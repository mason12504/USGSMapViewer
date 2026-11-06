import fs from 'node:fs';
import path from 'node:path';

// The e2e server reads its map library from a throwaway folder (MAP_LIBRARY_DIR in playwright.config.js),
// seeded from fixtures/, so tests never touch the real map_library/. Tests open maps by URL.
export const E2E_LIBRARY = path.resolve('tests/.e2e-library');

const SEED = [
  { from: 'fixtures/manitou/OF-03-19.pdf', file: 'OF-03-19.pdf', id: 'manitou_springs', title: 'Manitou Springs' },
  { from: 'fixtures/pikeview/OF-01-03_Pikeview_Geologic_Map.pdf', file: 'Pikeview.pdf', id: 'pikeview', title: 'Pikeview' },
  // The big scan is not in the repo; it is used when it is in map_library/ (see scanned.spec.js).
  { from: 'map_library/USGS_I-999_2-prnt.pdf', file: 'USGS_I-999_2-prnt.pdf', id: 'leadville_scan', title: 'Leadville (scan)', optional: true },
];

export default async function globalSetup() {
  // Refuse to run against a server that is not using the throwaway library (e.g. a dev server you left running).
  const health = await fetch('http://127.0.0.1:5173/api/health').then((r) => r.json());
  if (health.library !== path.basename(E2E_LIBRARY)) {
    throw new Error(
      `The server on :5173 is not using the e2e map library (health.library = ${health.library}). ` +
      'Stop your dev server so Playwright can start its own, or the tests would write into map_library/.',
    );
  }
  fs.rmSync(E2E_LIBRARY, { recursive: true, force: true });
  fs.mkdirSync(E2E_LIBRARY, { recursive: true });
  const catalog = {};
  for (const s of SEED) {
    if (!fs.existsSync(s.from)) {
      if (s.optional) continue;
      throw new Error(`missing fixture ${s.from}`);
    }
    fs.copyFileSync(s.from, path.join(E2E_LIBRARY, s.file));
    catalog[s.file] = { id: s.id, title: s.title };
  }
  fs.writeFileSync(path.join(E2E_LIBRARY, 'catalog.json'), JSON.stringify(catalog, null, 2));
}
