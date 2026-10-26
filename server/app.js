// Express app (separate from index.js so tests can create it without listening).
//
// The browser never sees the API key: it calls /api/parse-legend on this
// server, which adds the key (live mode) or replays a saved response (mock).

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {
  buildLabelSheetPrompt, buildLegendPrompt, buildSwatchPrompt, callAnthropic,
  parseLabelReads, parseLegendResponse, parseSwatchCodes, UpstreamError,
} from './anthropic.js';
import { createCache, requestKey, sha256 } from './cache.js';
import { createUsageTracker } from './usage.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // base64 payload cap
const CODE_RE = /^[A-Z][A-Za-z]{0,6}[0-9]?$/;
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const VOCAB_RE = /^[A-Za-z0-9]{1,8}$/;
const MAX_CELLS = 150;

export function createApp(config, { fetchImpl = fetch, log = console } = {}) {
  const live = config.mode === 'live';
  // Live mode only: the cache and the daily ledger are about real spending.
  const cache = createCache(live ? config.cacheDir : null, { log });
  const usage = createUsageTracker({
    dir: live ? config.cacheDir : null,
    cap: config.maxCallsPerDay,
    enforce: live,
    priceIn: config.priceInPerMTok,
    priceOut: config.priceOutPerMTok,
    log,
  });
  const inflight = new Map(); // identical requests running right now share one paid call

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '12mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: config.mode, model: config.model, usage: live ? usage.snapshot() : null, cache: live ? cache.enabled : null });
  });

  // Results for a scanned map, found by the SHA-256 of the PDF's bytes (the browser computes it).
  // Free and read-only, so it works in mock mode too. The hash is checked against a strict
  // pattern and only compared with fields inside known resolved.json files: it never becomes a path.
  app.get('/api/scans/:sha', (req, res) => {
    const { sha } = req.params;
    if (!/^[a-f0-9]{64}$/.test(sha)) return res.status(400).json({ error: 'expected a 64-character SHA-256' });
    try {
      for (const d of fs.readdirSync(config.scansDir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const file = path.join(config.scansDir, d.name, 'resolved.json');
        if (!fs.existsSync(file)) continue;
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (data.fileSha256 === sha) return res.json(data);
      }
    } catch {
      /* no scans folder yet: same as not found */
    }
    return res.status(404).json({ error: 'No scan results for this file. Run npm run scan, then npm run scan:ai.' });
  });

  app.get('/api/usage', (_req, res) => {
    res.json({ mode: config.mode, ...usage.snapshot(), cache: { enabled: cache.enabled } });
  });

  /** Validate the image fields shared by every paid endpoint; sends the 4xx itself. */
  function checkImage(req, res) {
    const { imageBase64, mediaType = 'image/png' } = req.body || {};
    if (typeof imageBase64 !== 'string' || !imageBase64.length) {
      res.status(400).json({ error: 'imageBase64 (string) is required' });
      return null;
    }
    if (imageBase64.length > MAX_IMAGE_BYTES) {
      res.status(413).json({ error: 'image too large' });
      return null;
    }
    if (!MEDIA_TYPES.has(mediaType)) {
      res.status(400).json({ error: `mediaType must be one of ${[...MEDIA_TYPES].join(', ')}` });
      return null;
    }
    return { imageBase64, mediaType };
  }

  /**
   * The one place a paid call happens, for every endpoint: cache first (free),
   * then the daily cap, then ONE upstream call shared by identical requests in
   * flight, then the usage log. Returns {body, cached}, or sends the error and
   * returns null.
   */
  async function paidCall(res, { label, prompt, maxTokens, imageBase64, mediaType }) {
    // Everything that shapes the answer, including the exact prompt text.
    const key = requestKey({ model: config.model, mediaType, image: sha256(imageBase64), prompt: sha256(prompt), maxTokens });
    const hit = cache.get(key);
    if (hit) {
      usage.recordCacheHit();
      log.info?.(`[api] ${label} CACHE HIT (no charge) key=${key.slice(0, 10)} model=${hit.model || config.model}`);
      return { body: hit, cached: true };
    }
    if (!usage.canCall()) {
      const q = usage.snapshot();
      log.error?.(`[api] daily cap reached: ${q.calls}/${q.cap} calls today; ${label} refused`);
      res.status(429).json({
        error: `Daily API call cap reached (${q.calls}/${q.cap}). Raise MAX_CALLS_PER_DAY or try again tomorrow. Identical requests already answered are served from the cache.`,
        usage: q,
      });
      return null;
    }
    let pending = inflight.get(key);
    if (!pending) {
      const t0 = Date.now();
      pending = callAnthropic({ apiKey: config.apiKey, model: config.model, imageBase64, mediaType, prompt, maxTokens, fetchImpl })
        .then((b) => {
          const u = usage.recordCall(b.usage);
          cache.put(key, b, { model: config.model, label, mediaType, imageBytes: Math.round(imageBase64.length * 0.75) });
          const q = usage.snapshot();
          log.info?.(`[api] ${label} LIVE call model=${b.model || config.model} in=${u.inputTokens} out=${u.outputTokens} tokens ${Date.now() - t0}ms | today ${q.calls}/${q.cap} calls, ${q.cacheHits} cache hits${q.estimatedUsd != null ? `, ~$${q.estimatedUsd.toFixed(3)}` : ''}`);
          return b;
        })
        .catch((err) => {
          usage.recordError();
          throw err;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    return { body: await pending, cached: false };
  }

  const meta = (body, cached) => ({
    mode: config.mode,
    model: body.model || config.model,
    cached,
    tokens: body.usage ? { input: body.usage.input_tokens || 0, output: body.usage.output_tokens || 0 } : null,
    usage: live ? usage.snapshot() : null,
  });

  function fail(res, err, label) {
    if (err instanceof UpstreamError) {
      log.error(`[api] upstream error ${err.status}: ${err.message}`);
      return res.status(502).json({ error: `Anthropic API error (${err.status}): ${err.message}` });
    }
    log.error(`[api] ${label} failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }

  app.post('/api/parse-legend', async (req, res) => {
    const img = checkImage(req, res);
    if (!img) return undefined;
    const { candidateCodes = [] } = req.body;
    if (!Array.isArray(candidateCodes) || candidateCodes.length > 300 ||
        !candidateCodes.every((c) => typeof c === 'string' && CODE_RE.test(c))) {
      return res.status(400).json({ error: 'candidateCodes must be an array of unit codes' });
    }
    try {
      let body;
      let cached = false;
      if (config.mode === 'mock') {
        body = JSON.parse(fs.readFileSync(config.mockFile, 'utf8'));
      } else {
        const out = await paidCall(res, { label: 'parse-legend', prompt: buildLegendPrompt(candidateCodes), maxTokens: 8000, ...img });
        if (!out) return undefined;
        ({ body, cached } = out);
        if (config.recordDir && !cached) record(config.recordDir, body, log);
      }
      return res.json({ ...meta(body, cached), units: parseLegendResponse(body) });
    } catch (err) {
      return fail(res, err, 'parse-legend');
    }
  });

  // Mock mode would have to invent answers for these; refuse instead of faking.
  const needsLive = (res) => {
    res.status(409).json({ error: 'This step reads real image crops and needs live mode (a real API key). Mock mode has no saved answer for it.' });
  };

  app.post('/api/read-swatch-codes', async (req, res) => {
    const img = checkImage(req, res);
    if (!img) return undefined;
    const { items } = req.body;
    if (!Array.isArray(items) || !items.length || items.length > MAX_CELLS ||
        !items.every((i) => i && Number.isInteger(i.n) && i.n > 0 && (i.ocr == null || (typeof i.ocr === 'string' && i.ocr.length <= 12)) &&
          (i.name == null || (typeof i.name === 'string' && i.name.length <= 160)))) {
      return res.status(400).json({ error: `items must be 1-${MAX_CELLS} entries of {n, ocr?, name?}` });
    }
    if (!live) return needsLive(res);
    try {
      const out = await paidCall(res, { label: 'read-swatch-codes', prompt: buildSwatchPrompt(items), maxTokens: 3000, ...img });
      if (!out) return undefined;
      return res.json({ ...meta(out.body, out.cached), codes: parseSwatchCodes(out.body) });
    } catch (err) {
      return fail(res, err, 'read-swatch-codes');
    }
  });

  app.post('/api/read-label-sheet', async (req, res) => {
    const img = checkImage(req, res);
    if (!img) return undefined;
    const { vocabulary, cells } = req.body;
    if (!Array.isArray(vocabulary) || !vocabulary.length || vocabulary.length > 300 || !vocabulary.every((v) => typeof v === 'string' && VOCAB_RE.test(v))) {
      return res.status(400).json({ error: 'vocabulary must be 1-300 unit codes (letters and digits)' });
    }
    if (!Number.isInteger(cells) || cells < 1 || cells > MAX_CELLS) {
      return res.status(400).json({ error: `cells must be an integer from 1 to ${MAX_CELLS}` });
    }
    if (!live) return needsLive(res);
    try {
      const out = await paidCall(res, { label: 'read-label-sheet', prompt: buildLabelSheetPrompt(vocabulary, cells), maxTokens: 4000, ...img });
      if (!out) return undefined;
      return res.json({ ...meta(out.body, out.cached), reads: parseLabelReads(out.body) });
    } catch (err) {
      return fail(res, err, 'read-label-sheet');
    }
  });

  return app;
}

/** Save a live response body (never request headers) for use as a mock later. */
function record(dir, body, log) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `parse-legend-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(body, null, 2));
  log.info?.(`[api] recorded response to ${file}`);
}
