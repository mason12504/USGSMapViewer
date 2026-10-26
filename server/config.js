// Server configuration.
//
// Two modes:
//   mock  MOCK_ANTHROPIC=1 (the default in the dev container). No key is
//         read or needed; /api/parse-legend replays a saved response.
//   live  Reads ANTHROPIC_API_KEY from $PRIVATE_ROOT/SECRETS.env. Only the
//         `api-real` compose service mounts that folder, so the key never
//         exists inside the container Claude works in.
//
// The key is read from the file at startup and kept in this module's memory
// only. It is NOT copied into process.env (so it can't leak via a child
// process or an env dump) and is never logged.

import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export class ConfigError extends Error {}

export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 3001);
  const host = env.HOST || '127.0.0.1';
  const mock = env.MOCK_ANTHROPIC === '1' || env.MOCK_ANTHROPIC === 'true';
  const mockFile = env.MOCK_RESPONSE_FILE || path.resolve('fixtures/mock/anthropic-parse-legend.json');
  const recordDir = env.RECORD_DIR || null;
  const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
  // Spend controls (live mode). Cache + daily ledger live in one folder.
  const spend = {
    cacheDir: env.CACHE_DIR || path.resolve('.cache/anthropic'),
    maxCallsPerDay: num(env.MAX_CALLS_PER_DAY, 50),
    priceInPerMTok: num(env.PRICE_IN_PER_MTOK, null),
    priceOutPerMTok: num(env.PRICE_OUT_PER_MTOK, null),
  };
  // Where `npm run scan:ai` leaves resolved.json per scanned map (read-only here; no API involved).
  const scansDir = env.SCANS_DIR || path.resolve('.lab/scan');

  if (mock) {
    return { mode: 'mock', port, host, mockFile, model: env.ANTHROPIC_MODEL || DEFAULT_MODEL, recordDir: null, scansDir, ...spend };
  }

  const root = env.PRIVATE_ROOT;
  if (!root) {
    throw new ConfigError(
      'Live mode needs PRIVATE_ROOT (the folder holding SECRETS.env). ' +
      'Set MOCK_ANTHROPIC=1 to run without a key.',
    );
  }
  const secretsPath = path.join(root, 'SECRETS.env');
  if (!fs.existsSync(secretsPath)) {
    throw new ConfigError(`Live mode: ${secretsPath} not found.`);
  }
  const secrets = parseEnv(fs.readFileSync(secretsPath, 'utf8'));
  const apiKey = (secrets.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new ConfigError(`Live mode: ANTHROPIC_API_KEY missing in ${secretsPath}.`);

  const config = {
    mode: 'live',
    port,
    host,
    model: secrets.ANTHROPIC_MODEL || env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    recordDir,
    scansDir,
    ...spend,
  };
  // Non-enumerable: invisible to JSON.stringify, console.log, and object spread.
  // (A plain getter is NOT enough — JSON.stringify calls enumerable getters.)
  Object.defineProperty(config, 'apiKey', { value: apiKey, enumerable: false });
  return config;
}

/** Safe-to-log view of a config. */
export function describeConfig(c) {
  return {
    mode: c.mode, host: c.host, port: c.port, model: c.model, recording: Boolean(c.recordDir),
    cacheDir: c.mode === 'live' ? c.cacheDir : null, maxCallsPerDay: c.mode === 'live' ? c.maxCallsPerDay : null,
  };
}
