// Talking to the Anthropic Messages API, and parsing what comes back.

export const API_URL = 'https://api.anthropic.com/v1/messages';

export function buildLegendPrompt(candidateCodes = []) {
  const codes = candidateCodes.length ? candidateCodes.slice(0, 60).join(', ') : '(none detected)';
  return `This image is the legend ("Description of Map Units") of a geologic map.
Unit codes already detected on the map: ${codes}.

For every legend entry you can read, return the unit code, name, age and description,
copied from the legend (fix line-break hyphenation, nothing else).

Respond with ONLY a JSON object, no markdown fences:
{"units":[{"code":"Qal","name":"Alluvium","age":"Holocene","description":"..."}]}`;
}

/** Call the API. `fetchImpl` is injectable for tests. Throws UpstreamError. */
export async function callAnthropic({ apiKey, model, imageBase64, mediaType, candidateCodes, fetchImpl = fetch }) {
  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: buildLegendPrompt(candidateCodes) },
        ],
      }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // Pass along Anthropic's error type/message (never contains the key), not headers.
    const msg = body?.error?.message || `HTTP ${res.status}`;
    throw new UpstreamError(res.status, msg);
  }
  return body;
}

export class UpstreamError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Extract {units: [...]} from a Messages API response body. Tolerates
 * markdown fences and prose around the JSON, which models sometimes add.
 */
export function parseLegendResponse(body) {
  const text = (body?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  if (!text) throw new Error('Empty response from model');

  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model response');
  const parsed = JSON.parse(unfenced.slice(start, end + 1));
  const units = Array.isArray(parsed.units) ? parsed.units : [];
  return units
    .filter((u) => u && typeof u.code === 'string' && u.code.trim())
    .map((u) => ({
      code: String(u.code).trim(),
      name: String(u.name || '').trim(),
      ageText: u.age ? String(u.age).trim() : null,
      description: String(u.description || '').trim(),
      source: 'ai',
    }));
}
