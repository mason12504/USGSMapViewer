// First pass over a SCANNED map PDF (one big image, no text layer), entirely
// local: no network, no API calls. Reads what it can, and prepares the small
// pictures a later, paid step would need for the parts local OCR cannot read.
//
//   npm run scan -- <scan.pdf> [--out dir] [--force] [--no-pdf]
//
// Writes to .lab/scan/<name>/ (git-ignored):
//   scan.json          legend entries, swatches, label reads, timings, apiCalls: 0
//   preview.jpg        the sheet with everything that was found drawn on it
//   searchable.pdf     the original scan plus an invisible text layer
//   swatch-sheet.png   every swatch, numbered (for a later API step)
//   label-sheet-N.png  unresolved label crops, numbered, 100 per sheet (same)
//
// Results are cached by file hash in .cache/scan/, so re-running is instant.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { ROOT, openPdf, renderRegion } from './lib/node-pdf.js';
import { createCanvas, loadImage, makeOcr, swatchCodeImage, toPng } from './lib/scan-tools.js';
import { findSwatchColumns } from '../src/lib/scan/swatches.js';
import { blobImage, findLabelBlobs } from '../src/lib/scan/blobs.js';
import { buildLegendEntries } from '../src/lib/scan/legendText.js';

const SCAN_VERSION = 1; // bump when the algorithm changes, so old cached results are ignored
const CONFIDENT = 70; // OCR confidence (0-100) we treat as a real read
const SHEET_CELLS = { cols: 10, rows: 10, cellW: 150, cellH: 70 };

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
if (!file) {
  console.error('usage: npm run scan -- <scan.pdf> [--out dir] [--force] [--no-pdf]');
  process.exit(1);
}

const bytes = fs.readFileSync(file);
const hash = crypto.createHash('sha256').update(bytes).update(String(SCAN_VERSION)).digest('hex');
const name = path.basename(file).replace(/\.pdf$/i, '');
const outDir = path.resolve(opt('--out') || path.join(ROOT, '.lab/scan', name));
const cacheFile = path.join(ROOT, '.cache/scan', `${hash}.json`);

if (!flag('--force') && fs.existsSync(cacheFile) && fs.existsSync(path.join(outDir, 'scan.json'))) {
  console.log(`cached: ${cacheFile}\n(use --force to redo; results are in ${outDir})`);
  process.exit(0);
}
fs.mkdirSync(outDir, { recursive: true });

const timings = {};
const stage = async (label, fn) => {
  const t0 = Date.now();
  process.stdout.write(`… ${label}`);
  const r = await fn();
  timings[label] = Math.round((Date.now() - t0) / 100) / 10;
  console.log(`  (${timings[label]} s)`);
  return r;
};

const doc = await openPdf(file);
const page = await doc.getPage(1);
const vp = page.getViewport({ scale: 1 });
const PAGE = { width: vp.width, height: vp.height };
const pageBox = { x0: 0, y0: 0, x1: PAGE.width, y1: PAGE.height };
console.log(`${name}: ${doc.numPages} page(s), ${Math.round(PAGE.width)} x ${Math.round(PAGE.height)} pt`);

/** A pixel box of an RGBA image, as its own image. */
function cropImage(img, x0, y0, x1, y1) {
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(img.width - 1, x1); y1 = Math.min(img.height - 1, y1);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
  return { data, width: w, height: h };
}

// ── 1. The whole sheet at 2 px/pt: enough to find shapes ────────────────────
const SHEET = 2;
const sheet = await stage('render sheet', () => renderRegion(page, pageBox, SHEET));
const toPt = (b) => ({ x0: b.x0 / SHEET, y0: b.y0 / SHEET, x1: (b.x1 + 1) / SHEET, y1: (b.y1 + 1) / SHEET });

// ── 2. Swatch columns (the legend) and the map ──────────────────────────────
const found = await stage('find legend swatches', async () => findSwatchColumns(sheet, { pxPerPt: SHEET }));
const columns = found.columns.sort((a, b) => a.x0 - b.x0);
const mapPt = found.map ? toPt(found.map) : pageBox;
console.log(`   ${columns.length} swatch column(s): ${columns.map((c) => `${c.swatches.length} @ x=${Math.round(c.x0 / SHEET)}pt`).join(', ')}; map ${Math.round(mapPt.x1 - mapPt.x0)} x ${Math.round(mapPt.y1 - mapPt.y0)} pt`);

const ocr = await makeOcr();

// ── 3. Swatch codes: each swatch interior, isolated, read on its own ────────
const swatches = [];
await stage('read swatch codes', async () => {
  for (const [ci, col] of columns.entries()) {
    for (const sw of col.swatches) {
      const read = await ocr.codeLine(swatchCodeImage(sheet, sw));
      swatches.push({ column: ci, bbox: toPt(sw), color: sw.color, code: read.text, confidence: read.confidence, px: sw });
    }
  }
});

// ── 4. Legend text: OCR in overlapping strips at ~300 dpi ───────────────────
const STRIP_H = 520, OVERLAP = 40, TEXT_SCALE = 4;
const legendLines = [];
await stage('OCR legend text', async () => {
  for (const [ci, col] of columns.entries()) {
    const sws = swatches.filter((s) => s.column === ci);
    const x0 = col.x1 / SHEET + 3; // right of the swatches, so their codes are not read as text
    const x1 = ci < columns.length - 1 ? columns[ci + 1].x0 / SHEET - 8 : PAGE.width - 20;
    const yTop = Math.max(0, Math.min(...sws.map((s) => s.bbox.y0)) - 30);
    const yBot = Math.min(PAGE.height, Math.max(...sws.map((s) => s.bbox.y1)) + 260);
    const kept = [];
    for (let y = yTop; y < yBot; y += STRIP_H - OVERLAP) {
      const region = { x0, y0: y, x1, y1: Math.min(yBot, y + STRIP_H) };
      const r = await renderRegion(page, region, TEXT_SCALE);
      for (const l of await ocr.lines(r.canvas.toBuffer('image/png'))) {
        const line = {
          column: ci, text: l.text, confidence: l.confidence,
          x0: region.x0 + l.bbox.x0 / TEXT_SCALE, y0: region.y0 + l.bbox.y0 / TEXT_SCALE,
          x1: region.x0 + l.bbox.x1 / TEXT_SCALE, y1: region.y0 + l.bbox.y1 / TEXT_SCALE,
          words: l.words.map((w) => ({ text: w.text, confidence: w.confidence, x0: region.x0 + w.bbox.x0 / TEXT_SCALE, y0: region.y0 + w.bbox.y0 / TEXT_SCALE, x1: region.x0 + w.bbox.x1 / TEXT_SCALE, y1: region.y0 + w.bbox.y1 / TEXT_SCALE })),
        };
        // Strips overlap: drop a line already read in the previous strip.
        const dup = kept.find((k) => Math.abs((k.y0 + k.y1) / 2 - (line.y0 + line.y1) / 2) < 4 && Math.abs(k.x0 - line.x0) < 12);
        if (!dup) kept.push(line);
      }
    }
    legendLines.push(...kept);
  }
});

// ── 5. Entries: swatch + its paragraph ──────────────────────────────────────
const entries = [];
for (const [ci] of columns.entries()) {
  const sws = swatches.filter((s) => s.column === ci).map((s) => ({ ...s.bbox, color: s.color, ref: s }));
  const lines = legendLines.filter((l) => l.column === ci);
  for (const e of buildLegendEntries(lines, sws)) {
    const ref = sws.find((s) => e.swatch && Math.abs(s.y0 - e.swatch.y0) < 1)?.ref;
    entries.push({ column: ci, ...e, code: ref ? ref.code : null, codeConfidence: ref ? ref.confidence : null });
  }
}
const withSwatch = entries.filter((e) => e.swatch);
console.log(`   ${entries.length} legend entries (${withSwatch.length} with a swatch, ${entries.length - withSwatch.length} text-only); ${legendLines.length} text lines`);

// ── 6. Map label candidates ─────────────────────────────────────────────────
const LABEL_SCALE = 3;
let blobs = [];
await stage('find and read map labels', async () => {
  const region = { x0: Math.floor(mapPt.x0), y0: Math.floor(mapPt.y0), x1: Math.ceil(mapPt.x1), y1: Math.ceil(mapPt.y1) };
  const r = await renderRegion(page, region, LABEL_SCALE);
  const raw = findLabelBlobs(r, { pxPerPt: LABEL_SCALE });
  for (const b of raw) {
    const read = await ocr.codeWord(toPng(blobImage(r, b)));
    blobs.push({
      bbox: { x0: region.x0 + b.x0 / LABEL_SCALE, y0: region.y0 + b.y0 / LABEL_SCALE, x1: region.x0 + (b.x1 + 1) / LABEL_SCALE, y1: region.y0 + (b.y1 + 1) / LABEL_SCALE },
      glyphs: b.glyphs, text: read.text, confidence: read.confidence,
      crop: toPng(blobImage(r, b)),
    });
  }
});
const vocab = new Set(swatches.filter((s) => s.confidence >= CONFIDENT && /^[A-Za-z0-9]{2,7}$/.test(s.code)).map((s) => s.code));
for (const b of blobs) b.inVocabulary = vocab.has(b.text);
const read = blobs.filter((b) => b.inVocabulary);
console.log(`   ${blobs.length} label-like blobs; ${read.length} read as a legend code, ${blobs.length - read.length} unresolved`);

// ── 7. Pictures for review, and for a later (paid, not run here) step ───────
await stage('write review pictures', async () => {
  // preview.jpg: the sheet, scaled down, with boxes
  const PV = 0.5;
  const pv = createCanvas(Math.round(PAGE.width * PV), Math.round(PAGE.height * PV));
  const pctx = pv.getContext('2d');
  const full = createCanvas(sheet.width, sheet.height);
  const fctx = full.getContext('2d');
  const id = fctx.createImageData(sheet.width, sheet.height);
  id.data.set(sheet.data);
  fctx.putImageData(id, 0, 0);
  pctx.drawImage(full, 0, 0, pv.width, pv.height);
  const box = (b, color, w = 2) => { pctx.strokeStyle = color; pctx.lineWidth = w; pctx.strokeRect(b.x0 * PV, b.y0 * PV, (b.x1 - b.x0) * PV, (b.y1 - b.y0) * PV); };
  for (const s of swatches) box(s.bbox, s.confidence >= CONFIDENT ? '#0a0' : '#f80');
  for (const b of blobs) box(b.bbox, b.inVocabulary ? '#0c0' : '#e22', 1);
  box(mapPt, '#00f', 3);
  fs.writeFileSync(path.join(outDir, 'preview.jpg'), pv.toBuffer('image/jpeg', 80));

  // swatch-sheet.png: EVERY swatch, numbered. Local OCR is sometimes confidently
  // wrong (a "Kc" read as "Ke" at 85%), so a later paid step reads them all.
  {
    const COLS = 4, W = 220, H = 70;
    const sheetCv = createCanvas(W * COLS, H * Math.ceil(swatches.length / COLS));
    const sctx = sheetCv.getContext('2d');
    sctx.fillStyle = '#fff';
    sctx.fillRect(0, 0, sheetCv.width, sheetCv.height);
    for (const [i, s] of swatches.entries()) {
      const px = s.px;
      const crop = await loadImage(toPng(cropImage(sheet, px.x0 - 4, px.y0 - 4, px.x1 + 4, px.y1 + 4)));
      const cx = (i % COLS) * W, cy = Math.floor(i / COLS) * H;
      sctx.strokeStyle = '#ccc';
      sctx.strokeRect(cx + 0.5, cy + 0.5, W - 1, H - 1);
      sctx.drawImage(crop, cx + 36, cy + 4, W - 44, H - 8);
      sctx.fillStyle = '#c00';
      sctx.font = '17px sans-serif';
      sctx.fillText(String(i + 1), cx + 5, cy + H / 2 + 6);
      s.index = i + 1;
    }
    fs.writeFileSync(path.join(outDir, 'swatch-sheet.png'), sheetCv.toBuffer('image/png'));
  }

  // label sheets: unresolved crops, 100 per sheet, numbered
  const unresolved = blobs.filter((b) => !b.inVocabulary);
  const { cols, rows, cellW, cellH } = SHEET_CELLS;
  const per = cols * rows;
  for (let sheetNo = 0; sheetNo * per < unresolved.length; sheetNo++) {
    const cv = createCanvas(cols * cellW, rows * cellH);
    const c = cv.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, cv.width, cv.height);
    for (let k = 0; k < per && sheetNo * per + k < unresolved.length; k++) {
      const b = unresolved[sheetNo * per + k];
      b.sheet = sheetNo + 1;
      b.cell = k + 1;
      const cx = (k % cols) * cellW, cy = Math.floor(k / cols) * cellH;
      const imgEl = await loadImage(b.crop);
      const s = Math.min((cellW - 34) / imgEl.width, (cellH - 8) / imgEl.height, 3);
      c.strokeStyle = '#bbb';
      c.strokeRect(cx + 0.5, cy + 0.5, cellW - 1, cellH - 1);
      c.drawImage(imgEl, cx + 30, cy + (cellH - imgEl.height * s) / 2, imgEl.width * s, imgEl.height * s);
      c.fillStyle = '#c00';
      c.font = '13px sans-serif';
      c.fillText(String(k + 1), cx + 3, cy + 14);
    }
    fs.writeFileSync(path.join(outDir, `label-sheet-${sheetNo + 1}.png`), cv.toBuffer('image/png'));
  }
});

// ── 8. Searchable PDF: the original scan plus an invisible text layer ───────
if (!flag('--no-pdf')) {
  await stage('write searchable.pdf', async () => {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const pg = pdf.getPage(0);
    const { height } = pg.getSize();
    const put = (text, b) => {
      const clean = text.replace(/[^\x20-\x7E]/g, '');
      if (!clean.trim()) return;
      pg.drawText(clean, { x: b.x0, y: height - b.y1, size: Math.max(3, (b.y1 - b.y0) * 0.85), font, opacity: 0 });
    };
    for (const l of legendLines) for (const w of l.words) if (w.confidence >= 40) put(w.text, w);
    for (const s of swatches) if (s.confidence >= CONFIDENT) put(s.code, s.bbox);
    for (const b of read) put(b.text, b.bbox);
    const out = await pdf.save();
    // The file may be open in a PDF viewer on your PC (Windows locks it); never lose the scan over that.
    try {
      fs.writeFileSync(path.join(outDir, 'searchable.pdf'), out);
    } catch (err) {
      const alt = path.join(outDir, `searchable-${Date.now()}.pdf`);
      fs.writeFileSync(alt, out);
      console.log(`\n   could not overwrite searchable.pdf (${err.code}; is it open in a viewer?); wrote ${path.basename(alt)} instead`);
    }
  });
}

await ocr.close();

// ── 9. Result ───────────────────────────────────────────────────────────────
// Identifies THIS scan's blobs, so answers saved for an earlier scan are never applied to a different one.
const scanId = crypto.createHash('sha256').update(JSON.stringify([blobs.map((b) => b.bbox), swatches.map((s) => s.bbox)])).digest('hex').slice(0, 16);
const result = {
  version: SCAN_VERSION,
  file: path.basename(file),
  fileSha256: crypto.createHash('sha256').update(bytes).digest('hex'), // what the app looks the scan up by
  scanId,
  sha256: hash.slice(0, 16),
  page: PAGE,
  apiCalls: 0,
  timings,
  map: mapPt,
  columns: columns.map((c) => ({ x: c.x0 / SHEET, swatches: c.swatches.length })),
  stats: {
    swatches: swatches.length,
    swatchCodesConfident: swatches.filter((s) => s.confidence >= CONFIDENT).length,
    legendEntries: entries.length,
    entriesWithSwatch: withSwatch.length,
    labelBlobs: blobs.length,
    labelsReadAsLegendCode: read.length,
    labelsUnresolved: blobs.length - read.length,
  },
  entries: entries.map((e) => ({
    column: e.column, code: e.code, codeConfidence: e.codeConfidence, name: e.name, ageText: e.ageText,
    description: e.description, textConfidence: e.confidence, swatch: e.swatch,
  })),
  swatches: swatches.map(({ px: _px, ...s }) => s),
  labels: blobs.map(({ crop: _crop, ...b }) => b),
};
fs.writeFileSync(path.join(outDir, 'scan.json'), JSON.stringify(result, null, 2));
fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
fs.writeFileSync(cacheFile, JSON.stringify(result));

console.log('\n' + JSON.stringify(result.stats, null, 2));
console.log(`API calls made: 0\noutput: ${outDir}`);
