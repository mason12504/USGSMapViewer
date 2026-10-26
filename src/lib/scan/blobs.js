// Candidate unit labels on a scanned map: small clusters of black glyphs.
//
// Geologic maps print unit codes in black, and plain full-page OCR drowns in
// colour, contour lines and place names. So we look for what a label is made
// of (a handful of glyph-sized black shapes in a row) and let the caller OCR
// each blob on its own, white background, nothing else around it.

import { components, darkMask } from './raster.js';

/**
 * @param img   {data,width,height} RGBA of (part of) the map
 * @param opts.pxPerPt  image pixels per PDF point
 * @returns [{x0,y0,x1,y1,glyphs}] pixel boxes, reading order not guaranteed
 */
export function findLabelBlobs(img, { pxPerPt = 3, darkThreshold = 95 } = {}) {
  const mask = darkMask(img, darkThreshold);
  const comps = components(mask, img.width, img.height);

  const glyphs = comps.filter((c) => {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    const fill = c.n / (w * h);
    return h >= 3.3 * pxPerPt && h <= 9.5 * pxPerPt && w <= 9 * pxPerPt && fill > 0.15 && fill < 0.9;
  }).sort((a, b) => a.x0 - b.x0);

  // Join glyphs on one line into words: similar top/bottom, small gap.
  const words = [];
  for (const g of glyphs) {
    const h = g.y1 - g.y0 + 1;
    let w = null;
    for (let k = words.length - 1; k >= 0 && k >= words.length - 60; k--) {
      const c = words[k];
      const ch = c.y1 - c.y0 + 1;
      const hh = Math.max(h, ch);
      const sameLine = Math.abs(c.y1 - g.y1) < 0.45 * hh || Math.abs(c.y0 - g.y0) < 0.45 * hh;
      const gap = g.x0 - c.x1;
      if (sameLine && gap < 0.9 * hh && gap > -3) { w = c; break; }
    }
    if (w) {
      w.x1 = Math.max(w.x1, g.x1);
      w.y0 = Math.min(w.y0, g.y0);
      w.y1 = Math.max(w.y1, g.y1);
      w.glyphs++;
    } else {
      words.push({ x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, glyphs: 1 });
    }
  }
  // A code is short: 1-7 glyphs, under ~40 pt wide.
  return words.filter((w) => w.glyphs >= 1 && w.glyphs <= 7 && w.x1 - w.x0 < 40 * pxPerPt && w.x1 - w.x0 > 5 * pxPerPt);
}

/** The blob's dark pixels on white, padded, as {data,width,height} grayscale RGBA. */
export function blobImage(img, blob, { pad = 5, darkThreshold = 95 } = {}) {
  const w = blob.x1 - blob.x0 + 1 + 2 * pad;
  const h = blob.y1 - blob.y0 + 1 + 2 * pad;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = blob.x0 - pad + x, sy = blob.y0 - pad + y;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const i = (sy * img.width + sx) * 4;
      if (Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) < darkThreshold) {
        const o = (y * w + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = 0;
      }
    }
  }
  return { data, width: w, height: h };
}
