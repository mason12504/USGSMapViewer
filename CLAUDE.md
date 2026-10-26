# CLAUDE.md: Geologic Map Explorer

Guidance for Claude Code working in this repo (inside the dev container).

## What this is

A React app that reads geologic map PDFs (USGS / state surveys) and makes the
map interactive: click a unit label → see the unit's name, age, description and
legend swatch. Parsing is **text-first** (PDF text layer + vector drawing
commands), with AI/OCR only as a fallback for scanned maps.

## Environment rules (important)

- You are in a sandbox. Outbound network is limited to Anthropic + the npm
  registry. GitHub, CDNs and the rest of the internet are blocked on purpose.
- **There is no Anthropic API key here, by design.** The API server runs with
  `MOCK_ANTHROPIC=1` and replays `fixtures/mock/anthropic-parse-legend.json`.
  Don't try to find, create or request a real key, and don't call
  `api-real` unless the user asks. It is the user's opt-in, live-key server.
- You may `git add` / `git commit`. **Never push** (no network or credentials
  anyway). The user reviews and pushes from their PC.
- These paths are read-only by design, so don't try to edit them: `.devcontainer/`,
  `.git/config`, `.git/hooks/`, `scripts/host/`. If a change is needed there,
  write the proposed change in your reply and the user applies it on their PC.
- `.vscode/` is a throwaway tmpfs; anything written there disappears.

## Commands

```bash
npm run dev            # Vite (5173) + API server in mock mode (3001)
npm test               # vitest: unit + Pikeview golden fixture + server (~5s)
npm run test:e2e       # Playwright, headless Chromium, real UI against mock API (~1.5 min)
npm run lint
npm run build
npm run parse -- <pdf> [--json out.json]     # parse a PDF from the CLI
npm run color:lab -- <pdf>                   # color-matching workbench → .lab/
npm run scan -- <scan.pdf>                   # SCANNED map first pass, all local, no API → .lab/scan/
npm run scan:ai -- <name> [--run]            # paid follow-up via the live API server; DRY RUN without --run
```

Run `npm test` and `npm run lint` before committing. Run `npm run test:e2e` when
you change UI or anything in `src/lib/`.

## Layout

```
src/lib/                 environment-agnostic parsing pipeline (runs in browser AND Node)
  document.js            whole publication: finds the plate page, attaches report text to its legend
  pipeline.js            orchestrator: page → {legend, labels, plateLabels, color, warnings}
  report/descriptions.js report text (two columns) → full unit descriptions; matches them to the plate legend
  pdf/textItems.js       positioned words from the text layer (+ bold detection)
  pdf/vectorShapes.js    filled paths, paints (solid/pattern), images, short strokes
  units/unitCodes.js     unit-code shape, age prefixes, subscript merging (Qt + ₁ → Qt1)
  legend/legend.js       legend entries: swatch + bold "Name (Age)—" + description
  labels/mapLabels.js    map frame + labels inside it
  color/                 COLOR COMPARTMENT: see src/lib/color/README.md
  scan/                  scanned maps: swatch columns, label blobs, legend text → entries (pixels in, no I/O)
src/pdf/pdfjs.browser.js pdf.js setup for the browser (assets served locally, no CDN)
src/hooks/useMapParser.js browser orchestration (parse → render → swatch previews)
src/components/          UI
src/fallback/scanned.js  OCR + AI path for scanned maps (UNTESTED, no fixture yet)
server/                  Express API: mock/live modes; key only in live mode
  cache.js, usage.js     live mode only: response cache (.cache/anthropic) + daily call cap/ledger
scripts/                 CLI tools (parse, color lab) + Node pdf.js helper
tests/unit, tests/fixtures, tests/server, tests/e2e
fixtures/pikeview/       real public map + expected-units.json (ground truth)
fixtures/manitou/        whole report (46 pages) + plate as page 47, with expected-units.json
```

## Conventions

- Coordinates in `src/lib` are **page units**: PDF points at scale 1, origin
  top-left, y down.
- `src/lib` must not import browser-only or Node-only modules; pass pdf.js
  objects (`page`, `OPS`) in.
- pdf.js internals used by `vectorShapes.js` (constructPath arg format, etc.)
  are version-specific. `pdfjs-dist` is pinned; the Pikeview fixture test fails
  loudly if an upgrade changes them.
- Ground truth lives in `fixtures/<map>/expected-units.json`. If you improve
  parsing and a fixture test fails, update the JSON **deliberately** and say
  so in the commit message.
- Keep color work inside `src/lib/color/` behind `index.js`.
- `@playwright/test` version must match `PLAYWRIGHT_VERSION` in
  `.devcontainer/Dockerfile` (browsers are baked into the image).
