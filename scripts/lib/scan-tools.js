// Node-side helpers for scripts/scan-pdf.js: OCR with locally stored language
// data (the dev container cannot reach the CDN tesseract.js normally uses),
// and image encoding. Nothing here talks to the network.

import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { ROOT } from './node-pdf.js';
import { SHEET_CELLS, cellRect, sheetSize } from '../../src/lib/scan/sheets.js';

const LANG_DIR = path.join(ROOT, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int');
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

async function worker(params = {}) {
  const w = await createWorker('eng', 1, {
    langPath: LANG_DIR,
    gzip: true,
    cachePath: path.join(ROOT, '.cache/tesseract'),
    logger: () => {},
  });
  if (Object.keys(params).length) await w.setParameters(params);
  return w;
}

/** Two workers: paragraphs of text, and single short codes. */
export async function makeOcr() {
  const text = await worker();
  const code = await worker({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: CODE_CHARS });
  const word = await worker({ tessedit_pageseg_mode: '8', tessedit_char_whitelist: CODE_CHARS });
  return {
    /** Lines of text with boxes, for a block of paragraphs. */
    async lines(png) {
      const { data } = await text.recognize(png, {}, { blocks: true });
      const out = [];
      for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
        if (l.text.trim()) out.push({ text: l.text.trim(), bbox: l.bbox, confidence: l.confidence, words: (l.words || []).map((w) => ({ text: w.text, bbox: w.bbox, confidence: w.confidence })) });
      }
      return out;
    },
    /** One line holding one code (inside a swatch). */
    async codeLine(png) {
      const { data } = await code.recognize(png);
      return { text: data.text.trim(), confidence: Math.round(data.confidence) };
    },
    /** One word (a map label on its own). */
    async codeWord(png) {
      const { data } = await word.recognize(png);
      return { text: data.text.trim(), confidence: Math.round(data.confidence) };
    },
    async close() {
      await Promise.all([text.terminate(), code.terminate(), word.terminate()]);
    },
  };
}

/** {data,width,height} RGBA -> PNG buffer. */
export function toPng({ data, width, height }, scale = 1) {
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(width, height);
  id.data.set(data);
  ctx.putImageData(id, 0, 0);
  if (scale === 1) return c.toBuffer('image/png');
  const o = createCanvas(Math.round(width * scale), Math.round(height * scale));
  const octx = o.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.fillStyle = '#fff';
  octx.fillRect(0, 0, o.width, o.height);
  octx.drawImage(c, 0, 0, o.width, o.height);
  return o.toBuffer('image/png');
}

/** A swatch's code text, isolated: grayscale, Otsu threshold, white margin, upscaled. */
export function swatchCodeImage(img, sw, { inset = 4, up = 3 } = {}) {
  const w = sw.x1 - sw.x0 + 1 - 2 * inset;
  const h = sw.y1 - sw.y0 + 1 - 2 * (inset - 1);
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((sw.y0 + inset - 1 + y) * img.width + sw.x0 + inset + x) * 4;
      g[y * w + x] = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    }
  }
  const hist = new Array(256).fill(0);
  for (const v of g) hist[v | 0]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 100;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = w * h - wB;
    if (!wF) break;
    sB += i * hist[i];
    const v = wB * wF * (sB / wB - (sum - sB) / wF) ** 2;
    if (v > best) { best = v; thr = i; }
  }
  const bin = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const v = g[p] < thr ? 0 : 255;
    bin[p * 4] = bin[p * 4 + 1] = bin[p * 4 + 2] = v;
    bin[p * 4 + 3] = 255;
  }
  const src = createCanvas(w, h);
  const sctx = src.getContext('2d');
  const id = sctx.createImageData(w, h);
  id.data.set(bin);
  sctx.putImageData(id, 0, 0);
  const pad = 8;
  const out = createCanvas((w + 2 * pad) * up, (h + 2 * pad) * up);
  const o = out.getContext('2d');
  o.fillStyle = '#fff';
  o.fillRect(0, 0, out.width, out.height);
  o.imageSmoothingEnabled = true;
  o.drawImage(src, pad * up, pad * up, w * up, h * up);
  return out.toBuffer('image/png');
}

/**
 * A new numbered sheet made of cells cut out of existing label sheets (no PDF re-render).
 * @param pickCell async (sheetNo) -> loaded sheet image; cells [{sheet, cell}] in the order they get 1..n
 * @returns {png: Buffer, count}
 */
export async function sliceSheet(loadSheet, cells) {
  const g = SHEET_CELLS;
  const { width, height } = sheetSize(cells.length, g);
  const out = createCanvas(width, height);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  const cache = new Map();
  for (const [i, c] of cells.entries()) {
    if (!cache.has(c.sheet)) cache.set(c.sheet, await loadSheet(c.sheet));
    const src = cellRect(c.cell, g);
    const dst = cellRect(i + 1, g);
    ctx.drawImage(cache.get(c.sheet), src.x, src.y, src.w, src.h, dst.x, dst.y, dst.w, dst.h);
    // The old cell number is in the corner: cover it and print the new one.
    ctx.fillStyle = '#fff';
    ctx.fillRect(dst.x + 1, dst.y + 1, 30, 20);
    ctx.fillStyle = '#c00';
    ctx.font = '13px sans-serif';
    ctx.fillText(String(i + 1), dst.x + 3, dst.y + 14);
  }
  return { png: out.toBuffer('image/png'), count: cells.length };
}

export { createCanvas, loadImage };
