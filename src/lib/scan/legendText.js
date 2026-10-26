// Turn OCR'd legend lines + detected swatches into legend entries.
//
// Layout of a printed legend (see scanned USGS maps): a column of swatches on
// the left; to the right, one paragraph per unit. The first line of a unit
// starts at the text edge; continuation lines are indented. A paragraph with no
// swatch beside it (a unit that only exists as a combination) still starts at
// the text edge, so "a new first line" ends the previous entry whether or not
// a swatch sits next to it.

import { dehyphenateJoin, fixKnownTerms, parseEntryText } from '../legend/legend.js';

/**
 * @param lines    [{text, x0, y0, x1, y1, confidence}] in page points
 * @param swatches [{x0, y0, x1, y1}] in page points, one column
 * @returns [{code: null, swatch|null, name, ageText, description, lines, confidence, ...}]
 */
export function buildLegendEntries(lines, swatches, { maxBlockLines = 14 } = {}) {
  if (!lines.length) return [];
  const ordered = [...lines].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  // First lines sit at the left edge; the many continuation lines are indented,
  // so the edge is a low percentile of x, not the most common x.
  const xs = ordered.map((l) => l.x0).sort((a, b) => a - b);
  const leftEdge = xs[Math.floor(xs.length * 0.1)];
  const lineH = ordered.map((l) => l.y1 - l.y0).sort((a, b) => a - b)[Math.floor(ordered.length / 2)] || 10;

  // Each swatch belongs to the line whose centre is nearest its own centre (the
  // line above can overlap a tall swatch's top edge; that one is the previous
  // entry's last line, not this entry's first).
  const startOf = new Map(); // line -> swatch
  for (const s of [...swatches].sort((p, q) => p.y0 - q.y0)) {
    const mid = (s.y0 + s.y1) / 2;
    let best = null;
    for (const l of ordered) {
      if (startOf.has(l) || l.x0 < s.x1 - 2) continue;
      const d = Math.abs((l.y0 + l.y1) / 2 - mid);
      if (d <= 0.8 * (s.y1 - s.y0) && (!best || d < best.d)) best = { l, d };
    }
    if (best) startOf.set(best.l, s);
  }

  // Words seen whole anywhere in the legend, so "quart-|zite" can be told from "north-|facing".
  const corpus = new Set();
  for (const l of lines) {
    for (const w of l.text.toLowerCase().replace(/[a-z]+-\s*$/, '').match(/[a-z]+/g) || []) corpus.add(w);
  }

  const entries = [];
  let cur = null;
  for (const line of ordered) {
    // A line beside an unused swatch starts an entry, wherever it is indented;
    // so does a line at the text edge (a unit with no swatch of its own).
    const s = startOf.get(line);
    const startsHere = Boolean(s) || Math.abs(line.x0 - leftEdge) <= 0.95 * lineH;
    const gap = cur ? line.y0 - cur.lines.at(-1).y1 : 0;
    const bigGap = cur && gap > 3.2 * lineH;
    if (startsHere || !cur || bigGap) {
      if (cur) entries.push(cur);
      if (s) s.used = true;
      cur = { swatch: s ? { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, color: s.color } : null, lines: [line] };
    } else if (cur.lines.length < maxBlockLines) {
      cur.lines.push(line);
    }
  }
  if (cur) entries.push(cur);

  return entries.map((e) => {
    const text = fixKnownTerms(dehyphenateJoin(e.lines.map((l) => l.text), corpus, { aggressive: true }));
    const parsed = parseEntryText(text);
    return {
      code: null,
      swatch: e.swatch,
      name: parsed.name,
      ageText: parsed.ageText,
      description: parsed.description,
      y0: e.lines[0].y0,
      y1: e.lines.at(-1).y1,
      confidence: Math.round(e.lines.reduce((a, l) => a + (l.confidence ?? 0), 0) / e.lines.length),
    };
  });
}

