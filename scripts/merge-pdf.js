#!/usr/bin/env node
// Merge a pamphlet (unit descriptions) and a plate (the map) into one PDF the app can open.
//
//   npm run merge-pdf -- <pamphlet.pdf> <plate.pdf> [out.pdf]
//
// Default output: map_library/<plate name>+pamphlet.pdf. Drop the result on the home page, or leave it in
// map_library/ where the catalog finds it. Big plates are fine; give node more memory if it runs out:
//   NODE_OPTIONS=--max-old-space-size=8192 npm run merge-pdf -- ...

import fs from 'node:fs';
import path from 'node:path';
import { mergePamphletAndPlate } from '../server/mergePdf.js';

const [pamphletFile, plateFile, outArg] = process.argv.slice(2);
if (!pamphletFile || !plateFile) {
  console.error('usage: npm run merge-pdf -- <pamphlet.pdf> <plate.pdf> [out.pdf]');
  process.exit(2);
}
for (const f of [pamphletFile, plateFile]) {
  if (!fs.existsSync(f)) {
    console.error(`not found: ${f}`);
    process.exit(2);
  }
}
const out = outArg || path.join('map_library', `${path.basename(plateFile, path.extname(plateFile))}+pamphlet.pdf`);
if (fs.existsSync(out)) {
  console.error(`${out} already exists; choose another name or delete it first.`);
  process.exit(2);
}

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const t0 = Date.now();
const pamphlet = fs.readFileSync(pamphletFile);
const plate = fs.readFileSync(plateFile);
console.log(`pamphlet ${mb(pamphlet.length)}, plate ${mb(plate.length)}; merging…`);
const merged = await mergePamphletAndPlate(pamphlet, plate);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, merged.bytes);
console.log(
  `wrote ${out} (${mb(merged.bytes.length)}): ${merged.pamphletPages} pamphlet page(s) + ${merged.platePages} plate page(s), ` +
  `${((Date.now() - t0) / 1000).toFixed(1)}s`,
);
if (merged.platePages > 1) console.log('note: the plate file has more than one page; the app picks the largest sheet as the map.');
