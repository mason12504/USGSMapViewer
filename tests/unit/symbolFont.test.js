import { describe, expect, it } from 'vitest';
import { plainSymbolText } from '../../src/lib/pdf/textItems.js';

// The FGDC geologic-age font: plates carry control characters, pamphlets printable look-alikes.
describe('plainSymbolText', () => {
  it('spells out the age symbols in the geologic-age font, in plate and pamphlet encodings', () => {
    expect(plainSymbolText('P\x1ff', 'PETLOI+FGDCGeoAge')).toBe('PIPf'); // Fountain Formation
    expect(plainSymbolText('\x1ePl', 'FGDCGeoAge')).toBe('TRPl'); // Lykins
    expect(plainSymbolText('M\x1d', 'FGDCGeoAge')).toBe('MC'); // M + barred C
    expect(plainSymbolText('\x1ds', 'FGDCGeoAge')).toBe('Cs'); // Sawatch
    expect(plainSymbolText('P*f', 'ABC+FGDCGeoAge')).toBe('PIPf');
    expect(plainSymbolText('^Pl', 'FGDCGeoAge')).toBe('TRPl');
    expect(plainSymbolText('_s', 'FGDCGeoAge')).toBe('Cs');
  });

  it('leaves every other font alone, including text that has those characters', () => {
    expect(plainSymbolText('a*b_c^d', 'Univers')).toBe('a*b_c^d');
    expect(plainSymbolText('P\x1ff', 'Univers')).toBe('P\x1ff');
    expect(plainSymbolText('Qa', 'FGDCGeoAge')).toBe('Qa');
    expect(plainSymbolText('Qa', undefined)).toBe('Qa');
  });
});
