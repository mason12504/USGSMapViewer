// The map library: PDFs in map_library/ (or MAP_LIBRARY_DIR), listed, served, and added to by the browser.
//
// Ids are what /mapviewer/:id uses. They come from map_library/catalog.json when a file has an entry
// ({ "OF-03-19.pdf": { "id": "manitou_springs", "title": "Manitou Springs" } }), else from the file name.
// An id from a request is only ever compared with the listing; it never becomes part of a path.
// Duplicates are exact: the same SHA-256 as a stored file is the same map.
//
// Two kinds of entries:
//   map_library/<name>.pdf                       one PDF (plate alone, or plate + report already merged)
//   map_library/<folder>/{plate,pamphlet,merged}.pdf   added as a plate + pamphlet pair: both originals are kept,
//                                                      merged.pdf (pamphlet pages first, plate last) is what opens.
//                                                      Same pair of SHA-256s = same map.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { mergePamphletAndPlate } from './mergePdf.js';

const MAX_PDF_BYTES = 600 * 1024 * 1024; // big plates are 100+ MB
const MAX_THUMB_BYTES = 1024 * 1024;
const CATALOG = 'catalog.json';
const THUMBS = '.thumbs';
const MERGED = 'merged.pdf';
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/;

export const slugify = (s) => String(s).toLowerCase().replace(/\.pdf$/i, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
const titleFromFile = (file) => file.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ');
/** A file name that is safe to create inside the library folder. */
export const safeFileName = (name) => {
  const base = path.basename(String(name || '')).replace(/\.pdf$/i, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 100);
  return (base || 'map') + '.pdf';
};

export function createLibrary(dir) {
  const hashes = new Map(); // path -> {key: mtime:size, sha}

  const readCatalog = () => {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(dir, CATALOG), 'utf8'));
      return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
    } catch {
      return {};
    }
  };

  const sha = (file) => {
    const st = fs.statSync(file);
    const key = `${st.mtimeMs}:${st.size}`;
    const hit = hashes.get(file);
    if (hit?.key === key) return hit.sha;
    const h = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    hashes.set(file, { key, sha: h });
    return h;
  };

  /** Every PDF in the folder: [{id, title, file, bytes, sha256}], sorted by title. */
  const list = () => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return []; // no folder yet: an empty library
    }
    // [{file (relative to dir), name (what the id is made from), pair}]
    const found = [];
    for (const e of entries) {
      if (e.isFile() && /\.pdf$/i.test(e.name)) found.push({ file: e.name, name: e.name, pair: false });
      else if (e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(dir, e.name, MERGED))) {
        found.push({ file: `${e.name}/${MERGED}`, name: e.name, pair: true });
      }
    }
    const catalog = readCatalog();
    const used = new Set();
    const items = [];
    for (const f of found.sort((a, b) => a.file.localeCompare(b.file))) {
      const entry = catalog[f.file] || {};
      let id = ID_RE.test(entry.id || '') ? entry.id : slugify(f.name) || 'map';
      for (let n = 2; used.has(id); n++) id = `${slugify(f.name) || 'map'}_${n}`;
      used.add(id);
      const full = path.join(dir, f.file);
      items.push({
        id, title: entry.title || titleFromFile(f.name), file: f.file, bytes: fs.statSync(full).size, sha256: sha(full),
        pair: f.pair, sources: entry.sources || null,
      });
    }
    return items.sort((a, b) => a.title.localeCompare(b.title));
  };

  const find = (id) => list().find((m) => m.id === id) || null;
  const pathOf = (item) => path.join(dir, item.file);

  /** Save a PDF unless the library already has these exact bytes. */
  const add = (bytes, fileName) => {
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const existing = list().find((m) => m.sha256 === digest);
    if (existing) return { duplicate: true, id: existing.id, title: existing.title };
    fs.mkdirSync(dir, { recursive: true });
    let file = safeFileName(fileName);
    for (let n = 2; fs.existsSync(path.join(dir, file)); n++) file = file.replace(/(_\d+)?\.pdf$/i, `_${n}.pdf`);
    fs.writeFileSync(path.join(dir, file), bytes);
    const taken = new Set(list().filter((m) => m.file !== file).map((m) => m.id));
    let id = slugify(file) || 'map';
    for (let n = 2; taken.has(id); n++) id = `${slugify(file) || 'map'}_${n}`;
    const title = titleFromFile(file);
    const catalog = readCatalog();
    catalog[file] = { id, title };
    fs.writeFileSync(path.join(dir, CATALOG), JSON.stringify(catalog, null, 2) + '\n');
    return { duplicate: false, id, title };
  };

  /**
   * Save a plate + pamphlet pair in its own folder, with the merged PDF the app opens.
   * Same pair of files (by SHA-256) as a stored map -> {duplicate: true}, nothing written.
   * Throws an Error with .status when a file cannot be merged (the folder is removed again).
   */
  const addPair = async (plateBytes, pamphletBytes, title) => {
    const sources = {
      plate: crypto.createHash('sha256').update(plateBytes).digest('hex'),
      pamphlet: crypto.createHash('sha256').update(pamphletBytes).digest('hex'),
    };
    const existing = list().find((m) => m.sources?.plate === sources.plate && m.sources?.pamphlet === sources.pamphlet);
    if (existing) return { duplicate: true, id: existing.id, title: existing.title };

    const base = slugify(title) || 'map';
    let folder = base;
    for (let n = 2; fs.existsSync(path.join(dir, folder)); n++) folder = `${base}_${n}`;
    const target = path.join(dir, folder);
    fs.mkdirSync(target, { recursive: true });
    try {
      let merged;
      try {
        merged = await mergePamphletAndPlate(pamphletBytes, plateBytes);
      } catch (err) {
        throw Object.assign(new Error(`could not merge the two PDFs: ${err.message}`), { status: 422 });
      }
      fs.writeFileSync(path.join(target, 'plate.pdf'), plateBytes);
      fs.writeFileSync(path.join(target, 'pamphlet.pdf'), pamphletBytes);
      fs.writeFileSync(path.join(target, MERGED), merged.bytes);
    } catch (err) {
      fs.rmSync(target, { recursive: true, force: true }); // only the folder created just above
      throw err;
    }
    const file = `${folder}/${MERGED}`;
    const taken = new Set(list().filter((m) => m.file !== file).map((m) => m.id));
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
    const shownTitle = String(title || '').trim().slice(0, 120) || titleFromFile(folder);
    const catalog = readCatalog();
    catalog[file] = { id, title: shownTitle, sources };
    fs.writeFileSync(path.join(dir, CATALOG), JSON.stringify(catalog, null, 2) + '\n');
    return { duplicate: false, id, title: shownTitle };
  };

  const thumbPath = (item) => path.join(dir, THUMBS, `${item.sha256.slice(0, 16)}.jpg`);
  const saveThumb = (item, bytes) => {
    fs.mkdirSync(path.join(dir, THUMBS), { recursive: true });
    fs.writeFileSync(thumbPath(item), bytes);
  };

  return { list, find, pathOf, add, addPair, thumbPath, saveThumb };
}

/** Express routes for the library. `dir` is the library folder. */
export function libraryRouter(dir) {
  const lib = createLibrary(dir);
  const router = express.Router();
  const pdfBody = express.raw({ type: 'application/pdf', limit: MAX_PDF_BYTES });
  const pairBody = express.raw({ type: 'application/octet-stream', limit: MAX_PDF_BYTES });
  const jpegBody = express.raw({ type: 'image/jpeg', limit: MAX_THUMB_BYTES });
  const publicItem = ({ id, title, file, bytes, sha256, pair }) => ({ id, title, file, bytes, sha256, pair });

  router.get('/', (_req, res) => res.json(lib.list().map(publicItem)));

  router.post('/', pdfBody, (req, res) => {
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || !bytes.length) return res.status(415).json({ error: 'send the PDF as the request body (content-type application/pdf)' });
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return res.status(400).json({ error: 'that is not a PDF file' });
    try {
      return res.json(lib.add(bytes, req.query.name));
    } catch (err) {
      return res.status(500).json({ error: `could not save the map: ${err.message}` });
    }
  });

  // A plate + pamphlet pair in ONE body: the pamphlet's bytes, then the plate's. ?pamphletBytes=N&plateBytes=M tell
  // where to cut; ?name= is the map's title. Each part must start with %PDF-.
  router.post('/pair', pairBody, async (req, res) => {
    const body = req.body;
    const pamphletLen = Number(req.query.pamphletBytes);
    const plateLen = Number(req.query.plateBytes);
    if (!Buffer.isBuffer(body) || !Number.isInteger(pamphletLen) || !Number.isInteger(plateLen) || pamphletLen < 5 || plateLen < 5 || pamphletLen + plateLen !== body.length) {
      return res.status(400).json({ error: 'send the pamphlet and the plate in one body (content-type application/octet-stream) with matching ?pamphletBytes= and ?plateBytes=' });
    }
    const pamphlet = body.subarray(0, pamphletLen);
    const plate = body.subarray(pamphletLen);
    if (pamphlet.subarray(0, 5).toString('latin1') !== '%PDF-') return res.status(400).json({ error: 'the pamphlet is not a PDF file' });
    if (plate.subarray(0, 5).toString('latin1') !== '%PDF-') return res.status(400).json({ error: 'the plate is not a PDF file' });
    try {
      return res.json(await lib.addPair(plate, pamphlet, req.query.name));
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.status ? err.message : `could not save the map: ${err.message}` });
    }
  });

  router.get('/:id/pdf', (req, res) => {
    const item = lib.find(req.params.id);
    if (!item) return res.status(404).json({ error: 'no such map in the library' });
    res.type('application/pdf');
    return fs.createReadStream(lib.pathOf(item)).on('error', () => res.destroy()).pipe(res);
  });

  router.get('/:id/thumb', (req, res) => {
    const item = lib.find(req.params.id);
    const file = item && lib.thumbPath(item);
    if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'no thumbnail yet' });
    res.type('image/jpeg');
    return fs.createReadStream(file).pipe(res);
  });

  router.put('/:id/thumb', jpegBody, (req, res) => {
    const item = lib.find(req.params.id);
    if (!item) return res.status(404).json({ error: 'no such map in the library' });
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return res.status(400).json({ error: 'expected a JPEG' });
    lib.saveThumb(item, bytes);
    return res.json({ ok: true });
  });

  return router;
}
