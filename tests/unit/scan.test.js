import { describe, expect, it } from 'vitest';
import { components, darkMask, paperColor } from '../../src/lib/scan/raster.js';
import { findSwatchColumns } from '../../src/lib/scan/swatches.js';
import { blobImage, findLabelBlobs } from '../../src/lib/scan/blobs.js';
import { buildLegendEntries } from '../../src/lib/scan/legendText.js';
import { nearestCode } from '../../src/lib/scan/vocab.js';
import { scanResultFromResolved } from '../../src/lib/scan/toResult.js';

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

  it('joins words broken at a line end, but keeps real compounds', () => {
    const lines = [
      line('DAKOTA SANDSTONE (LOWER CRETACEOUS)—Light-gray sandstone or quart-', 200, 0),
      line('zite; north-', 218, 12),
      line('facing slopes and a north-facing unit', 218, 24),
    ];
    const [e] = buildLegendEntries(lines, [{ x0: 100, x1: 140, y0: -4, y1: 14 }]);
    expect(e.description).toBe('Light-gray sandstone or quartzite; north-facing slopes and a north-facing unit');
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
  it('finds dark-gray type on a light colour that a fixed cutoff would miss', () => {
    const c = canvas(200, 100);
    c.rect(0, 0, 199, 99, [255, 165, 20]); // orange fill
    // Gray (110) glyphs, 15 px tall: above a fixed cutoff of 95, still clearly darker than the fill.
    c.rect(40, 40, 43, 54, [110, 110, 110]);
    c.rect(44, 46, 50, 54, [110, 110, 110]);
    c.rect(56, 40, 59, 54, [110, 110, 110]);
    c.rect(60, 46, 64, 54, [110, 110, 110]);
    expect(findLabelBlobs(c, { pxPerPt: 3 })).toHaveLength(1);
  });

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
    const img = blobImage(c, blobs[0]);
    // Room around the glyphs, more on the right where the last letter gets clipped.
    expect(img.width).toBe(25 + Math.round(0.5 * 15) + Math.round(1.0 * 15));
    expect(img.height).toBe(15 + 2 * Math.round(0.35 * 15));
    const at = (x, y) => img.data[(y * img.width + x) * 4];
    expect(at(Math.round(0.5 * 15), Math.round(0.35 * 15))).toBe(0); // ink stays black
    expect(at(0, 0)).toBe(255); // the coloured fill is gone
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

describe('scanResultFromResolved (a scan opened in the app)', () => {
  const resolved = {
    file: 'x.pdf',
    page: { width: 1000, height: 800 },
    map: { x0: 50, y0: 50, x1: 600, y1: 500 },
    entries: [
      { column: 0, code: null, name: 'UNCONSOLIDATED DEPOSITS (HOLOCENE):', ageText: null, description: '', swatch: null },
      { column: 0, code: 'Qa', name: 'Alluvium', ageText: 'Holocene', description: 'Gravel, sand, and silt in stream valleys and alluvial fans.', swatch: { x0: 700, y0: 60, x1: 740, y1: 78, color: [250, 240, 100] } },
      { column: 0, code: 'IPm', name: 'MAROON FORMATION', ageText: 'PENNSYLVANIAN AND PERMIAN', description: 'Red beds.', swatch: { x0: 700, y0: 90, x1: 740, y1: 108, color: [120, 160, 240] } },
      { column: 0, code: 'Qa', name: 'Alluvium again', ageText: null, description: '', swatch: { x0: 700, y0: 120, x1: 740, y1: 138, color: [1, 2, 3] } },
      { column: 1, code: null, name: 'CURTIS FORMATION', ageText: null, description: 'No swatch, so not a map unit.', swatch: null },
    ],
    labels: [
      { final: 'Qa', source: 'ocr', bbox: { x0: 100, y0: 100, x1: 120, y1: 110 } },
      { final: 'IPm', source: 'ai', aiConfidence: 'medium', bbox: { x0: 200, y0: 200, x1: 230, y1: 210 } },
      { final: 'IPm', source: 'ocr+legend', corrected: 'Pm', bbox: { x0: 900, y0: 600, x1: 920, y1: 610 } }, // outside the map frame
      { final: null, bbox: { x0: 1, y0: 1, x1: 2, y1: 2 } }, // unresolved
      { final: 'Zzz', source: 'ai', bbox: { x0: 1, y0: 1, x1: 2, y1: 2 } }, // not in the legend
    ],
  };
  const { result, internals } = scanResultFromResolved(resolved);

  it('builds legend entries from swatch entries, tidying SHOUTING names and skipping duplicates', () => {
    expect(result.legend.map((e) => e.code)).toEqual(['Qa', 'IPm']);
    const ipm = result.legend[1];
    expect(ipm).toMatchObject({ name: 'Maroon Formation', ageText: 'Pennsylvanian and Permian', key: 'IPm' });
    expect(ipm.age?.period).toBe('Pennsylvanian'); // the barred P prefix still gives an age
    expect(result.legend[0].group.name).toBe('Unconsolidated Deposits (Holocene)');
    expect(result.legend[0].swatch.paint).toEqual({ kind: 'rgb', color: '#faf064' });
  });

  it('puts the legend paragraph where the app shows "full description", without a page number', () => {
    expect(result.legend[0].report).toMatchObject({ text: expect.stringContaining('Gravel, sand'), page: null, matchedBy: 'legend' });
    expect(result.legend[1].report).toBeNull(); // too short to be worth a button
  });

  it('keeps only labels whose code is in the legend, split by the map frame', () => {
    expect(result.labels.map((l) => l.code)).toEqual(['Qa', 'IPm']);
    expect(result.plateLabels).toHaveLength(1);
    expect(result.plateLabels[0]).toMatchObject({ code: 'IPm', other: true, id: 'p0' });
    expect(result.legend.map((e) => e.labelCount)).toEqual([1, 2]);
    expect(result.labels[1].read).toEqual({ by: 'ai', confidence: 'medium', ocrText: null });
  });

  it('looks like any other result to the viewer, with no color analysis', () => {
    expect(result.mapRegion).toEqual({ bbox: resolved.map, method: 'scan' });
    expect(result.color.primary).toBeNull();
    expect(result.warnings[0].code).toBe('scanned');
    expect(internals).toEqual({ color: null });
  });
});
