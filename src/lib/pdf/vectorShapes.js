// Walk a pdf.js operator list and collect every FILLED vector path, plus
// the placement of raster images.
//
// Why: on modern (vector) geologic maps, every unit polygon is a filled path
// whose fill is a solid color or a tiling pattern (color + dots/stripes).
// The legend swatch for a unit is filled with the *same* paint. So "which
// legend unit is this polygon?" can be answered exactly by comparing paints,
// no pixel sampling needed. See src/lib/color/ for how this is used.
//
// pdf.js internals relied on (pinned pdfjs-dist version, see package.json):
//   constructPath args = [paintOp, [Float32Array pathData], minMax]
//   pathData codes: 0 moveTo(x,y) 1 lineTo(x,y) 2 curveTo(x1,y1,x2,y2,x,y)
//                   3 quadraticCurveTo(x1,y1,x,y) 4 closePath
//   setFillRGBColor args = ['#rrggbb']
//   setFillColorN args   = ['TilingPattern', ?, tileIR{fnArray,argsArray}, matrix, bbox, ...]
// If a pdf.js upgrade changes these, tests/fixtures/pikeview.test.js fails loudly.

import { applyMatrix, bboxOfPoints, multiply } from '../geometry.js';

const CURVE_STEPS = 6;

export function extractVectorShapes(opList, OPS, viewportTransform) {
  const FILL_OPS = new Map([
    [OPS.fill, 'nonzero'],
    [OPS.eoFill, 'evenodd'],
    [OPS.fillStroke, 'nonzero'],
    [OPS.eoFillStroke, 'evenodd'],
    [OPS.closeFillStroke, 'nonzero'],
    [OPS.closeEOFillStroke, 'evenodd'],
  ]);

  const fills = [];
  const strokes = []; // short open polylines only (candidate label leader lines)
  const images = [];
  const patternKeys = new Map(); // tileIR object -> key (cache)
  const patterns = new Map(); // key -> {key, colors}

  let ctm = viewportTransform.slice();
  let paint = { kind: 'rgb', color: '#000000' };
  const stack = [];

  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    switch (fn) {
      case OPS.save:
        stack.push({ ctm, paint });
        break;
      case OPS.restore: {
        const s = stack.pop();
        if (s) ({ ctm, paint } = s);
        break;
      }
      case OPS.transform:
        ctm = multiply(ctm, args);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push({ ctm, paint });
        if (args && args[0]) ctm = multiply(ctm, args[0]);
        break;
      case OPS.paintFormXObjectEnd: {
        const s = stack.pop();
        if (s) ({ ctm, paint } = s);
        break;
      }
      case OPS.setFillRGBColor:
        paint = { kind: 'rgb', color: normalizeHex(args[0]) };
        break;
      case OPS.setFillColorN:
      case OPS.setFillColor:
        paint = paintFromColorN(args, patternKeys, patterns) || paint;
        break;
      case OPS.paintImageXObject:
      case OPS.paintImageMaskXObject:
      case OPS.paintInlineImageXObject: {
        const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => applyMatrix(ctm, x, y));
        images.push({
          bbox: bboxOfPoints(corners),
          kind: fn === OPS.paintImageMaskXObject ? 'mask' : 'image',
          color: fn === OPS.paintImageMaskXObject && paint.kind === 'rgb' ? paint.color : null,
          order: i,
        });
        break;
      }
      case OPS.constructPath: {
        const [paintOp, pathParts] = args;
        const fillRule = FILL_OPS.get(paintOp);
        if (!fillRule) {
          if (paintOp === OPS.stroke) {
            const line = shortPolyline(pathParts, ctm);
            if (line) strokes.push({ order: i, points: line, bbox: bboxOfPoints(line) });
          }
          break;
        }
        const rings = pathToRings(pathParts, ctm);
        if (!rings.length) break;
        const bbox = bboxOfPoints(rings.flat());
        fills.push({ id: fills.length, order: i, rings, bbox, fillRule, paint });
        break;
      }
      default:
        break;
    }
  }
  return { fills, strokes, images, patterns: [...patterns.values()] };
}

const MAX_LEADER_LENGTH = 150; // page units

/** A single open subpath of straight segments, shorter than MAX_LEADER_LENGTH. */
function shortPolyline(pathParts, ctm) {
  if (!pathParts || pathParts.length !== 1) return null;
  const data = pathParts[0];
  if (!data || data[0] !== 0) return null;
  const pts = [];
  for (let k = 0; k < data.length; ) {
    const code = data[k++];
    if (code === 0 || code === 1) {
      if (code === 0 && pts.length) return null; // more than one subpath
      pts.push(applyMatrix(ctm, data[k], data[k + 1]));
      k += 2;
    } else if (code === 2) {
      pts.push(applyMatrix(ctm, data[k + 4], data[k + 5])); // keep curve endpoints only
      k += 6;
    } else if (code === 3) {
      pts.push(applyMatrix(ctm, data[k + 2], data[k + 3]));
      k += 4;
    } else {
      return null; // closePath: not a leader
    }
    if (pts.length > 12) return null;
  }
  if (pts.length < 2) return null;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len > 2 && len <= MAX_LEADER_LENGTH ? pts : null;
}

function normalizeHex(c) {
  if (typeof c === 'string') return c.toLowerCase();
  if (Array.isArray(c) || ArrayBuffer.isView(c)) {
    return '#' + [...c].slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  }
  return '#000000';
}

function paintFromColorN(args, cache, patterns) {
  if (!args || args[0] !== 'TilingPattern') {
    // Shading patterns / other color spaces: pdf.js usually converts plain
    // colors to setFillRGBColor already, so treat anything else as opaque.
    if (args && args[0] === 'Shading') return { kind: 'shading', key: 'shading' };
    return null;
  }
  const tile = args[2];
  if (!tile || !tile.fnArray) return null;
  let key = cache.get(tile);
  if (!key) {
    // Key by tile CONTENT, not by the pattern's matrix: the legend swatch and
    // the map polygons usually use different pattern objects/offsets that
    // draw identical tiles.
    key = 'pat:' + hashString(stableTileString(tile));
    cache.set(tile, key);
    if (!patterns.has(key)) patterns.set(key, { key, colors: tileColors(tile) });
  }
  const info = patterns.get(key);
  return { kind: 'pattern', key, colors: info.colors };
}

function stableTileString(tile) {
  // Round floats so tiny numeric noise between copies does not change the key.
  return JSON.stringify([tile.fnArray, tile.argsArray], (k, v) => {
    if (typeof v === 'number') return Math.round(v * 100) / 100;
    if (ArrayBuffer.isView(v)) return Array.from(v, (n) => Math.round(n * 100) / 100);
    return v;
  });
}

/** Colors used inside a pattern tile, in paint order: [{color, role}]. */
function tileColors(tile) {
  const colors = [];
  for (let i = 0; i < tile.fnArray.length; i++) {
    const a = tile.argsArray[i];
    if (a && typeof a[0] === 'string' && a[0].startsWith('#')) {
      colors.push(a[0].toLowerCase());
    }
  }
  return [...new Set(colors)];
}

function hashString(s) {
  // FNV-1a 32-bit, hex. Plenty for distinguishing ~100 patterns per map.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function pathToRings(pathParts, ctm) {
  const rings = [];
  for (const data of pathParts || []) {
    if (!data) continue;
    let ring = [];
    let cx = 0, cy = 0;
    let startX = 0, startY = 0;
    const push = (x, y) => ring.push(applyMatrix(ctm, x, y));
    for (let k = 0; k < data.length; ) {
      const code = data[k++];
      if (code === 0) {
        if (ring.length > 2) rings.push(ring);
        ring = [];
        cx = startX = data[k++];
        cy = startY = data[k++];
        push(cx, cy);
      } else if (code === 1) {
        cx = data[k++];
        cy = data[k++];
        push(cx, cy);
      } else if (code === 2) {
        const [x1, y1, x2, y2, x, y] = [data[k], data[k + 1], data[k + 2], data[k + 3], data[k + 4], data[k + 5]];
        k += 6;
        for (let s = 1; s <= CURVE_STEPS; s++) {
          const t = s / CURVE_STEPS, u = 1 - t;
          push(
            u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
            u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
          );
        }
        cx = x;
        cy = y;
      } else if (code === 3) {
        const [x1, y1, x, y] = [data[k], data[k + 1], data[k + 2], data[k + 3]];
        k += 4;
        for (let s = 1; s <= CURVE_STEPS; s++) {
          const t = s / CURVE_STEPS, u = 1 - t;
          push(u * u * cx + 2 * u * t * x1 + t * t * x, u * u * cy + 2 * u * t * y1 + t * t * y);
        }
        cx = x;
        cy = y;
      } else if (code === 4) {
        cx = startX;
        cy = startY;
      } else {
        // Unknown code: bail out of this subpath rather than misread coordinates.
        break;
      }
    }
    if (ring.length > 2) rings.push(ring);
  }
  return rings;
}
