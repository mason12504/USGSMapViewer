// The saved results of a scanned map (USGS I-999, Leadville 1x2 degree sheet): the output of
// `npm run scan` + `npm run scan:ai`, which cost real API calls. Kept in the repo so they are
// never bought twice, and used to check the scan -> app conversion on real data.
//
// Assertions are about shape and consistency, not exact counts: a better scan will change the counts.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../scripts/lib/node-pdf.js';
import { scanResultFromResolved } from '../../src/lib/scan/toResult.js';

const resolved = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/leadville-scan/resolved.json'), 'utf8'));
const { result } = scanResultFromResolved(resolved);

describe('Leadville scan (real saved results)', () => {
  it('keeps the barred-C units: shown as printed, matched by plain letters, with labels', () => {
    const cambrian = result.legend.filter((e) => /€/.test(e.code));
    expect(cambrian.map((e) => [e.code, e.key]).sort()).toEqual([['M€r', 'MCr'], ['O€r', 'OCr']]);
    expect(cambrian.every((e) => e.labelCount > 0)).toBe(true);
    expect(result.labels.some((l) => l.code === 'M€r' && l.key === 'MCr')).toBe(true);
  });

  it('has the sheet geometry and a hash to be found by', () => {
    expect(resolved.fileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.page).toEqual({ width: 3056, height: 2269 });
    expect(result.mapRegion.bbox.x1).toBeGreaterThan(result.mapRegion.bbox.x0);
  });

  it('turns all 73 swatches into legend entries with unique codes and real swatch boxes', () => {
    expect(result.legend).toHaveLength(73);
    expect(new Set(result.legend.map((e) => e.key)).size).toBe(73);
    for (const e of result.legend) {
      expect(e.swatch.bbox.x1).toBeGreaterThan(e.swatch.bbox.x0);
      expect(e.name.length).toBeGreaterThan(1);
    }
  });

  it('keeps some of the long legend paragraphs as full descriptions', () => {
    const withText = result.legend.filter((e) => e.report);
    expect(withText.length).toBeGreaterThan(40);
    expect(withText.every((e) => e.report.page === null)).toBe(true);
  });

  it('only has labels whose code is a legend code, and most units have at least one', () => {
    const codes = new Set(result.legend.map((e) => e.key));
    const all = [...result.labels, ...result.plateLabels];
    expect(all.length).toBeGreaterThan(600);
    expect(all.every((l) => codes.has(l.key))).toBe(true);
    expect(result.legend.filter((e) => e.labelCount > 0)).toHaveLength(73); // every unit has a label
  });
});
