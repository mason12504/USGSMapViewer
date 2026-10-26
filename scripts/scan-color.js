// How well does COLOR agree with the labels read on a scanned map? A report, no API.
//
//   npm run scan:color -- <name | scan dir> [--pdf file.pdf] [--radius-factor 1.5]
//
// Uses the saved resolved.json (labels already read by OCR/Claude), measures each legend
// swatch's colors on the page, and for every label checks the neighbourhood (a disc of
// radius-factor x the swatch's long side) with src/lib/scan/colorCheck.js, the same code
// the app runs. Writes color-report.json and color-disagreements.jpg next to resolved.json.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, makeNodeSampler, openPdf } from './lib/node-pdf.js';
import { createCanvas } from './lib/scan-tools.js';
import { scanResultFromResolved } from '../src/lib/scan/toResult.js';
import {
  MIN_BLOCK_PT2, NEIGHBOURHOOD_FACTOR, TOUCH_PT, buildUnitPalettes, checkLabel, estimatePaper, makeClassifier, neighbourhoodRadiusPt, summarizeChecks,
} from '../src/lib/scan/colorCheck.js';
import { paletteDistance } from '../src/lib/color/colorMath.js';

const args = process.argv.slice(2);
const opt = (n, d = null) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const target = args.find((a, i) => !a.startsWith('--') && !['--pdf', '--radius-factor'].includes(args[i - 1]));
if (!target) {
  console.error('usage: npm run scan:color -- <name | scan dir> [--pdf file.pdf] [--radius-factor 1.5]');
  process.exit(1);
}
const dir = fs.existsSync(target) ? path.resolve(target) : path.join(ROOT, '.lab/scan', target);
const resolved = JSON.parse(fs.readFileSync(path.join(dir, 'resolved.json'), 'utf8'));
const pdfPath = opt('--pdf') || [path.join(ROOT, 'scripts/proposed', resolved.file), path.join(ROOT, resolved.file)].find((p) => fs.existsSync(p));
if (!pdfPath) {
  console.error(`Can't find ${resolved.file}; pass --pdf <path>.`);
  process.exit(1);
}
const factor = Number(opt('--radius-factor', NEIGHBOURHOOD_FACTOR));

const { result } = scanResultFromResolved(resolved);
const labels = [...result.labels, ...result.plateLabels];
const page = await (await openPdf(pdfPath)).getPage(1);
const SCALE = 2;
console.log(`${resolved.file}: ${result.legend.length} units, ${labels.length} labels; radius factor ${factor}`);

let t = Date.now();
const sampler = await makeNodeSampler(page, { x0: 0, y0: 0, x1: result.page.width, y1: result.page.height }, SCALE);
console.log(`rendered page (${((Date.now() - t) / 1000).toFixed(1)} s)`);

const palettes = buildUnitPalettes(sampler, result.legend);
const paper = estimatePaper(sampler);
const classify = makeClassifier(palettes, { paper });
const radiusPt = neighbourhoodRadiusPt(result.legend, factor);
console.log(`${palettes.length} swatch palettes in ${classify.groups.length} color groups (${classify.groups.filter((g) => g.length > 1).length} groups of look-alikes); paper ${paper.join(',')}; neighbourhood radius ${radiusPt.toFixed(1)} pt; min block ${MIN_BLOCK_PT2} pt2; touching <= ${TOUCH_PT} pt`);

t = Date.now();
const checks = labels.map((l) => ({ label: l, color: checkLabel(sampler, classify, l, { radiusPt }) }));
console.log(`checked ${checks.length} labels (${((Date.now() - t) / 1000).toFixed(1)} s)\n`);

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
const all = checks.map((c) => c.color);
const sum = summarizeChecks(all, radiusPt);
const withEvidence = all.filter((c) => c.predicted.length);

// Baseline: how often does a RANDOM OTHER unit also have a block nearby? (what chance looks like)
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const keys = palettes.map((p) => p.key);
const chance = checks.map(({ label }) => {
  let other = label.key;
  while (other === label.key) other = keys[Math.floor(rnd() * keys.length)];
  return checkLabel(sampler, classify, { ...label, key: other }, { radiusPt });
});

console.log(`Labels with any legend color nearby:                    ${pct(withEvidence.length, all.length)}  (the rest sit in paper margins or on unmatched colors)`);
console.log(`Label's unit has a block TOUCHING the text (<= ${TOUCH_PT} pt):     ${pct(sum.directAgree, all.length)}  (${sum.directAgree}/${all.length})`);
console.log(`Label's unit has a block ANYWHERE in the radius:         ${pct(sum.agree, all.length)}  (${sum.agree}/${all.length})   <- chance level for a random other unit: ${pct(chance.filter((c) => c.supports).length, all.length)}`);
console.log(`   found only in the neighbourhood (leader-like):        ${all.filter((c) => c.via === 'leader').length}`);
console.log(`Label's unit has NO block in the radius (suspicious):    ${pct(all.length - sum.agree - sum.conflicts, all.length)}`);
const conflictList = checks.filter(({ color }) => color.verdict === 'conflict');
console.log(`CONFLICTS: read as one unit, text sits on a near-twin's color:  ${conflictList.length}  (${pct(conflictList.length, all.length)})`);
const pairs2 = {};
for (const { label, color } of conflictList) { const k = `${label.key} -> ${color.suggest.join('/')}`; pairs2[k] = (pairs2[k] || 0) + 1; }
console.log('   ' + (Object.entries(pairs2).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => `${k} x${n}`).join('   ') || 'none'));
console.log(`Nearest block to the text is the label's unit:           ${pct(checks.filter(({ label, color }) => color.predicted[0] === label.key).length, all.length)}`);
console.log(`Label's unit among the 3 nearest blocks:                 ${pct(checks.filter(({ label, color }) => color.top3.some((t3) => t3.key === label.key)).length, all.length)}`);
console.log(`Distinct units with a block in a typical radius:         median ${[...all.map((c) => c.nearbyUnits)].sort((x, y) => x - y)[Math.floor(all.length / 2)]} of ${keys.length}`);

// By how the label was read: does color disagree more where the read was less sure?
const by = {};
for (const { label, color } of checks) {
  const k = label.read.by === 'ai' ? `claude (${label.read.confidence || 'high'})` : label.read.by;
  (by[k] ||= []).push(color);
}
console.log('\nBy how the label was read:');
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${k.padEnd(18)} ${String(v.length).padStart(4)} labels   in radius ${pct(v.filter((c) => c.agrees).length, v.length).padStart(6)}   touching ${pct(v.filter((c) => c.directAgrees).length, v.length).padStart(6)}`);
}

// Per unit.
const perUnit = {};
for (const { label, color } of checks) (perUnit[label.key] ||= []).push(color);
const units = Object.entries(perUnit).map(([key, v]) => ({ key, n: v.length, rate: v.filter((c) => c.agrees).length / v.length })).filter((u) => u.n >= 4).sort((a, b) => a.rate - b.rate);
console.log('\nUnits color struggles with (>= 4 labels):');
for (const u of units.slice(0, 10)) console.log(`  ${u.key.padEnd(7)} ${(100 * u.rate).toFixed(0).padStart(3)}% of ${u.n}`);

// Which swatches look alike (so color alone cannot tell them apart)?
const pairs = [];
for (let i = 0; i < palettes.length; i++) {
  for (let j = i + 1; j < palettes.length; j++) pairs.push({ a: palettes[i].key, b: palettes[j].key, d: paletteDistance(palettes[i].palette, palettes[j].palette) });
}
pairs.sort((x, y) => x.d - y.d);
const close = pairs.filter((p) => p.d < 8);
console.log(`\nSwatch pairs within 8 delta-E (hard to tell apart by color): ${close.length} of ${pairs.length}`);
console.log('  ' + pairs.slice(0, 12).map((p) => `${p.a}~${p.b} ${p.d.toFixed(1)}`).join('   '));

// Disagreements: contact sheet.
const bad = [...checks.filter(({ color }) => color.verdict === 'conflict'), ...checks.filter(({ color }) => color.verdict === 'doubtful')].slice(0, 24);
if (bad.length) {
  const CELL = 220, COLS = 6, HALF = 55; // 110 pt square around each label
  const sheet = createCanvas(COLS * CELL, Math.ceil(bad.length / COLS) * (CELL + 18));
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  bad.forEach(({ label, color }, i) => {
    const cx = (label.bbox.x0 + label.bbox.x1) / 2, cy = (label.bbox.y0 + label.bbox.y1) / 2;
    const ox = (i % COLS) * CELL, oy = Math.floor(i / COLS) * (CELL + 18);
    ctx.drawImage(sampler.canvas, (cx - HALF) * SCALE, (cy - HALF) * SCALE, 2 * HALF * SCALE, 2 * HALF * SCALE, ox, oy + 18, CELL, CELL);
    ctx.strokeStyle = '#f0f';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + CELL / 2 - ((label.bbox.x1 - label.bbox.x0) / 2) * (CELL / (2 * HALF)), oy + 18 + CELL / 2 - ((label.bbox.y1 - label.bbox.y0) / 2) * (CELL / (2 * HALF)), (label.bbox.x1 - label.bbox.x0) * (CELL / (2 * HALF)), (label.bbox.y1 - label.bbox.y0) * (CELL / (2 * HALF)));
    ctx.fillStyle = '#000';
    ctx.font = '13px sans-serif';
    ctx.fillText(color.verdict === 'conflict' ? `${label.code}: text sits on ${color.suggest[0]}'s color` : `${label.code}: ${color.predicted.length ? `nearest color is ${color.predicted[0]}` : 'no legend color nearby'}`, ox + 3, oy + 13);
  });
  fs.writeFileSync(path.join(dir, 'color-disagreements.jpg'), sheet.toBuffer('image/jpeg', 85));
}

fs.writeFileSync(path.join(dir, 'color-report.json'), JSON.stringify({
  radiusFactor: factor, radiusPt, minBlockPt2: MIN_BLOCK_PT2, touchPt: TOUCH_PT, chanceSupportRate: chance.filter((c) => c.supports).length / all.length, summary: sum, byRead: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { n: v.length, agree: v.filter((c) => c.agrees).length, direct: v.filter((c) => c.directAgrees).length }])),
  worstUnits: units.slice(0, 15), closestSwatchPairs: pairs.slice(0, 30),
}, null, 2));
console.log(`\nWrote color-report.json${bad.length ? ' and color-disagreements.jpg' : ''} in ${dir}`);
