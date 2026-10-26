import { describe, expect, it } from 'vitest';
import { components, darkMask, paperColor } from '../../src/lib/scan/raster.js';
import { findSwatchColumns } from '../../src/lib/scan/swatches.js';
import { blobImage, findLabelBlobs } from '../../src/lib/scan/blobs.js';
import { buildLegendEntries } from '../../src/lib/scan/legendText.js';
import { nearestCode } from '../../src/lib/scan/vocab.js';

// A synthetic scan: cream paper we can paint rectangles on.
function canvas(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set([250, 247, 238, 255], p * 4);
  const rect = (x0, y0, x1, y1, [r, g, b]) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data.set([r, g, b, 255], (y * width + x) * 4);
  };
  return { data, width, height, rect };
}

describe('raster helpers', () => {
  it('finds the paper colour and connected components', () => {
    const c = canvas(60, 40);
    c.rect(10, 10, 19, 14, [200, 0, 0]);
    c.rect(30, 20, 31, 21, [0, 0, 0]);
    const [r, g, b] = paperColor(c);
    expect(Math.abs(r - 250) + Math.abs(g - 247) + Math.abs(b - 238)).toBeLessThan(24);
    const comps = components(darkMask(c, 60), c.width, c.height);
    expect(comps).toEqual([{ x0: 30, y0: 20, x1: 31, y1: 21, n: 4 }]);
  });
});

describe('findSwatchColumns', () => {
  it('finds a column of same-size swatches and the big map, ignoring other shapes', () => {
    const c = canvas(600, 400);
    c.rect(20, 20, 300, 300, [120, 160, 90]); // the map
    for (let i = 0; i < 8; i++) c.rect(400, 20 + i * 24, 440, 20 + i * 24 + 17, i % 2 ? [230, 120, 120] : [120, 120, 230]);
    c.rect(500, 100, 505, 140, [0, 0, 0]); // thin stray shape
    const { columns, map } = findSwatchColumns(c, { pxPerPt: 1 });
    expect(columns).toHaveLength(1);
    expect(columns[0].swatches).toHaveLength(8);
    expect(columns[0].x0).toBe(400);
    expect(map).toMatchObject({ x0: 20, y0: 20, x1: 300, y1: 300 });
  });

  it('splits two touching swatches of different colours', () => {
    const c = canvas(300, 300);
    for (let i = 0; i < 6; i++) c.rect(50, 10 + i * 30, 90, 10 + i * 30 + 17, [200, 200, 100]);
    c.rect(50, 200, 90, 217, [100, 200, 100]); // two touching: 200-217 and 218-235
    c.rect(50, 218, 90, 235, [240, 100, 100]);
    const { columns } = findSwatchColumns(c, { pxPerPt: 1, minInColumn: 5 });
    expect(columns[0].swatches).toHaveLength(8);
    const [a, b] = columns[0].swatches.slice(-2);
    expect(a.color[1]).toBeGreaterThan(150); // green one
    expect(b.color[0]).toBeGreaterThan(200); // red one
  });
});

describe('buildLegendEntries', () => {
  const line = (text, x0, y0, confidence = 90) => ({ text, x0, y0, x1: x0 + 200, y1: y0 + 10, confidence });

  it('pairs each swatch with the line beside it and keeps wrapped lines together', () => {
    const lines = [
      line('UNCONSOLIDATED DEPOSITS (HOLOCENE):', 200, 0), // heading: no swatch
      line('Alluvium—Gravel, sand, and silt', 224, 24),
      line('in stream valleys', 243, 36),
      line('Eolian deposits—Windblown sand', 224, 52),
    ];
    const swatches = [
      { x0: 100, x1: 140, y0: 20, y1: 40 }, // taller than a line: overlaps the one above too
      { x0: 100, x1: 140, y0: 46, y1: 66 },
    ];
    const entries = buildLegendEntries(lines, swatches);
    expect(entries.map((e) => [Boolean(e.swatch), e.name])).toEqual([
      [false, 'UNCONSOLIDATED DEPOSITS (HOLOCENE):'],
      [true, 'Alluvium'],
      [true, 'Eolian deposits'],
    ]);
    expect(entries[1].description).toBe('Gravel, sand, and silt in stream valleys');
  });

  it('starts a swatch-less entry at the text edge', () => {
    const lines = [line('MANCOS SHALE (UPPER CRETACEOUS)—Gray shale.', 168, 0), line('Thickness 500 ft', 186, 12), line('Burro Canyon Formation—Yellow sandstone', 177, 30)];
    const entries = buildLegendEntries(lines, [{ x0: 60, x1: 100, y0: -2, y1: 18 }]);
    expect(entries).toHaveLength(2);
    expect(entries[0].swatch).not.toBeNull();
    expect(entries[1].swatch).toBeNull();
  });
});

describe('findLabelBlobs', () => {
  it('finds a short row of glyph-sized black shapes as one label, ignoring long strokes', () => {
    const c = canvas(300, 120);
    c.rect(0, 0, 299, 119, [230, 150, 150]); // coloured fill
    // "Kd": two glyphs ~15px tall at 3 px/pt (5 pt), 12px apart
    c.rect(40, 40, 43, 54, [0, 0, 0]);
    c.rect(44, 46, 50, 48, [0, 0, 0]);
    c.rect(56, 40, 59, 54, [0, 0, 0]);
    c.rect(60, 46, 64, 54, [0, 0, 0]);
    c.rect(10, 100, 280, 101, [0, 0, 0]); // a fault line
    const blobs = findLabelBlobs(c, { pxPerPt: 3 });
    expect(blobs).toHaveLength(1);
    expect(blobs[0]).toMatchObject({ x0: 40, x1: 64, y0: 40, y1: 54, glyphs: 2 });
    const img = blobImage(c, blobs[0], { pad: 4 });
    expect(img.width).toBe(25 + 8);
    expect(img.data[(4 * img.width + 4) * 4]).toBe(0); // ink stays black
    expect(img.data[0]).toBe(255); // the coloured fill is gone
  });
});

describe('nearestCode (snapping OCR reads to the legend)', () => {
  const vocab = ['Kc', 'Kd', 'Km', 'Kfd', 'IPee', 'IPm', 'IPb', 'Pmb', 'Qd'];

  it('keeps exact matches', () => {
    expect(nearestCode('Kd', vocab)).toEqual({ code: 'Kd', distance: 0 });
  });

  it('restores the barred P that OCR drops', () => {
    expect(nearestCode('Pee', vocab).code).toBe('IPee');
    expect(nearestCode('Pm', vocab).code).toBe('IPm');
  });

  it('fixes a single wrong letter only when exactly one code is that close', () => {
    expect(nearestCode('Qe', vocab).code).toBe('Qd');
    expect(nearestCode('Ke', vocab)).toBeNull(); // Kc, Kd and Km are all one letter away
    expect(nearestCode('Kid', vocab)).toBeNull(); // Kfd and Kd are both one edit away
    expect(nearestCode('Pb', vocab).code).toBe('IPb'); // the barred P is nearly free; Pmb needs a real edit
  });

  it('gives up on anything far from every code', () => {
    expect(nearestCode('Zzzz', vocab)).toBeNull();
    expect(nearestCode('', vocab)).toBeNull();
  });
});
