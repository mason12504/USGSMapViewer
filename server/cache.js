// On-disk cache for Anthropic responses, so identical requests are paid for once.
//
// Key = SHA-256 of everything that shapes the answer (model, the exact prompt
// text, the image bytes, media type). Change the prompt or the picture and the
// key changes; nothing stale is ever served. Only successful upstream bodies
// are stored: never request headers, never the API key.
//
// If the directory can't be written (the api-real container mounts the code
// read-only), the cache turns itself off and says so once; calls still work.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** Stable key for a request. `parts` must be JSON-serialisable. */
export function requestKey(parts) {
  return sha256(JSON.stringify(parts));
}

export function createCache(dir, { log = console } = {}) {
  let enabled = Boolean(dir);
  let root = null;
  if (enabled) {
    try {
      root = path.join(dir, 'responses');
      fs.mkdirSync(root, { recursive: true });
      fs.accessSync(root, fs.constants.W_OK);
    } catch (err) {
      enabled = false;
      log.error?.(`[cache] disabled: cannot write ${dir} (${err.code || err.message})`);
    }
  }
  const file = (key) => path.join(root, `${key}.json`);

  return {
    get enabled() { return enabled; },
    dir: enabled ? dir : null,

    /** The stored response body, or null. */
    get(key) {
      if (!enabled) return null;
      try {
        const entry = JSON.parse(fs.readFileSync(file(key), 'utf8'));
        return entry?.body || null;
      } catch {
        return null;
      }
    },

    /** Store a response body. `meta` is for humans reading the cache folder. */
    put(key, body, meta = {}) {
      if (!enabled) return;
      try {
        const tmp = file(key) + `.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), meta, body }));
        fs.renameSync(tmp, file(key));
      } catch (err) {
        log.error?.(`[cache] write failed: ${err.code || err.message}`);
      }
    },
  };
}
