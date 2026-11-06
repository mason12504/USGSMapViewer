import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mergePamphletAndPlate } from '../../server/mergePdf.js';

async function pdfWithPages(sizes) {
  const doc = await PDFDocument.create();
  for (const [w, h] of sizes) doc.addPage([w, h]);
  return doc.save();
}

describe('mergePamphletAndPlate', () => {
  it('puts the pamphlet pages first and the plate last, keeping every page size', async () => {
    const pamphlet = await pdfWithPages([[612, 792], [612, 792], [612, 792]]);
    const plate = await pdfWithPages([[2592, 3024]]);
    const merged = await mergePamphletAndPlate(pamphlet, plate);
    expect(merged.pamphletPages).toBe(3);
    expect(merged.platePages).toBe(1);
    const doc = await PDFDocument.load(merged.bytes);
    expect(doc.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([[612, 792], [612, 792], [612, 792], [2592, 3024]]);
  });

  it('refuses something that is not a PDF', async () => {
    const plate = await pdfWithPages([[100, 100]]);
    await expect(mergePamphletAndPlate(new TextEncoder().encode('nope'), plate)).rejects.toThrow();
  });
});
