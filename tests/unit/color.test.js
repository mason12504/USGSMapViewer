import { describe, expect, it } from 'vitest';
import { buildPalette, deltaE, paletteDistance, paletteFromHexes, rgbToLab } from '../../src/lib/color/colorMath.js';
import { buildFillIndex, followLeader, legendPaintLookup, matchLabelsVector } from '../../src/lib/color/vectorMatch.js';
import { paintKey } from '../../src/lib/color/paint.js';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const fill = (id, order, ring, paint) => ({
  id, order, rings: [ring], fillRule: 'nonzero', paint,
  bbox: { x0: Math.min(...ring.map((p) => p[0])), y0: Math.min(...ring.map((p) => p[1])), x1: Math.max(...ring.map((p) => p[0])), y1: Math.max(...ring.map((p) => p[1])) },
});

const YELLOW = { kind: 'pattern', key: 'pat:yellowdots', colors: ['#ffdd67', '#fb3199'] };
const GREEN = { kind: 'rgb', color: '#9ad58d' };
const legend = [
  { key: 'Qsw', swatch: { paint: YELLOW, paintKey: paintKey(YELLOW) } },
  { key: 'Kl', swatch: { paint: GREEN, paintKey: paintKey(GREEN) } },
];

describe('color math', () => {
  it('deltaE is 0 for identical colors and large for opposites', () => {
    expect(deltaE(rgbToLab([10, 20, 30]), rgbToLab([10, 20, 30]))).toBe(0);
    expect(deltaE(rgbToLab([0, 0, 0]), rgbToLab([255, 255, 255]))).toBeGreaterThan(99);
  });

  it('buildPalette finds the dominant color', () => {
    const data = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i++) data.set(i < 80 ? [255, 221, 103, 255] : [251, 49, 153, 255], i * 4);
    const pal = buildPalette(data);
    expect(pal[0].hex).toBe('#ffdd67');
    expect(pal[0].weight).toBeCloseTo(0.8, 2);
  });

  it('palette distance prefers the matching legend palette', () => {
    const sample = paletteFromHexes(['#ffdc66', '#fa3298']);
    const yellow = paletteFromHexes(YELLOW.colors);
    const green = paletteFromHexes([GREEN.color]);
    expect(paletteDistance(sample, yellow)).toBeLessThan(paletteDistance(sample, green));
  });
});

describe('vector matching', () => {
  // Green bedrock everywhere, a yellow surficial polygon painted on top of it,
  // and a tiny yellow sliver reached by a leader line.
  const fills = [
    fill(0, 1, rect(0, 0, 200, 200), GREEN),
    fill(1, 2, rect(20, 20, 80, 80), YELLOW),
    fill(2, 3, rect(150, 150, 156, 156), YELLOW),
  ];
  const index = buildFillIndex(fills, { x0: 0, y0: 0, x1: 200, y1: 200 });
  const label = (key, x, y) => ({ key, bbox: { x0: x, y0: y, x1: x + 12, y1: y + 8 } });

  it('maps paint keys to legend units', () => {
    expect([...legendPaintLookup(legend).entries()]).toEqual([['pat:yellowdots', ['Qsw']], ['rgb:#9ad58d', ['Kl']]]);
  });

  it('uses the TOPMOST fill under a label', () => {
    const r = matchLabelsVector([label('Qsw', 40, 40), label('Kl', 120, 30)], legend, index);
    expect(r.perLabel.map((p) => p.predicted)).toEqual([['Qsw'], ['Kl']]);
    expect(r.summary.accuracy).toBe(1);
  });

  it('flags a label sitting on the wrong unit', () => {
    const r = matchLabelsVector([label('Qsw', 120, 30)], legend, index);
    expect(r.perLabel[0].agrees).toBe(false);
    expect(r.perLabel[0].predicted).toEqual(['Kl']);
  });

  it('follows a leader line from the label to a small polygon', () => {
    const lab = label('Qsw', 100, 100); // sits on green bedrock
    const strokes = [{ points: [[112, 104], [153, 153]], bbox: { x0: 112, y0: 104, x1: 153, y1: 153 } }];
    const hit = followLeader(lab, strokes, index, legendPaintLookup(legend));
    expect(hit.units).toEqual(['Qsw']);
    const r = matchLabelsVector([lab], legend, index, strokes);
    expect(r.perLabel[0]).toMatchObject({ agrees: true, via: 'leader' });
  });
});
