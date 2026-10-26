// Turn a scanned map's resolved.json (OCR + the paid reading step) into the same
// result object the app gets from a text-layer PDF, so the viewer, legend panel
// and unit details need no special case.
//
// Pure data in, data out: no I/O.

import { RESULT_VERSION } from '../pipeline.js';
import { titleCaseIfShouting } from '../legend/legend.js';
import { ageForCode, normalizeCode } from '../units/unitCodes.js';
import { canonicalCode } from './glyphs.js';

const hex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const nice = (s) => titleCaseIfShouting((s || '').replace(/[\s:]+$/, '').trim());

/**
 * @param resolved  parsed resolved.json
 * @returns {{result, internals}} like parseMapPage
 */
export function scanResultFromResolved(resolved) {
  const page = resolved.page;
  const mapBox = resolved.map || { x0: 0, y0: 0, x1: page.width, y1: page.height };

  // Legend: entries with a swatch and a code. A swatch-less all-caps heading
  // ("UNCONSOLIDATED DEPOSITS (HOLOCENE):") names the group of the entries below it.
  const legend = [];
  const seen = new Set();
  let group = null;
  let column = null;
  for (const e of resolved.entries || []) {
    if (e.column !== column) { column = e.column; group = null; }
    if (!e.swatch || !e.code) {
      if (!e.swatch && e.name && e.name === e.name.toUpperCase() && /[A-Z]{4,}/.test(e.name)) group = { name: nice(e.name) };
      continue;
    }
    // Matching uses the plain-letter form ("MCr"); the legend keeps the code as printed ("M€r").
    const key = normalizeCode(canonicalCode(e.code));
    if (seen.has(key)) continue; // a code read twice: keep the first
    seen.add(key);
    const color = hex(e.swatch.color || [128, 128, 128]);
    legend.push({
      code: e.code,
      key,
      age: ageForCode(e.code),
      name: nice(e.name) || e.code,
      ageText: e.ageText ? nice(e.ageText) : null,
      description: '', // the scan has no separate "brief" line: name and age above are it
      group: group ? { ...group } : undefined,
      swatch: {
        bbox: { x0: e.swatch.x0, y0: e.swatch.y0, x1: e.swatch.x1, y1: e.swatch.y1 },
        paint: { kind: 'rgb', color },
        paintKey: `rgb:${color}`,
      },
      swatchTextBbox: null,
      // The legend paragraph (OCR) is the "full description" for a scan.
      report: e.description && e.description.length > 20
        ? { text: e.description, page: null, matchedBy: 'legend', truncated: false, heading: e.name }
        : null,
      source: 'scan',
      codeSource: e.codeSource || null,
    });
  }

  const known = new Set(legend.map((e) => e.key));
  const byKey = Object.fromEntries(legend.map((e) => [e.key, e]));
  const labels = [];
  const plateLabels = [];
  for (const l of resolved.labels || []) {
    const lkey = l.final ? normalizeCode(canonicalCode(l.final)) : null;
    if (!lkey || !known.has(lkey)) continue;
    const c = { x: (l.bbox.x0 + l.bbox.x1) / 2, y: (l.bbox.y0 + l.bbox.y1) / 2 };
    const inMap = c.x >= mapBox.x0 && c.x <= mapBox.x1 && c.y >= mapBox.y0 && c.y <= mapBox.y1;
    const label = {
      id: inMap ? labels.length : `p${plateLabels.length}`,
      code: byKey[lkey].code, // as printed in the legend
      key: lkey,
      uncertain: false,
      bbox: { ...l.bbox },
      codeBbox: { ...l.bbox },
      angle: 0,
      color: null,
      // How this label was read, shown in the unit details.
      read: { by: l.source, confidence: l.aiConfidence || null, ocrText: l.corrected || null },
      ...(inMap ? {} : { other: true }),
    };
    (inMap ? labels : plateLabels).push(label);
  }

  const counts = {};
  for (const l of [...labels, ...plateLabels]) counts[l.key] = (counts[l.key] || 0) + 1;
  for (const e of legend) e.labelCount = counts[e.key] || 0;

  const result = {
    version: RESULT_VERSION,
    page: { width: page.width, height: page.height },
    mapRegion: { bbox: { ...mapBox }, method: 'scan' },
    legend,
    labels,
    plateLabels,
    unmatchedCodes: [],
    color: { primary: null, vector: null, raster: null, legendPalettes: null },
    stats: { swatches: resolved.swatches?.length ?? legend.length, labelBlobs: resolved.labels?.length ?? 0 },
    warnings: [{
      code: 'scanned',
      message: `Scanned map: read from saved OCR and AI results (${labels.length + plateLabels.length} of ${resolved.labels?.length ?? '?'} candidate labels were identified, so some labels on the map are not clickable). Color is only a hint on a scan: look-alike units share a color, so use Color check to spot doubtful labels, not to confirm them.`,
    }],
    source: 'scan',
    document: { pageCount: 1, plate: { pageNumber: 1, width: page.width, height: page.height }, pages: [{ pageNumber: 1, kind: 'plate' }], report: null },
  };
  return { result, internals: { color: null } };
}
