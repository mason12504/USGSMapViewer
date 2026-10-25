// Strategy 2 — APPROXIMATE matching from pixels, for scanned/raster maps
// where there are no vector fills to read.
//
// Idea: build a small color palette of the area around each map label (a
// ring around the text, so the black letters don't dominate) and compare it
// with the palette of each legend swatch. Patterns (dots, stripes) show up as
// secondary palette colors, so they contribute to the match too.
//
// `sampler` abstracts where pixels come from (browser canvas or Node canvas):
//   sampler.scale                       pixels per page unit
//   sampler.getPixels(bbox) -> {data, width, height}   bbox in page units

import { buildPalette, deltaE, hexToRgb, paletteDistance, rgbToLab } from './colorMath.js';
import { summarize } from './vectorMatch.js';

const DEFAULTS = {
  ringInner: 1.5, // page units outside the text box
  ringOuter: 7,
  darkL: 35, // pixels darker than this L* are treated as linework/text
  ignoreDeltaE: 14, // drop pixels this close to an ignore color (e.g. topo lines)
};

function makeAccept({ darkL, ignoreLabs, ignoreDeltaE }) {
  return (r, g, b) => {
    const lab = rgbToLab([r, g, b]);
    if (lab[0] < darkL) return false;
    for (const ig of ignoreLabs) if (deltaE(lab, ig) < ignoreDeltaE) return false;
    return true;
  };
}

/** Palette for a legend swatch: its interior minus the code text. */
export function swatchPalette(sampler, entry, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const s = entry.swatch.bbox;
  const inset = { x0: s.x0 + 1, y0: s.y0 + 1, x1: s.x1 - 1, y1: s.y1 - 1 };
  const px = sampler.getPixels(inset);
  const text = entry.swatchTextBbox;
  const accept = makeAccept({ ...o, ignoreLabs: (o.ignoreColors || []).map((h) => rgbToLab(hexToRgb(h))) });
  return buildPalette(px.data, {
    accept: (r, g, b, i) => {
      if (text) {
        const p = i / 4;
        const x = inset.x0 + (p % px.width) / sampler.scale;
        const y = inset.y0 + Math.floor(p / px.width) / sampler.scale;
        if (x >= text.x0 - 1 && x <= text.x1 + 1 && y >= text.y0 - 1 && y <= text.y1 + 1) return false;
      }
      return accept(r, g, b);
    },
  });
}

/** Palette of the ring around a map label. */
export function labelPalette(sampler, label, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const b = label.bbox;
  const outer = { x0: b.x0 - o.ringOuter, y0: b.y0 - o.ringOuter, x1: b.x1 + o.ringOuter, y1: b.y1 + o.ringOuter };
  const px = sampler.getPixels(outer);
  const accept = makeAccept({ ...o, ignoreLabs: (o.ignoreColors || []).map((h) => rgbToLab(hexToRgb(h))) });
  return buildPalette(px.data, {
    accept: (r, g, bl, i) => {
      const p = i / 4;
      const x = outer.x0 + (p % px.width) / sampler.scale;
      const y = outer.y0 + Math.floor(p / px.width) / sampler.scale;
      if (x >= b.x0 - o.ringInner && x <= b.x1 + o.ringInner && y >= b.y0 - o.ringInner && y <= b.y1 + o.ringInner) {
        return false;
      }
      return accept(r, g, bl);
    },
  });
}

/** Rank legend entries by palette distance to `palette`. */
export function rankUnits(palette, legendPalettes) {
  return legendPalettes
    .map(({ key, palette: lp }) => ({ key, distance: paletteDistance(palette, lp) }))
    .filter((r) => Number.isFinite(r.distance))
    .sort((a, b) => a.distance - b.distance);
}

export function matchLabelsRaster(labels, legend, sampler, opts = {}) {
  const legendPalettes = legend.map((e) => ({ key: e.key, palette: swatchPalette(sampler, e, opts) }));
  const perLabel = labels.map((lab) => {
    const pal = labelPalette(sampler, lab, opts);
    const ranked = rankUnits(pal, legendPalettes);
    const best = ranked[0];
    const predicted = best ? [best.key] : [];
    return {
      method: 'raster',
      predicted,
      agrees: predicted.includes(lab.key),
      supports: ranked.slice(0, 3).some((r) => r.key === lab.key),
      distance: best?.distance ?? null,
      top3: ranked.slice(0, 3),
      palette: pal.map((c) => ({ hex: c.hex, weight: +c.weight.toFixed(3) })),
    };
  });
  return {
    perLabel,
    summary: summarize(perLabel),
    legendPalettes: legendPalettes.map((l) => ({ key: l.key, palette: l.palette.map((c) => ({ hex: c.hex, weight: +c.weight.toFixed(3) })) })),
  };
}
