// Browser -> our API server: the map library (PDFs in map_library/).

async function failure(res, what) {
  const body = await res.json().catch(() => ({}));
  return new Error(body.error || `${what} (HTTP ${res.status})`);
}

/** [{id, title, file, bytes, sha256}] */
export async function listLibrary() {
  const res = await fetch('/api/library');
  if (!res.ok) throw await failure(res, 'Could not read the map library');
  return res.json();
}

export const libraryPdfUrl = (id) => `/api/library/${encodeURIComponent(id)}/pdf`;
export const libraryThumbUrl = (id) => `/api/library/${encodeURIComponent(id)}/thumb`;

/** The PDF of a library map as a File, ready for the parser. */
export async function fetchLibraryFile(item) {
  const res = await fetch(libraryPdfUrl(item.id));
  if (!res.ok) throw await failure(res, 'Could not open the map');
  return new File([await res.blob()], item.file, { type: 'application/pdf' });
}

/** Save a dropped PDF into the library. -> {duplicate, id, title}; the same bytes are never stored twice. */
export async function addToLibrary(file) {
  const res = await fetch(`/api/library?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/pdf' },
    body: file,
  });
  if (!res.ok) throw await failure(res, 'Could not save the map');
  return res.json();
}

/**
 * Save a map that comes as two files. The server keeps both in a folder and merges them into the one PDF
 * the explorer opens. -> {duplicate, id, title}. The two files travel in one request: pamphlet bytes, then plate bytes.
 */
export async function addPairToLibrary({ plate, pamphlet, title }) {
  const q = new URLSearchParams({ name: title, pamphletBytes: String(pamphlet.size), plateBytes: String(plate.size) });
  const res = await fetch(`/api/library/pair?${q}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Blob([pamphlet, plate]),
  });
  if (!res.ok) throw await failure(res, 'Could not save the map');
  return res.json();
}

/** Keep a card thumbnail (JPEG blob) so it is only rendered once. */
export async function saveThumb(id, blob) {
  const res = await fetch(libraryThumbUrl(id), { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: blob });
  if (!res.ok) throw await failure(res, 'Could not save the thumbnail');
}
