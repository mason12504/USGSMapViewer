// Special glyphs printed in geologic unit codes, and their plain-letter forms.
//
// Maps print a barred P (Pennsylvanian), a barred C (Cambrian) and a ligature R
// (Triassic) that have no keyboard form. We keep the code as printed for display
// ("M€r") and use a plain ASCII form for matching, vocabularies and map keys
// ("MCr"). The barred P is already written "IP" everywhere (see server prompts).

const ASCII = { '€': 'C', 'ℙ': 'IP', 'ℝ': 'R', 'ʀ': 'R' };

/** Plain-ASCII form of a printed code, for matching. "M€r" -> "MCr". */
export function canonicalCode(code) {
  if (!code) return code;
  return String(code).replace(/[€ℙℝʀ]/g, (g) => ASCII[g]).trim();
}

/** A code we can send to the API and compare: letters and digits only, after canonicalising. */
export const isCanonicalCode = (code) => /^[A-Za-z0-9]{1,8}$/.test(code || '');
