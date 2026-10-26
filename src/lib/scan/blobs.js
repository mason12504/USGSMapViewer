// Candidate unit labels on a scanned map: small clusters of black glyphs.
//
// Geologic maps print unit codes in black, and plain full-page OCR drowns in
// colour, contour lines and place names. So we look for what a label is made
// of (a handful of glyph-sized black shapes in a row) and let the caller OCR
// each blob on its own, white background, nothing else around it.

import { components, inkMask } from './raster.js';

/**
 * @param img   {data,width,height} RGBA of (part of) the map
 * @param opts.pxPerPt  image pixels per PDF point
 * @returns [{x0,y0,x1,y1,glyphs}] pixel boxes, reading order not guaranteed
 */
export function findLabelBlobs(img, { pxPerPt = 3, ink = {} } = {}) {
  const mask = inkMask(img, ink);
  const comps = components(mask, img.width, img.height);

  // Glyph-sized shapes. Lowercase letters are only about half as tall as capitals,
  // so the floor is the x-height; a word still has to contain a capital-height glyph.
  const glyphs = comps.filter((c) => {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    const fill = c.n / (w * h);
    return h >= 2 * pxPerPt && h <= 9.5 * pxPerPt && w >= 0.8 * pxPerPt && w <= 9 * pxPerPt && fill > 0.2 && fill < 0.92;
  }).sort((a, b) => a.x0 - b.x0);

  // Join glyphs on one line into words: similar baseline, small gap.
  const words = [];
  for (const g of glyphs) {
    const h = g.y1 - g.y0 + 1;
    let w = null;
    for (let k = words.length - 1; k >= 0 && k >= words.length - 80; k--) {
      const c = words[k];
      const cap = Math.max(h, c.tall);
      const sameLine = Math.abs(c.y1 - g.y1) < 0.4 * cap || (h < 0.8 * cap && Math.abs(c.y1 - g.y1) < 0.55 * cap);
      const gap = g.x0 - c.x1;
      if (sameLine && gap < 0.75 * cap && gap > -3) { w = c; break; }
    }
    if (w) {
      w.x1 = Math.max(w.x1, g.x1);
      w.y0 = Math.min(w.y0, g.y0);
      w.y1 = Math.max(w.y1, g.y1);
      w.tall = Math.max(w.tall, h);
      w.glyphs++;
    } else {
      words.push({ x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, glyphs: 1, tall: h });
    }
  }
  // A code is short (1-8 glyphs, under ~40 pt) and has at least one capital-height glyph.
  return words
    .filter((w) => w.tall >= 3.4 * pxPerPt && w.glyphs <= 8 && w.x1 - w.x0 < 40 * pxPerPt && w.x1 - w.x0 > 4 * pxPerPt)
    .map(({ tall: _tall, ...w }) => w);
}

/** The blob's dark pixels on white, padded, as {data,width,height} grayscale RGBA. */
export function blobImage(img, blob, { padX = null, padY = null, ink = null } = {}) {
  const h = blob.y1 - blob.y0 + 1;
  // More room on the right: the last glyph is the one most often clipped.
  const left = padX ?? Math.round(0.5 * h);
  const right = padX ?? Math.round(1.0 * h);
  const vert = padY ?? Math.round(0.35 * h);
  const w = blob.x1 - blob.x0 + 1 + left + right;
  const hh = h + 2 * vert;
  const data = new Uint8ClampedArray(w * hh * 4).fill(255);

  // Ink inside this crop: clearly darker than the crop's own typical (background) brightness.
  const vals = [];
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const sx = blob.x0 - left + x, sy = blob.y0 - vert + y;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) { vals.push(255); continue; }
      const i = (sy * img.width + sx) * 4;
      vals.push(Math.max(img.data[i], img.data[i + 1], img.data[i + 2]));
    }
  }
  const sorted = Uint8Array.from(vals).sort();
  const background = sorted[Math.floor(sorted.length * 0.7)];
  const cut = ink?.cut ?? Math.min(150, background - 34);
  for (let p = 0; p < vals.length; p++) {
    if (vals[p] < cut) {
      const o = p * 4;
      data[o] = data[o + 1] = data[o + 2] = 0;
    }
  }
  return { data, width: w, height: hh };
}
