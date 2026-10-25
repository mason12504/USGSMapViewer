// Express app (separate from index.js so tests can create it without listening).
//
// The browser never sees the API key: it calls /api/parse-legend on this
// server, which adds the key (live mode) or replays a saved response (mock).

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { callAnthropic, parseLegendResponse, UpstreamError } from './anthropic.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // base64 payload cap
const CODE_RE = /^[A-Z][A-Za-z]{0,6}[0-9]?$/;
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function createApp(config, { fetchImpl = fetch, log = console } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '12mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: config.mode, model: config.model });
  });

  app.post('/api/parse-legend', async (req, res) => {
    const { imageBase64, mediaType = 'image/png', candidateCodes = [] } = req.body || {};

    if (typeof imageBase64 !== 'string' || !imageBase64.length) {
      return res.status(400).json({ error: 'imageBase64 (string) is required' });
    }
    if (imageBase64.length > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: 'image too large' });
    }
    if (!MEDIA_TYPES.has(mediaType)) {
      return res.status(400).json({ error: `mediaType must be one of ${[...MEDIA_TYPES].join(', ')}` });
    }
    if (!Array.isArray(candidateCodes) || candidateCodes.length > 300 ||
        !candidateCodes.every((c) => typeof c === 'string' && CODE_RE.test(c))) {
      return res.status(400).json({ error: 'candidateCodes must be an array of unit codes' });
    }

    try {
      let body;
      if (config.mode === 'mock') {
        body = JSON.parse(fs.readFileSync(config.mockFile, 'utf8'));
      } else {
        body = await callAnthropic({
          apiKey: config.apiKey,
          model: config.model,
          imageBase64,
          mediaType,
          candidateCodes,
          fetchImpl,
        });
        if (config.recordDir) record(config.recordDir, body, log);
      }
      const units = parseLegendResponse(body);
      res.json({ mode: config.mode, model: body.model || config.model, units });
    } catch (err) {
      if (err instanceof UpstreamError) {
        log.error(`[api] upstream error ${err.status}: ${err.message}`);
        return res.status(502).json({ error: `Anthropic API error (${err.status}): ${err.message}` });
      }
      log.error(`[api] parse-legend failed: ${err.message}`);
      return res.status(500).json({ error: err.message });
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
