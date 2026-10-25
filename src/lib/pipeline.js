// The parsing pipeline: one pdf.js page in, one plain JSON result out.
//
//   operator list ──► vector fills/images ─┐
//                                          ├─► legend entries ─┐
//   text content  ──► positioned words ────┘                   ├─► map labels ─► color check
//                                          map region ─────────┘
//
// Environment-agnostic: works with pdf.js in the browser or in Node (tests,
// scripts). Pass the matching pdf.js `OPS` table in.

import { extractTextItems, splitWords } from './pdf/textItems.js';
import { extractVectorShapes } from './pdf/vectorShapes.js';
import { isUnitCodeShape, mergeSplitCodes, mergeSubscripts } from './units/unitCodes.js';
import { findLegendEntries } from './legend/legend.js';
import { findMapLabels, findMapRegion } from './labels/mapLabels.js';
import { analyzeColors } from './color/index.js';
import { bboxCenter, bboxContainsPoint } from './geometry.js';

export const RESULT_VERSION = 1;

/**
 * @param page  pdf.js PDFPageProxy (document opened with fontExtraProperties: true)
 * @param opts.OPS         pdf.js OPS enum
 * @param opts.onProgress  (stage: string) => void
 * @param opts.sampler     optional pixel sampler (enables raster color strategy)
 * @returns {{result: object, internals: object}}
 *   result    — serializable JSON (what the UI renders, what tests snapshot)
 *   internals — heavy objects for interactive use (fills index, raw items)
 */
export async function parseMapPage(page, { OPS, onProgress = () => {}, sampler = null } = {}) {
  if (!OPS) throw new Error('parseMapPage: pass the pdf.js OPS table');
  const viewport = page.getViewport({ scale: 1 });
  const pageSize = { width: viewport.width, height: viewport.height };
  const warnings = [];

  onProgress('Reading vector graphics');
  // Must run before text extraction: it loads fonts, which gives us real
  // font names (bold detection).
  const opList = await page.getOperatorList();
  const shapes = extractVectorShapes(opList, OPS, viewport.transform);

  onProgress('Reading text layer');
  const rawItems = await extractTextItems(page, viewport);
  const items = mergeSubscripts(splitWords(rawItems));
  const codeLike = items.filter((i) => isUnitCodeShape(i.str)).length;
  if (codeLike < 5) {
    warnings.push({
      code: 'no-text-layer',
      message: 'Almost no unit codes in the PDF text layer — this looks like a scanned map. OCR/AI fallback needed.',
    });
  }

  onProgress('Finding legend entries');
  const legend = findLegendEntries(items, shapes.fills);
  if (!legend.entries.length) {
    warnings.push({ code: 'no-legend', message: 'No legend swatches with bold unit names were found.' });
  }

  onProgress('Finding map labels');
  const mapRegion = findMapRegion({ images: shapes.images, fills: shapes.fills, swatches: legend.swatches, page: pageSize });
  const legendKeys = new Set(legend.entries.map((e) => e.key));
  const codeItems = mergeSplitCodes(items, legendKeys);
  const { labels, unmatched } = findMapLabels(codeItems, {
    legendKeys: legendKeys.size ? legendKeys : null,
    swatchLabels: legend.swatchLabels,
    region: mapRegion.bbox,
  });
  // Unit codes elsewhere on the sheet: cross-sections, the correlation chart. Kept apart from
  // `labels` so the map's counts and color check stay about the map frame.
  const plateLabels = legendKeys.size
    ? findMapLabels(codeItems, { legendKeys, swatchLabels: legend.swatchLabels, region: null }).labels
      .filter((l) => !bboxContainsPoint(mapRegion.bbox, ...bboxCenter(l.codeBbox)))
      .map((l, i) => ({ ...l, id: `p${i}`, other: true }))
    : [];

  onProgress('Checking colors and patterns');
  const ignoreColors = shapes.images.filter((im) => im.kind === 'mask' && im.color).map((im) => im.color);
  const color = analyzeColors({
    labels,
    legend: legend.entries,
    fills: shapes.fills,
    strokes: shapes.strokes,
    mapRegion: mapRegion.bbox,
    sampler,
    ignoreColors,
  });
  const primary = color.primary ? color[color.primary] : null;
  labels.forEach((lab, i) => {
    lab.color = primary ? primary.perLabel[i] : null;
    if (color.vector && color.raster) lab.colorAlt = color.raster.perLabel[i];
  });

  const counts = {};
  for (const l of labels) counts[l.key] = (counts[l.key] || 0) + 1;

  const result = {
    version: RESULT_VERSION,
    page: pageSize,
    mapRegion,
    legend: legend.entries.map((e) => ({ ...e, labelCount: counts[e.key] || 0 })),
    labels,
    plateLabels,
    unmatchedCodes: unmatched,
    color: {
      primary: color.primary,
      vector: color.vector ? color.vector.summary : null,
      raster: color.raster ? color.raster.summary : null,
      legendPalettes: color.raster ? color.raster.legendPalettes : null,
    },
    stats: {
      textItems: rawItems.length,
      codeLikeWords: codeLike,
      fills: shapes.fills.length,
      patterns: shapes.patterns.length,
      images: shapes.images.length,
    },
    warnings,
  };
  return { result, internals: { shapes, items, color } };
}
