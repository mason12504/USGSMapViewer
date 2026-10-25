// Find "Description of Map Units" legend entries from text + vector shapes.
//
// A legend entry on a USGS/state-survey map looks like:
//
//   ┌─────┐
//   │ Qsw │  Sheetwash deposits (Holocene and late Pleistocene)—Silty sand,
//   └─────┘      clayey silt, and clay deposited in valleys of ...
//
//   swatch       bold name (age)—  description in roman type, hanging indent
//
// Strategy (no AI, no OCR — needs a PDF with a real text layer):
//   1. Unit-code-shaped words sitting inside small RECTANGULAR filled shapes
//      are swatch labels (legend + correlation chart).
//   2. A swatch label is a legend ENTRY if bold text starts just to its right.
//   3. The entry's text block runs down its column until the next entry,
//      a heading, or a big vertical gap.

import { bboxArea, bboxCenter, bboxContainsPoint, ringsArea } from '../geometry.js';
import { groupLines } from '../pdf/textItems.js';
import { ageForCode, isUnitCodeShape, normalizeCode } from '../units/unitCodes.js';
import { paintKey } from '../color/paint.js';

// Legend text lines stop at a horizontal gap wider than this many font sizes:
// beyond it is a different column (map symbols, correlation chart).
const LINE_MAX_GAP = 4;

const SWATCH_LIMITS = { minW: 10, maxW: 150, minH: 6, maxH: 80, minRectangularity: 0.85 };

/** Rectangular, swatch-sized filled shapes. */
export function findSwatchShapes(fills, limits = SWATCH_LIMITS) {
  return fills.filter((f) => {
    const w = f.bbox.x1 - f.bbox.x0;
    const h = f.bbox.y1 - f.bbox.y0;
    if (w < limits.minW || w > limits.maxW || h < limits.minH || h > limits.maxH) return false;
    if (f.rings.length !== 1) return false;
    const rect = ringsArea(f.rings) / Math.max(1e-6, bboxArea(f.bbox));
    return rect >= limits.minRectangularity;
  });
}

/**
 * A code printed INSIDE a legend swatch. Normal unit codes, plus short
 * all-lowercase ones ("af" artificial fill, "mw" mine waste): those are only
 * trustworthy because of where they sit, so they're not accepted elsewhere.
 */
export const isSwatchCode = (str) =>
  isUnitCodeShape(str) || /^[a-z]{2,3}$/.test(str) || /^[A-Z]{2,3}[a-z]{1,4}[0-9]?$/.test(str);

/**
 * Codes like "TRPl" are sometimes typeset as two text runs ("T" + "RPl").
 * Inside one swatch, join a short all-caps run with the run touching its right.
 */
function mergeSwatchParts(items, swatches) {
  const consumed = new Set();
  const merged = [];
  for (const s of swatches) {
    const inside = items
      .filter((it) => !it.bold && Math.abs(it.angle) <= 0.05 && bboxContainsPoint(s.bbox, ...bboxCenter(it)))
      .sort((a, b) => a.x0 - b.x0);
    if (inside.length !== 2) continue;
    const [a, b] = inside;
    if (!/^[A-Z]{1,2}$/.test(a.str) || Math.abs(a.baseline - b.baseline) > 0.5 * a.fontSize) continue;
    if (b.x0 - a.x1 > 0.6 * a.fontSize || !isSwatchCode(a.str + b.str)) continue;
    consumed.add(a);
    consumed.add(b);
    merged.push({
      ...a, str: a.str + b.str, x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), parts: [a, b],
    });
  }
  return [...items.filter((it) => !consumed.has(it)), ...merged];
}

/** Pair code-shaped words with the swatch rectangle they sit in. */
export function findSwatchLabels(rawItems, swatches) {
  const out = [];
  for (const it of mergeSwatchParts(rawItems, swatches)) {
    if (Math.abs(it.angle) > 0.05) continue;
    if (!isSwatchCode(it.str)) continue;
    const base = it.parts ? it.parts[0] : it; // center of the code, not the subscript
    const [cx, cy] = bboxCenter(base);
    let best = null;
    for (const s of swatches) {
      if (!bboxContainsPoint(s.bbox, cx, cy)) continue;
      // Code must be small relative to the swatch (it's a label inside it).
      if (it.x1 - it.x0 > (s.bbox.x1 - s.bbox.x0) * 1.05) continue;
      if (!best || bboxArea(s.bbox) < bboxArea(best.bbox) ||
          (bboxArea(s.bbox) === bboxArea(best.bbox) && s.order > best.order)) {
        best = s;
      }
    }
    if (best) out.push({ item: it, swatch: best });
  }
  return out;
}

/**
 * Swatches drawn as outlines on white paper (dikes, veins, contact-metamorphic
 * units) have no filled rectangle to find. If a code sits in the same swatch
 * column as filled swatches (x-aligned with at least three of them), treat the
 * code's cell as a swatch with no paint. The bold-text-to-the-right test in
 * findLegendEntries then decides whether it is really an entry.
 */
export function findTextOnlySwatchLabels(items, swatches, found) {
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const cols = [];
  for (const sl of found) {
    const b = sl.swatch.bbox;
    const col = cols.find((k) => Math.abs(k.x0 - b.x0) < 3);
    if (col) col.boxes.push(b);
    else cols.push({ x0: b.x0, boxes: [b] });
  }
  const out = [];
  const taken = new Set(found.map((f) => f.item));
  for (const col of cols.filter((k) => k.boxes.length >= 3)) {
    const w = median(col.boxes.map((b) => b.x1 - b.x0));
    const h = median(col.boxes.map((b) => b.y1 - b.y0));
    const yMin = Math.min(...col.boxes.map((b) => b.y0)) - 4 * h;
    const yMax = Math.max(...col.boxes.map((b) => b.y1)) + 4 * h;
    for (const it of items) {
      if (taken.has(it) || it.bold || Math.abs(it.angle) > 0.05) continue;
      if (!isSwatchCode(it.str)) continue;
      const [cx, cy] = bboxCenter(it);
      if (cx < col.x0 || cx > col.x0 + w || cy < yMin || cy > yMax) continue;
      if (swatches.some((s) => bboxContainsPoint(s.bbox, cx, cy))) continue;
      taken.add(it);
      const bbox = { x0: col.x0, x1: col.x0 + w, y0: cy - h / 2, y1: cy + h / 2 };
      out.push({ item: it, swatch: { bbox, paint: null, order: -1, textOnly: true } });
    }
  }
  return out;
}

const isHeading = (text) =>
  text.length >= 8 && text === text.toUpperCase() && /[A-Z]{4,}/.test(text);

/**
 * Join wrapped lines into one paragraph.
 * A line-end "-" is ambiguous: "matrix-|supported" is a real hyphen, "mas-|sive"
 * is hyphenation. If `corpus` (a Set of lowercase words seen anywhere in the
 * document) contains the joined word ("massive"), we treat the hyphen as
 * hyphenation and drop it; otherwise we keep it.
 */
export function dehyphenateJoin(lines, corpus = null, { aggressive = false } = {}) {
  let out = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!out) {
      out = line;
      continue;
    }
    if (/[A-Za-z]--$/.test(out)) {
      // Illustrator soft-hyphen artifact: "hill--" + "slopes" -> "hillslopes"
      out = out.slice(0, -2) + line;
    } else if (/[A-Za-z]-$/.test(out)) {
      const head = out.match(/([A-Za-z]+)-$/)[1];
      const tail = line.match(/^[A-Za-z]+/)?.[0] || '';
      const joined = (head + tail).toLowerCase();
      // aggressive: long prose where most words occur only once, so "pro-|duces" is
      // hyphenation whenever the left fragment is not a word of its own.
      const hyphenation = corpus && tail && (corpus.has(joined) || (aggressive && !corpus.has(head.toLowerCase())));
      out = hyphenation ? out.slice(0, -1) + line : out + line;
    } else {
      out += ' ' + line;
    }
  }
  if (corpus) {
    // Mid-line leftovers of old hyphenation ("silt-stone", "Thick-ness"): join
    // when the document also spells the word without the hyphen.
    out = out.replace(/\b([A-Za-z]+)-([a-z]+)\b/g, (m, a, b) => (corpus.has((a + b).toLowerCase()) ? a + b : m));
  }
  return out
    .replace(/\s+/g, ' ')
    .replace(/([a-z])--([a-z])/g, '$1$2') // mid-line soft-hyphen artifacts
    .replace(/,(?=[A-Za-z])/g, ', ') // "supported,gravelly" (missing space in source)
    .trim();
}

// Geologic time terms. Illustrator-made PDFs sometimes contain invisible
// discretionary hyphens inside words ("Cre-ta-ceous"); for these well-known
// words we can safely remove them.
const GEO_TERMS = new Map(
  [
    'Quaternary', 'Holocene', 'Pleistocene', 'Tertiary', 'Neogene', 'Paleogene', 'Pliocene',
    'Miocene', 'Oligocene', 'Eocene', 'Paleocene', 'Cretaceous', 'Jurassic', 'Triassic',
    'Permian', 'Pennsylvanian', 'Mississippian', 'Devonian', 'Silurian', 'Ordovician',
    'Cambrian', 'Proterozoic', 'Mesoproterozoic', 'Paleoproterozoic', 'Neoproterozoic',
    'Archean', 'Precambrian', 'Paleozoic', 'Mesozoic', 'Cenozoic',
  ].map((t) => [t.toLowerCase(), t]),
);

export function fixKnownTerms(text) {
  return text.replace(/\b[A-Za-z]+(?:-[A-Za-z]+)+\b/g, (tok) => {
    const joined = tok.replace(/-/g, '');
    const hit = GEO_TERMS.get(joined.toLowerCase());
    if (!hit) return tok;
    return joined[0] === joined[0].toUpperCase() ? hit : hit.toLowerCase();
  });
}

/**
 * Split "Sheetwash deposits (Holocene and late Pleistocene)—Silty sand..." into
 * {name, ageText, description}. `header` is the bold run if known.
 */
export function parseEntryText(fullText, header = '') {
  const text = fullText.trim();
  let head = header.trim();
  let rest = '';
  const dash = /\s*[—–]\s*|\s+-{1,2}\s+/;

  if (head && text.startsWith(head)) {
    rest = text.slice(head.length);
  } else {
    const m = text.match(dash);
    if (m && m.index < 200) {
      head = text.slice(0, m.index);
      rest = text.slice(m.index);
    } else {
      head = text;
      rest = '';
    }
  }
  head = head.replace(/\s*[—–-]+\s*$/, '').trim();
  rest = rest.replace(/^\s*[—–-]+\s*/, '').trim();

  // "(?)" is a doubt marker inside an age, not a nested parenthesis.
  const masked = head.replace(/\(\?\)/g, '[?]');
  const unmask = (t) => t.replace(/\[\?\]/g, '(?)');
  let name = head;
  let ageText = null;
  const ageMatch = masked.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (ageMatch) {
    name = unmask(ageMatch[1]).trim();
    ageText = unmask(ageMatch[2]).trim();
  } else {
    // "X Member (Mississippian) and Y Formation (Devonian), undifferentiated":
    // keep the whole name, collect the ages.
    const ages = [...masked.matchAll(/\(([^()]*)\)/g)].map((m) => unmask(m[1]).trim());
    if (ages.length > 1) ageText = ages.join(' and ');
  }
  name = name.replace(/[\s,;]+$/, '');
  return { name, ageText, description: rest };
}

/**
 * Main entry point.
 * @param items  text items (subscripts already merged, words split)
 * @param fills  from extractVectorShapes
 * @returns {entries, swatchLabels}
 */
export function findLegendEntries(items, fills) {
  const swatches = findSwatchShapes(fills);
  const swatchLabels = findSwatchLabels(items, swatches);
  const textOnly = findTextOnlySwatchLabels(items, swatches, swatchLabels);
  swatchLabels.push(...textOnly);
  const allSwatches = [...swatches, ...textOnly.map((t) => t.swatch)];
  // A merged code ("T"+"RPl") must also take its original runs out of the free text.
  const labelItems = new Set(swatchLabels.flatMap((s) => [s.item, ...(s.item.parts || [])]));
  const freeItems = items.filter((it) => !labelItems.has(it) && Math.abs(it.angle) < 0.05);
  // Every whole word in the document, for hyphenation decisions.
  const corpus = new Set();
  for (const it of items) for (const w of it.str.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g) || []) {
    if (!w.includes('-')) corpus.add(w);
  }

  // Step 2: entries = swatch labels with bold text right next to them.
  const candidates = [];
  for (const sl of swatchLabels) {
    const s = sl.swatch.bbox;
    const sw = s.x1 - s.x0;
    const sh = s.y1 - s.y0;
    // Name text starts close to the swatch. (Correlation-chart boxes have age
    // labels further away; keeping this tight stops those posing as entries.)
    const right = freeItems
      .filter((it) =>
        it.x0 >= s.x1 - 1 && it.x0 <= s.x1 + Math.max(1.2 * sw, 30) &&
        it.baseline >= s.y0 && it.baseline <= s.y1 + 0.6 * sh)
      .sort((a, b) => a.x0 - b.x0 || a.baseline - b.baseline);
    const first = right[0];
    if (!first || !first.bold) continue;
    candidates.push({ ...sl, nameX: first.x0, firstLineBaseline: first.baseline });
  }

  // Columns: entries whose swatches share an x position.
  const columns = [];
  for (const c of candidates.sort((a, b) => a.swatch.bbox.x0 - b.swatch.bbox.x0)) {
    const col = columns.find((k) => Math.abs(k.x - c.swatch.bbox.x0) < 15);
    if (col) col.entries.push(c);
    else columns.push({ x: c.swatch.bbox.x0, entries: [c] });
  }
  for (const col of columns) col.entries.sort((a, b) => a.swatch.bbox.y0 - b.swatch.bbox.y0);

  const entries = [];
  for (const col of columns) {
    const colEntries = [];
    col.entries.forEach((c, idx) => {
      const s = c.swatch.bbox;
      const next = col.entries[idx + 1];
      const yStop = next ? next.swatch.bbox.y0 - 1 : Infinity;
      // Right edge of this entry's text = the nearest column to the right that
      // has an entry at roughly the same height.
      const yEnd = Number.isFinite(yStop) ? yStop : s.y1 + 400;
      const nextColX = Math.min(
        ...columns
          .filter((k) => k.x > col.x + 15)
          .filter((k) => k.entries.some((e) => e.swatch.bbox.y1 >= s.y0 - 200 && e.swatch.bbox.y0 <= yEnd + 200))
          .map((k) => k.x),
        Infinity,
      );
      const colRight = Number.isFinite(nextColX) ? nextColX - 4 : Infinity;

      // Gather from the column's left edge so we can SEE lines that start left
      // of the name column (category headers like "COLLUVIAL DEPOSITS—") and
      // stop there, instead of silently clipping them into this description.
      const blockItems = freeItems.filter((it) =>
        it.x0 >= s.x0 - 3 && it.x1 <= colRight + 6 &&
        it.y0 >= s.y0 - 3 && it.baseline < yStop);
      const lines = groupLines(blockItems, { maxGap: LINE_MAX_GAP });

      const kept = [];
      let prev = null;
      for (const line of lines) {
        if (line.x0 > c.nameX + 60) continue; // stray text further right in the column
        if (line.x0 < c.nameX - 6) {
          if (kept.length) break; // a new block starts at the column edge
          continue;
        }
        if (prev) {
          const lh = Math.max(4, prev.y1 - prev.y0);
          if (line.baseline - prev.baseline > 2.2 * lh) break;
        }
        if (kept.length && isHeading(line.text)) break;
        kept.push(line);
        prev = line;
      }
      if (!kept.length) return;

      const header = boldPrefix(kept);
      const fullText = fixKnownTerms(dehyphenateJoin(kept.map((l) => l.text), corpus));
      const parsed = parseEntryText(fullText, fixKnownTerms(header));
      // Correlation-chart boxes can sit next to bold age labels ("Paleocene",
      // "TERTIARY"). A real entry has a "Name—" dash or an actual description.
      const hasDash = /[—–]/.test(fullText.slice(0, 250));
      // Some plates print only "Name (Age)" next to each swatch (the prose lives
      // in the accompanying report), so a parenthesised age in the bold header
      // is enough too.
      const strong = hasDash || parsed.description.length >= 20 || Boolean(parsed.ageText);
      const code = c.item.str.trim();
      colEntries.push({
        _meta: { nameX: c.nameX, colRight, colX: col.x, weak: !strong },
        code,
        key: normalizeCode(code),
        age: ageForCode(code),
        name: parsed.name,
        ageText: parsed.ageText,
        description: parsed.description,
        swatch: {
          bbox: { ...s },
          paint: c.swatch.paint,
          paintKey: paintKey(c.swatch.paint),
        },
        swatchTextBbox: { x0: c.item.x0, y0: c.item.y0, x1: c.item.x1, y1: c.item.y1 },
        textBbox: {
          x0: Math.min(...kept.map((l) => l.x0)),
          y0: Math.min(...kept.map((l) => l.y0)),
          x1: Math.max(...kept.map((l) => l.x1)),
          y1: Math.max(...kept.map((l) => l.y1)),
        },
        source: 'text',
      });
    });
    // Bare-name entries ("upper unit", a sub-unit with no age) are only believed
    // in a swatch column that already holds well-formed entries; a lone one is
    // more likely a correlation-chart box beside an age label.
    const strongCount = colEntries.filter((e) => !e._meta.weak).length;
    if (strongCount < 3) colEntries.splice(0, colEntries.length, ...colEntries.filter((e) => !e._meta.weak));
    assignHierarchy(colEntries, freeItems, allSwatches);
    for (const e of colEntries) {
      delete e._meta;
      entries.push(e);
    }
  }

  // De-duplicate by normalized code, keeping the richest description.
  const byKey = new Map();
  for (const e of entries) {
    const prev = byKey.get(e.key);
    if (!prev || e.description.length > prev.description.length) byKey.set(e.key, e);
  }
  return { entries: [...byKey.values()], swatchLabels, swatches: allSwatches };
}

/**
 * Give entries context:
 *  - parent: an INDENTED entry ("Upper member") belongs to the nearest
 *    top-level entry above it ("Laramie Formation").
 *  - group:  a bold paragraph WITHOUT a swatch ("Upper part of the Dawson
 *    Formation (Upper Cretaceous and Paleocene)—" or a category header like
 *    "ALLUVIAL DEPOSITS—") owns the entries below it: indented ones directly,
 *    top-level ones as a category.
 * Entries with no age of their own inherit it from parent/group.
 */
function assignHierarchy(colEntries, freeItems, swatches) {
  if (!colEntries.length) return;
  const baseX = Math.min(...colEntries.map((e) => e._meta.nameX));
  const colX = colEntries[0]._meta.colX; // left edge of the swatch column
  let context = null; // nearest top-level thing above: {type: 'entry'|'group'|'unknown', ...}
  let category = null; // group header that applies to following top-level entries

  // A line that has a swatch just to its left is an entry we didn't recognise
  // (e.g. lowercase code "af" for artificial fill), never a group header.
  const hasSwatchLeft = (line) => swatches.some((s) =>
    s.bbox.x1 <= line.x0 + 2 && s.bbox.x1 >= line.x0 - 60 &&
    s.bbox.y0 <= line.baseline && s.bbox.y1 >= line.baseline - 0.6 * (line.y1 - line.y0));

  colEntries.forEach((e, i) => {
    const indented = e._meta.nameX > baseX + 8;

    const prev = colEntries[i - 1];
    const lower = prev ? prev.textBbox.y1 : -Infinity;
    const upper = e.swatch.bbox.y0 - 1;
    const between = groupLines(freeItems.filter((it) =>
      it.x0 >= colX - 6 && it.x1 <= e._meta.colRight + 6 && it.baseline > lower && it.baseline < upper), { maxGap: LINE_MAX_GAP });

    let header = null;
    between.forEach((line, k) => {
      if (isHeading(line.text)) {
        header = null;
        category = null;
        context = null;
        return;
      }
      // "af Artificial fill—": short non-bold code then bold name = an entry
      // whose code we didn't recognise (lowercase codes, missing swatch).
      const [a, b] = line.items;
      const unrecognisedEntry = a && b && !a.bold && b.bold && a.str.length <= 5;
      if (hasSwatchLeft(line) || unrecognisedEntry) {
        header = null;
        context = { type: 'unknown' };
        return;
      }
      // Group headers start at the name column or at the column's left edge.
      const atNameCol = Math.abs(line.x0 - baseX) < 10;
      const atColEdge = Math.abs(line.x0 - colX) < 10;
      if ((atNameCol || atColEdge) && line.items[0].bold) {
        const head = fixKnownTerms(boldPrefix(between.slice(k)));
        const parsed = parseEntryText(head, head);
        header = { name: titleCaseIfShouting(parsed.name), ageText: parsed.ageText };
      }
    });

    if (header) context = { type: 'group', group: header };

    if (indented) {
      if (context?.type === 'entry') {
        const p = context.entry;
        e.parent = { code: p.code, name: p.name, ageText: p.ageText };
        if (p.group) e.group = p.group;
      } else if (context?.type === 'group') {
        e.group = context.group;
      }
    } else {
      if (header) category = header;
      if (category) e.group = category;
      context = { type: 'entry', entry: e };
    }
    if (!e.ageText) e.ageText = e.parent?.ageText || e.group?.ageText || null;
  });
}

function titleCaseIfShouting(s) {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(And|Or|Of|The)\b/g, (m) => m.toLowerCase());
}

/** Concatenate the leading bold run of the first lines (the "Name (Age)—" header). */
function boldPrefix(lines) {
  let out = '';
  for (const line of lines) {
    for (const it of line.items) {
      if (!it.bold) return dehyphenateJoin([out]);
      out += (out && !out.endsWith(' ') ? ' ' : '') + it.str;
    }
    out += ' ';
  }
  return dehyphenateJoin([out]);
}
