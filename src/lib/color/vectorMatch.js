// Strategy 1 — EXACT matching for vector maps.
//
// Every map polygon is a filled path. For a point on the map, the topmost
// filled path containing it (ignoring paper-white knockouts) tells us its
// paint; the legend swatch with the same paint key is the unit.

import { bboxContainsPoint, pathContainsPoint } from '../geometry.js';
import { isBackgroundPaint, paintKey } from './paint.js';

const CELL = 64; // page units per spatial-index cell

/** Spatial index over fills inside `region` (page units), topmost-first lookups. */
export function buildFillIndex(fills, region) {
  const inRegion = fills.filter((f) =>
    !region || (f.bbox.x1 >= region.x0 && f.bbox.x0 <= region.x1 && f.bbox.y1 >= region.y0 && f.bbox.y0 <= region.y1));
  const grid = new Map();
  for (const f of inRegion) {
    const cx0 = Math.floor(f.bbox.x0 / CELL), cx1 = Math.floor(f.bbox.x1 / CELL);
    const cy0 = Math.floor(f.bbox.y0 / CELL), cy1 = Math.floor(f.bbox.y1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const k = cx + ',' + cy;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(f);
      }
    }
  }
  for (const list of grid.values()) list.sort((a, b) => b.order - a.order);
  return { grid, region, count: inRegion.length };
}

/** All fills containing (x, y), topmost first. */
export function fillsAtPoint(index, x, y) {
  if (index.region && !bboxContainsPoint(index.region, x, y)) return [];
  const list = index.grid.get(Math.floor(x / CELL) + ',' + Math.floor(y / CELL)) || [];
  return list.filter((f) => bboxContainsPoint(f.bbox, x, y) && pathContainsPoint(f.rings, x, y, f.fillRule));
}

/** Map paintKey -> [unit keys] from parsed legend entries. */
export function legendPaintLookup(legend) {
  const m = new Map();
  for (const e of legend) {
    const k = e.swatch?.paintKey;
    if (!k || isBackgroundPaint(e.swatch.paint)) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(e.key);
  }
  return m;
}

/**
 * Which legend unit(s) is the map at (x, y)?
 * @returns {units: string[], paintKey, paint, depth} depth = how many fills
 *          above the matching one were skipped (0 = topmost).
 */
export function unitAtPoint(index, lookup, x, y) {
  const stack = fillsAtPoint(index, x, y);
  for (let d = 0; d < stack.length; d++) {
    const f = stack[d];
    if (isBackgroundPaint(f.paint)) continue;
    const k = paintKey(f.paint);
    if (lookup.has(k)) return { units: lookup.get(k), paintKey: k, paint: f.paint, depth: d };
  }
  const top = stack.find((f) => !isBackgroundPaint(f.paint));
  return { units: [], paintKey: top ? paintKey(top.paint) : null, paint: top?.paint || null, depth: -1 };
}

/**
 * Check every map label against the paint underneath it.
 * Samples a few points around the label (labels can straddle contacts) and votes.
 */
/**
 * Find a short stroke with one end touching the label box, and return the
 * unit(s) painted at (or just past) its other end.
 */
export function followLeader(lab, strokes, index, lookup) {
  const b = lab.bbox;
  const h = b.y1 - b.y0;
  const near = (x, y, pad) => x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad;
  let best = null;
  for (const s of strokes) {
    if (s.bbox.x1 < b.x0 - h || s.bbox.x0 > b.x1 + h || s.bbox.y1 < b.y0 - h || s.bbox.y0 > b.y1 + h) continue;
    const pts = s.points;
    const a = pts[0], z = pts[pts.length - 1];
    let start, end, prevPt;
    if (near(a[0], a[1], 0.6 * h) && !near(z[0], z[1], 0.6 * h)) {
      [start, end, prevPt] = [a, z, pts[pts.length - 2]];
    } else if (near(z[0], z[1], 0.6 * h) && !near(a[0], a[1], 0.6 * h)) {
      [start, end, prevPt] = [z, a, pts[1]];
    } else continue;
    // Sample the far end and a little beyond it along the last segment.
    const dx = end[0] - prevPt[0], dy = end[1] - prevPt[1];
    const len = Math.hypot(dx, dy) || 1;
    const samples = [end, [end[0] + (dx / len) * 1.5, end[1] + (dy / len) * 1.5]];
    for (const [x, y] of samples) {
      const hit = unitAtPoint(index, lookup, x, y);
      if (hit.units.length) {
        const dist = Math.hypot(start[0] - (b.x0 + b.x1) / 2, start[1] - (b.y0 + b.y1) / 2);
        if (!best || dist < best.dist) best = { units: hit.units, line: pts, dist };
        break;
      }
    }
  }
  return best;
}

export function matchLabelsVector(labels, legend, index, strokes = []) {
  const lookup = legendPaintLookup(legend);
  const perLabel = labels.map((lab) => {
    const b = lab.codeBbox || lab.bbox;
    const h = b.y1 - b.y0;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const pts = [
      [cx, cy],
      [b.x0 - 0.6 * h, cy], [b.x1 + 0.6 * h, cy],
      [cx, b.y0 - 0.6 * h], [cx, b.y1 + 0.6 * h],
    ];
    // Cartographers place a label INSIDE its polygon, so the paint under the
    // label's center decides. The surrounding points only vote when the
    // center hits nothing usable (label on a knockout, a line, or a gap).
    const votes = new Map();
    let firstPaint = null;
    let centerUnits = null;
    pts.forEach(([x, y], i) => {
      const hit = unitAtPoint(index, lookup, x, y);
      if (i === 0) {
        firstPaint = hit.paintKey;
        if (hit.units.length) centerUnits = hit.units;
      }
      const k = hit.units.length ? hit.units.join('|') : null;
      if (k) votes.set(k, (votes.get(k) || 0) + 1);
    });
    const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    let predicted = centerUnits || (ranked.length ? ranked[0][0].split('|') : []);
    let via = 'center';
    let leader = null;

    // Label placed OUTSIDE its (small) polygon with a leader line: follow
    // the line and read the paint at its far end.
    if (!predicted.includes(lab.key) && strokes?.length) {
      const hit = followLeader(lab, strokes, index, lookup);
      if (hit) {
        leader = hit.line;
        if (hit.units.includes(lab.key) || !predicted.length) {
          predicted = hit.units;
          via = 'leader';
        }
      }
    }

    const agrees = predicted.includes(lab.key);
    const supports = agrees || ranked.some(([k]) => k.split('|').includes(lab.key));
    return {
      method: 'vector',
      via,
      predicted,
      agrees,
      supports,
      paintKey: firstPaint,
      votes: Object.fromEntries(ranked),
      leader,
    };
  });
  return { perLabel, summary: summarize(perLabel), lookupSize: lookup.size };
}

export function summarize(perLabel) {
  const total = perLabel.length;
  const agree = perLabel.filter((p) => p.agrees).length;
  const unknown = perLabel.filter((p) => !p.predicted.length).length;
  return {
    total,
    agree,
    disagree: total - agree - unknown,
    unknown,
    accuracy: total ? agree / total : 0,
  };
}
