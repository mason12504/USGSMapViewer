// The PAID step for a scanned map: ask Claude to read the small numbered crops
// that scripts/scan-pdf.js prepared, through the local API server, so every call
// is cached, capped, and logged by the server.
//
//   npm run scan:ai -- <name | scan dir>                    DRY RUN: shows the plan, calls nothing
//   npm run scan:ai -- <name | scan dir> --run              make the calls
//   ...  --only swatches | labels      one step only
//   ...  --sheets 1,2                  only these label sheets (default: all)
//   ...  --max-calls 20                refuse to start if the plan needs more (default 20)
//   ...  --server http://127.0.0.1:3001
//   ...  --merge-only                  rebuild resolved.json from saved answers: no server, no calls
//
// Needs the live API server running (bash scripts/host/run-local.sh, or api-real)
// and `npm run scan` already done for this map. Calls: 1 for all swatches, then
// 1 per label sheet (about 100 labels each). Repeat runs are served from the
// cache and cost nothing.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/node-pdf.js';
import { nearestCode } from '../src/lib/scan/vocab.js';
import { canonicalCode, isCanonicalCode } from '../src/lib/scan/glyphs.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d = null) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const target = args.find((a, i) => !a.startsWith('--') && !['--only', '--sheets', '--max-calls', '--server'].includes(args[i - 1]));
if (!target) {
  console.error('usage: npm run scan:ai -- <name | scan dir> [--run] [--only swatches|labels] [--sheets 1,2] [--max-calls 8] [--server url]');
  process.exit(1);
}
const dir = fs.existsSync(target) ? path.resolve(target) : path.join(ROOT, '.lab/scan', target);
const server = (opt('--server') || process.env.API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const only = opt('--only');
const maxCalls = Number(opt('--max-calls', 20));
const MERGE_ONLY = flag('--merge-only');
const RUN = flag('--run') && !MERGE_ONLY;

if (!fs.existsSync(path.join(dir, 'scan.json'))) {
  console.error(`No scan.json in ${dir}. Run  npm run scan -- <pdf>  first.`);
  process.exit(1);
}
const scan = JSON.parse(fs.readFileSync(path.join(dir, 'scan.json'), 'utf8'));
if (!scan.swatches.every((s) => s.index) || !fs.existsSync(path.join(dir, 'swatch-sheet.png'))) {
  console.error('This scan was made by an older version (no swatch-sheet.png). Re-run:  npm run scan -- <pdf> --force');
  process.exit(1);
}

// ── What would be sent ──────────────────────────────────────────────────────
const png = (f) => {
  const b = fs.readFileSync(path.join(dir, f));
  return { file: f, base64: b.toString('base64'), bytes: b.length, width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};
/** Rough image tokens: the API shrinks the long edge to ~1568 px, then ~1 token per 750 px. */
const imageTokens = (w, h) => {
  const k = Math.min(1, 1568 / Math.max(w, h));
  return Math.round((w * k * h * k) / 750);
};

const entryFor = (sw) => scan.entries.find((e) => e.swatch && Math.abs(e.swatch.x0 - sw.bbox.x0) < 1 && Math.abs(e.swatch.y0 - sw.bbox.y0) < 1);
const swatchItems = scan.swatches.map((s) => ({
  n: s.index,
  ocr: /^[A-Za-z0-9]{1,12}$/.test(s.code) ? s.code : null,
  name: (entryFor(s)?.name || '').replace(/\s+/g, ' ').slice(0, 150) || null,
}));

const unresolved = scan.labels.filter((l) => !l.inVocabulary && l.sheet);
const sheetNos = [...new Set(unresolved.map((l) => l.sheet))].sort((a, b) => a - b);
const wantSheets = opt('--sheets') ? opt('--sheets').split(',').map(Number) : sheetNos;

const plan = [];
if (only !== 'labels') plan.push({ kind: 'swatches', image: 'swatch-sheet.png', cells: swatchItems.length });
if (only !== 'swatches') {
  for (const n of sheetNos.filter((s) => wantSheets.includes(s))) {
    plan.push({ kind: 'labels', sheet: n, image: `label-sheet-${n}.png`, cells: unresolved.filter((l) => l.sheet === n).length });
  }
}
if (MERGE_ONLY) plan.length = 0;
for (const step of plan) Object.assign(step, { img: png(step.image) });

console.log(`${scan.file}: ${scan.swatches.length} swatches, ${unresolved.length} unresolved labels on ${sheetNos.length} sheet(s)`);
console.log('\nPlanned calls:');
let estIn = 0;
for (const [i, s] of plan.entries()) {
  const t = imageTokens(s.img.width, s.img.height) + (s.kind === 'swatches' ? 40 * s.cells + 300 : 400);
  estIn += t;
  console.log(`  ${i + 1}. ${s.kind === 'swatches' ? 'read swatch codes ' : `read label sheet ${s.sheet}`}  ${s.cells} cells  image ${s.img.width}x${s.img.height} (${Math.round(s.img.bytes / 1024)} KB)  ~${t.toLocaleString()} input tokens`);
}
console.log(`  total: ${plan.length} call(s), roughly ${estIn.toLocaleString()} input tokens plus roughly ${(plan.length * 900).toLocaleString()} output tokens (estimates, not measurements)`);
if (plan.length > maxCalls) {
  console.error(`\nRefusing: ${plan.length} calls planned, --max-calls is ${maxCalls}.`);
  process.exit(1);
}

// ── The server ──────────────────────────────────────────────────────────────
async function get(p) {
  const r = await fetch(server + p);
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return r.json();
}
async function post(p, body) {
  const r = await fetch(server + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${p}: ${j.error || `HTTP ${r.status}`}`);
  return j;
}

let health = null;
if (!MERGE_ONLY) {
  try {
    health = await get('/api/health');
  } catch {
    console.log(`\nAPI server not reachable at ${server}.`);
  }
}
if (health) {
  const u = health.usage;
  console.log(`\nServer: ${server}  mode=${health.mode}  model=${health.model}`);
  if (u) console.log(`Today: ${u.calls}/${u.cap} paid calls used, ${u.cacheHits} cache hits, ${u.inputTokens.toLocaleString()} tokens in / ${u.outputTokens.toLocaleString()} out`);
}

if (!RUN && !MERGE_ONLY) {
  console.log('\nDRY RUN: nothing was sent. Add --run to make these calls (identical calls already cached are free).');
  process.exit(0);
}
if (!health && !MERGE_ONLY) {
  console.error('Start the live server first (bash scripts/host/run-local.sh) and run again.');
  process.exit(1);
}
if (health && health.mode !== 'live') {
  console.error(`The server is in ${health.mode} mode; these steps need live mode. Nothing was sent.`);
  process.exit(1);
}
if (health?.usage && health.usage.remaining < plan.length) {
  console.log(`Note: ${health.usage.remaining} paid call(s) left today and ${plan.length} planned; cached ones don't count, so this may still finish.`);
}

// ── Run ─────────────────────────────────────────────────────────────────────
const before = health?.usage;
const calls = [];
let prior = fs.existsSync(path.join(dir, 'ai-results.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'ai-results.json'), 'utf8')) : null;
if (prior && prior.scanId !== scan.scanId) {
  // Answers are keyed by sheet and cell number; after a re-scan those numbers mean different crops.
  console.log('\nNote: ai-results.json belongs to an earlier scan of this map, so its answers are not reused. (Identical API calls are still free from the cache.)');
  prior = null;
}
const aiCodes = new Map((prior?.swatchCodes || []).map((c) => [c.n, c]));
const labelReads = new Map((prior?.labelReads || []).map((r) => [`${r.sheet}:${r.n}`, r]));
const sheetsRead = new Set(prior?.sheetsRead || []);
const note = (kind, r) => {
  calls.push({ kind, cached: r.cached, tokens: r.tokens });
  console.log(`  ✓ ${kind}: ${r.cached ? 'from cache, no charge' : `${r.tokens?.input ?? '?'} in / ${r.tokens?.output ?? '?'} out tokens`}`);
};

if (MERGE_ONLY) console.log('\nMerge only: rebuilding resolved.json from ai-results.json; no server, no calls.');
else console.log('\nRunning…');
try {
  for (const step of plan) {
    if (step.kind === 'swatches') {
      const r = await post('/api/read-swatch-codes', { imageBase64: step.img.base64, mediaType: 'image/png', items: swatchItems });
      note('swatch codes', r);
      for (const c of r.codes) aiCodes.set(c.n, c);
    }
  }
  // The legend's own codes are the vocabulary for reading labels.
  // Codes as printed ("M€r") are kept for display; the API and all matching use the plain-letter form ("MCr").
  const finalCode = (s) => aiCodes.get(s.index)?.code ?? (s.confidence >= 70 && /^[A-Za-z0-9]{2,8}$/.test(s.code) ? s.code : null);
  const vocabulary = [...new Set(scan.swatches.map(finalCode).map(canonicalCode).filter((c) => c && isCanonicalCode(c)))];
  if (!vocabulary.length) throw new Error('No legend codes known, so labels cannot be read. Run the swatches step first.');
  for (const step of plan) {
    if (step.kind !== 'labels') continue;
    const r = await post('/api/read-label-sheet', { imageBase64: step.img.base64, mediaType: 'image/png', vocabulary, cells: step.cells });
    note(`label sheet ${step.sheet}`, r);
    for (const read of r.reads) labelReads.set(`${step.sheet}:${read.n}`, { sheet: step.sheet, ...read });
    sheetsRead.add(step.sheet);
  }
} catch (err) {
  console.error(`\nStopped: ${err.message}`);
  console.error('Results so far are kept; already-answered calls are cached, so re-running does not pay twice.');
  process.exitCode = 1;
}

// ── Merge and report ────────────────────────────────────────────────────────
const finalSwatches = scan.swatches.map((s) => {
  const ai = aiCodes.get(s.index);
  const ocrOk = s.confidence >= 70 && /^[A-Za-z0-9]{2,8}$/.test(s.code);
  const code = ai?.code ?? (ocrOk ? s.code : null);
  return { index: s.index, ocr: s.code, ocrConfidence: s.confidence, ai: ai?.code ?? null, aiConfidence: ai?.confidence ?? null, code, key: code ? canonicalCode(code) : null, source: ai?.code ? 'ai' : ocrOk ? 'ocr' : null };
});
const vocab = new Set(finalSwatches.map((s) => s.key).filter(Boolean)); // plain-letter keys
const asked = finalSwatches.filter((s) => aiCodes.has(s.index));
const agree = asked.filter((s) => s.ocrConfidence >= 70 && s.ocr === s.ai).length;
const disagree = asked.filter((s) => s.ocrConfidence >= 70 && s.ai && s.ocr !== s.ai);

const vocabList = [...vocab];
// The same OCR engine misreads the same glyphs the same way on swatches and on the map, so a
// swatch Claude corrected (OCR "Ke" -> "Kc") teaches us how to fix the map's OCR reads: but only for
// texts that are not themselves a real code (OCR "Tg" on swatch #26 must not rewrite genuine Tg labels).
const alias = new Map();
for (const s of finalSwatches) {
  if (s.ai && s.ocr && s.ocrConfidence >= 70 && s.ocr !== s.ai && !vocab.has(canonicalCode(s.ocr))) {
    alias.set(s.ocr, alias.has(s.ocr) && alias.get(s.ocr) !== s.ai ? null : s.ai); // two different answers: ambiguous
  }
}
const finalLabels = scan.labels.map((l) => {
  if (l.inVocabulary) {
    // OCR matched the legend as OCR first read it; check against the final codes.
    if (vocab.has(canonicalCode(l.text))) return { ...l, final: canonicalCode(l.text), source: 'ocr' };
    const near = alias.get(l.text) ? { code: alias.get(l.text) } : nearestCode(l.text, vocabList);
    return near
      ? { ...l, final: near.code, source: 'ocr+legend', corrected: l.text }
      : { ...l, final: null, source: null, ocrRejected: l.text };
  }
  const r = l.sheet ? labelReads.get(`${l.sheet}:${l.cell}`) : null;
  // Claude lists only the cells that hold a code, so on a sheet that was read, a missing cell is "not a code".
  if (!r && l.sheet && sheetsRead.has(l.sheet)) return { ...l, ai: null, aiKind: 'not-a-code', final: null, source: null };
  if (!r) return { ...l, final: null, source: null };
  const text = r.text == null ? null : canonicalCode(r.text);
  if (text == null) return { ...l, ai: null, aiConfidence: r.confidence, aiKind: 'not-a-code', final: null, source: null };
  if (vocab.has(text)) return { ...l, ai: r.text, aiConfidence: r.confidence, aiKind: 'legend-code', final: text, source: 'ai' };
  // Not a legend code as read: one close to exactly one legend code is a misread of it ("OCr" for "O€r").
  const near = nearestCode(text, vocabList);
  return near
    ? { ...l, ai: r.text, aiConfidence: r.confidence, aiKind: 'legend-code', final: near.code, source: 'ai+legend', corrected: text }
    : { ...l, ai: r.text, aiConfidence: r.confidence, aiKind: 'novel', final: null, source: null };
});
const readByAi = finalLabels.filter((l) => l.aiKind);
const corrected = finalLabels.filter((l) => l.source === 'ocr+legend');
const rejected = finalLabels.filter((l) => l.ocrRejected);
const count = (k) => readByAi.filter((l) => l.aiKind === k).length;

fs.writeFileSync(path.join(dir, 'ai-results.json'), JSON.stringify({
  scanId: scan.scanId,
  runAt: new Date().toISOString(),
  swatchCodes: [...aiCodes.values()],
  labelReads: [...labelReads.values()],
  sheetsRead: [...sheetsRead],
}, null, 2));
fs.writeFileSync(path.join(dir, 'resolved.json'), JSON.stringify({
  file: scan.file,
  fileSha256: scan.fileSha256,
  scanId: scan.scanId,
  page: scan.page,
  map: scan.map,
  summary: {
    swatches: finalSwatches.length,
    swatchesWithCode: finalSwatches.filter((s) => s.code).length,
    labelsTotal: finalLabels.length,
    labelsResolved: finalLabels.filter((l) => l.final).length,
    labelSheetsRead: [...sheetsRead].sort((a, b) => a - b),
  },
  swatches: finalSwatches,
  entries: scan.entries.map((e) => {
    const sw = scan.swatches.find((s) => e.swatch && Math.abs(s.bbox.x0 - e.swatch.x0) < 1 && Math.abs(s.bbox.y0 - e.swatch.y0) < 1);
    const f = sw && finalSwatches.find((x) => x.index === sw.index);
    return { ...e, code: f?.code ?? e.code, codeSource: f?.source ?? null };
  }),
  labels: finalLabels,
}, null, 2));

let after = null;
try { after = (await get('/api/health')).usage; } catch { /* server went away */ }

console.log('\n── Results ──');
if (asked.length) {
  console.log(`Swatch codes: ${asked.length} read by Claude; ${agree} agree with confident local OCR, ${disagree.length} disagree`);
  for (const s of disagree.slice(0, 12)) console.log(`   #${s.index}: OCR "${s.ocr}" (${s.ocrConfidence}%)  vs  Claude "${s.ai}" (${s.aiConfidence})`);
  console.log(`   ${finalSwatches.filter((s) => s.code).length}/${finalSwatches.length} swatches now have a code; ${finalSwatches.filter((s) => s.ai && s.aiConfidence === 'low').length} marked low confidence`);
}
if (readByAi.length) {
  console.log(`Labels: ${readByAi.length} crops read from ${sheetsRead.size} sheet(s): ${count('legend-code')} are legend codes, ${count('novel')} look like codes not in the legend, ${count('not-a-code')} are not codes`);
  console.log(`   ${finalLabels.filter((l) => l.final).length}/${finalLabels.length} labels on the map now have a legend code (${finalLabels.filter((l) => l.source === 'ocr').length} from OCR, ${corrected.length} from OCR snapped to the legend, ${finalLabels.filter((l) => l.source === 'ai').length} from Claude)`);
  if (corrected.length || rejected.length) {
    const tally = {};
    for (const l of corrected) tally[`${l.corrected}->${l.final}`] = (tally[`${l.corrected}->${l.final}`] || 0) + 1;
    console.log(`   OCR reads fixed against the legend: ${Object.entries(tally).map(([k, v]) => `${k} x${v}`).join(', ') || 'none'}; ${rejected.length} OCR reads dropped as unmatched`);
  }
  const novel = readByAi.filter((l) => l.aiKind === 'novel').map((l) => l.ai);
  if (novel.length) console.log(`   not in legend (check these): ${[...new Set(novel)].slice(0, 25).join(' ')}`);
}
const paid = calls.filter((c) => !c.cached);
console.log(`\nCalls this run: ${calls.length} (${paid.length} paid, ${calls.length - paid.length} from cache); tokens ${paid.reduce((a, c) => a + (c.tokens?.input || 0), 0).toLocaleString()} in / ${paid.reduce((a, c) => a + (c.tokens?.output || 0), 0).toLocaleString()} out`);
if (before && after) console.log(`Today's count: ${before.calls} -> ${after.calls} of ${after.cap}${after.estimatedUsd != null ? `, about $${after.estimatedUsd.toFixed(2)} so far today` : ''}`);
console.log(`Wrote ${path.join(dir, 'resolved.json')}`);
