// Golden-fixture test: run the real pipeline on a real public map and compare
// with hand-checkable expectations in fixtures/pikeview/expected-units.json.
//
// If this fails after a change, either the change broke parsing, or you
// improved it — in which case update expected-units.json deliberately.

import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { OPS, openPdf, ROOT } from '../../scripts/lib/node-pdf.js';
import { parseMapPage } from '../../src/lib/pipeline.js';

const dir = path.join(ROOT, 'fixtures/pikeview');
const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected-units.json'), 'utf8'));

let result;
beforeAll(async () => {
  const doc = await openPdf(path.join(dir, expected.pdf));
  const page = await doc.getPage(1);
  ({ result } = await parseMapPage(page, { OPS }));
});

describe('Pikeview quadrangle (vector PDF with text layer)', () => {
  it('has no warnings', () => {
    expect(result.warnings).toEqual([]);
  });

  it('finds exactly the expected legend units', () => {
    expect(result.legend.map((e) => e.code).sort()).toEqual(expected.units.map((u) => u.code).sort());
  });

  describe.each(expected.units)('$code', (unit) => {
    it('has the expected name, age and context', () => {
      const e = result.legend.find((x) => x.code === unit.code);
      expect(e.name).toBe(unit.name);
      expect(e.ageText).toBe(unit.ageText);
      expect(e.parent?.code).toBe(unit.parent);
      expect(e.group?.name).toBe(unit.group);
      expect(e.description.startsWith(unit.descriptionStartsWith)).toBe(true);
    });
  });

  it('includes the units from the requirements list', () => {
    const byCode = Object.fromEntries(result.legend.map((e) => [e.code, e]));
    expect(byCode.Qsw.name).toMatch(/^Sheetwash deposits/);
    expect(byCode.Qsw.ageText).toMatch(/^Holocene/);
    expect(byCode.Kda.name).toBe('Lower part of the Dawson Formation');
    expect(byCode.Qc.name).toBe('Colluvium');
  });

  it('finds map labels inside the map frame, merging subscripts', () => {
    expect(result.labels.length).toBeGreaterThanOrEqual(expected.expectations.minMapLabels);
    const codes = new Set(result.labels.map((l) => l.code));
    for (const c of ['Qt1', 'Qg2', 'TKda3']) expect(codes.has(c)).toBe(true);
    for (const w of expected.expectations.mustNotBeLabels) expect(codes.has(w)).toBe(false);
  });

  it('flags uncertain "Kl?" style labels', () => {
    expect(result.labels.some((l) => l.code === 'Kl' && l.uncertain)).toBe(true);
  });

  it('color/pattern under each label agrees with its text', () => {
    expect(result.color.primary).toBe('vector');
    expect(result.color.vector.accuracy).toBeGreaterThanOrEqual(expected.expectations.minVectorColorAgreement);
  });

  it('every legend unit has a distinct paint', () => {
    const keys = result.legend.map((e) => e.swatch.paintKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
