// Find the map frame and the unit labels printed inside it.

import { bboxArea, bboxCenter, bboxContainsPoint, unionBbox } from '../geometry.js';
import { isUnitCodeShape, normalizeCode } from '../units/unitCodes.js';
import { isBackgroundPaint } from '../color/paint.js';

/**
 * The map frame. Heuristics, in order:
 *   1. the largest raster image/mask covering >= 12% of the page (scanned map,
 *      or a topographic base layer drawn over vector geology, as on Pikeview)
 *   2. the union of large non-swatch vector fills (pure vector maps)
 *   3. the whole page
 */
export function findMapRegion({ images = [], fills = [], swatches = [], page }) {
  const pageArea = page.width * page.height;
  const clip = (b) => ({
    x0: Math.max(0, b.x0), y0: Math.max(0, b.y0),
    x1: Math.min(page.width, b.x1), y1: Math.min(page.height, b.y1),
  });

  const swatchSet = new Set(swatches);
  const bigImage = [...images].sort((a, b) => bboxArea(b.bbox) - bboxArea(a.bbox))[0];
  if (bigImage && bboxArea(clip(bigImage.bbox)) >= 0.12 * pageArea) {
    const img = clip(bigImage.bbox);
    // Images usually include the map collar. If vector geology fills sit
    // inside the image, their extent is the real map frame (the neatline).
    let geo = null;
    for (const f of fills) {
      if (swatchSet.has(f) || isBackgroundPaint(f.paint)) continue;
      const [cx, cy] = bboxCenter(f.bbox);
      if (bboxContainsPoint(img, cx, cy)) geo = unionBbox(geo, f.bbox);
    }
    const method = bigImage.kind === 'mask' ? 'base-layer-mask' : 'raster-image';
    if (geo && bboxArea(geo) >= 0.5 * bboxArea(img)) {
      const tight = {
        x0: Math.max(img.x0, geo.x0), y0: Math.max(img.y0, geo.y0),
        x1: Math.min(img.x1, geo.x1), y1: Math.min(img.y1, geo.y1),
      };
      return { bbox: tight, method: method + '+geology-extent' };
    }
    return { bbox: img, method };
  }

  let union = null;
  for (const f of fills) {
    if (swatchSet.has(f)) continue;
    if (bboxArea(f.bbox) < 0.0005 * pageArea) continue;
    if (bboxArea(f.bbox) > 0.9 * pageArea) continue; // page background
    union = unionBbox(union, f.bbox);
  }
  if (union && bboxArea(union) >= 0.1 * pageArea) return { bbox: clip(union), method: 'vector-fills' };

  return { bbox: { x0: 0, y0: 0, x1: page.width, y1: page.height }, method: 'whole-page' };
}

/**
 * Unit labels inside the map frame whose code appears in the legend.
 * Code-shaped words that are NOT in the legend are returned as `unmatched`
 * (useful for spotting legend-parsing misses; also catches words like "Creek").
 */
export function findMapLabels(items, { legendKeys, swatchLabels = [], region }) {
  const inSwatch = new Set(swatchLabels.map((s) => s.item));
  const labels = [];
  const unmatched = new Map();

  for (const it of items) {
    if (inSwatch.has(it)) continue;
    // "Kl?" = uncertain identification of Kl; keep the flag, match on "Kl".
    const rawStr = it.str.trim();
    const uncertain = /\?$/.test(rawStr);
    const str = rawStr.replace(/\?$/, '');
    if (!isUnitCodeShape(str)) continue;
    const base = it.parts ? it.parts[0] : it;
    const [cx, cy] = bboxCenter(base);
    if (region && !bboxContainsPoint(region, cx, cy)) continue;
    const key = normalizeCode(str);
    if (legendKeys && !legendKeys.has(key)) {
      unmatched.set(str, (unmatched.get(str) || 0) + 1);
      continue;
    }
    labels.push({
      id: labels.length,
      code: str,
      key,
      uncertain,
      bbox: { x0: it.x0, y0: it.y0, x1: it.x1, y1: it.y1 },
      codeBbox: { x0: base.x0, y0: base.y0, x1: base.x1, y1: base.y1 },
      angle: it.angle,
    });
  }
  return {
    labels,
    unmatched: [...unmatched.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count })),
  };
}
