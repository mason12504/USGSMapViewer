#!/usr/bin/env node
// Color lab: iterate on src/lib/color/ in isolation.
//
//   npm run color:lab -- <map.pdf> [--scale 3] [--crops 12]
//
// Prints agreement for BOTH strategies (vector-exact and raster-palette),
// a confusion list, and writes debug images to .lab/:
//   .lab/<name>-labels.png    map with every label boxed (green = color agrees
//                             with the text, red = disagrees, gray = unknown)
//   .lab/<name>-crop-NN.png   close-ups of disagreements
//   .lab/<name>-report.json   full per-label details

import fs from 'node:fs';
import path from 'node:path';
import { OPS, openPdf, makeNodeSampler, ROOT } from './lib/node-pdf.js';
import { parseMapPage } from '../src/lib/pipeline.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^\d+(\.\d+)?$/.test(a));
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? Number(args[i + 1]) : def;
};
if (!file) {
  console.error('usage: npm run color:lab -- <map.pdf> [--scale 3] [--crops 12]');
  process.exit(2);
}
const SCALE = opt('scale', 3);
const CROPS = opt('crops', 12);
const outDir = path.join(ROOT, '.lab');
fs.mkdirSync(outDir, { recursive: true });
const name = path.basename(file, path.extname(file)).replace(/[^\w-]+/g, '_');

const doc = await openPdf(file);
const page = await doc.getPage(1);

// Pass 1: text + vector parse, to learn the map region and legend.
const { result: first } = await parseMapPage(page, { OPS });
// One render that covers the map AND all legend swatches, for the raster strategy.
const bounds = [first.mapRegion.bbox, ...first.legend.map((e) => e.swatch.bbox)];
const region = {
  x0: Math.min(...bounds.map((b) => b.x0)) - 10,
  y0: Math.min(...bounds.map((b) => b.y0)) - 10,
  x1: Math.max(...bounds.map((b) => b.x1)) + 10,
  y1: Math.max(...bounds.map((b) => b.y1)) + 10,
};
console.error(`rendering ${Math.round(region.x1 - region.x0)}×${Math.round(region.y1 - region.y0)} pt at ${SCALE}× …`);
const t0 = Date.now();
const sampler = await makeNodeSampler(page, region, SCALE);
console.error(`  rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Pass 2: full analysis with the raster strategy enabled.
const { result } = await parseMapPage(page, { OPS, sampler });
const { vector, raster } = result.color;

const pct = (s) => (s ? `${s.agree}/${s.total} (${(s.accuracy * 100).toFixed(1)}%), ${s.unknown} unknown` : 'n/a');
console.log(`\n${file}`);
console.log(`vector (exact paint match):    ${pct(vector)}`);
console.log(`raster (pixel palette match):  ${pct(raster)}`);

for (const [label, key] of [['vector', 'color'], ['raster', vector ? 'colorAlt' : 'color']]) {
  const conf = {};
  for (const l of result.labels) {
    const c = l[key];
    if (!c || c.agrees) continue;
    const k = `${l.key} → ${c.predicted.join('|') || 'none'}`;
    conf[k] = (conf[k] || 0) + 1;
  }
  const top = Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (top.length) console.log(`\ntop ${label} confusions:\n` + top.map(([k, v]) => `  ${String(v).padStart(3)}  ${k}`).join('\n'));
}

// Debug images.
const { createCanvas } = await import('@napi-rs/canvas');
const map = result.mapRegion.bbox;
const toPx = (x, y) => [(x - region.x0) * SCALE, (y - region.y0) * SCALE];
const mw = Math.ceil((map.x1 - map.x0) * SCALE);
const mh = Math.ceil((map.y1 - map.y0) * SCALE);
const canvas = createCanvas(mw, mh);
const ctx = canvas.getContext('2d');
const [ox, oy] = toPx(map.x0, map.y0);
ctx.drawImage(sampler.canvas, -ox, -oy);
ctx.lineWidth = Math.max(2, SCALE);
ctx.font = `${Math.round(5 * SCALE)}px sans-serif`;
for (const l of result.labels) {
  const c = l.color;
  ctx.strokeStyle = !c || !c.predicted.length ? '#888' : c.agrees ? '#16a34a' : '#dc2626';
  const [x0, y0] = toPx(l.bbox.x0, l.bbox.y0);
  const [x1, y1] = toPx(l.bbox.x1, l.bbox.y1);
  ctx.strokeRect(x0 - ox - 2, y0 - oy - 2, x1 - x0 + 4, y1 - y0 + 4);
  if (c && !c.agrees && c.predicted.length) {
    ctx.fillStyle = '#dc2626';
    ctx.fillText('→' + c.predicted.join('|'), x1 - ox + 4, y1 - oy);
  }
}
const overview = path.join(outDir, `${name}-labels.png`);
fs.writeFileSync(overview, canvas.toBuffer('image/png'));

const bad = result.labels.filter((l) => l.color && !l.color.agrees).slice(0, CROPS);
bad.forEach((l, i) => {
  const pad = 30;
  const b = { x0: l.bbox.x0 - pad, y0: l.bbox.y0 - pad, x1: l.bbox.x1 + pad, y1: l.bbox.y1 + pad };
  const [bx0, by0] = toPx(b.x0, b.y0);
  const w = (b.x1 - b.x0) * SCALE, h = (b.y1 - b.y0) * SCALE;
  const c2 = createCanvas(Math.ceil(w), Math.ceil(h) + 18 * SCALE / 3);
  const k = c2.getContext('2d');
  k.fillStyle = '#fff';
  k.fillRect(0, 0, c2.width, c2.height);
  k.drawImage(sampler.canvas, -bx0, -by0);
  k.strokeStyle = '#dc2626';
  k.lineWidth = 2;
  k.strokeRect(pad * SCALE - 2, pad * SCALE - 2, (l.bbox.x1 - l.bbox.x0) * SCALE + 4, (l.bbox.y1 - l.bbox.y0) * SCALE + 4);
  k.fillStyle = '#000';
  k.font = `${Math.round(4 * SCALE)}px sans-serif`;
  k.fillText(`${l.code}: color says ${l.color.predicted.join('|') || 'none'}`, 4, c2.height - 4);
  fs.writeFileSync(path.join(outDir, `${name}-crop-${String(i + 1).padStart(2, '0')}.png`), c2.toBuffer('image/png'));
});

fs.writeFileSync(path.join(outDir, `${name}-report.json`), JSON.stringify(result, null, 2));
console.log(`\nwrote ${path.relative(ROOT, overview)}, ${bad.length} crops, and ${name}-report.json in .lab/`);
