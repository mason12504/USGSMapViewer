// Color evidence for a scanned map: which legend unit does the paper around a
// point look like? Used two ways, with the same code:
//
//   checkLabel      a label's neighbourhood: is the unit printed in the label
//                   present around it? (verifies a read; flags, never rewrites)
//   identifyByColor click anywhere: which unit(s) does the color there match?
//
// A label sits on one formation but its leader line may point at a small block of
// another, so a label is judged by the colors found in a DISC around it, not only
// the pixels right beside the letters. The disc's radius is a multiple of the
// legend swatch's long side, so it scales with each map. Tune it here:

/** Radius of the neighbourhood, as a multiple of the legend swatch's long side. */
export const NEIGHBOURHOOD_FACTOR = 1.5;

/**
 * A patch of a unit's color must cover at least this many square points to count as a block of that unit.
 * Small on purpose: a leader line often points at a tiny block, which a "percent of the disc" rule would miss.
 * Raise it to demand bigger blocks (fewer chance matches from speckle and halftone).
 */
export const MIN_BLOCK_PT2 = 6;

/** A unit's block this close (pt) to the label's text counts as "right at the text". */
export const TOUCH_PT = 3;

/** The strip around the text that says what the label sits ON (pt outside its box). */
export const RING_PT = { inner: 1.5, outer: 7 };

/** A color group "dominates the text" if it holds at least this share of the classified pixels in that strip. */
export const MIN_DOMINANT_SHARE = 0.4;

/**
 * The read unit's color touching the text is not enough when a twin's color outweighs it: if its share of the strip
 * beside the text is at most this fraction of the dominant twin's share, the label is a conflict anyway (a thin
 * sliver of the read unit's color at the edge of a big field of the twin's).
 */
export const OUTWEIGHED_RATIO = 0.5;

/** Fewest classified pixels (on the sampling grid) in the strip before we trust a dominant color. */
export const MIN_RING_CELLS = 12;

/**
 * Two codes this close (glyph-aware edit distance, see vocab.js) are "twins": the kind of pair a reader mixes up
 * (MDr / MCr). A color block of a twin's unit under the text, with the read unit's color only nearby, is a CONFLICT
 * (probably misread); the same situation with an unrelated code is a leader line to a block elsewhere.
 */
export const TWIN_DISTANCE = 1;

/**
 * Units whose swatches are within this palette distance cannot be told apart by color (a unit and its
 * sub-units are often printed in the same ink). They form one COLOR GROUP: a block of the group's color
 * counts for every unit in it, and the check reports the whole group.
 */
export const SAME_COLOR_DELTA_E = 3;

/** A pixel belongs to a unit if it is within this CIELAB distance of one of that unit's swatch colors. */
export const CLASSIFY_TOLERANCE = 12;

/**
 * How much a lightness difference counts next to a hue difference (1 = plain CIELAB delta-E). Scanned
 * maps print polygons over a shaded topographic base and under contour lines, so the same unit is often
 * darker or lighter than its flat legend swatch while keeping its hue.
 */
export const LIGHTNESS_WEIGHT = 0.35;

/** Pixels darker than this L* are ink or linework, not paper color. */
export const INK_LIGHTNESS = 38;

const PATCH_PT = 3; // click identification samples a disc of this radius

import { paletteDistance, rgbToLab } from '../color/colorMath.js';
import { swatchPalette } from '../color/rasterMatch.js';
import { summarize } from '../color/vectorMatch.js';
import { deltaE } from '../color/colorMath.js';
import { paperColor } from './raster.js';
import { codeDistance } from './vocab.js';

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Neighbourhood radius in page points: factor x the typical swatch's long side. */
export function neighbourhoodRadiusPt(legend, factor = NEIGHBOURHOOD_FACTOR) {
  const sizes = legend.filter((e) => e.swatch).map((e) => Math.max(e.swatch.bbox.x1 - e.swatch.bbox.x0, e.swatch.bbox.y1 - e.swatch.bbox.y0));
  return sizes.length ? factor * median(sizes) : 0;
}

/** Palette (dominant colors) of every legend swatch, read from the page's own pixels. */
export function buildUnitPalettes(sampler, legend, opts = {}) {
  return legend
    .filter((e) => e.swatch)
    .map((e) => ({ key: e.key, palette: swatchPalette(sampler, e, opts) }))
    .filter((u) => u.palette.length);
}

/**
 * RGB -> unit index (or -1 for ink/unmatched). Memoised on 5 bits per channel, so
 * classifying tens of thousands of pixels per label stays cheap.
 */
export function makeClassifier(unitPalettes, { tolerance = CLASSIFY_TOLERANCE, inkL = INK_LIGHTNESS, lightnessWeight = LIGHTNESS_WEIGHT, paper = null, paperDeltaE = 7, sameColor = SAME_COLOR_DELTA_E } = {}) {
  const paperLab = paper ? rgbToLab(paper) : null;
  // Color groups: units whose swatches look the same (union-find over pairwise palette distance).
  const parent = unitPalettes.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < unitPalettes.length; i++) {
    for (let j = i + 1; j < unitPalettes.length; j++) {
      if (sameColor > 0 && paletteDistance(unitPalettes[i].palette, unitPalettes[j].palette) <= sameColor) parent[find(j)] = find(i);
    }
  }
  const groupOfUnit = unitPalettes.map((_, i) => find(i));
  const groupIds = [...new Set(groupOfUnit)];
  const groups = groupIds.map((g) => unitPalettes.filter((_, i) => groupOfUnit[i] === g).map((u) => u.key));
  const groupIndex = new Map();
  groups.forEach((keys, gi) => keys.forEach((k) => groupIndex.set(k, gi)));
  const colors = [];
  unitPalettes.forEach((u, i) => u.palette.forEach((c) => colors.push({ idx: groupIds.indexOf(groupOfUnit[i]), lab: c.lab })));
  const cache = new Int16Array(32768).fill(-2); // -2 = not computed yet
  const classify = (r, g, b) => {
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let v = cache[k];
    if (v !== -2) return v;
    const lab = rgbToLab([(r & 0xf8) | 4, (g & 0xf8) | 4, (b & 0xf8) | 4]);
    v = -1;
    // Ink and bare paper (margins, the white of the sheet) are not any unit's color.
    if (lab[0] >= inkL && !(paperLab && deltaE(lab, paperLab) < paperDeltaE)) {
      let best = tolerance;
      for (const c of colors) {
        const dl = (lab[0] - c.lab[0]) * lightnessWeight;
        const d = Math.sqrt(dl * dl + (lab[1] - c.lab[1]) ** 2 + (lab[2] - c.lab[2]) ** 2);
        if (d < best) { best = d; v = c.idx; }
      }
    }
    cache[k] = v;
    return v;
  };
  classify.groups = groups; // [[unit keys]] per class index
  classify.groupIndex = groupIndex; // unit key -> class index
  return classify;
}

/** Walk the pixels of a disc, calling visit(classIndex, distanceFromCenterPt, x, y). */
function scanDisc(sampler, classify, cx, cy, radiusPt, visit, stride = 2) {
  let box = { x0: cx - radiusPt, y0: cy - radiusPt, x1: cx + radiusPt, y1: cy + radiusPt };
  // Samplers hand back pixels from the (clipped) box's own corner, so clip it first and map from there.
  const r = sampler.region;
  if (r) box = { x0: Math.max(box.x0, r.x0), y0: Math.max(box.y0, r.y0), x1: Math.min(box.x1, r.x1), y1: Math.min(box.y1, r.y1) };
  if (box.x1 <= box.x0 || box.y1 <= box.y0) return;
  const px = sampler.getPixels(box);
  const s = sampler.scale;
  for (let y = 0; y < px.height; y += stride) {
    for (let x = 0; x < px.width; x += stride) {
      const gx = box.x0 + x / s;
      const gy = box.y0 + y / s;
      if (Math.hypot(gx - cx, gy - cy) > radiusPt) continue;
      const i = (y * px.width + x) * 4;
      if (px.data[i + 3] < 128) continue;
      visit(classify(px.data[i], px.data[i + 1], px.data[i + 2]), Math.hypot(gx - cx, gy - cy), gx, gy);
    }
  }
}

/**
 * Page paper color: the most common near-white color over a grid of small patches across the sheet (or over
 * `boxes`). Bare paper must not count as a pale unit. Near-white only (low chroma), so a large pale
 * formation is not mistaken for paper, and an aged, yellowed corner does not set the tone for the margins.
 * @returns [r, g, b], or null if nothing near-white is found
 */
export function estimatePaper(sampler, boxes = null, { maxChroma = 28, grid = [24, 18], patchPt = 6 } = {}) {
  const r = sampler.region || { x0: 0, y0: 0, x1: 400, y1: 300 };
  let patches = boxes ? (Array.isArray(boxes) ? boxes : [boxes]) : [];
  if (!patches.length) {
    for (let j = 0; j < grid[1]; j++) {
      for (let i = 0; i < grid[0]; i++) {
        const x = r.x0 + ((i + 0.5) / grid[0]) * (r.x1 - r.x0), y = r.y0 + ((j + 0.5) / grid[1]) * (r.y1 - r.y0);
        patches.push({ x0: x - patchPt / 2, y0: y - patchPt / 2, x1: x + patchPt / 2, y1: y + patchPt / 2 });
      }
    }
  }
  const px = patches.map((box) => sampler.getPixels(box)).filter((p) => p.width && p.height);
  const total = px.reduce((sum, p) => sum + p.width * p.height, 0);
  if (!total) return null;
  const data = new Uint8ClampedArray(total * 4);
  let o = 0;
  for (const p of px) { data.set(p.data, o); o += p.data.length; }
  return paperColor({ data, width: total, height: 1 }, { maxChroma, orNull: true });
}

/**
 * Color evidence for one label: what is under the text, and where is the color of the unit it names?
 *
 * Classifies a disc of `radiusPt` around the label into color groups, finds connected blocks of at least
 * `minBlockPt2`, and measures (1) how far the nearest block of each group is from the text, and (2) which group
 * dominates the strip right beside the text. Verdict, first match wins:
 *   conflict   a TWIN code's color (MDr / MCr) dominates the text and the read unit's color does not touch it,
 *              or only as a sliver (a fraction `outweighed` of the twin's share): probably misread (`suggest`)
 *   confirmed  the read unit's color has a block touching the text
 *   leader     the read unit's color has a block elsewhere in the disc and nothing twin-like explains the text
 *              (code over one formation, leader line to a small block of its own unit)
 *   doubtful   no block of the read unit's color anywhere near
 *
 * @returns {method, verdict, agrees, directAgrees, supports, via, suggest, atText, nearestPt, distance, predicted, top3, nearbyUnits}
 *   agrees   confirmed or leader   suggest   unit keys of the twin whose color is under the text (conflict only)
 *   atText   the color groups beside the text, biggest first: [{key, keys, share}]
 *   predicted  the unit key(s) of the group dominating the text, else of the nearest block
 *   top3     the three color groups with the nearest blocks [{key, keys, distancePt}]
 *   nearbyUnits  how many color groups have a block in the disc (the larger, the less any one match tells)
 */
export function checkLabel(sampler, classify, label, { radiusPt, minBlockPt2 = MIN_BLOCK_PT2, touchPt = TOUCH_PT, stride = 2, ring = RING_PT, minDominant = MIN_DOMINANT_SHARE, twinDistance = TWIN_DISTANCE, outweighed = OUTWEIGHED_RATIO } = {}) {
  const groups = classify.groups;
  const target = classify.groupIndex.get(label.key) ?? -1;
  const b = label.bbox;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  let box = { x0: cx - radiusPt, y0: cy - radiusPt, x1: cx + radiusPt, y1: cy + radiusPt };
  const r = sampler.region;
  if (r) box = { x0: Math.max(box.x0, r.x0), y0: Math.max(box.y0, r.y0), x1: Math.min(box.x1, r.x1), y1: Math.min(box.y1, r.y1) };
  const none = { method: 'raster', verdict: 'doubtful', predicted: [], agrees: false, directAgrees: false, supports: false, via: null, suggest: [], atText: [], distance: null, nearestPt: null, top3: [], nearbyUnits: 0 };
  if (box.x1 <= box.x0 || box.y1 <= box.y0) return none;

  const px = sampler.getPixels(box);
  const step = stride / sampler.scale; // pt per grid cell
  const gw = Math.ceil(px.width / stride), gh = Math.ceil(px.height / stride);
  const cls = new Int16Array(gw * gh).fill(-1);
  const beside = new Array(groups.length).fill(0);
  let besideTotal = 0;
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x = box.x0 + gx * step, y = box.y0 + gy * step;
      if (Math.hypot(x - cx, y - cy) > radiusPt) continue;
      const i = (gy * stride * px.width + gx * stride) * 4;
      if (px.data[i + 3] < 128) continue;
      const c = classify(px.data[i], px.data[i + 1], px.data[i + 2]);
      cls[gy * gw + gx] = c;
      if (c < 0) continue;
      const out = Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));
      if (out >= ring.inner && out <= ring.outer) { beside[c]++; besideTotal++; }
    }
  }

  // Connected blocks (4-neighbour) of one class; keep the nearest to the text for each class.
  const minCells = Math.max(1, Math.round(minBlockPt2 / (step * step)));
  const seen = new Uint8Array(gw * gh);
  const nearest = new Array(groups.length).fill(Infinity);
  const stack = [];
  for (let s0 = 0; s0 < cls.length; s0++) {
    if (seen[s0] || cls[s0] < 0) continue;
    const c = cls[s0];
    const members = [];
    stack.push(s0);
    seen[s0] = 1;
    while (stack.length) {
      const q = stack.pop();
      members.push(q);
      const x = q % gw, y = (q / gw) | 0;
      for (const n of [x > 0 ? q - 1 : -1, x < gw - 1 ? q + 1 : -1, y > 0 ? q - gw : -1, y < gh - 1 ? q + gw : -1]) {
        if (n >= 0 && !seen[n] && cls[n] === c) { seen[n] = 1; stack.push(n); }
      }
    }
    if (members.length < minCells) continue;
    for (const q of members) {
      const gx = box.x0 + (q % gw) * step, gy = box.y0 + ((q / gw) | 0) * step;
      const d = Math.hypot(Math.max(b.x0 - gx, 0, gx - b.x1), Math.max(b.y0 - gy, 0, gy - b.y1));
      if (d < nearest[c]) nearest[c] = d;
    }
  }

  const ranked = nearest.map((d, i) => ({ keys: groups[i], distancePt: d })).filter((u) => Number.isFinite(u.distancePt)).sort((a, z) => a.distancePt - z.distancePt);
  const atText = besideTotal >= MIN_RING_CELLS
    ? beside.map((n, i) => ({ key: groups[i][0], keys: groups[i], share: n / besideTotal })).filter((g) => g.share > 0).sort((a, z) => z.share - a.share).slice(0, 3).map((g) => ({ ...g, share: +g.share.toFixed(2) }))
    : [];
  if (!ranked.length && !atText.length) return none;

  const own = target >= 0 ? nearest[target] : Infinity;
  const directAgrees = own <= touchPt;
  const supports = Number.isFinite(own);
  const dominant = atText[0] && atText[0].share >= minDominant ? atText[0] : null;
  const dominantIsOwn = dominant && groups.indexOf(dominant.keys) === target;
  const ownShare = target >= 0 && besideTotal >= MIN_RING_CELLS ? beside[target] / besideTotal : 0;
  // A twin of the read, in the color that dominates the text, while the read unit's own color is not at the text
  // (or only a sliver of it is).
  const twinsWin = dominant && !dominantIsOwn && (!directAgrees || ownShare <= outweighed * dominant.share);
  const twins = twinsWin ? dominant.keys.filter((k) => codeDistance(label.key, k) <= twinDistance) : [];
  const verdict = twins.length ? 'conflict' : directAgrees ? 'confirmed' : supports ? 'leader' : 'doubtful';
  return {
    method: 'raster',
    verdict,
    predicted: dominant ? [...dominant.keys] : ranked.length ? [...ranked[0].keys] : [],
    agrees: verdict === 'confirmed' || verdict === 'leader',
    directAgrees,
    ownShare: +ownShare.toFixed(2),
    supports,
    via: verdict === 'leader' ? 'leader' : null,
    suggest: twins,
    atText,
    distance: supports ? +own.toFixed(1) : null,
    nearestPt: supports ? +own.toFixed(1) : null,
    top3: ranked.slice(0, 3).map((u) => ({ key: u.keys[0], keys: u.keys, distancePt: +u.distancePt.toFixed(1) })),
    nearbyUnits: ranked.length,
  };
}

/** Summary for the header chip: lenient (`accuracy`) and strict (`directAccuracy`) agreement. */
export function summarizeChecks(perLabel, radiusPt) {
  const base = summarize(perLabel);
  const direct = perLabel.filter((p) => p.directAgrees).length;
  const conflicts = perLabel.filter((p) => p.verdict === 'conflict').length;
  return { ...base, directAgree: direct, directAccuracy: perLabel.length ? direct / perLabel.length : 0, conflicts, radiusPt: +radiusPt.toFixed(1) };
}

/**
 * Which unit(s) does the color at (x, y) match? A small disc is sampled so one
 * speck of ink or a halftone dot does not decide it.
 * @returns {units: [key] (units of the color group(s) holding >= 25% of the matched pixels), candidates: [{key, keys, fraction}], via: 'raster'}
 */
export function identifyByColor(sampler, classify, x, y, { patchPt = PATCH_PT } = {}) {
  const groups = classify.groups;
  const counts = new Array(groups.length).fill(0);
  let total = 0;
  scanDisc(sampler, classify, x, y, patchPt, (c) => {
    if (c < 0) return;
    counts[c]++;
    total++;
  }, 1);
  if (!total) return { units: [], candidates: [], via: 'raster', paintKey: null };
  const candidates = counts
    .map((n, i) => ({ key: groups[i][0], keys: groups[i], fraction: n / total }))
    .filter((c) => c.fraction > 0)
    .sort((a, b) => b.fraction - a.fraction)
    .slice(0, 4)
    .map((c) => ({ ...c, fraction: +c.fraction.toFixed(3) }));
  // A color group of look-alike units: all of them are named (the first is the lead).
  return { units: candidates.filter((c) => c.fraction >= 0.25).flatMap((c) => c.keys), candidates, via: 'raster', paintKey: null };
}
