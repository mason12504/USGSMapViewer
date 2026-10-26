# Scanned maps

A PDF that is only a picture (an old printout, a scan) has no text layer and no vector shapes, so the normal
"read the PDF" path finds nothing. This guide covers the separate path for scans. It is experimental, built and
tested on one sheet (USGS I-999, Leadville 1°×2°, a clean 1978 print at 300 dpi), and it is honest about what it
gets wrong.

Nothing here is automatic or hidden: reading a scan is two commands you run, one free and one paid, and the app
then opens the saved result. **The browser never makes a paid call for a scan.**

## The workflow

| Step | Command | Cost | Time (Leadville) |
|---|---|---|---|
| 1. First pass | `npm run scan -- <scan.pdf>` | free, local, no API | ~2 min |
| 2. Paid reading | `npm run scan:ai -- <name>` (dry run), then add `--run` | ~15 API calls, roughly $0.5 at Sonnet-class prices (an estimate; your Console has the real figure) | ~2 min |
| 3. Open it | drop the same PDF into the app | free (works in mock mode) | ~25-35 s to load |

`<name>` is the PDF's file name without `.pdf`; results live in `.lab/scan/<name>/` (git-ignored). Run commands from
the project folder. Before the first `--run`, start the live API server (`bash scripts/host/run-local.sh`): it holds
your key, caches every answer, enforces the daily cap and logs every call (see "API spending controls" in the README).

### 1. `npm run scan` (local)

1. Renders the sheet and finds the legend **swatch columns** by shape (rectangles of one size in a column).
2. OCRs the **legend text** (Tesseract, language data shipped by the `@tesseract.js-data/eng` dev dependency, so no
   network) and each swatch's code.
3. Finds **label-like blobs** on the map: dark marks that are clearly darker than their surroundings (so type
   printed over orange or pink still counts), grouped into words. About 1,400 on Leadville; roughly half are not
   labels (place names, contour scribbles).
4. Writes `scan.json`, a **searchable PDF** (the scan plus an invisible text layer), `preview.jpg`, and the numbered
   pictures a paid step would read: `swatch-sheet.png` and `label-sheet-N.png`.

Results are cached by file hash in `.cache/scan/`; `--force` redoes it.

### 2. `npm run scan:ai` (paid, through the local server)

Without `--run` it only prints the plan: how many calls, image sizes, estimated tokens, and today's usage.

- **1 call** reads all swatch codes from the numbered swatch sheet (OCR guesses and the legend text beside each
  swatch are sent as hints). Barred glyphs are written in plain letters for matching (`€` → `C`, barred P → `IP`) and
  shown as printed.
- **1 call per ~100 candidate labels** reads the numbered label sheets, with the legend's own codes as the vocabulary.
  Claude lists only the cells that hold a code.
- Local OCR reads are re-checked against the final legend and snapped when exactly one code is one letter away.

Leadville's measured cost: 1 + 13 calls (about 26k tokens in, 27k out), then one 54-cell re-read (1.6k in, 0.7k out).
Output tokens were most of it, and about half the output was "not a code" cells. `--max-calls` (default 20) refuses a
bigger plan; the server's daily cap (50) is the backstop.

### Fixing a bad batch cheaply: `--reread-suspects`

A read is only as good as the list it was made with. When `M€r` and `O€r` were missing from the list, Claude answered
the nearest listed code (`MDr` for 38 crops that read `M€r`). `--reread-suspects` finds saved answers that sit one
edit from a code that was missing when they were read, cuts those cells out of the existing sheets (no PDF re-render,
see `reread-sheet-N.png`) and asks again with the complete list: one call, 54 cells, about a cent. `--reread MDr,Om`
re-asks every cell currently answered with those codes. The list is checked before every label read and the run
stops if a legend code would be dropped. `--merge-only` rebuilds `resolved.json` from saved answers with no server
and no calls.

### 3. Opening it in the app

The browser hashes the PDF and fetches `GET /api/scans/<sha256>` (the server reads `resolved.json` files under
`.lab/scan/`; `SCANS_DIR` overrides). The file must be the same bytes you scanned: a re-saved copy has a different hash.
If nothing is found the app says which two commands to run. You get the whole sheet (never cropped), the legend with
real swatch crops and the legend paragraph as the "full description", clickable labels (each says how it was read),
middle-mouse or left-drag panning, and the color features below. A banner says how many candidate labels were
identified: the rest are simply not clickable.

## Color on a scan

Vector PDFs match exact paints. A scan only has pixels, so color is a **hint**, never proof. The code is
`src/lib/scan/colorCheck.js`; every threshold is a named, commented constant at the top of that file.

| Constant | Default | Meaning |
|---|---|---|
| `NEIGHBOURHOOD_FACTOR` | 1.5 | radius around a label = this × the legend swatch's long side (~61 pt on Leadville) |
| `MIN_BLOCK_PT2` | 6 | smallest connected patch of a unit's color that counts (tiny blocks matter: leader lines) |
| `TOUCH_PT` | 3 | a block this close to the text counts as "at the text" |
| `MIN_DOMINANT_SHARE` | 0.4 | share of the strip beside the text a color needs to "dominate" it |
| `OUTWEIGHED_RATIO` | 0.5 | own color touching the text still loses to a twin that has more than 2× its share |
| `TWIN_DISTANCE` | 1 | codes this close (glyph-aware edits) are near-twins: `MDr` / `M€r` |
| `CLASSIFY_TOLERANCE`, `LIGHTNESS_WEIGHT` | 12, 0.35 | how close a pixel must be to a swatch color, and how little shading matters |
| `SAME_COLOR_DELTA_E` | 3 | swatches this alike form one color group (a unit and its sub-units) |

- **Color check** (header toggle): each label gets a verdict. *Confirmed*: its unit's color touches the text.
  *Leader*: its unit's color is nearby but not at the text, and nothing explains the text better (code over one
  formation, leader line to a small block of its own). *Conflict*: a near-twin code's color dominates the text and
  the read unit's color is absent or a sliver, so it was probably misread; the note suggests the twin. *Doubtful*:
  its color is nowhere near. Reads are never rewritten by color.
- **Click anywhere** on the map: the closest legend colors with percentages. Look-alike units share a color and are
  listed together; paper is ignored.
- `npm run scan:color -- <name> [--radius-factor 1.5]` reports how well color agrees with the labels, against a
  random-unit baseline, and writes `color-report.json` and `color-disagreements.jpg`.

Measured on Leadville (717 identified labels): the label's unit has a color block in the radius for 86% (a random other
unit: 35%) and touching the text for 53%; 20 conflicts remain. The unit with the nearest block is the label's only 29%
of the time, because a median of 19 of the 73 color groups lie within the radius. Color is a good flag for doubtful
reads and a weak identifier on its own. Reads by confidence: Claude high 90%, medium 76%, re-read 95%.

## Where it is weak

- **Recall.** Of ~1,400 candidate blobs, 717 became codes; many real labels are missed or unread.
- **Near-twin units** in the Pennsylvanian and Triassic groups (`IPee`/`IPe`, `TRPcs`/`TRPs`) still show conflicts; they
  may be misreads (a targeted `--reread` is the cheap test) or real.
- **Mixed or shaded backgrounds** hide color evidence; units whose swatches look identical cannot be told apart by color.
- **Text-only legend entries** (no swatch) are not map units and are skipped; the correlation chart is not read.
- Handwritten or very degraded scans are untested.

## Open items and next steps (as of 2026-10-26)

- [ ] **Triage the near-twin conflicts.** About 20 labels in Pennsylvanian and Triassic units (`IPee`/`IPe` x4,
  `TRPcs`/`TRPs` x3, `IPPm`/`IPm` x2, `IPm`/`IPe` x2, a few singles) sit on a near-twin's color.
  Look at their crops (`npm run scan:color -- <name>` writes `color-disagreements.jpg`), then test with a cheap targeted
  re-read: `npm run scan:ai -- USGS_I-999_2-prnt --reread IPee,IPe,IPm` (dry run first; about one call, a cent or two).
- [ ] **Cut the cost of the next scan.** About half of the candidate cells sent to Claude are "not a code" (place names,
  contour scribbles) and they are most of the output tokens. A local filter on ink color and shape (place names are
  blue or brown italics; labels are upright black sans-serif) is the next lever. Color *grouping* of the sheets was
  measured and rejected (see "Color on a scan").
- [ ] **Recall.** 717 of ~1,400 candidate blobs became codes; find out how many real labels are missed entirely.
- [ ] **A second map.** Everything here was tuned on one sheet. Another scan (older type, different legend layout)
  will show what is general. Handwritten and heavily degraded scans are untested.
- [ ] **`scripts/host/run-local.sh`** only runs `npm ci` when `node_modules/vite` is missing, so after dependency changes
  run `npm ci` yourself (a fix would reinstall when `package-lock.json` is newer than `node_modules`; `scripts/host/`
  is read-only inside the container, so it has to be edited on the PC).
- [ ] **`.devcontainer/.env.example`** shows as deleted in the maintainer's working tree and was deliberately not
  committed (the template should stay in the repo). Restore it with `git checkout .devcontainer/.env.example` or
  `git rm` it on purpose.

## Troubleshooting

- *"This scan was made by an older version (no swatch-sheet.png)"*: `npm run scan -- <pdf> --force`.
- *"ai-results.json belongs to an earlier scan"*: the blobs changed after a rescan, so old answers are not reused
  (identical API calls are still free from the cache). Run `scan:ai` again.
- *Could not overwrite searchable.pdf*: it is open in a viewer (Windows locks it); a timestamped copy is written instead.
- *The app says there are no saved results*: the PDF's bytes differ from the one scanned, or `.lab/scan/<name>/resolved.json` is missing.
- *Server not reachable* when running `scan:ai --run`: start `bash scripts/host/run-local.sh` first.
