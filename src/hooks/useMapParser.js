// Orchestrates parsing in the browser: PDF -> pipeline -> rendered map image
// -> legend swatch previews. Heavy objects (pdf page, fill index) stay in a
// ref; React state only holds what the UI renders.

import { useCallback, useRef, useState } from 'react';
import { openPdf, OPS, renderRegion, cropToDataUrl, makeCanvasSampler } from '../pdf/pdfjs.browser.js';
import { parseDocument } from '../lib/document.js';
import { identifyAt } from '../lib/color/index.js';
import { scanResultFromResolved } from '../lib/scan/toResult.js';
import { applyScanColor } from '../lib/scan/applyColor.js';
import { getScanResults, sha256Hex } from '../api.js';

// The whole plate is rendered, not just the map frame, so the long side gets
// more pixels (~31 MP for a 36x42 in sheet) to keep zoomed-in labels legible.
const MAX_MAP_PIXELS_SIDE = 6000;
const MAX_LEGEND_PIXELS = 12_000_000;

export function useMapParser() {
  const [state, setState] = useState({ status: 'idle' });
  const internals = useRef(null);

  const load = useCallback(async (file) => {
    setState({ status: 'working', stage: 'Opening PDF', fileName: file.name });
    const progress = (stage) => setState((s) => ({ ...s, stage }));
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      // Hash BEFORE opening: pdf.js takes ownership of (detaches) the buffer it is given.
      const fileHash = await sha256Hex(data);
      const doc = await openPdf(data);

      // A single map or a whole publication: the plate is found automatically
      // and the report text (if any) is attached to its legend.
      let parsed = await parseDocument(doc, { OPS, onProgress: progress });
      const page = parsed.page;
      if (parsed.result.warnings.some((w) => w.code === 'no-text-layer')) {
        // A scan has no text layer to read. Its results are made ahead of time, off the
        // browser (npm run scan, then scan:ai) and looked up by the file's hash. Nothing
        // here ever starts a paid API call.
        progress('Looking up saved scan results');
        const saved = await getScanResults(fileHash);
        if (!saved) {
          const base = file.name.replace(/\.pdf$/i, '');
          throw new Error(
            `"${file.name}" is a scanned map (no text layer) and has no saved scan results yet. ` +
            `Prepare it first: npm run scan -- <path to ${file.name}>, then npm run scan:ai -- ${base} --run, then open it again.`,
          );
        }
        parsed = scanResultFromResolved(saved);
      }
      const { result } = parsed;
      internals.current = { page, color: parsed.internals.color };

      progress('Rendering map');
      // Never crop: the view is the whole page, and the map frame is just a
      // region inside it (result.mapRegion) the UI can zoom to.
      const region = { x0: 0, y0: 0, x1: result.page.width, y1: result.page.height };
      const w = region.x1 - region.x0, h = region.y1 - region.y0;
      const scale = Math.min(2.5, MAX_MAP_PIXELS_SIDE / Math.max(w, h));
      const mapCanvas = await renderRegion(page, region, scale);
      const mapUrl = await canvasToObjectUrl(mapCanvas);

      setState({
        status: 'ready',
        fileName: file.name,
        result,
        map: { url: mapUrl, region, scale, width: mapCanvas.width, height: mapCanvas.height },
        swatches: {},
      });

      // Background: crisp legend swatch previews (one render, many crops).
      const withSwatch = result.legend.filter((e) => e.swatch);
      if (withSwatch.length) {
        const box = withSwatch.reduce((b, e) => ({
          x0: Math.min(b.x0, e.swatch.bbox.x0), y0: Math.min(b.y0, e.swatch.bbox.y0),
          x1: Math.max(b.x1, e.swatch.bbox.x1), y1: Math.max(b.y1, e.swatch.bbox.y1),
        }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
        const area = (box.x1 - box.x0) * (box.y1 - box.y0);
        const lscale = Math.min(5, Math.sqrt(MAX_LEGEND_PIXELS / area));
        const legendCanvas = await renderRegion(page, box, lscale);
        internals.current.legendCanvas = { canvas: legendCanvas, region: box, scale: lscale };
        const swatches = {};
        for (const e of withSwatch) swatches[e.key] = cropToDataUrl(legendCanvas, box, lscale, e.swatch.bbox);
        setState((s) => (s.status === 'ready' && s.result === result ? { ...s, swatches } : s));
      }

      // Scans have no vector shapes, so color evidence comes from the pixels: each swatch's colors against the
      // map around every label (and for click identification). Runs in the background in small chunks.
      if (result.source === 'scan') {
        const preloaded = makeCanvasSampler(mapCanvas, region, scale, { preload: true });
        const forClicks = makeCanvasSampler(mapCanvas, region, scale); // reads one small patch per click
        try {
          const colored = await applyScanColor(result, preloaded, { identifySampler: forClicks });
          if (internals.current) internals.current.scanIdentify = colored.identify;
          setState((s) => (s.status === 'ready' && s.result === result ? { ...s, result: colored.result } : s));
        } finally {
          preloaded.release(); // the ~100 MB copy is only needed for the checks
        }
      }
    } catch (err) {
      console.error(err);
      setState({ status: 'error', error: err.message || String(err), fileName: file.name });
    }
  }, []);

  /** Experimental: which unit is at page point (x, y)? Exact paint for vector maps; swatch colors for scans. */
  const identify = useCallback((x, y) => internals.current?.scanIdentify?.(x, y) ?? identifyAt(internals.current?.color, x, y), []);

  /** Render the legend text area for the AI comparison. */
  const legendImage = useCallback(async () => {
    const it = internals.current;
    if (!it || state.status !== 'ready') return null;
    const entries = state.result.legend;
    const boxes = entries.flatMap((e) => [e.swatch?.bbox, e.textBbox].filter(Boolean));
    if (!boxes.length) return null;
    const box = {
      x0: Math.min(...boxes.map((b) => b.x0)) - 4, y0: Math.min(...boxes.map((b) => b.y0)) - 4,
      x1: Math.max(...boxes.map((b) => b.x1)) + 4, y1: Math.max(...boxes.map((b) => b.y1)) + 4,
    };
    return renderRegion(it.page, box, 1.5);
  }, [state]);

  const reset = useCallback(() => {
    if (state.map?.url) URL.revokeObjectURL(state.map.url);
    internals.current = null;
    setState({ status: 'idle' });
  }, [state]);

  return { state, load, identify, legendImage, reset };
}

function canvasToObjectUrl(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('Could not encode map image'))), 'image/jpeg', 0.92);
  });
}
