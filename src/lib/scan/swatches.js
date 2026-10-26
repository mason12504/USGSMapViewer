// Legend swatches on a scanned map: the small coloured rectangles in a column,
// each carrying a unit code. Vector PDFs hand us these as shapes; a scan only
// has pixels, so we look for rectangles of similar size stacked in a column.
//
// Coordinates are image pixels; callers convert with their render scale.

import { colorDistance, components, meanColor, nonPaperMask, paperColor } from './raster.js';

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * @param img    {data,width,height} RGBA
 * @param opts.pxPerPt  image pixels per PDF point (swatch size limits are in points)
 * @returns {columns: [{x0, x1, swatches: [{x0,y0,x1,y1,color}]}], paper, map: pixel box of the largest coloured shape}
 */
export function findSwatchColumns(img, { pxPerPt = 1, minInColumn = 6 } = {}) {
  const paper = paperColor(img);
  const mask = nonPaperMask(img, paper, 40);
  const comps = components(mask, img.width, img.height);
  const lim = { minW: 20 * pxPerPt, maxW: 95 * pxPerPt, minH: 9 * pxPerPt, maxH: 90 * pxPerPt };

  const cands = comps.filter((c) => {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    return w >= lim.minW && w <= lim.maxW && h >= lim.minH && h <= lim.maxH && c.n / (w * h) >= 0.7;
  });

  // Columns: candidates sharing a left edge and a width.
  const cols = [];
  for (const c of cands.sort((a, b) => a.x0 - b.x0)) {
    const col = cols.find((k) => Math.abs(k.x0 - c.x0) <= 3 * pxPerPt && Math.abs(k.w - (c.x1 - c.x0 + 1)) <= 5 * pxPerPt);
    if (col) col.items.push(c);
    else cols.push({ x0: c.x0, w: c.x1 - c.x0 + 1, items: [c] });
  }

  const columns = [];
  for (const k of cols.filter((c) => c.items.length >= minInColumn)) {
    const x0 = Math.round(median(k.items.map((c) => c.x0)));
    const x1 = Math.round(median(k.items.map((c) => c.x1)));
    const h0 = median(k.items.map((c) => c.y1 - c.y0 + 1));
    const swatches = [];
    for (const c of k.items.sort((a, b) => a.y0 - b.y0)) {
      const h = c.y1 - c.y0 + 1;
      // Touching swatches come out as one tall block: cut where the fill colour changes.
      const parts = h > 1.6 * h0 ? splitByColor(img, x0, x1, c.y0, c.y1, h0) : [[c.y0, c.y1]];
      for (const [ya, yb] of parts) {
        swatches.push({ x0, x1, y0: ya, y1: yb, color: meanColor(img, x0 + 3, ya + 2, x1 - 3, yb - 2) });
      }
    }
    columns.push({ x0, x1, swatches });
  }
  columns.sort((a, b) => b.swatches.length - a.swatches.length);
  // The map itself is the biggest coloured shape on the sheet.
  const big = comps.reduce((a, c) => (c.n > a.n ? c : a), { n: 0 });
  return { columns, paper, map: big.n ? { x0: big.x0, y0: big.y0, x1: big.x1, y1: big.y1 } : null };
}

/** Cut a tall block into swatch-height pieces where the row colour jumps. */
function splitByColor(img, x0, x1, y0, y1, h0) {
  const rows = [];
  for (let y = y0; y <= y1; y++) rows.push(meanColor(img, x0 + 2, y, x0 + 6, y)); // a strip beside the code text
  const cuts = [];
  for (let i = Math.round(h0 * 0.6); i < rows.length - Math.round(h0 * 0.6); i++) {
    if (cuts.length && i - cuts[cuts.length - 1] < h0 * 0.6) continue;
    if (colorDistance(rows[i - 1], rows[i]) > 30) cuts.push(i);
  }
  const edges = [0, ...cuts, rows.length];
  const out = [];
  for (let k = 0; k < edges.length - 1; k++) out.push([y0 + edges[k], y0 + edges[k + 1] - 1]);
  return out;
}
