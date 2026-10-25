import { describe, expect, it } from 'vitest';
import { ageForCode, isUnitCodeShape, mergeSubscripts, normalizeCode } from '../../src/lib/units/unitCodes.js';

describe('isUnitCodeShape', () => {
  it.each(['Qal', 'Qsw', 'Kda', 'Xqm', 'Ypp', 'Tmp', 'Qt1', 'TKda', 'TKda3', 'Kcgg', 'Qlsr', 'Kl'])(
    'accepts %s',
    (code) => expect(isUnitCodeShape(code)).toBe(true),
  );

  it.each(['THE', 'QT', 'Q', 'qal', 'Unit', 'Force', 'Digital', 'Qal-', '12', 'QAL', 'KdaX'])(
    'rejects %s',
    (word) => expect(isUnitCodeShape(word)).toBe(false),
  );

  it('is only a shape test: some English words pass (position filtering removes them)', () => {
    // A = Archean, C = Cambrian. The pipeline only trusts codes inside legend
    // swatches, or map words that match a legend code.
    expect(isUnitCodeShape('Air')).toBe(true);
    expect(isUnitCodeShape('Creek')).toBe(true);
  });
});

describe('ageForCode', () => {
  it('reads one-letter prefixes', () => {
    expect(ageForCode('Qsw')).toEqual({ prefix: 'Q', period: 'Quaternary' });
    expect(ageForCode('Kda').period).toBe('Cretaceous');
    expect(ageForCode('Xqm').period).toBe('Paleoproterozoic');
  });

  it('prefers two-letter prefixes', () => {
    expect(ageForCode('TKda').period).toBe('Tertiary–Cretaceous');
  });

  it('does not treat Qt (terrace) as a two-letter age', () => {
    expect(ageForCode('Qt1').prefix).toBe('Q');
  });
});

describe('normalizeCode', () => {
  it('upper-cases a flattened second age letter', () => {
    expect(normalizeCode('Tkda')).toBe('TKda');
  });
  it('leaves ordinary codes alone', () => {
    expect(normalizeCode('Qt1')).toBe('Qt1');
    expect(normalizeCode('Qsw')).toBe('Qsw');
  });
});

describe('mergeSubscripts', () => {
  const item = (str, x0, y0, size) => ({ str, x0, x1: x0 + str.length * size * 0.55, y0, y1: y0 + size, fontSize: size });

  it('joins a small digit right after a code', () => {
    const out = mergeSubscripts([item('Qt', 100, 100, 8), item('1', 109, 104, 5.5)]);
    expect(out.map((i) => i.str)).toEqual(['Qt1']);
    expect(out[0].parts).toHaveLength(2);
  });

  it('ignores digits that are far away or full-size', () => {
    const far = mergeSubscripts([item('Qt', 100, 100, 8), item('1', 140, 104, 5.5)]);
    expect(far.map((i) => i.str)).toEqual(['Qt', '1']);
    const big = mergeSubscripts([item('Qt', 100, 100, 8), item('1', 109, 100, 8)]);
    expect(big.map((i) => i.str)).toEqual(['Qt', '1']);
  });
});
