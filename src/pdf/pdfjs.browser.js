// pdf.js configured for the browser. Assets come from this app's own server
// (see vite.config.js), never a CDN.

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const { OPS } = pdfjs;

export async function openPdf(data) {
  const base = new URL('pdfjs/', window.location.origin + import.meta.env.BASE_URL).href;
  return pdfjs.getDocument({
    data,
    isEvalSupported: false, // never run JavaScript embedded in a PDF
    enableXfa: false,
    fontExtraProperties: true, // real font names -> bold detection for legend parsing
    wasmUrl: base + 'wasm/',
    standardFontDataUrl: base + 'standard_fonts/',
    cMapUrl: base + 'cmaps/',
    cMapPacked: true,
  }).promise;
}

/**
 * Render a region of a page (bbox in page units) into a new canvas at `scale`.
 */
export async function renderRegion(page, bbox, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((bbox.x1 - bbox.x0) * scale));
  canvas.height = Math.max(1, Math.ceil((bbox.y1 - bbox.y0) * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport: page.getViewport({ scale }),
    transform: [1, 0, 0, 1, -bbox.x0 * scale, -bbox.y0 * scale],
  }).promise;
  return canvas;
}

/** Crop part of an already-rendered region canvas into a data URL. */
export function cropToDataUrl(canvas, region, scale, bbox) {
  const sx = (bbox.x0 - region.x0) * scale;
  const sy = (bbox.y0 - region.y0) * scale;
  const w = Math.max(1, Math.round((bbox.x1 - bbox.x0) * scale));
  const h = Math.max(1, Math.round((bbox.y1 - bbox.y0) * scale));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(canvas, sx, sy, w, h, 0, 0, w, h);
  return out.toDataURL('image/png');
}
