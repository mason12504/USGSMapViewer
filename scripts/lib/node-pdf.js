// Open PDFs with pdf.js in Node (tests and scripts). The browser has its own
// loader in src/pdf/pdfjs.browser.js; both feed the same src/lib pipeline.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PDFJS_DIR = path.join(ROOT, 'node_modules/pdfjs-dist');

export const { OPS } = pdfjs;
export { ROOT };

export async function openPdf(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false, // never run JS embedded in a PDF
    fontExtraProperties: true, // real font names -> bold detection
    wasmUrl: PDFJS_DIR + '/wasm/', // JBIG2/JPX decoders (topo base layers are often JBIG2)
    standardFontDataUrl: PDFJS_DIR + '/standard_fonts/',
    cMapUrl: PDFJS_DIR + '/cmaps/',
    cMapPacked: true,
    verbosity: 0,
  }).promise;
  return doc;
}

/**
 * Render a page region to RGBA pixels with @napi-rs/canvas.
 * bbox in page units; returns {data, width, height, scale}.
 */
export async function renderRegion(page, bbox, scale) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const width = Math.max(1, Math.ceil((bbox.x1 - bbox.x0) * scale));
  const height = Math.max(1, Math.ceil((bbox.y1 - bbox.y0) * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const viewport = page.getViewport({ scale });
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    transform: [1, 0, 0, 1, -bbox.x0 * scale, -bbox.y0 * scale],
    background: '#ffffff',
  }).promise;
  const img = ctx.getImageData(0, 0, width, height);
  return { data: img.data, width, height, scale, canvas };
}

/**
 * A pixel sampler (see src/lib/color/rasterMatch.js) backed by ONE render of
 * `region` at `scale`; getPixels crops from it.
 */
export async function makeNodeSampler(page, region, scale = 3) {
  const r = await renderRegion(page, region, scale);
  return {
    scale,
    region,
    canvas: r.canvas,
    getPixels(bbox) {
      const x0 = Math.max(0, Math.floor((bbox.x0 - region.x0) * scale));
      const y0 = Math.max(0, Math.floor((bbox.y0 - region.y0) * scale));
      const x1 = Math.min(r.width, Math.ceil((bbox.x1 - region.x0) * scale));
      const y1 = Math.min(r.height, Math.ceil((bbox.y1 - region.y0) * scale));
      const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0);
      const out = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        const src = ((y0 + y) * r.width + x0) * 4;
        out.set(r.data.subarray(src, src + w * 4), y * w * 4);
      }
      return { data: out, width: w, height: h };
    },
  };
}
