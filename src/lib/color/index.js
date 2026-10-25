// Color / pattern analysis — public API of the color compartment.
//
// Everything color-related lives in src/lib/color/ and is reached only through
// this file, so you can iterate on color matching without touching text
// parsing or the UI. Work loop:
//
//   npm run color:lab -- fixtures/pikeview/OF-01-03_Pikeview_Geologic_Map.pdf
//
// which prints accuracy for both strategies and writes debug images to .lab/.
// See src/lib/color/README.md.

import { buildFillIndex, matchLabelsVector, unitAtPoint, legendPaintLookup } from './vectorMatch.js';
import { matchLabelsRaster } from './rasterMatch.js';

export { describePaint, paintColors, paintKey } from './paint.js';
export { buildFillIndex, unitAtPoint, legendPaintLookup } from './vectorMatch.js';
export { labelPalette, rankUnits, swatchPalette } from './rasterMatch.js';

/**
 * @param {object} p
 * @param {Array}  p.labels     map labels ({key, bbox, codeBbox})
 * @param {Array}  p.legend     legend entries (with swatch.paint / swatch.paintKey)
 * @param {Array}  p.fills      vector fills (may be empty for raster maps)
 * @param {Array}  [p.strokes]  short stroked polylines (label leader lines)
 * @param {object} p.mapRegion  bbox of the map frame
 * @param {object} [p.sampler]  pixel sampler; enables the raster strategy
 * @param {Array}  [p.ignoreColors] hex colors to ignore in raster mode (e.g. topo linework)
 */
export function analyzeColors({ labels, legend, fills, strokes = [], mapRegion, sampler = null, ignoreColors = [] }) {
  const result = { primary: null, vector: null, raster: null };

  const index = buildFillIndex(fills || [], mapRegion);
  const lookup = legendPaintLookup(legend);
  if (index.count > 0 && lookup.size > 0) {
    result.vector = matchLabelsVector(labels, legend, index, strokes);
    // Only trust the vector strategy if a decent share of labels found a paint.
    if (result.vector.summary.total && result.vector.summary.unknown / result.vector.summary.total < 0.5) {
      result.primary = 'vector';
    }
  }
  if (sampler) {
    result.raster = matchLabelsRaster(labels, legend, sampler, { ignoreColors });
    if (!result.primary) result.primary = 'raster';
  }
  return { ...result, index, lookup };
}

/** Convenience for the UI: unit(s) under an arbitrary click. Vector maps only. */
export function identifyAt(colorAnalysis, x, y) {
  if (!colorAnalysis?.index || !colorAnalysis.lookup) return null;
  return unitAtPoint(colorAnalysis.index, colorAnalysis.lookup, x, y);
}
