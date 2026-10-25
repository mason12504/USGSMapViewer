// A whole publication in, one result out.
//
// State-survey reports bundle the plate (the big sheet with the map, legend,
// cross-sections) with the report text that describes every unit in full:
//
//   pages 1..N-1   letter-size report text  ─► full unit descriptions
//   page N         the plate (2592 x 3024)  ─► legend, labels, colors
//
// The plate is parsed exactly as a standalone one-page PDF would be. The
// report is read for "Name (Age)—description" entries, which are attached to
// the plate's legend entries. Plain one-page map PDFs pass straight through.
//
// Environment-agnostic like pipeline.js: pass the opened pdf.js document and OPS.

import { parseMapPage } from './pipeline.js';
import { extractTextItems } from './pdf/textItems.js';
import { mergeSubscripts } from './units/unitCodes.js';
import { findReportEntries, matchReportToLegend } from './report/descriptions.js';

/** A page this many times the median page area is a plate, not report text. */
const PLATE_AREA_RATIO = 3;

/** Page sizes (PDF points) without touching page content. */
export async function readPageSizes(doc) {
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
    pages.push({ pageNumber: n, width: vp.width, height: vp.height });
  }
  return pages;
}

/**
 * Which pages are plates? Sheets far larger than the typical page. If none
 * stands out (a single map, or a stack of same-size sheets), the largest page
 * is the plate; ties go to the first.
 */
export function classifyPages(sizes) {
  const areas = sizes.map((p) => p.width * p.height);
  const sorted = [...areas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const plateIdx = areas.map((a, i) => (a >= PLATE_AREA_RATIO * median ? i : -1)).filter((i) => i >= 0);
  if (!plateIdx.length) plateIdx.push(areas.indexOf(Math.max(...areas)));
  return sizes.map((p, i) => ({ ...p, kind: plateIdx.includes(i) ? 'plate' : 'text' }));
}

/** The plate to explore: the largest sheet. */
export function pickPlate(pages) {
  const plates = pages.filter((p) => p.kind === 'plate');
  return plates.reduce((best, p) => (p.width * p.height > best.width * best.height ? p : best), plates[0]);
}

async function readReportPage(doc, meta) {
  const page = await doc.getPage(meta.pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  await page.getOperatorList(); // loads fonts: needed for bold detection
  const items = mergeSubscripts(await extractTextItems(page, viewport));
  return { pageNumber: meta.pageNumber, width: viewport.width, height: viewport.height, items };
}

/**
 * @returns {Promise<{result, internals, page}>}  `page` is the plate's pdf.js
 *   page (for rendering); result.document describes the publication.
 */
export async function parseDocument(doc, { OPS, onProgress = () => {}, sampler = null } = {}) {
  const sizes = await readPageSizes(doc);
  const pages = classifyPages(sizes);
  const plateMeta = pickPlate(pages);
  const plate = await doc.getPage(plateMeta.pageNumber);

  const parsed = await parseMapPage(plate, { OPS, onProgress, sampler });
  const { result } = parsed;

  const textPages = pages.filter((p) => p.kind === 'text');
  const documentInfo = {
    pageCount: pages.length,
    plate: { pageNumber: plateMeta.pageNumber, width: plateMeta.width, height: plateMeta.height },
    pages: pages.map(({ pageNumber, kind }) => ({ pageNumber, kind })),
    report: null,
  };

  if (textPages.length && result.legend.length && !result.warnings.some((w) => w.code === 'no-text-layer')) {
    const read = [];
    for (const meta of textPages) {
      onProgress(`Reading report text (page ${meta.pageNumber} of ${pages.length})`);
      read.push(await readReportPage(doc, meta));
    }
    onProgress('Matching report descriptions to the legend');
    const { entries } = findReportEntries(read);
    const matched = matchReportToLegend(result.legend, entries);
    result.legend = matched.legend;
    documentInfo.report = {
      entries: entries.length,
      matched: matched.legend.filter((e) => e.report).length,
      unmatched: matched.unmatchedReport.map((e) => ({ code: e.code, name: e.name, page: e.page })),
    };
    if (!entries.length) {
      result.warnings.push({ code: 'no-report', message: 'No unit descriptions were found in the report pages.' });
    } else if (documentInfo.report.matched < result.legend.length) {
      const n = result.legend.length - documentInfo.report.matched;
      result.warnings.push({
        code: 'report-partial',
        message: `${n} of ${result.legend.length} units have no matching full description in the report.`,
      });
    }
  }

  result.document = documentInfo;
  return { result, internals: parsed.internals, page: plate };
}
