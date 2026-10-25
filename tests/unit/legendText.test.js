import { describe, expect, it } from 'vitest';
import { dehyphenateJoin, fixKnownTerms, parseEntryText } from '../../src/lib/legend/legend.js';

describe('parseEntryText', () => {
  it('splits name, age and description', () => {
    const r = parseEntryText(
      'Sheetwash deposits (Holocene and late Pleistocene)—Silty sand, clayey silt, and clay',
      'Sheetwash deposits (Holocene and late Pleistocene)—',
    );
    expect(r).toEqual({
      name: 'Sheetwash deposits',
      ageText: 'Holocene and late Pleistocene',
      description: 'Silty sand, clayey silt, and clay',
    });
  });

  it('works without a known bold header', () => {
    const r = parseEntryText('Colluvium (Holocene and late Pleistocene)—Mostly matrix-supported');
    expect(r.name).toBe('Colluvium');
    expect(r.ageText).toBe('Holocene and late Pleistocene');
    expect(r.description).toBe('Mostly matrix-supported');
  });

  it('handles entries with no age in parentheses', () => {
    const r = parseEntryText('Upper member—Brownish-gray sandy shale', 'Upper member—');
    expect(r).toEqual({ name: 'Upper member', ageText: null, description: 'Brownish-gray sandy shale' });
  });
});

describe('dehyphenateJoin', () => {
  it('keeps a real hyphen that falls at a line end', () => {
    expect(dehyphenateJoin(['Mostly matrix-', 'supported sand'])).toBe('Mostly matrix-supported sand');
  });

  it('removes Illustrator double-hyphen artifacts', () => {
    expect(dehyphenateJoin(['on gentle hill--', 'slopes below'])).toBe('on gentle hillslopes below');
  });

  it('uses the document as a dictionary for ambiguous hyphens', () => {
    const corpus = new Set(['massive', 'siltstone']);
    expect(dehyphenateJoin(['or mas-', 'sive beds'], corpus)).toBe('or massive beds');
    expect(dehyphenateJoin(['gray silt-stone'], corpus)).toBe('gray siltstone');
    // "matrixsupported" never appears in the document, so the hyphen is real.
    expect(dehyphenateJoin(['Mostly matrix-', 'supported'], corpus)).toBe('Mostly matrix-supported');
    expect(dehyphenateJoin(['light-gray sand'], corpus)).toBe('light-gray sand');
  });

  it('adds the space missing after a comma', () => {
    expect(dehyphenateJoin(['supported,gravelly sand'])).toBe('supported, gravelly sand');
  });
});

describe('fixKnownTerms', () => {
  it('repairs soft-hyphenated geologic time words only', () => {
    expect(fixKnownTerms('Upper Cre-ta-ceous')).toBe('Upper Cretaceous');
    expect(fixKnownTerms('light-gray sand')).toBe('light-gray sand');
  });
});
