// Find the map frame and the unit labels printed inside it.

import { bboxArea, bboxCenter, bboxContainsPoint, unionBbox } from '../geometry.js';
import { isUnitCodeShape, normalizeCode } from '../units/unitCodes.js';
import { isBackgroundPaint } from '../color/paint.js';

/**
 * The interval along one axis holding most of the filled area: intervals closer
 * than `gap` merge into clusters, and the cluster with the most area wins.
 */
export function dominantSpan(boxes, lo, hi, gap = 12) {
  const iv = boxes
    .map((b) => ({ lo: b[lo], hi: b[hi], area: bboxArea(b) }))
    .sort((a, b) => a.lo - b.lo);
  const clusters = [];
  for (const it of iv) {
    const last = clusters[clusters.length - 1];
    if (last && it.lo - last.hi <= gap) {
      last.hi = Math.max(last.hi, it.hi);
      last.area += it.area;
    } else {
      clusters.push({ lo: it.lo, hi: it.hi, area: it.area });
    }
  }
  const best = clusters.reduce((a, b) => (b.area > a.area ? b : a));
  return [best.lo, best.hi];
}

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
    const inside = [];
    for (const f of fills) {
      if (swatchSet.has(f) || isBackgroundPaint(f.paint)) continue;
      const [cx, cy] = bboxCenter(f.bbox);
      if (bboxContainsPoint(img, cx, cy)) inside.push(f.bbox);
    }
    // Legend swatches we failed to recognise, scale bars and footer art all
    // sit outside the map as thin slivers. Keep only the dominant cluster.
    let geo = null;
    if (inside.length) {
      const [x0, x1] = dominantSpan(inside, 'x0', 'x1');
      const [y0, y1] = dominantSpan(inside, 'y0', 'y1');
      geo = { x0, y0, x1, y1 };
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
  const inSwatch = new Set(swatchLabels.flatMap((s) => [s.item, ...(s.item.parts || [])]));
  const labels = [];
  const unmatched = new Map();

  for (const it of items) {
    if (inSwatch.has(it) || it.parts?.some((part) => inSwatch.has(part))) continue;
    // "Kl?" = uncertain identification of Kl; keep the flag, match on "Kl".
    const rawStr = it.str.trim();
    const uncertain = /\?$/.test(rawStr);
    const str = rawStr.replace(/\?$/, '');
    // Codes with an unusual shape ("af", "PIPf") count only because the legend defines them.
    const inLegend = Boolean(legendKeys?.has(normalizeCode(str))) && str.length <= 7;
    if (!isUnitCodeShape(str) && !inLegend) continue;
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
