// A "paint" is how a vector shape is filled:
//   {kind: 'rgb', color: '#ffe7ce'}
//   {kind: 'pattern', key: 'pat:709bd3ff', colors: ['#ffdd67', '#fb3199']}
// paintKey() turns it into a comparable string. Two shapes with the same key
// were filled identically, which on a vector geologic map means "same unit".

export function paintKey(paint) {
  if (!paint) return 'none';
  if (paint.kind === 'rgb') return 'rgb:' + paint.color;
  if (paint.kind === 'pattern') return paint.key;
  return paint.kind || 'none';
}

/** Representative display colors for a paint: [base, ...accents]. */
export function paintColors(paint) {
  if (!paint) return [];
  if (paint.kind === 'rgb') return [paint.color];
  if (paint.kind === 'pattern') return paint.colors || [];
  return [];
}

/** Paints we never treat as a geologic unit fill (paper, label knockouts). */
export function isBackgroundPaint(paint) {
  if (!paint) return true;
  if (paint.kind === 'rgb') {
    const c = paint.color.toLowerCase();
    return c === '#ffffff' || c === '#fefefe';
  }
  return paint.kind !== 'pattern';
}

/** Short human description, e.g. "#ffdd67 with #fb3199 pattern". */
export function describePaint(paint) {
  if (!paint) return 'unknown';
  if (paint.kind === 'rgb') return `solid ${paint.color}`;
  if (paint.kind === 'pattern') {
    const [base, ...rest] = paint.colors || [];
    return rest.length ? `${base} with ${rest.join(', ')} pattern` : `pattern ${base || ''}`.trim();
  }
  return paint.kind;
}
