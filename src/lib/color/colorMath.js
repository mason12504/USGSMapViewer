// Color math for the raster (pixel) matching strategy.

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** sRGB (0-255) -> CIE L*a*b* (D65). */
export function rgbToLab([r, g, b]) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.0;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 color difference. ~2.3 is a "just noticeable difference". */
export function deltaE(lab1, lab2) {
  return Math.hypot(lab1[0] - lab2[0], lab1[1] - lab2[1], lab1[2] - lab2[2]);
}

/**
 * Build a small weighted palette from RGBA pixels by bucketing colors
 * (5 bits per channel) and averaging each bucket.
 * @param data   Uint8ClampedArray RGBA
 * @param accept optional (r,g,b,i) => boolean pixel filter
 * @returns [{rgb, lab, weight}] sorted by weight desc, weights sum to 1
 */
export function buildPalette(data, { accept = null, maxColors = 4, minWeight = 0.04 } = {}) {
  const buckets = new Map();
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (accept && !accept(r, g, b, i)) continue;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let bk = buckets.get(key);
    if (!bk) {
      bk = { r: 0, g: 0, b: 0, n: 0 };
      buckets.set(key, bk);
    }
    bk.r += r; bk.g += g; bk.b += b; bk.n++;
    total++;
  }
  if (!total) return [];
  // Merge neighbouring buckets that are perceptually identical.
  const raw = [...buckets.values()]
    .map((bk) => ({ rgb: [bk.r / bk.n, bk.g / bk.n, bk.b / bk.n], n: bk.n }))
    .sort((a, b) => b.n - a.n);
  const merged = [];
  for (const c of raw) {
    const lab = rgbToLab(c.rgb);
    const near = merged.find((m) => deltaE(m.lab, lab) < 6);
    if (near) {
      const n = near.n + c.n;
      near.rgb = near.rgb.map((v, k) => (v * near.n + c.rgb[k] * c.n) / n);
      near.n = n;
      near.lab = rgbToLab(near.rgb);
    } else {
      merged.push({ rgb: c.rgb, n: c.n, lab });
    }
  }
  return merged
    .map((m) => ({ rgb: m.rgb.map(Math.round), lab: m.lab, weight: m.n / total }))
    .filter((m) => m.weight >= minWeight)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxColors)
    .map((m, _, arr) => {
      const sum = arr.reduce((s, x) => s + x.weight, 0);
      return { ...m, weight: m.weight / sum, hex: rgbToHex(m.rgb) };
    });
}

/**
 * Distance between two weighted palettes: weighted average of each color's
 * nearest-match deltaE, computed both ways and averaged (symmetric).
 */
export function paletteDistance(p1, p2) {
  if (!p1.length || !p2.length) return Infinity;
  const oneWay = (a, b) => a.reduce((s, c) => s + c.weight * Math.min(...b.map((d) => deltaE(c.lab, d.lab))), 0);
  return (oneWay(p1, p2) + oneWay(p2, p1)) / 2;
}

/** Palette from a list of hex colors (e.g. a vector paint), base color weighted most. */
export function paletteFromHexes(hexes, baseWeight = 0.75) {
  if (!hexes.length) return [];
  if (hexes.length === 1) {
    const rgb = hexToRgb(hexes[0]);
    return [{ rgb, lab: rgbToLab(rgb), weight: 1, hex: hexes[0] }];
  }
  const rest = (1 - baseWeight) / (hexes.length - 1);
  return hexes.map((h, i) => {
    const rgb = hexToRgb(h);
    return { rgb, lab: rgbToLab(rgb), weight: i === 0 ? baseWeight : rest, hex: h };
  });
}
