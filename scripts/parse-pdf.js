#!/usr/bin/env node
// Parse a geologic map PDF from the command line and print/save the result.
//
//   npm run parse -- path/to/map.pdf             # summary to stdout
//   npm run parse -- path/to/map.pdf --json out.json

import fs from 'node:fs';
import { OPS, openPdf } from './lib/node-pdf.js';
import { parseMapPage } from '../src/lib/pipeline.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx !== -1 ? args[jsonIdx + 1] : null;

if (!file) {
  console.error('usage: npm run parse -- <map.pdf> [--json out.json]');
  process.exit(2);
}

const t0 = Date.now();
const doc = await openPdf(file);
const page = await doc.getPage(1);
const { result } = await parseMapPage(page, { OPS, onProgress: (s) => console.error(`  … ${s}`) });

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2));
  console.error(`wrote ${jsonOut}`);
}

console.log(`\n${file}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.log(`map region: ${result.mapRegion.method}`, roundBox(result.mapRegion.bbox));
console.log(`legend entries: ${result.legend.length}   map labels: ${result.labels.length}`);
for (const w of result.warnings) console.log(`WARNING ${w.code}: ${w.message}`);
console.log('');
for (const e of result.legend) {
  console.log(`${e.code.padEnd(6)} ${String(e.labelCount).padStart(3)}×  ${e.name}${e.ageText ? `  (${e.ageText})` : ''}`);
  console.log(`        ${e.swatch.paintKey}  ${e.description.slice(0, 110)}${e.description.length > 110 ? '…' : ''}`);
}
if (result.unmatchedCodes.length) {
  console.log('\ncode-shaped words in the map NOT in the legend:', result.unmatchedCodes.map((u) => `${u.code}×${u.count}`).join(' '));
}
const c = result.color;
if (c.vector) console.log(`\ncolor check (vector): ${c.vector.agree}/${c.vector.total} labels agree (${(c.vector.accuracy * 100).toFixed(1)}%), ${c.vector.unknown} unknown`);

function roundBox(b) {
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v)]));
}
