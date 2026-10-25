// Geologic map unit codes ("Qal", "Kda", "Xqm", "TKda", "Qt1"...).
//
// Convention (USGS / state surveys): one or two leading capitals encode the
// geologic age, followed by lowercase letters for the formation/lithology,
// and sometimes a trailing digit for numbered sub-units (often drawn as a
// subscript: Qt₁, Qt₂). Some maps flatten the second capital ("Tkda" for
// "TKda"), so we accept either.

/** Leading age symbols -> human-readable period. Two-letter keys win over one. */
export const AGE_PREFIXES = {
  TK: 'Tertiary–Cretaceous',
  Tk: 'Tertiary–Cretaceous',
  QT: 'Quaternary–Tertiary',
  Qt: null, // never treat "Qt" as a two-letter prefix: it's Quaternary + "t" (terrace)
  TR: 'Triassic',
  Tr: null,
  PP: 'Pennsylvanian–Permian',
  IP: 'Pennsylvanian',
  Q: 'Quaternary',
  T: 'Tertiary',
  N: 'Neogene',
  K: 'Cretaceous',
  J: 'Jurassic',
  P: 'Permian',
  M: 'Mississippian',
  D: 'Devonian',
  S: 'Silurian',
  O: 'Ordovician',
  C: 'Cambrian',
  Z: 'Neoproterozoic',
  Y: 'Mesoproterozoic',
  X: 'Paleoproterozoic',
  W: 'Archean',
  A: 'Archean',
};

// 1 capital + 1-5 lowercase, or 2 capitals + 1-4 lowercase, optional digit.
const CODE_SHAPE = /^[A-Z](?:[a-z]{1,5}|[A-Z][a-z]{1,4})[0-9]?$/;

/**
 * True if a string has the *shape* of a unit code. Shape alone is weak
 * evidence ("Creek" and "Unit" pass too) — callers combine it with position
 * (inside a legend swatch, inside the map frame) before trusting it.
 */
export function isUnitCodeShape(str) {
  if (!str || str.length < 2 || str.length > 7) return false;
  if (!CODE_SHAPE.test(str)) return false;
  // Must contain at least one lowercase letter after the age prefix ("QT" alone is not a unit).
  if (!/[a-z]/.test(str.slice(1))) return false;
  // Uppercase letters only allowed in the first two positions.
  if (/[A-Z]/.test(str.slice(2))) return false;
  return ageForCode(str) !== null;
}

/** Look up the age period encoded by a code's leading capital(s). */
export function ageForCode(code) {
  if (!code) return null;
  const two = code.slice(0, 2);
  if (two in AGE_PREFIXES && AGE_PREFIXES[two]) {
    return { prefix: two.toUpperCase(), period: AGE_PREFIXES[two] };
  }
  const one = code[0];
  if (AGE_PREFIXES[one]) return { prefix: one, period: AGE_PREFIXES[one] };
  return null;
}

/** Canonical form used as a lookup key: "Tkda" and "TKda" compare equal. */
export function normalizeCode(code) {
  if (!code) return code;
  const two = code.slice(0, 2);
  if (/^[A-Z][a-z]$/.test(two) && AGE_PREFIXES[two.toUpperCase()] && AGE_PREFIXES[two]) {
    return two.toUpperCase() + code.slice(2);
  }
  return code;
}

/**
 * Merge subscript digits into the preceding code: "Qt" + small "1" -> "Qt1".
 * Items must have {str, x0, x1, y0, y1, fontSize}. Returns a NEW array where
 * merged items carry `parts` (the original items) and an updated bbox.
 */
export function mergeSubscripts(items) {
  const digitIdx = [];
  items.forEach((it, i) => {
    if (/^[0-9]$/.test(it.str.trim())) digitIdx.push(i);
  });

  const consumed = new Set(); // digit indices merged into a code
  const mergedAt = new Map(); // code index -> digit index

  items.forEach((it, i) => {
    const s = it.str.trim();
    if (!/^[A-Z][A-Za-z]?[a-z]{0,5}$/.test(s)) return;
    const h = it.y1 - it.y0;
    const di = digitIdx.find((j) => {
      if (consumed.has(j)) return false;
      const d = items[j];
      const gap = d.x0 - it.x1;
      const smaller = d.fontSize <= it.fontSize * 0.95;
      const dCenterY = (d.y0 + d.y1) / 2;
      // Subscript sits just right of the code, vertically in its lower part.
      return gap > -0.6 * h && gap < 0.5 * h && smaller &&
        dCenterY > it.y0 + 0.3 * h && dCenterY < it.y1 + 0.5 * h;
    });
    if (di !== undefined) {
      consumed.add(di);
      mergedAt.set(i, di);
    }
  });

  const out = [];
  items.forEach((it, i) => {
    if (consumed.has(i)) return;
    const di = mergedAt.get(i);
    if (di === undefined) {
      out.push(it);
      return;
    }
    const d = items[di];
    out.push({
      ...it,
      str: it.str.trim() + d.str.trim(),
      x1: Math.max(it.x1, d.x1),
      y1: Math.max(it.y1, d.y1),
      parts: [it, d],
    });
  });
  return out;
}
