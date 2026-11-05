// Which map shapes belong to a legend unit? Used by the viewer to gray out
// the map and outline every polygon of the picked unit.
//
// 1. Exact: shapes whose paint key equals the legend swatch's paint key.
// 2. Colors: some maps tile the same pattern at a different scale on the map
//    than in the legend, so the hash differs while the colors are identical
//    (Manitou: Qcs, Qf, Qm1-3 ...). Match by color set, but only when that
//    color set belongs to exactly one legend unit.

import { isBackgroundPaint, paintKey } from './paint.js';

const colorSignature = (paint) => (paint?.kind === 'pattern' && paint.colors?.length ? [...paint.colors].sort().join('|') : null);

/**
 * Teach a paint lookup (paintKey -> unit keys) the map patterns that match a legend unit only by colors
 * (same colors, different tile hash). Mutates and returns `lookup`. Same rule as shapesForUnit.
 */
export function addColorAliases(lookup, legend, fills) {
  const bySig = new Map(); // color signature -> legend unit keys
  for (const e of legend) {
    const sig = colorSignature(e.swatch?.paint);
    if (!sig || isBackgroundPaint(e.swatch.paint)) continue;
    if (!bySig.has(sig)) bySig.set(sig, []);
    bySig.get(sig).push(e.key);
  }
  for (const f of fills || []) {
    const k = paintKey(f.paint);
    if (lookup.has(k)) continue;
    const units = bySig.get(colorSignature(f.paint));
    if (units?.length === 1) lookup.set(k, units);
  }
  return lookup;
}

/**
 * @param {{index: {fills: Array}}} analysis  result of analyzeColors()
 * @param {Array} legend                      legend entries
 * @param {string} key                        legend unit key
 * @returns {{shapes: Array, method: 'exact'|'colors'|null}}  shapes = the fills (rings in page units)
 */
export function shapesForUnit(analysis, legend, key) {
  const fills = analysis?.index?.fills;
  const entry = legend.find((e) => e.key === key);
  const paint = entry?.swatch?.paint;
  if (!fills || !paint || isBackgroundPaint(paint)) return { shapes: [], method: null };

  const want = paintKey(paint);
  const exact = fills.filter((f) => paintKey(f.paint) === want);
  if (exact.length) return { shapes: exact, method: 'exact' };

  const sig = colorSignature(paint);
  if (!sig) return { shapes: [], method: null };
  const sharing = legend.filter((e) => colorSignature(e.swatch?.paint) === sig);
  if (sharing.length !== 1) return { shapes: [], method: null };
  const legendKeys = new Set(legend.map((e) => e.swatch?.paintKey).filter(Boolean));
  // Only patterns the legend has no exact swatch for: those with an exact swatch belong to that unit.
  const byColors = fills.filter((f) => !legendKeys.has(paintKey(f.paint)) && colorSignature(f.paint) === sig);
  return byColors.length ? { shapes: byColors, method: 'colors' } : { shapes: [], method: null };
}

/** SVG path data for a list of fills (page units), one `d` per fill-rule group. */
export function shapesToPaths(shapes) {
  const by = { nonzero: [], evenodd: [] };
  for (const f of shapes) {
    const d = f.rings.map((r) => 'M' + r.map(([x, y]) => `${+x.toFixed(1)} ${+y.toFixed(1)}`).join('L') + 'Z').join('');
    by[f.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'].push(d);
  }
  return Object.entries(by).filter(([, ds]) => ds.length).map(([fillRule, ds]) => ({ fillRule, d: ds.join('') }));
}
