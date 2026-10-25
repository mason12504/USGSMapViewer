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
  const config = loadConfig({ PRIVATE_ROOT: tmpSecrets(`ANTHROPIC_API_KEY=${FAKE_KEY}\n`) });

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
    const app = createApp(config, { fetchImpl, log: quiet });
    const res = await request(app).post('/api/parse-legend').send({ imageBase64: TINY_PNG });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_KEY);
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
