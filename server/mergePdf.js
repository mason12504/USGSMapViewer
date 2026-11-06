// Join a pamphlet (report text) and a plate (the big map sheet) into ONE PDF, the layout the app reads:
// pamphlet pages first, plate last (see src/lib/document.js).
//
// The plate is the base document and the pamphlet pages are inserted in front of it, so the huge plate's
// own content is not re-copied page by page.

import { PDFDocument } from 'pdf-lib';

/**
 * @param {Uint8Array} pamphletBytes
 * @param {Uint8Array} plateBytes
 * @returns {Promise<{bytes: Uint8Array, pamphletPages: number, platePages: number}>}
 */
export async function mergePamphletAndPlate(pamphletBytes, plateBytes) {
  const load = (bytes) => PDFDocument.load(bytes, { updateMetadata: false });
  const [pamphlet, plate] = await Promise.all([load(pamphletBytes), load(plateBytes)]);
  const pamphletPages = pamphlet.getPageCount();
  const platePages = plate.getPageCount();
  const copied = await plate.copyPages(pamphlet, pamphlet.getPageIndices());
  copied.forEach((page, i) => plate.insertPage(i, page));
  return { bytes: await plate.save(), pamphletPages, platePages };
}
