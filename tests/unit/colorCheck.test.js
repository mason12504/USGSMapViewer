import { describe, expect, it } from 'vitest';
import {
  CLASSIFY_TOLERANCE, MIN_BLOCK_PT2, NEIGHBOURHOOD_FACTOR, TOUCH_PT,
  buildUnitPalettes, checkLabel, estimatePaper, identifyByColor, makeClassifier, neighbourhoodRadiusPt, summarizeChecks,
} from '../../src/lib/scan/colorCheck.js';
import { canonicalCode, isCanonicalCode } from '../../src/lib/scan/glyphs.js';
import { applyScanColor } from '../../src/lib/scan/applyColor.js';

// A 400 x 300 pt "map" at 1 px/pt: yellow formation A on the left, blue formation C on the right,
// a small red block B inside A, and a column of legend swatches at the far right.
const W = 400, H = 300;
function makeMap() {
  const data = new Uint8ClampedArray(W * H * 4);
  const rect = (x0, y0, x1, y1, [r, g, b]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([r, g, b, 255], (y * W + x) * 4);
  };
  const A = [250, 235, 110], B = [220, 60, 70], C = [110, 150, 230], PAPER = [250, 247, 238];
  rect(0, 0, W, H, PAPER);
  rect(0, 0, 200, 300, A); // formation A
  rect(200, 0, 330, 300, C); // formation C
  rect(150, 40, 170, 60, B); // small block of B, up and to the right of the label below
  rect(340, 10, 380, 28, A); // swatches (40 x 18)
  rect(340, 40, 380, 58, B);
  rect(340, 70, 380, 88, C);
  rect(340, 100, 380, 118, [248, 244, 225]); // a pale unit whose swatch is nearly the color of paper
  rect(100, 150, 103, 153, [220, 60, 70]); // a 3 x 3 pt speck of B inside A
  const sampler = {
    scale: 1,
    region: { x0: 0, y0: 0, x1: W, y1: H },
    getPixels(b) {
      const x0 = Math.max(0, Math.floor(b.x0)), y0 = Math.max(0, Math.floor(b.y0));
      const x1 = Math.min(W, Math.ceil(b.x1)), y1 = Math.min(H, Math.ceil(b.y1));
      const w = x1 - x0, h = y1 - y0, out = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) out.set(data.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4);
      return { data: out, width: w, height: h };
    },
  };
  const legend = [
    { key: 'Ka', swatch: { bbox: { x0: 340, y0: 10, x1: 380, y1: 28 } } },
    { key: 'Kb', swatch: { bbox: { x0: 340, y0: 40, x1: 380, y1: 58 } } },
    { key: 'Kc', swatch: { bbox: { x0: 340, y0: 70, x1: 380, y1: 88 } } },
    { key: 'Kp', swatch: { bbox: { x0: 340, y0: 100, x1: 380, y1: 118 } } },
  ];
  return { sampler, legend };
}
const labelAt = (key, x, y) => ({ key, bbox: { x0: x - 8, y0: y - 4, x1: x + 8, y1: y + 4 } });

describe('colorCheck: neighbourhood rule', () => {
  const { sampler, legend } = makeMap();
  const palettes = buildUnitPalettes(sampler, legend);
  const classify = makeClassifier(palettes);
  // What the app does: tell the classifier what bare paper looks like, so margins are not a pale unit.
  const paperAware = makeClassifier(palettes, { paper: estimatePaper(sampler) });
  const radiusPt = neighbourhoodRadiusPt(legend); // 1.5 x the 40 pt swatch = 60 pt

  it('measures the radius from the swatches, with the factor easy to change', () => {
    expect(NEIGHBOURHOOD_FACTOR).toBe(1.5);
    expect(radiusPt).toBe(60);
    expect(neighbourhoodRadiusPt(legend, 0.5)).toBe(20);
    expect(neighbourhoodRadiusPt([])).toBe(0);
  });

  it('a code on its own formation agrees directly', () => {
    const c = checkLabel(sampler, classify, labelAt('Ka', 60, 200), { radiusPt });
    expect(c).toMatchObject({ directAgrees: true, agrees: true, via: null, predicted: ['Ka'] });
  });

  it('a code over formation A whose leader points at a small B block is supported by the neighbourhood', () => {
    const c = checkLabel(sampler, classify, labelAt('Kb', 130, 90), { radiusPt }); // B block ~35 pt away
    expect(c.directAgrees).toBe(false);
    expect(c.predicted).toEqual(['Ka']); // what is under the text
    expect(c.supports).toBe(true);
    expect(c.agrees).toBe(true);
    expect(c.via).toBe('leader');
    expect(c.nearestPt).toBeGreaterThan(20);
    expect(c.nearestPt).toBeLessThan(40);
    expect(c.top3[0].key).toBe('Ka');
    expect(c.top3.map((u) => u.key)).toContain('Kb');
    expect(c.nearbyUnits).toBeGreaterThanOrEqual(2);
  });

  it('the same label fails when the radius is too small to reach the block (the factor matters)', () => {
    const small = checkLabel(sampler, classify, labelAt('Kb', 130, 90), { radiusPt: neighbourhoodRadiusPt(legend, 0.5) });
    expect(small.supports).toBe(false);
    expect(small.agrees).toBe(false);
  });

  it('a code whose unit is nowhere nearby disagrees, and says what the color looks like', () => {
    const c = checkLabel(sampler, classify, labelAt('Kc', 60, 250), { radiusPt }); // C is 140 pt away
    expect(c).toMatchObject({ agrees: false, supports: false, predicted: ['Ka'] });
    expect(c.nearestPt).toBeNull();
  });

  it('reports no evidence (rather than a guess) when nothing matches the legend', () => {
    const c = checkLabel(sampler, paperAware, labelAt('Ka', 365, 250), { radiusPt: 10 }); // plain paper
    expect(c.predicted).toEqual([]);
    expect(c.agrees).toBe(false);
  });

  it('counts a tiny block of a unit, which a percent-of-the-area rule would lose, but not a speck', () => {
    const tiny = labelAt('Kb', 60, 140); // a 3 x 3 pt speck of B (9 square pt) sits just below
    expect(checkLabel(sampler, classify, tiny, { radiusPt })).toMatchObject({ supports: true, directAgrees: false });
    expect(checkLabel(sampler, classify, tiny, { radiusPt, minBlockPt2: 20 }).supports).toBe(false); // demand bigger blocks
  });

  it('does not mistake bare paper for a pale unit once the paper color is known', () => {
    const margin = labelAt('Kp', 365, 250);
    expect(checkLabel(sampler, classify, margin, { radiusPt: 25 }).predicted).toEqual(['Kp']); // paper looks like the pale unit
    expect(estimatePaper(sampler).every((v, i) => Math.abs(v - [250, 247, 238][i]) < 10)).toBe(true); // found across the sheet, not told where
    expect(estimatePaper({ ...sampler, region: { x0: 0, y0: 0, x1: 200, y1: 300 } })).toBeNull(); // a sheet with no white at all
    expect(checkLabel(sampler, paperAware, margin, { radiusPt: 25 }).predicted).toEqual([]);
  });

  it('keeps the strict and the neighbourhood agreement rates apart in the summary', () => {
    const checks = [
      checkLabel(sampler, classify, labelAt('Ka', 60, 200), { radiusPt }),
      checkLabel(sampler, classify, labelAt('Kb', 130, 90), { radiusPt }),
      checkLabel(sampler, classify, labelAt('Kc', 60, 250), { radiusPt }),
    ];
    const s = summarizeChecks(checks, radiusPt);
    expect(s).toMatchObject({ total: 3, agree: 2, directAgree: 1, radiusPt: 60 });
    expect(s.accuracy).toBeCloseTo(2 / 3);
    expect(s.directAccuracy).toBeCloseTo(1 / 3);
  });

  it('exposes the thresholds as named constants', () => {
    expect(MIN_BLOCK_PT2).toBeGreaterThan(0);
    expect(TOUCH_PT).toBeGreaterThan(0);
    expect(CLASSIFY_TOLERANCE).toBeGreaterThan(0);
  });
});

describe('colorCheck: click identification', () => {
  const { sampler, legend } = makeMap();
  const palettes = buildUnitPalettes(sampler, legend);
  const classify = makeClassifier(palettes, { paper: estimatePaper(sampler) });

  it('names the unit under the point, with alternatives ranked', () => {
    const hit = identifyByColor(sampler, classify, 60, 200);
    expect(hit.units).toEqual(['Ka']);
    expect(hit.candidates[0]).toMatchObject({ key: 'Ka' });
    expect(hit.via).toBe('raster');
  });

  it('on a boundary, both units are candidates', () => {
    const hit = identifyByColor(sampler, classify, 200, 150, { patchPt: 4 });
    expect(new Set(hit.units)).toEqual(new Set(['Ka', 'Kc']));
  });

  it('says nothing on bare paper', () => {
    expect(identifyByColor(sampler, classify, 365, 250).units).toEqual([]);
  });
});

describe('glyphs', () => {
  it('writes printed glyphs in plain letters for matching', () => {
    expect(canonicalCode('M€r')).toBe('MCr');
    expect(canonicalCode('O€r')).toBe('OCr');
    expect(canonicalCode('ℙPm')).toBe('IPPm');
    expect(canonicalCode('Kd')).toBe('Kd');
    expect(canonicalCode('')).toBe('');
  });

  it('a canonical code is letters and digits only', () => {
    expect(isCanonicalCode('MCr')).toBe(true);
    expect(isCanonicalCode('M€r')).toBe(false);
    expect(isCanonicalCode('')).toBe(false);
  });
});

describe('applyScanColor (what the browser runs on a scan)', () => {
  it('adds a check to every label, a summary for the chip, and a click identifier', async () => {
    const { sampler, legend } = makeMap();
    const result = {
      legend: legend.map((e) => ({ ...e, swatchTextBbox: null })),
      labels: [labelAt('Ka', 60, 200), labelAt('Kb', 130, 90)].map((l, id) => ({ id, code: l.key, ...l })),
      plateLabels: [labelAt('Kc', 60, 250)].map((l) => ({ id: 'p0', code: l.key, other: true, ...l })),
    };
    let yields = 0;
    const out = await applyScanColor(result, sampler, { yieldEvery: 1, yieldFn: async () => { yields++; } });
    expect(out.result.labels.map((l) => [l.key, l.color.agrees, l.color.via])).toEqual([['Ka', true, null], ['Kb', true, 'leader']]);
    expect(out.result.plateLabels[0].color.agrees).toBe(false);
    expect(out.result.color.primary).toBe('raster');
    expect(out.result.color.raster).toMatchObject({ total: 3, agree: 2, directAgree: 1, radiusPt: 60 });
    expect(out.identify(60, 200).units).toEqual(['Ka']);
    expect(yields).toBeGreaterThan(0);
    expect(result.labels[0].color).toBeUndefined(); // the input is not modified
  });

  it('leaves a result alone when no swatch colors can be read', async () => {
    const { sampler } = makeMap();
    const result = { legend: [{ key: 'Zz', swatch: { bbox: { x0: 1000, y0: 1000, x1: 1040, y1: 1018 } } }], labels: [], plateLabels: [] };
    expect((await applyScanColor(result, sampler)).result).toBe(result);
  });
});
