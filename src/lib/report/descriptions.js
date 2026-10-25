// "Description of Map Units" from the report text that accompanies a plate.
//
// State-survey open-file reports typeset the descriptions in two columns:
//
//   46 ┌─ ALLUVIAL DEPOSITS—intro paragraph (page margin, bold caps)
//      │
//   58 │af   93 Artificial fill (latest Holocene)—Rip rap, engineered fill ...
//      │         continues on following lines, hanging nowhere, until the next
//      │         bold "Name (Age)—" heading
//
// The unit code sits in the gutter left of its heading (small type, often with
// a subscript: "Pl" + "u"). Text is read column by column, page by page, so an
// entry can run across a column or page break.
//
// Input is plain positioned text items (see pdf/textItems.js), so this module
// runs in the browser and in Node.

import { groupLines } from '../pdf/textItems.js';
import { dehyphenateJoin, fixKnownTerms, parseEntryText } from '../legend/legend.js';
import { normalizeCode } from '../units/unitCodes.js';

/** Hard cap on one unit's text (characters); real descriptions are far shorter. */
export const MAX_DESCRIPTION_CHARS = 10_000;

const DASH = /[—–]/;
const isShouting = (t) => t.length >= 8 && t === t.toUpperCase() && /[A-Z]{4,}/.test(t);
const GUTTER_CODE = /^[A-Za-z]{2,7}[0-9]?$/;

const mode = (xs) => {
  const counts = new Map();
  for (const x of xs) counts.set(Math.round(x), (counts.get(Math.round(x)) || 0) + 1);
  let best = null;
  for (const [x, n] of counts) if (!best || n > best[1]) best = [x, n];
  return best ? best[0] : null;
};

/** The bold run at the start of a line: {text, endsWithDash, restItems}. */
function boldPrefix(line) {
  let i = 0;
  while (i < line.items.length && line.items[i].bold) i++;
  const bold = line.items.slice(0, i);
  const text = groupLines(bold).map((l) => l.text).join(' ');
  return { items: bold, rest: line.items.slice(i), text };
}

function lineText(items) {
  return groupLines(items)[0]?.text || '';
}

/**
 * @param pages  [{pageNumber, width, height, items}]  items: text items with
 *               {str, x0, y0, x1, y1, baseline, fontSize, bold, angle}
 * @returns {entries: [{code, name, ageText, headingText, text, page, truncated}]}
 */
export function findReportEntries(pages, { maxChars = MAX_DESCRIPTION_CHARS } = {}) {
  const MARGIN = 45; // running heads / page numbers
  const prepared = pages.map((p) => {
    const items = p.items.filter((it) => Math.abs(it.angle) < 0.05 && it.y0 > MARGIN && it.y1 < p.height - MARGIN && it.str.trim());
    const split = p.width * 0.5; // column gutter; later pieces of a long left-column line stay left
    return { ...p, sides: [items.filter((it) => it.x0 < split), items.filter((it) => it.x0 >= split)] };
  });

  // Words that appear unhyphenated anywhere, for line-break hyphenation decisions.
  const corpus = new Set();
  for (const p of pages) for (const it of p.items) {
    // A fragment before a line-end hyphen ("pro-") is not a word of its own.
    for (const w of it.str.toLowerCase().replace(/[a-z]+-\s*$/, '').match(/[a-z]+/g) || []) corpus.add(w);
  }

  // Pass 1: where do unit headings start in each column?
  const startsBySide = [[], []];
  for (const p of prepared) {
    p.sides.forEach((items, side) => {
      for (const line of groupLines(items)) {
        const first = line.items[0];
        if (!first?.bold || isShouting(line.text)) continue;
        if (DASH.test(boldPrefix(line).text)) startsBySide[side].push(first.x0);
      }
    });
  }
  const unitX = startsBySide.map((xs) => mode(xs));
  if (unitX.every((x) => x === null)) return { entries: [] };

  // Pass 2: read each column top to bottom.
  const entries = [];
  let current = null; // entry being filled
  let pending = null; // heading lines gathered until the dash arrives
  let skipping = false; // inside a section-intro paragraph

  const finish = () => {
    if (!current) return;
    const text = fixKnownTerms(dehyphenateJoin(current.lines, corpus, { aggressive: true }));
    current.truncated = text.length > maxChars;
    current.text = current.truncated ? text.slice(0, maxChars) : text;
    delete current.lines;
    entries.push(current);
    current = null;
  };

  const startEntry = (page, headLines, afterDash, code) => {
    finish();
    const heading = fixKnownTerms(dehyphenateJoin(headLines, corpus)).replace(/\s*[—–]\s*$/, '');
    const parsed = parseEntryText(heading, heading);
    current = {
      code,
      name: parsed.name,
      ageText: parsed.ageText,
      headingText: heading,
      page,
      lines: afterDash ? [afterDash] : [],
    };
    skipping = false;
  };

  for (const p of prepared) {
    p.sides.forEach((rawItems, side) => {
      const ux = unitX[side];
      if (ux === null) return;
      // Gutter codes: small non-bold runs to the left of the unit text column.
      // A code can be several runs ("Yw" + subscript "p", "T" + "RPl"), so read
      // the gutter line by line and glue each line's runs together.
      const inGutter = (it) => !it.bold && it.x1 < ux - 8 && it.fontSize < 9.8;
      const gutterItems = rawItems.filter(inGutter);
      const gutter = groupLines(gutterItems, { tolerance: 0.8 })
        .map((l) => ({ str: l.text.replace(/\s+/g, ''), x0: l.x0, x1: l.x1, y0: Math.min(...l.items.map((i) => i.y0)) }))
        .filter((g) => GUTTER_CODE.test(g.str) || /^[A-Z]{1,2}[A-Za-z]{2,5}$/.test(g.str));
      const used = new Set();
      const consumedRaw = new Set(gutterItems);
      const textItems = rawItems.filter((it) => !consumedRaw.has(it));

      const codeFor = (line) => {
        let best = null;
        for (const g of gutter) {
          if (used.has(g)) continue;
          const dy = g.y0 - line.y0;
          if (dy < -4 || dy > 16 || g.x0 < line.x0 - 65 || g.x1 > line.x0 - 8) continue;
          if (!best || Math.abs(dy - 7) < Math.abs(best.dy - 7)) best = { g, dy };
        }
        if (!best) return null;
        used.add(best.g);
        return best.g.str.trim();
      };

      for (const line of groupLines(textItems)) {
        const first = line.items[0];
        const margin = line.x0 < ux - 20;

        if (margin) {
          // Page-margin text: category headings ("ALLUVIAL DEPOSITS—") and their
          // intro paragraphs. They end the current unit and belong to none.
          finish();
          pending = null;
          skipping = true;
          continue;
        }
        if (line.x0 < ux - 6) continue; // stray

        if (first.bold && isShouting(line.text)) {
          // A new section heading ("STRUCTURAL GEOLOGY") ends the last unit.
          finish();
          pending = null;
          skipping = true;
          continue;
        }

        if (first.bold && !isShouting(line.text)) {
          const bp = boldPrefix(line);
          const hasDash = DASH.test(bp.text);
          if (pending && !hasDash && first.bold) {
            pending.lines.push(bp.text);
            if (pending.lines.length > 4) { current?.lines.push(...pending.lines); pending = null; }
            continue;
          }
          if (pending && hasDash) {
            const full = [...pending.lines, bp.text];
            const after = lineText(line.items.slice(bp.items.length));
            const tail = bp.text.split(DASH)[1]?.trim();
            startEntry(p.pageNumber, full.map((t) => t.split(DASH)[0] + (DASH.test(t) ? '—' : '')), [tail, after].filter(Boolean).join(' '), pending.code);
            pending = null;
            continue;
          }
          if (hasDash) {
            const before = bp.text.split(DASH)[0].trim();
            const tail = bp.text.slice(bp.text.search(DASH) + 1).trim();
            const after = lineText(line.items.slice(bp.items.length));
            startEntry(p.pageNumber, [before + '—'], [tail, after].filter(Boolean).join(' '), codeFor(line));
            continue;
          }
          // Bold start without a dash yet: maybe a heading that wraps.
          pending = { lines: [bp.text], code: codeFor(line) };
          continue;
        }

        if (pending) {
          // Not a heading after all: its text belongs to whatever came before.
          if (current) current.lines.push(...pending.lines);
          pending = null;
        }
        if (skipping || !current) continue;
        current.lines.push(line.text);
      }
    });
  }
  finish();
  return { entries };
}

// ── Matching report entries to the plate legend ──────────────────────────

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9?]+/g, ' ').trim();
const nameKey = (name, age) => `${norm(name)}|${norm(age)}`;

/**
 * Attach the report's full text to plate legend entries. Match by code first
 * (plates and reports share the unit codes), then by name + age, then by name
 * alone when that is unambiguous. Returns {legend, unmatchedReport}.
 */
export function matchReportToLegend(legend, reportEntries) {
  const byCode = new Map();
  const byNameAge = new Map();
  const byName = new Map();
  const push = (m, k, e) => m.set(k, [...(m.get(k) || []), e]);
  for (const e of reportEntries) {
    if (e.code) push(byCode, normalizeCode(e.code), e);
    push(byNameAge, nameKey(e.name, e.ageText), e);
    push(byName, norm(e.name), e);
  }
  const unique = (xs) => (xs && xs.length === 1 ? xs[0] : null);
  const used = new Set();

  const out = legend.map((entry) => {
    let hit = unique(byCode.get(entry.key));
    let matchedBy = hit ? 'code' : null;
    if (hit && norm(hit.name) !== norm(entry.name) && !sharesWords(hit.name, entry.name)) {
      // Same code but unrelated names: only trust it if the ages agree too.
      if (norm(hit.ageText) !== norm(entry.ageText)) { hit = null; matchedBy = null; }
    }
    if (!hit) {
      hit = unique(byNameAge.get(nameKey(entry.name, entry.ageText)));
      if (hit) matchedBy = 'name+age';
    }
    if (!hit) {
      hit = unique(byName.get(norm(entry.name)));
      if (hit) matchedBy = 'name';
    }
    if (!hit || used.has(hit)) return { ...entry, report: null };
    used.add(hit);
    return {
      ...entry,
      report: { text: hit.text, page: hit.page, matchedBy, truncated: Boolean(hit.truncated), heading: hit.headingText },
    };
  });
  return { legend: out, unmatchedReport: reportEntries.filter((e) => !used.has(e)) };
}

function sharesWords(a, b) {
  const wa = new Set(norm(a).split(' ').filter((w) => w.length > 3));
  return norm(b).split(' ').some((w) => wa.has(w));
}
