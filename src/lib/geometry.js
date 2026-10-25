// Small 2D geometry helpers shared by the parsing pipeline.
// Coordinates everywhere in src/lib are "page units": PDF points at scale 1,
// origin at the top-left of the visible page, y pointing DOWN (same as the
// pdf.js viewport at scale 1, and the same as screen/canvas pixels at scale 1).

/** Multiply two 2D affine matrices [a, b, c, d, e, f] (m1 applied after m2). */
export function multiply(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function applyMatrix(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Bounding box {x0, y0, x1, y1} of a list of [x, y] points. */
export function bboxOfPoints(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

export function unionBbox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

export const bboxWidth = (b) => b.x1 - b.x0;
export const bboxHeight = (b) => b.y1 - b.y0;
export const bboxArea = (b) => Math.max(0, bboxWidth(b)) * Math.max(0, bboxHeight(b));
export const bboxCenter = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];

export function bboxContainsPoint(b, x, y, pad = 0) {
  return x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad;
}

export function expandBbox(b, pad) {
  return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
}

/**
 * Point-in-path test for a path made of one or more closed rings.
 * fillRule: 'nonzero' (PDF default for the f and B operators) or 'evenodd'
 * (the starred f-star and B-star operators).
 */
export function pathContainsPoint(rings, x, y, fillRule = 'nonzero') {
  let winding = 0;
  let crossings = 0;
  for (const ring of rings) {
    const n = ring.length;
    if (n < 3) continue;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y)) {
        const xCross = xj + ((y - yj) * (xi - xj)) / (yi - yj);
        if (x < xCross) {
          crossings++;
          winding += yi > yj ? 1 : -1;
        }
      }
    }
  }
  return fillRule === 'evenodd' ? crossings % 2 === 1 : winding !== 0;
}

/** Absolute area of a set of rings (shoelace; holes are not subtracted). */
export function ringsArea(rings) {
  let total = 0;
  for (const ring of rings) {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    }
    total += Math.abs(a / 2);
  }
  return total;
}
