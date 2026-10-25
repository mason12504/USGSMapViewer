import { describe, expect, it } from 'vitest';
import { findReportEntries, matchReportToLegend } from '../../src/lib/report/descriptions.js';
import { dominantSpan } from '../../src/lib/labels/mapLabels.js';
import { classifyPages } from '../../src/lib/document.js';
import { mergeSplitCodes } from '../../src/lib/units/unitCodes.js';

// A text item as extractTextItems produces it.
const item = (str, x0, y0, { bold = false, fontSize = 10, w } = {}) => ({
  str, x0, x1: x0 + (w ?? str.length * 4.5), y0, y1: y0 + fontSize, baseline: y0 + fontSize * 0.8,
  fontSize, bold, italic: false, angle: 0,
});

// Left column text starts at x=93 with codes in the gutter at x=58.
function page(items) {
  return { pageNumber: 12, width: 612, height: 792, items };
}

describe('findReportEntries', () => {
  it('reads "Name (Age)—text" entries with gutter codes, across a column break', () => {
    const items = [
      item('HUMAN-MADE DEPOSITS', 46, 56, { bold: true, fontSize: 11 }),
      item('Artificial fill (latest Holocene)—', 93, 72, { bold: true }),
      item('Rip rap,', 245, 72),
      item('engineered fill, and refuse placed during', 93, 84),
      item('af', 58, 79, { fontSize: 9 }),
      item('Mine waste (latest Holocene)—', 93, 224, { bold: true }),
      item('Waste rock', 240, 224),
      item('excavated from mines and pits.', 93, 236),
      item('mw', 58, 231, { fontSize: 9 }),
    ];
    const { entries } = findReportEntries([page(items)]);
    expect(entries.map((e) => e.code)).toEqual(['af', 'mw']);
    expect(entries[0]).toMatchObject({ name: 'Artificial fill', ageText: 'latest Holocene', page: 12 });
    expect(entries[0].text).toBe('Rip rap, engineered fill, and refuse placed during');
    expect(entries[1].text).toBe('Waste rock excavated from mines and pits.');
  });

  it('ends the last unit at a section heading and skips its intro paragraph', () => {
    const items = [
      item('Granodiorite (Early Proterozoic)—', 93, 72, { bold: true }),
      item('Dark granodiorite.', 260, 72),
      item('STRUCTURAL GEOLOGY', 93, 100, { bold: true }),
      item('Intro paragraph that belongs to no unit.', 46, 118),
      item('Unit text again?', 93, 136),
    ];
    const { entries } = findReportEntries([page(items)]);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('Dark granodiorite.');
  });

  it('joins a heading that wraps onto a second line', () => {
    const items = [
      item('Lykins Formation (Lower Triassic? and', 93, 72, { bold: true }),
      item('Upper Permian)—', 93, 84, { bold: true }),
      item('Nonresistant red siltstone.', 200, 84),
      item('Pl', 58, 80, { fontSize: 9 }),
      item('Other (Age)—', 93, 120, { bold: true }),
      item('x y z', 170, 120),
    ];
    const { entries } = findReportEntries([page(items)]);
    expect(entries[0].name).toBe('Lykins Formation');
    expect(entries[0].ageText).toBe('Lower Triassic? and Upper Permian');
    expect(entries[0].code).toBe('Pl');
  });

  it('caps one description at the maximum length', () => {
    const lines = Array.from({ length: 40 }, (_, i) => item('word '.repeat(10).trim(), 93, 84 + i * 12));
    const items = [item('Big unit (Age)—', 93, 72, { bold: true }), ...lines];
    const { entries } = findReportEntries([page(items)], { maxChars: 100 });
    expect(entries[0].truncated).toBe(true);
    expect(entries[0].text.length).toBe(100);
  });
});

describe('matchReportToLegend', () => {
  const legend = [
    { code: 'af', key: 'af', name: 'Artificial fill', ageText: 'latest Holocene' },
    { code: 'Xyz', key: 'Xyz', name: 'Some granite', ageText: 'Early Proterozoic' },
    { code: 'Zzz', key: 'Zzz', name: 'Unmatched unit', ageText: 'Permian' },
  ];
  const reportEntries = [
    { code: 'af', name: 'Artificial fill', ageText: 'latest Holocene', text: 'A', page: 12, headingText: 'h' },
    { code: null, name: 'Some granite', ageText: 'Early Proterozoic', text: 'B', page: 13, headingText: 'h' },
    { code: 'Pl', name: 'Parent only', ageText: 'Permian', text: 'C', page: 14, headingText: 'h' },
  ];

  it('matches by code, then by name and age, and reports leftovers', () => {
    const { legend: out, unmatchedReport } = matchReportToLegend(legend, reportEntries);
    expect(out[0].report).toMatchObject({ matchedBy: 'code', page: 12, text: 'A' });
    expect(out[1].report).toMatchObject({ matchedBy: 'name+age', page: 13 });
    expect(out[2].report).toBeNull();
    expect(unmatchedReport.map((e) => e.code)).toEqual(['Pl']);
  });

  it('refuses a code match whose name and age both disagree', () => {
    const { legend: out } = matchReportToLegend(
      [{ code: 'Qa', key: 'Qa', name: 'Alluvium', ageText: 'Holocene' }],
      [{ code: 'Qa', name: 'Granite', ageText: 'Proterozoic', text: 'X', page: 1, headingText: 'h' }],
    );
    expect(out[0].report).toBeNull();
  });
});

describe('plate helpers', () => {
  it('dominantSpan ignores thin slivers separated by a gap', () => {
    const boxes = [
      { x0: 50, x1: 700, y0: 0, y1: 10 },
      { x0: 690, x1: 1334, y0: 0, y1: 10 },
      { x0: 1392, x1: 1431, y0: 0, y1: 10 }, // legend swatches beyond a 58-unit gap
    ];
    expect(dominantSpan(boxes, 'x0', 'x1')).toEqual([50, 1334]);
  });

  it('classifyPages marks sheets far larger than the report pages as plates', () => {
    const sizes = [
      ...Array.from({ length: 5 }, (_, i) => ({ pageNumber: i + 1, width: 612, height: 792 })),
      { pageNumber: 6, width: 2592, height: 3024 },
    ];
    expect(classifyPages(sizes).map((p) => p.kind)).toEqual(['text', 'text', 'text', 'text', 'text', 'plate']);
    expect(classifyPages([{ pageNumber: 1, width: 2000, height: 2000 }])[0].kind).toBe('plate');
  });

  it('mergeSplitCodes joins "T" + "RPl" only when the legend knows TRPl', () => {
    const t = { str: 'T', x0: 100, x1: 105.5, y0: 0, y1: 8, baseline: 7, fontSize: 8 };
    const r = { str: 'RPl', x0: 102, x1: 112, y0: 0, y1: 8, baseline: 7, fontSize: 8 };
    expect(mergeSplitCodes([t, r], new Set(['TRPl'])).map((i) => i.str)).toEqual(['TRPl']);
    expect(mergeSplitCodes([t, r], new Set(['Qa'])).map((i) => i.str)).toEqual(['T', 'RPl']);
  });
});
