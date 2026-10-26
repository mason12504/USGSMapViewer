// Small raster helpers shared by the scan tools. Images are {data, width, height}
// with RGBA bytes (what canvas getImageData and pdf.js/napi-canvas give us).
// Pure JS, no browser or Node APIs.

const sq = (n) => n * n;

/** The paper colour: the most common bright colour (5 bits per channel). `maxChroma` limits it to near-white. */
export function paperColor({ data, width, height }, { maxChroma = Infinity, orNull = false } = {}) {
  const counts = new Map();
  const step = Math.max(1, Math.floor((width * height) / 400_000));
  for (let p = 0; p < width * height; p += step) {
    const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
    if ((r + g + b) / 3 < 190) continue;
    if (Math.max(r, g, b) - Math.min(r, g, b) > maxChroma) continue; // paper is near-white, not a pale unit color
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  if (orNull && !counts.size) return null; // nothing near-white at all
  let best = [245, 245, 235];
  let n = 0;
  for (const [k, c] of counts) {
    if (c > n) { n = c; best = [((k >> 10) & 31) << 3 | 4, ((k >> 5) & 31) << 3 | 4, (k & 31) << 3 | 4]; }
  }
  return best;
}

/** 1 where a pixel differs from the paper by more than `tol` (RGB distance). */
export function nonPaperMask({ data, width, height }, paper, tol = 45) {
  const mask = new Uint8Array(width * height);
  const t2 = tol * tol;
  for (let p = 0; p < width * height; p++) {
    mask[p] = sq(data[p * 4] - paper[0]) + sq(data[p * 4 + 1] - paper[1]) + sq(data[p * 4 + 2] - paper[2]) > t2 ? 1 : 0;
  }
  return mask;
}

/** 1 where the brightest channel is below `thr`: ink, not colour. */
export function darkMask({ data, width, height }, thr = 95) {
  const mask = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    mask[p] = Math.max(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]) < thr ? 1 : 0;
  }
  return mask;
}

/**
 * Connected components (8-neighbour) of a 0/1 mask.
 * Returns [{x0, y0, x1, y1, n}] with inclusive pixel bounds.
 */
export function components(mask, width, height) {
  const seen = new Uint8Array(width * height);
  const out = [];
  const stack = new Int32Array(width * height > 4_000_000 ? 4_000_000 : width * height);
  for (let s = 0; s < width * height; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0;
    stack[sp++] = s;
    seen[s] = 1;
    let x0 = width, y0 = height, x1 = 0, y1 = 0, n = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % width, y = (p / width) | 0;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            if (sp < stack.length) stack[sp++] = q;
          }
        }
      }
    }
    out.push({ x0, y0, x1, y1, n });
  }
  return out;
}

/** Mean colour of a pixel box. */
export function meanColor({ data, width }, x0, y0, x1, y1) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : [0, 0, 0];
}

export const colorDistance = (a, b) => Math.sqrt(sq(a[0] - b[0]) + sq(a[1] - b[1]) + sq(a[2] - b[2]));

/**
 * Ink: pixels clearly darker than their own neighbourhood and dark in absolute
 * terms. A fixed "darker than N" cutoff loses black type printed over orange or
 * pink (it scans as dark gray) and, set higher, merges everything on dark fills.
 * Local contrast keeps both. Brown contour lines stay above `maxAbs` and drop out.
 *
 * Neighbourhood mean = separable box blur of the brightest channel (two running
 * sums), so memory stays near 4 bytes per pixel even for a whole map.
 */
export function inkMask({ data, width, height }, { radius = 14, delta = 34, maxAbs = 150 } = {}) {
  const n = width * height;
  const v = new Uint8Array(n);
  for (let p = 0; p < n; p++) v[p] = Math.max(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);

  const horiz = new Uint8Array(n);
  const win = 2 * radius + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += v[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      horiz[row + x] = (sum / win) | 0;
      sum += v[row + Math.min(width - 1, x + radius + 1)] - v[row + Math.max(0, x - radius)];
    }
  }
  const mean = new Uint8Array(n);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += horiz[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) {
      mean[y * width + x] = (sum / win) | 0;
      sum += horiz[Math.min(height - 1, y + radius + 1) * width + x] - horiz[Math.max(0, y - radius) * width + x];
    }
  }
  const mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) mask[p] = v[p] < maxAbs && v[p] < mean[p] - delta ? 1 : 0;
  return mask;
}
