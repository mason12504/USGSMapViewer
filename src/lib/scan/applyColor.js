// Put color evidence on a scanned map's result: a check for every label, a summary for the
// header chip, and a click identifier. Pure orchestration over colorCheck.js (the sampler is
// passed in), so the browser and tests run the same code.

import {
  buildUnitPalettes, checkLabel, estimatePaper, identifyByColor, makeClassifier, neighbourhoodRadiusPt, summarizeChecks,
} from './colorCheck.js';

const nextTick = () => new Promise((resolve) => setTimeout(resolve));

/**
 * @param result   a scan result (src/lib/scan/toResult.js)
 * @param sampler  pixels of the rendered sheet ({scale, region, getPixels(bbox)}), used for the checks
 * @param opts.identifySampler  sampler kept for click identification (defaults to `sampler`)
 * @param opts.factor           neighbourhood radius factor (default NEIGHBOURHOOD_FACTOR)
 * @returns {{result, identify, radiusPt}}  `result` has `color` on every label and result.color filled in;
 *   `identify(x, y)` names the unit(s) by color at a page point. Without usable swatches the result is returned unchanged.
 */
export async function applyScanColor(result, sampler, { identifySampler = sampler, factor, yieldEvery = 30, yieldFn = nextTick } = {}) {
  const palettes = buildUnitPalettes(sampler, result.legend);
  if (!palettes.length) return { result, identify: null, radiusPt: 0 };
  const classify = makeClassifier(palettes, { paper: estimatePaper(sampler) });
  const radiusPt = neighbourhoodRadiusPt(result.legend, factor);

  const checks = new Map();
  const all = [...result.labels, ...(result.plateLabels || [])];
  for (let i = 0; i < all.length; i++) {
    checks.set(all[i], checkLabel(sampler, classify, all[i], { radiusPt }));
    if (i % yieldEvery === yieldEvery - 1) await yieldFn(); // keep the page responsive
  }
  const withColor = (l) => ({ ...l, color: checks.get(l) });
  return {
    result: {
      ...result,
      labels: result.labels.map(withColor),
      plateLabels: (result.plateLabels || []).map(withColor),
      color: { primary: 'raster', vector: null, raster: summarizeChecks([...checks.values()], radiusPt), legendPalettes: null },
    },
    identify: (x, y) => identifyByColor(identifySampler, classify, x, y),
    radiusPt,
  };
}
