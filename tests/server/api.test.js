import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';
import { ConfigError, describeConfig, loadConfig } from '../../server/config.js';
import { parseLegendResponse } from '../../server/anthropic.js';

const quiet = { error: () => {}, info: () => {} };
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const FAKE_KEY = 'sk-ant-test-THIS-MUST-NEVER-APPEAR';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mapparser-cache-'));

function tmpSecrets(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapparser-secrets-'));
  fs.writeFileSync(path.join(dir, 'SECRETS.env'), contents);
  return dir;
}

describe('config', () => {
  it('mock mode needs no key', () => {
    const c = loadConfig({ MOCK_ANTHROPIC: '1' });
    expect(c.mode).toBe('mock');
    expect(c.apiKey).toBeUndefined();
  });

  it('live mode refuses to start without PRIVATE_ROOT or a key', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ PRIVATE_ROOT: tmpSecrets('OTHER=1\n') })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('live mode reads the key from SECRETS.env but never exposes it', () => {
    const c = loadConfig({ PRIVATE_ROOT: tmpSecrets(`ANTHROPIC_API_KEY=${FAKE_KEY}\n`) });
    expect(c.mode).toBe('live');
    expect(c.apiKey).toBe(FAKE_KEY);
    expect(JSON.stringify(c)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(describeConfig(c))).not.toContain(FAKE_KEY);
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe('POST /api/parse-legend (mock mode)', () => {
  const app = createApp(loadConfig({ MOCK_ANTHROPIC: '1' }), { log: quiet });

  it('reports mock mode on /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body).toMatchObject({ ok: true, mode: 'mock' });
  });

  it('returns units parsed from the saved response', async () => {
    const res = await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG, candidateCodes: ['Qsw', 'Kda'] });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('mock');
    const qsw = res.body.units.find((u) => u.code === 'Qsw');
    expect(qsw).toMatchObject({ name: 'Sheetwash deposits', source: 'ai' });
  });

  it('validates input', async () => {
    expect((await request(app).post('/api/parse-legend').send({})).status).toBe(400);
    expect((await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG, mediaType: 'text/html' })).status).toBe(400);
    expect((await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG, candidateCodes: ['<script>'] })).status).toBe(400);
  });
});

describe('POST /api/parse-legend (live mode, fake upstream)', () => {
  const config = loadConfig({ PRIVATE_ROOT: tmpSecrets(`ANTHROPIC_API_KEY=${FAKE_KEY}\n`), CACHE_DIR: tmpDir() });

  it('adds the key server-side and never returns it', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ model: 'm', content: [{ type: 'text', text: '{"units":[{"code":"Qal","name":"Alluvium","age":"Holocene"}]}' }] }),
    }));
    const app = createApp(config, { fetchImpl, log: quiet });
    const res = await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    expect(res.status).toBe(200);
    expect(res.body.units).toEqual([{ code: 'Qal', name: 'Alluvium', ageText: 'Holocene', description: '', source: 'ai' }]);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers['x-api-key']).toBe(FAKE_KEY);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY);
  });

  it('maps upstream errors to 502 without leaking the key', async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) });
    // Fresh cache folder: the test above already cached a good answer for this image.
    const app = createApp({ ...config, cacheDir: tmpDir() }, { fetchImpl, log: quiet });
    const res = await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY);
  });
});

// A fake Anthropic that answers like the real one, with token usage.
const okUpstream = (units = '{"units":[{"code":"Qal","name":"Alluvium","age":"Holocene"}]}', usage = { input_tokens: 1200, output_tokens: 300 }) =>
  vi.fn(async () => ({ ok: true, json: async () => ({ model: 'fake-model', usage, content: [{ type: 'text', text: units }] }) }));

const liveConfig = (extra = {}) => loadConfig({ PRIVATE_ROOT: tmpSecrets(`ANTHROPIC_API_KEY=${FAKE_KEY}\n`), CACHE_DIR: tmpDir(), ...extra });

describe('response cache', () => {
  it('pays once: an identical request is served from disk', async () => {
    const fetchImpl = okUpstream();
    const app = createApp(liveConfig(), { fetchImpl, log: quiet });
    const send = () => request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG, candidateCodes: ['Qal'] });
    const first = await send();
    const second = await send();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first.body.cached).toBe(false);
    expect(second.body.cached).toBe(true);
    expect(second.body.units).toEqual(first.body.units);
    expect(second.body.usage).toMatchObject({ calls: 1, cacheHits: 1 });
  });

  it('survives a restart (the cache is on disk)', async () => {
    const config = liveConfig();
    const fetchImpl = okUpstream();
    await request(createApp(config, { fetchImpl, log: quiet })).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    const again = await request(createApp(config, { fetchImpl, log: quiet })).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    expect(again.body.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a different image or different candidate codes is a different request', async () => {
    const fetchImpl = okUpstream();
    const app = createApp(liveConfig(), { fetchImpl, log: quiet });
    await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG, candidateCodes: ['Qal'] });
    await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG + 'AAAA' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not cache failures', async () => {
    let fail = true;
    const fetchImpl = vi.fn(async () => (fail
      ? { ok: false, status: 529, json: async () => ({ error: { message: 'overloaded' } }) }
      : { ok: true, json: async () => ({ usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: '{"units":[]}' }] }) }));
    const app = createApp(liveConfig(), { fetchImpl, log: quiet });
    expect((await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG })).status).toBe(502);
    fail = false;
    const retry = await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    expect(retry.status).toBe(200);
    expect(retry.body.cached).toBe(false);
  });

  it('two identical requests in flight share one paid call', async () => {
    const fetchImpl = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true, json: async () => ({ usage: { input_tokens: 5, output_tokens: 5 }, content: [{ type: 'text', text: '{"units":[]}' }] }) };
    });
    const app = createApp(liveConfig(), { fetchImpl, log: quiet });
    const send = () => request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    await Promise.all([send(), send()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('stores no secrets on disk', async () => {
    const config = liveConfig();
    await request(createApp(config, { fetchImpl: okUpstream(), log: quiet })).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    const files = fs.readdirSync(config.cacheDir, { recursive: true, withFileTypes: true }).filter((f) => f.isFile());
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(fs.readFileSync(path.join(f.parentPath, f.name), 'utf8')).not.toContain(FAKE_KEY);
  });

  it('keeps working when the cache folder is not writable', async () => {
    const blocker = path.join(tmpDir(), 'a-file');
    fs.writeFileSync(blocker, 'x');
    const fetchImpl = okUpstream();
    const app = createApp(liveConfig({ CACHE_DIR: path.join(blocker, 'sub') }), { fetchImpl, log: quiet });
    const res = await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
  });
});

describe('usage logging and the daily cap', () => {
  it('logs every live call with its tokens, and every cache hit as free', async () => {
    const lines = [];
    const log = { info: (m) => lines.push(m), error: (m) => lines.push(m) };
    const app = createApp(liveConfig(), { fetchImpl: okUpstream(), log });
    await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    expect(lines.some((l) => /LIVE call .*in=1200 out=300 tokens.*today 1\/50/.test(l))).toBe(true);
    expect(lines.some((l) => /CACHE HIT \(no charge\)/.test(l))).toBe(true);
    expect(lines.join('\n')).not.toContain(FAKE_KEY);
  });

  it('reports usage on /api/usage and /api/health, with an optional dollar estimate', async () => {
    const app = createApp(liveConfig({ PRICE_IN_PER_MTOK: '3', PRICE_OUT_PER_MTOK: '15' }), { fetchImpl: okUpstream(), log: quiet });
    await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    const u = (await request(app).get('/api/usage')).body;
    expect(u).toMatchObject({ calls: 1, cap: 50, remaining: 49, inputTokens: 1200, outputTokens: 300 });
    expect(u.estimatedUsd).toBeCloseTo((1200 * 3 + 300 * 15) / 1e6, 8);
    expect((await request(app).get('/api/health')).body.usage.calls).toBe(1);
  });

  it('gives no dollar figure unless prices are configured', async () => {
    const app = createApp(liveConfig(), { fetchImpl: okUpstream(), log: quiet });
    await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    expect((await request(app).get('/api/usage')).body.estimatedUsd).toBeNull();
  });

  it('refuses paid calls past the daily cap, but still serves cache hits', async () => {
    const fetchImpl = okUpstream();
    const app = createApp(liveConfig({ MAX_CALLS_PER_DAY: '2' }), { fetchImpl, log: quiet });
    const send = (img) => request(app).post('/api/parse-legend').send({ imageBase64: img });
    expect((await send(TINY_PNG)).status).toBe(200);
    expect((await send(TINY_PNG + 'AA')).status).toBe(200);
    const blocked = await send(TINY_PNG + 'BB');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Daily API call cap reached \(2\/2\)/);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // the refused one never reached Anthropic
    expect((await send(TINY_PNG)).status).toBe(200); // cached: free
  });

  it('the daily count survives a restart', async () => {
    const config = liveConfig({ MAX_CALLS_PER_DAY: '1' });
    await request(createApp(config, { fetchImpl: okUpstream(), log: quiet })).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    const restarted = createApp(config, { fetchImpl: okUpstream(), log: quiet });
    expect((await request(restarted).post('/api/parse-legend').send({ imageBase64: TINY_PNG + 'AA' })).status).toBe(429);
  });

  it('failed calls still count (they may have been billed)', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) });
    const app = createApp(liveConfig(), { fetchImpl, log: quiet });
    await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    expect((await request(app).get('/api/usage')).body).toMatchObject({ calls: 1, errors: 1 });
  });

  it('mock mode never caches, caps or charges', async () => {
    const app = createApp(loadConfig({ MOCK_ANTHROPIC: '1' }), { log: quiet });
    const res = await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    expect(res.body).toMatchObject({ mode: 'mock', cached: false, usage: null });
    expect((await request(app).get('/api/health')).body.usage).toBeNull();
  });
});

describe('scanned-map endpoints (swatch codes, label sheets)', () => {
  const upstream = (json, usage = { input_tokens: 2500, output_tokens: 400 }) =>
    vi.fn(async () => ({ ok: true, json: async () => ({ model: 'fake-model', usage, content: [{ type: 'text', text: JSON.stringify(json) }] }) }));
  const swatchBody = { imageBase64: TINY_PNG, items: [{ n: 1, ocr: 'Ke', name: 'COLORADO GROUP' }, { n: 2, ocr: null }] };
  const sheetBody = { imageBase64: TINY_PNG, vocabulary: ['Kc', 'Kd', 'IPPm'], cells: 3 };

  it('reads swatch codes, sending the OCR hints and legend text in the prompt', async () => {
    const fetchImpl = upstream({ codes: [{ n: 1, code: 'Kc', confidence: 'high' }, { n: 2, code: null, confidence: 'low' }, { n: 'x', code: 'Z' }] });
    const app = createApp(liveConfig(), { fetchImpl, log: quiet });
    const res = await request(app).post('/api/read-swatch-codes').send(swatchBody);
    expect(res.status).toBe(200);
    expect(res.body.codes).toEqual([{ n: 1, code: 'Kc', confidence: 'high' }, { n: 2, code: null, confidence: 'low' }]);
    expect(res.body.tokens).toEqual({ input: 2500, output: 400 });
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const text = sent.messages[0].content.find((c) => c.type === 'text').text;
    expect(text).toContain('1: OCR guessed "Ke"; legend text beside it: COLORADO GROUP');
    expect(sent.max_tokens).toBe(3000);
  });

  it('reads a label sheet using the legend codes as the vocabulary', async () => {
    const fetchImpl = upstream({ reads: [{ n: 1, text: 'Kd', confidence: 'high' }, { n: 2, text: null, confidence: 'high' }, { n: 3, text: ' IPPm ', confidence: 'weird' }] });
    const app = createApp(liveConfig(), { fetchImpl, log: quiet });
    const res = await request(app).post('/api/read-label-sheet').send(sheetBody);
    expect(res.body.reads).toEqual([
      { n: 1, text: 'Kd', confidence: 'high' },
      { n: 2, text: null, confidence: 'high' },
      { n: 3, text: 'IPPm', confidence: 'low' }, // unknown confidence words are demoted
    ]);
    const text = JSON.parse(fetchImpl.mock.calls[0][1].body).messages[0].content.find((c) => c.type === 'text').text;
    expect(text).toContain('Kc, Kd, IPPm');
    expect(text).toContain('3 small crops');
  });

  it('goes through the same cache, cap and log as the legend call', async () => {
    const lines = [];
    const log = { info: (m) => lines.push(m), error: (m) => lines.push(m) };
    const fetchImpl = upstream({ reads: [] });
    const app = createApp(liveConfig({ MAX_CALLS_PER_DAY: '2' }), { fetchImpl, log });
    const send = (vocab) => request(app).post('/api/read-label-sheet').send({ ...sheetBody, vocabulary: vocab });
    expect((await send(['Kd'])).body.cached).toBe(false);
    expect((await send(['Kd'])).body.cached).toBe(true); // identical: free
    expect((await send(['Kd', 'Kc'])).status).toBe(200); // different prompt: a second paid call
    const blocked = await send(['Qa']);
    expect(blocked.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(lines.some((l) => /read-label-sheet LIVE call .*in=2500 out=400 .*today 1\/2/.test(l))).toBe(true);
    expect(lines.some((l) => /read-label-sheet CACHE HIT \(no charge\)/.test(l))).toBe(true);
  });

  it('validates input and refuses in mock mode instead of inventing answers', async () => {
    const live = createApp(liveConfig(), { fetchImpl: upstream({}), log: quiet });
    expect((await request(live).post('/api/read-swatch-codes').send({ imageBase64: TINY_PNG, items: [] })).status).toBe(400);
    expect((await request(live).post('/api/read-swatch-codes').send({ imageBase64: TINY_PNG, items: [{ n: 1, ocr: 'x'.repeat(40) }] })).status).toBe(400);
    expect((await request(live).post('/api/read-label-sheet').send({ ...sheetBody, vocabulary: ['<script>'] })).status).toBe(400);
    expect((await request(live).post('/api/read-label-sheet').send({ ...sheetBody, cells: 0 })).status).toBe(400);
    const mock = createApp(loadConfig({ MOCK_ANTHROPIC: '1' }), { log: quiet });
    expect((await request(mock).post('/api/read-swatch-codes').send(swatchBody)).status).toBe(409);
    expect((await request(mock).post('/api/read-label-sheet').send(sheetBody)).status).toBe(409);
  });
});

describe('parseLegendResponse', () => {
  it('tolerates prose and fences around the JSON', () => {
    const units = parseLegendResponse({
      content: [{ type: 'text', text: 'Here you go:\n```json\n{"units":[{"code":"Kda","name":"Dawson"}]}\n```' }],
    });
    expect(units.map((u) => u.code)).toEqual(['Kda']);
  });
});
