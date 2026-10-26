// Which saved label reads should be asked again?
//
// A read is only as good as the vocabulary it was made with. If a legend code was missing then (a glyph code the
// vocabulary check dropped, say), Claude, asked to pick from the list, answered the nearest listed code instead:
// "MDr" for a crop that plainly reads "M€r". Once the vocabulary is complete, the answers that could have been
// substitutions are the ones that now sit one edit away from a code that was missing at the time.

import { codeDistance } from './vocab.js';
import { canonicalCode, isCanonicalCode } from './glyphs.js';

/**
 * Build the vocabulary sent with label sheets from the legend's codes, and say which were dropped.
 * Nothing may be dropped silently: a missing code is how a unit's labels end up on its neighbour.
 */
export function buildVocabulary(codes) {
  const seen = new Set();
  const dropped = [];
  for (const raw of codes) {
    if (!raw) continue;
    const c = canonicalCode(raw);
    if (isCanonicalCode(c)) seen.add(c);
    else dropped.push(raw);
  }
  return { vocabulary: [...seen], dropped };
}

/**
 * @param labels  scan labels, each with {sheet, cell}
 * @param reads   Map "sheet:cell" -> saved Claude read {text}
 * @param opts.current       the complete vocabulary now
 * @param opts.readWith      (sheet) -> vocabulary that sheet was read with, or null if unknown
 * @param opts.assumeMissing codes to treat as missing when `readWith` is unknown (legacy results)
 * @param opts.codes         extra codes whose answers are always suspect (--reread MDr)
 * @param opts.distance      how close (glyph-aware edits) an answer must be to a missing code
 * @returns [{sheet, cell, was}] cells to re-read: answers one edit from a once-missing code, plus any named code
 */
export function findSuspectCells(labels, reads, { current, readWith = () => null, assumeMissing = [], codes = [], distance = 1 } = {}) {
  const named = new Set(codes.map(canonicalCode));
  const out = [];
  for (const l of labels) {
    if (!l.sheet || !l.cell) continue;
    const read = reads.get(`${l.sheet}:${l.cell}`);
    if (!read || read.text == null) continue;
    const answer = canonicalCode(read.text);
    const then = readWith(l.sheet);
    const missing = then ? current.filter((c) => !then.includes(c)) : assumeMissing.map(canonicalCode);
    const suspicious = named.has(answer)
      || (!missing.includes(answer) && missing.some((m) => codeDistance(answer, m) <= distance))
      || !current.includes(answer); // a reading outside the vocabulary: the model may have been working around it
    if (suspicious) out.push({ sheet: l.sheet, cell: l.cell, was: read.text });
  }
  return out;
}
