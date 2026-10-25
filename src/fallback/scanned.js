// Fallback for SCANNED maps (no usable text layer): OCR for label positions,
// Claude (via our API server) for the legend.
//
// STATUS: carried over from the original app's approach and adapted to the
// new result format, but NOT covered by tests yet — there is no scanned
// fixture. Add one (fixtures/<name>/) before relying on this path.
// Note: tesseract.js downloads its language data from a CDN at runtime
// (in your browser, not in the dev container).

import { ageForCode, isUnitCodeShape, normalizeCode } from '../lib/units/unitCodes.js';
import { RESULT_VERSION } from '../lib/pipeline.js';
import { canvasToBase64, parseLegendWithAI } from '../api.js';
import { renderRegion } from '../pdf/pdfjs.browser.js';

const OCR_SCALE = 2;

export async function parseScannedPage(page, { onProgress = () => {} } = {}) {
  const vp = page.getViewport({ scale: 1 });
  const pageBox = { x0: 0, y0: 0, x1: vp.width, y1: vp.height };
  const scale = Math.min(OCR_SCALE, 6000 / Math.max(vp.width, vp.height));

  onProgress('Rendering page for OCR');
  const canvas = await renderRegion(page, pageBox, scale);

  onProgress('Reading the legend with AI');
  const ai = await parseLegendWithAI({ imageBase64: canvasToBase64(canvas, { maxSide: 2400 }) });
  const legend = ai.units.map((u) => ({
    ...u,
    key: normalizeCode(u.code),
    age: ageForCode(u.code),
    swatch: null,
    labelCount: 0,
  }));
  const keys = new Set(legend.map((e) => e.key));

  onProgress('Running OCR (30–60 s)');
  const words = await ocrWords(canvas);
  const labels = [];
  for (const w of words) {
    const text = w.text.trim().replace(/[^\w?]/g, '');
    const code = text.replace(/\?$/, '');
    if (!isUnitCodeShape(code) || !keys.has(normalizeCode(code))) continue;
    const bbox = { x0: w.bbox.x0 / scale, y0: w.bbox.y0 / scale, x1: w.bbox.x1 / scale, y1: w.bbox.y1 / scale };
    labels.push({ id: labels.length, code, key: normalizeCode(code), uncertain: text.endsWith('?'), bbox, codeBbox: bbox, angle: 0, color: null });
  }
  for (const e of legend) e.labelCount = labels.filter((l) => l.key === e.key).length;

  return {
    result: {
      version: RESULT_VERSION,
      page: { width: vp.width, height: vp.height },
      mapRegion: { bbox: pageBox, method: 'whole-page (scanned)' },
      legend,
      labels,
      unmatchedCodes: [],
      color: { primary: null, vector: null, raster: null },
      stats: { ocrWords: words.length },
      warnings: [{ code: 'scanned', message: `Scanned map: legend read by AI (${ai.mode} mode), labels found by OCR. Color matching is not available yet for scans.` }],
      source: 'ocr+ai',
    },
    internals: { color: null },
  };
}

async function ocrWords(canvas) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    // Newer tesseract.js versions only return nested blocks; older ones had data.words.
    if (Array.isArray(data.words) && data.words.length) return data.words;
    const words = [];
    for (const block of data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          for (const word of line.words || []) words.push(word);
        }
      }
    }
    return words;
  } finally {
    await worker.terminate();
  }
}
