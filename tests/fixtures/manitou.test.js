// Golden-fixture test for a whole publication: the Manitou Springs report
// (46 pages of text) with its plate as page 47. Compared with
// fixtures/manitou/expected-units.json.
//
// If this fails after a change, either the change broke parsing, or you
// improved it, in which case update expected-units.json deliberately.

import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { OPS, openPdf, ROOT } from '../../scripts/lib/node-pdf.js';
import { parseDocument } from '../../src/lib/document.js';

const dir = path.join(ROOT, 'fixtures/manitou');
const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected-units.json'), 'utf8'));
const ex = expected.expectations;

let result;
beforeAll(async () => {
  const doc = await openPdf(path.join(dir, expected.pdf));
  ({ result } = await parseDocument(doc, { OPS }));
}, 120_000);

describe('Manitou Springs publication (report + plate)', () => {
  it('finds the plate among the report pages', () => {
    expect(result.document.pageCount).toBe(ex.pageCount);
    expect(result.document.plate.pageNumber).toBe(ex.platePage);
    expect(result.document.pages.filter((p) => p.kind === 'plate')).toHaveLength(1);
  });

  it('has no warnings', () => {
    expect(result.warnings).toEqual([]);
  });

  it('crops the map to its geology, not the legend or the footer', () => {
    const b = result.mapRegion.bbox;
    const t = ex.mapRegion.tolerance;
    for (const k of ['x0', 'y0', 'x1', 'y1']) expect(Math.abs(b[k] - ex.mapRegion[k])).toBeLessThanOrEqual(t);
  });

  it('finds exactly the expected legend units', () => {
    expect(result.legend.map((e) => e.code).sort()).toEqual(expected.units.map((u) => u.code).sort());
  });

  describe.each(expected.units)('$code', (unit) => {
    it('has the plate legend name and age, and the full report description', () => {
      const e = result.legend.find((x) => x.code === unit.code);
      expect(e.name).toBe(unit.name);
      expect(e.ageText).toBe(unit.ageText);
      expect(e.parent?.code ?? null).toBe(unit.parent);
      expect(e.group?.name ?? null).toBe(unit.group);
      expect(e.report?.matchedBy).toBe('code');
      expect(e.report.page).toBe(unit.reportPage);
      expect(e.report.text.startsWith(unit.reportStartsWith)).toBe(true);
    });
  });

  it('keeps every description under the cap and free of the next section', () => {
    for (const e of result.legend) {
      expect(e.report.text.length).toBeGreaterThan(40);
      expect(e.report.text.length).toBeLessThanOrEqual(10_000);
      expect(e.report.text).not.toMatch(/STRUCTURAL GEOLOGY|[A-Z]{4,} DEPOSITS/);
    }
  });

  it('reports the one report entry with no plate unit (the Lyons parent)', () => {
    expect(result.document.report.unmatched.map((u) => u.code)).toEqual(ex.unmatchedReportCodes);
  });

  it('finds map labels, including lowercase and split codes', () => {
    expect(result.labels.length).toBeGreaterThanOrEqual(ex.minMapLabels);
    const codes = new Set(result.labels.map((l) => l.code));
    for (const c of ex.mustBeLabels) expect(codes.has(c)).toBe(true);
    for (const w of ex.mustNotBeLabels) expect(codes.has(w)).toBe(false);
  });

  it('finds unit codes on the cross-sections and chart, outside the map frame', () => {
    expect(result.plateLabels.length).toBeGreaterThanOrEqual(ex.minPlateLabels);
    const b = result.mapRegion.bbox;
    for (const l of result.plateLabels) {
      const cx = (l.codeBbox.x0 + l.codeBbox.x1) / 2;
      const cy = (l.codeBbox.y0 + l.codeBbox.y1) / 2;
      expect(cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1).toBe(false);
    }
  });
});
