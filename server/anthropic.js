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
export async function callAnthropic({ apiKey, model, imageBase64, mediaType, candidateCodes, prompt, maxTokens = 8000, fetchImpl = fetch }) {
  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: prompt ?? buildLegendPrompt(candidateCodes) },
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

// ── Scanned-map helpers: read small, numbered crops instead of a whole page ──

/**
 * A sheet of legend swatches, each cell numbered. OCR already made a guess per
 * swatch; the model confirms or corrects it by looking at the printed code.
 * items: [{n, ocr, name}]
 */
export function buildSwatchPrompt(items) {
  const hints = items.map((i) => `${i.n}: OCR guessed "${i.ocr || ''}"${i.name ? `; legend text beside it: ${i.name}` : ''}`).join('\n');
  return `This image is a contact sheet of ${items.length} colored legend swatches cut from a printed geologic map.
Each cell has a red number on the left and, to its right, one swatch with a unit code printed inside it.

For each numbered cell, read the unit code printed inside the swatch EXACTLY as printed:
keep capital and lowercase letters and digits. A "P" with a vertical bar through it (Pennsylvanian)
should be written "IP". If a swatch has no readable code, use null.

OCR guesses (often wrong, use only as a hint) and the legend text beside each swatch:
${hints}

Respond with ONLY a JSON object, no markdown fences:
{"codes":[{"n":1,"code":"Qa","confidence":"high"}]}
confidence is "high", "medium" or "low".`;
}

/**
 * A sheet of small crops of map labels. The legend's own codes are the
 * vocabulary: a label is almost always one of them.
 */
export function buildLabelSheetPrompt(vocabulary, cells) {
  return `This image is a contact sheet of ${cells} small crops of text found on a printed geologic map.
Each cell has a red number at its top-left; the crop is to its right. Most crops are unit labels:
short codes naming a rock unit. Some crops are place names, elevations, symbols or noise.

Valid unit codes from this map's legend (a barred "P" is written "IP", a barred "C" or "€" is written "C"):
${vocabulary.join(', ')}

List ONLY the cells that contain a unit code. If a crop clearly matches a valid code, return that code
exactly as listed. If it looks like a unit code that is not in the list, return your best reading.
OMIT every cell that is not a unit code: place names, river names, numbers, symbols, contour lines,
scribbles, or anything unreadable. Most cells are omitted; that is expected.

Respond with ONLY a JSON object, no markdown fences:
{"reads":[{"n":1,"text":"Kd"},{"n":7,"text":"Qg","confidence":"low"}]}
Add "confidence" only when it is "medium" or "low"; leave it out when you are sure.`;
}

function jsonObject(body) {
  const text = (body?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (!text) throw new Error('Empty response from model');
  const unfenced = text.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model response');
  return JSON.parse(unfenced.slice(start, end + 1));
}

const CONF = new Set(['high', 'medium', 'low']);
const confidence = (c) => (c === undefined ? 'high' : CONF.has(c) ? c : 'low');

/** [{n, code|null, confidence}] */
export function parseSwatchCodes(body) {
  const list = Array.isArray(jsonObject(body).codes) ? jsonObject(body).codes : [];
  return list
    .filter((r) => r && Number.isInteger(r.n))
    .map((r) => ({ n: r.n, code: typeof r.code === 'string' && r.code.trim() ? r.code.trim() : null, confidence: confidence(r.confidence) }));
}

/** [{n, text|null, confidence}]. A missing confidence means "high"; cells the model left out are not returned. */
export function parseLabelReads(body) {
  const list = Array.isArray(jsonObject(body).reads) ? jsonObject(body).reads : [];
  return list
    .filter((r) => r && Number.isInteger(r.n))
    .map((r) => ({ n: r.n, text: typeof r.text === 'string' && r.text.trim() ? r.text.trim() : null, confidence: confidence(r.confidence) }));
}
