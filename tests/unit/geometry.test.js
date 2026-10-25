import { describe, expect, it } from 'vitest';
import { applyMatrix, multiply, pathContainsPoint, ringsArea } from '../../src/lib/geometry.js';

const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];

describe('pathContainsPoint', () => {
  it('detects inside / outside of a square', () => {
    expect(pathContainsPoint([square(0, 0, 10)], 5, 5)).toBe(true);
    expect(pathContainsPoint([square(0, 0, 10)], 15, 5)).toBe(false);
  });

  it('respects even-odd holes', () => {
    const rings = [square(0, 0, 10), square(3, 3, 4)];
    expect(pathContainsPoint(rings, 5, 5, 'evenodd')).toBe(false);
    expect(pathContainsPoint(rings, 1, 1, 'evenodd')).toBe(true);
  });
});

describe('matrices', () => {
  it('multiplies and applies affine transforms', () => {
    const scale2 = [2, 0, 0, 2, 0, 0];
    const shift = [1, 0, 0, 1, 10, 20];
    expect(applyMatrix(multiply(shift, scale2), 1, 1)).toEqual([12, 22]);
  });
});

describe('ringsArea', () => {
  it('computes square area', () => {
    expect(ringsArea([square(0, 0, 10)])).toBe(100);
  });
});
