import { describe, expect, it } from 'vitest';
import { buildFillIndex } from '../../src/lib/color/vectorMatch.js';
import { shapesForUnit, shapesToPaths } from '../../src/lib/color/highlight.js';
import { paintKey } from '../../src/lib/color/paint.js';

const sq = (x, y) => [[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10]];
const fill = (id, ring, paint, fillRule = 'nonzero') => ({
  id, order: id, rings: [ring], fillRule, paint,
  bbox: { x0: ring[0][0], y0: ring[0][1], x1: ring[0][0] + 10, y1: ring[0][1] + 10 },
});
const pat = (key, colors) => ({ kind: 'pattern', key, colors });
const entry = (key, paint) => ({ key, swatch: { paint, paintKey: paintKey(paint) } });

describe('shapesForUnit', () => {
  const GREEN = { kind: 'rgb', color: '#9ad58d' };
  const legend = [
    entry('Kl', GREEN),
    entry('Qcs', pat('pat:legend1', ['#fed095', '#ffffff'])),
    entry('Qf', pat('pat:legend2', ['#fffac2', '#00aeef'])),
    entry('Qf2', pat('pat:legend3', ['#fffac2', '#00aeef'])), // same colors as Qf: ambiguous
    entry('af', { kind: 'rgb', color: '#ffffff' }),
  ];
  const fills = [
    fill(0, sq(0, 0), GREEN),
    fill(1, sq(20, 0), GREEN),
    fill(2, sq(40, 0), pat('pat:map1', ['#ffffff', '#fed095'])), // Qcs at another scale
    fill(3, sq(60, 0), pat('pat:map2', ['#fffac2', '#00aeef'])),
    fill(4, sq(80, 0), { kind: 'rgb', color: '#ffffff' }),
  ];
  const analysis = { index: buildFillIndex(fills, null) };

  it('finds every shape with the swatch paint', () => {
    const r = shapesForUnit(analysis, legend, 'Kl');
    expect(r.method).toBe('exact');
    expect(r.shapes.map((f) => f.id)).toEqual([0, 1]);
  });

  it('falls back to the pattern colors when the hash differs and only one unit has those colors', () => {
    const r = shapesForUnit(analysis, legend, 'Qcs');
    expect(r.method).toBe('colors');
    expect(r.shapes.map((f) => f.id)).toEqual([2]);
  });

  it('does not guess when two units share the colors, or for a white swatch', () => {
    expect(shapesForUnit(analysis, legend, 'Qf').shapes).toEqual([]);
    expect(shapesForUnit(analysis, legend, 'af').shapes).toEqual([]);
    expect(shapesForUnit(analysis, legend, 'nope').shapes).toEqual([]);
  });

  it('builds one path per fill rule', () => {
    const paths = shapesToPaths([fill(0, sq(0, 0), GREEN), fill(1, sq(20, 0), GREEN, 'evenodd')]);
    expect(paths.map((p) => p.fillRule)).toEqual(['nonzero', 'evenodd']);
    expect(paths[0].d).toBe('M0 0L10 0L10 10L0 10Z');
  });
});

describe('addColorAliases', () => {
  it('lets a click on a color-only match identify the unit, and leaves exact matches alone', async () => {
    const { addColorAliases } = await import('../../src/lib/color/highlight.js');
    const { legendPaintLookup } = await import('../../src/lib/color/vectorMatch.js');
    const legend = [
      entry('QTg4', pat('pat:legend', ['#fffcdf', '#31c1f1'])),
      entry('Qa', { kind: 'rgb', color: '#fffcdf' }),
    ];
    const fills = [fill(0, sq(0, 0), pat('pat:map', ['#31c1f1', '#fffcdf'])), fill(1, sq(20, 0), { kind: 'rgb', color: '#fffcdf' })];
    const lookup = addColorAliases(legendPaintLookup(legend), legend, fills);
    expect(lookup.get('pat:map')).toEqual(['QTg4']);
    expect(lookup.get('rgb:#fffcdf')).toEqual(['Qa']);
  });
});

describe('paintUnderCode (diagonal-split legend swatches)', () => {
  it('uses the topmost small fill under the code, ignores white and fills outside the cell', async () => {
    const { paintUnderCode } = await import('../../src/lib/legend/legend.js');
    const cell = { x0: 0, y0: 0, x1: 40, y1: 18 };
    const code = { x0: 4, y0: 4, x1: 16, y1: 12 }; // sits in the colored trapezoid
    const SALMON = { kind: 'rgb', color: '#fab49b' };
    const big = (paint, order) => ({ ...fill(order, [[-500, -500], [500, -500], [500, 500], [-500, 500]], paint), bbox: { x0: -500, y0: -500, x1: 500, y1: 500 } });
    const small = (paint, order) => ({ ...fill(order, [[0, 0], [30, 0], [30, 18], [0, 18]], paint), bbox: { x0: 0, y0: 0, x1: 30, y1: 18 } });
    expect(paintUnderCode(code, cell, [big(SALMON, 5), small(SALMON, 2)])).toEqual(SALMON);
    expect(paintUnderCode(code, cell, [small(SALMON, 2), small({ kind: 'rgb', color: '#ffffff' }, 3)])).toBeNull(); // white on top: plain dike swatch
    expect(paintUnderCode(code, cell, [big(SALMON, 5)])).toBeNull(); // the big shape is not part of the swatch
    expect(paintUnderCode({ x0: 100, y0: 4, x1: 110, y1: 12 }, cell, [small(SALMON, 2)])).toBeNull();
  });
});
