// Geometry of the numbered contact sheets (label-sheet-N.png): a grid of cells, each with a red number at its
// top-left and the crop to its right. Shared so the picture-makers and the re-read slicer agree.

export const SHEET_CELLS = { cols: 10, rows: 10, cellW: 150, cellH: 70 };

/** Pixel rectangle of cell `cell` (1-based) on a sheet. */
export function cellRect(cell, g = SHEET_CELLS) {
  const k = cell - 1;
  return { x: (k % g.cols) * g.cellW, y: Math.floor(k / g.cols) * g.cellH, w: g.cellW, h: g.cellH };
}

/** Size of a sheet holding `n` cells (rows are only as many as needed). */
export function sheetSize(n, g = SHEET_CELLS) {
  return { width: g.cols * g.cellW, height: Math.ceil(n / g.cols) * g.cellH };
}
