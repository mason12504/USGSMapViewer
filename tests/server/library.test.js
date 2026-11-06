import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../server/app.js';
import { loadConfig } from '../../server/config.js';
import { safeFileName, slugify } from '../../server/library.js';

const quiet = { error: () => {}, info: () => {} };
const pdf = (text) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);

function appWithLibrary(files = {}, catalog = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapparser-library-'));
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), bytes);
  if (catalog) fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(catalog));
  const config = loadConfig({ MOCK_ANTHROPIC: '1', MAP_LIBRARY_DIR: dir });
  return { app: createApp(config, { log: quiet }), dir };
}

describe('library: listing', () => {
  it('lists PDFs with ids from the file name, or from catalog.json when present', async () => {
    const { app } = appWithLibrary(
      { 'OF-03-19.pdf': pdf('a'), 'Plate 5.pdf': pdf('b'), 'notes.txt': 'x' },
      { 'OF-03-19.pdf': { id: 'manitou_springs', title: 'Manitou Springs' } },
    );
    const res = await request(app).get('/api/library').expect(200);
    expect(res.body.map((m) => [m.id, m.title])).toEqual([['manitou_springs', 'Manitou Springs'], ['plate_5', 'Plate 5']]);
    expect(res.body[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('an empty or missing folder is an empty library', async () => {
    const config = loadConfig({ MOCK_ANTHROPIC: '1', MAP_LIBRARY_DIR: path.join(os.tmpdir(), 'mapparser-nope-' + Date.now()) });
    const res = await request(createApp(config, { log: quiet })).get('/api/library').expect(200);
    expect(res.body).toEqual([]);
  });

  it('keeps ids unique when two files would get the same one', async () => {
    const { app } = appWithLibrary({ 'a b.pdf': pdf('1'), 'a_b.pdf': pdf('2') });
    const ids = (await request(app).get('/api/library')).body.map((m) => m.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('library: opening a map', () => {
  it('streams the PDF by id', async () => {
    const { app } = appWithLibrary({ 'm.pdf': pdf('hello') });
    const res = await request(app).get('/api/library/m/pdf').buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.body.toString()).toContain('hello');
  });

  it('unknown ids and path tricks are a 404, never a file read', async () => {
    const { app } = appWithLibrary({ 'm.pdf': pdf('x') });
    await request(app).get('/api/library/nope/pdf').expect(404);
    await request(app).get('/api/library/..%2F..%2Fetc%2Fpasswd/pdf').expect(404);
    await request(app).get('/api/library/catalog.json/pdf').expect(404);
  });
});

describe('library: adding a map', () => {
  const send = (app, bytes, name = 'New Map.pdf') =>
    request(app).post('/api/library').query({ name }).set('content-type', 'application/pdf').send(bytes);

  it('saves a new PDF, then recognizes the same bytes as a duplicate (even under another name)', async () => {
    const { app, dir } = appWithLibrary();
    const first = await send(app, pdf('one')).expect(200);
    expect(first.body).toEqual({ duplicate: false, id: 'new_map', title: 'New Map' });
    expect(fs.existsSync(path.join(dir, 'New_Map.pdf'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'))['New_Map.pdf'].id).toBe('new_map');

    const again = await send(app, pdf('one'), 'other-name.pdf').expect(200);
    expect(again.body).toEqual({ duplicate: true, id: 'new_map', title: 'New Map' });
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.pdf'))).toEqual(['New_Map.pdf']);
  });

  it('different bytes under the same name get their own file and id', async () => {
    const { app } = appWithLibrary();
    await send(app, pdf('one')).expect(200);
    const second = await send(app, pdf('two')).expect(200);
    expect(second.body.duplicate).toBe(false);
    expect(second.body.id).not.toBe('new_map');
    expect((await request(app).get('/api/library')).body).toHaveLength(2);
  });

  it('rejects things that are not PDFs and file names that try to leave the folder', async () => {
    const { app, dir } = appWithLibrary();
    await send(app, Buffer.from('<html>nope</html>')).expect(400);
    await request(app).post('/api/library').set('content-type', 'text/plain').send('x').expect(415);
    await send(app, pdf('evil'), '../../evil.pdf').expect(200);
    expect(fs.existsSync(path.join(dir, 'evil.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '..', '..', 'evil.pdf'))).toBe(false);
  });
});

describe('library: thumbnails', () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
  it('404 until one is stored, then serves it; rejects non-JPEG', async () => {
    const { app } = appWithLibrary({ 'm.pdf': pdf('x') });
    await request(app).get('/api/library/m/thumb').expect(404);
    await request(app).put('/api/library/m/thumb').set('content-type', 'image/jpeg').send(Buffer.from('nope!!')).expect(400);
    await request(app).put('/api/library/m/thumb').set('content-type', 'image/jpeg').send(JPEG).expect(200);
    const res = await request(app).get('/api/library/m/thumb').expect(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    await request(app).put('/api/library/zzz/thumb').set('content-type', 'image/jpeg').send(JPEG).expect(404);
  });
});

describe('library: name helpers', () => {
  it('slugify and safeFileName', () => {
    expect(slugify('OF-03-19.pdf')).toBe('of_03_19');
    expect(slugify('Hello World!')).toBe('hello_world');
    expect(safeFileName('../../a b.PDF')).toBe('a_b.pdf');
    expect(safeFileName('')).toBe('map.pdf');
  });
});

describe('library: plate + pamphlet pairs', () => {
  const makePdf = async (sizes, tag) => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    doc.setSubject(tag);
    for (const [w, h] of sizes) doc.addPage([w, h]);
    return Buffer.from(await doc.save());
  };
  const sendPair = (app, pamphlet, plate, name = 'Two Part Map', lens = {}) =>
    request(app)
      .post('/api/library/pair')
      .query({ name, pamphletBytes: lens.pamphlet ?? pamphlet.length, plateBytes: lens.plate ?? plate.length })
      .set('content-type', 'application/octet-stream')
      .send(Buffer.concat([pamphlet, plate]));

  it('saves both originals and the merged PDF in a sub-folder, lists it, and opens the merged one', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const { app, dir } = appWithLibrary();
    const pamphlet = await makePdf([[612, 792], [612, 792]], 'pamphlet');
    const plate = await makePdf([[2592, 3024]], 'plate');
    const res = await sendPair(app, pamphlet, plate).expect(200);
    expect(res.body).toEqual({ duplicate: false, id: 'two_part_map', title: 'Two Part Map' });
    expect(fs.readdirSync(path.join(dir, 'two_part_map')).sort()).toEqual(['merged.pdf', 'pamphlet.pdf', 'plate.pdf']);
    expect(fs.readFileSync(path.join(dir, 'two_part_map', 'plate.pdf')).equals(plate)).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'two_part_map', 'pamphlet.pdf')).equals(pamphlet)).toBe(true);

    const list = (await request(app).get('/api/library')).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'two_part_map', title: 'Two Part Map', file: 'two_part_map/merged.pdf', pair: true });

    const pdf = await request(app).get('/api/library/two_part_map/pdf').buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    const merged = await PDFDocument.load(pdf.body);
    expect(merged.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([[612, 792], [612, 792], [2592, 3024]]);
  });

  it('the same two files again are recognized (even under another title); one changed file is a new map', async () => {
    const { app, dir } = appWithLibrary();
    const pamphlet = await makePdf([[612, 792]], 'p1');
    const plate = await makePdf([[2000, 2000]], 'pl1');
    await sendPair(app, pamphlet, plate).expect(200);
    const again = await sendPair(app, pamphlet, plate, 'Another Name').expect(200);
    expect(again.body).toEqual({ duplicate: true, id: 'two_part_map', title: 'Two Part Map' });
    expect(fs.readdirSync(dir).filter((n) => !n.endsWith('.json'))).toEqual(['two_part_map']);

    const newPamphlet = await makePdf([[612, 792]], 'p2');
    const other = await sendPair(app, newPamphlet, plate).expect(200);
    expect(other.body.duplicate).toBe(false);
    expect(other.body.id).toBe('two_part_map_2');
  });

  it('rejects bad lengths and parts that are not PDFs, and leaves nothing behind', async () => {
    const { app, dir } = appWithLibrary();
    const pamphlet = await makePdf([[612, 792]], 'p');
    const plate = await makePdf([[2000, 2000]], 'pl');
    await sendPair(app, pamphlet, plate, 'x', { plate: plate.length + 1 }).expect(400);
    await sendPair(app, Buffer.from('<html>no</html>'), plate).expect(400);
    await sendPair(app, pamphlet, Buffer.from('<html>no</html>')).expect(400);
    // Starts like a PDF but cannot be read: refused, and its folder is removed again.
    const broken = await sendPair(app, pamphlet, Buffer.from('%PDF-1.4 this is not really a pdf')).expect(422);
    expect(broken.body.error).toContain('could not merge');
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('a hostile title cannot leave the library folder', async () => {
    const { app, dir } = appWithLibrary();
    const pamphlet = await makePdf([[612, 792]], 'p');
    const plate = await makePdf([[2000, 2000]], 'pl');
    const res = await sendPair(app, pamphlet, plate, '../../escape').expect(200);
    expect(res.body.id).toBe('escape');
    expect(fs.existsSync(path.join(dir, 'escape', 'merged.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '..', '..', 'escape'))).toBe(false);
  });
});
