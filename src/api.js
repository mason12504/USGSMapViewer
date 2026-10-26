// Browser -> our API server (never directly to Anthropic; no key in the browser).

export async function getHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) return { ok: false };
    return await res.json();
  } catch {
    return { ok: false };
  }
}

/** Saved results for a scanned PDF (made by `npm run scan` + `npm run scan:ai`), or null. */
export async function getScanResults(sha256) {
  const res = await fetch(`/api/scans/${sha256}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not look up scan results (HTTP ${res.status}).`);
  return res.json();
}

/** SHA-256 of a file's bytes, hex. */
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Ask the server to read a legend image with Claude (or the mock in dev). */
export async function parseLegendWithAI({ imageBase64, mediaType = 'image/jpeg', candidateCodes = [] }) {
  const res = await fetch('/api/parse-legend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageBase64, mediaType, candidateCodes }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `API error ${res.status}`);
  return body; // {mode, model, units}
}

/** Canvas -> base64 (no data: prefix), downscaled so the long side <= maxSide. */
export function canvasToBase64(canvas, { maxSide = 2000, type = 'image/jpeg', quality = 0.9 } = {}) {
  const k = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  let src = canvas;
  if (k < 1) {
    src = document.createElement('canvas');
    src.width = Math.round(canvas.width * k);
    src.height = Math.round(canvas.height * k);
    src.getContext('2d').drawImage(canvas, 0, 0, src.width, src.height);
  }
  return src.toDataURL(type, quality).split(',')[1];
}
