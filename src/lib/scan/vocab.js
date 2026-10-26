// Snap an OCR read to the map's own legend codes.
//
// Local OCR often lands one character away from the right code ("Ke" for "Kc",
// "Kid" for "Kfd") and drops the barred P of Pennsylvanian codes ("Pee" for
// "IPee", where "IP" is how the barred P is written). The legend gives the
// complete list of valid codes, so a read that is close to exactly one of them
// can be corrected; a read that is close to several is left alone.

/** Edit distance where a missing/extra leading "I" (the barred P) is nearly free. */
export function codeDistance(a, b) {
  const stripBar = (s) => (s.startsWith('IP') ? s.slice(1) : s);
  const barDiff = stripBar(a) === stripBar(b) && a !== b ? 0.3 : null;
  if (barDiff !== null) return barDiff;
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}

/**
 * The single legend code `text` is clearly closest to, or null.
 * Exact matches win. Otherwise the best must be within `maxDistance` and beat
 * the runner-up by at least `margin`, so ambiguous reads stay unresolved.
 */
export function nearestCode(text, vocabulary, { maxDistance = 1, margin = 0.5 } = {}) {
  if (!text) return null;
  if (vocabulary.includes(text)) return { code: text, distance: 0 };
  const ranked = vocabulary
    .map((code) => ({ code, distance: codeDistance(text, code) }))
    .sort((a, b) => a.distance - b.distance);
  const [best, next] = ranked;
  if (!best || best.distance > maxDistance) return null;
  if (next && next.distance - best.distance < margin) return null;
  return best;
}
