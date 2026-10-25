# Color & pattern matching (the "color compartment")

Everything about color lives in this folder. The rest of the app only calls
`analyzeColors()` and `identifyAt()` from `index.js`, so you can rework this
part without touching text parsing or the UI.

## Two strategies

| Strategy | File | Works on | How | Pikeview result |
|---|---|---|---|---|
| **Vector (exact)** | `vectorMatch.js` | Modern PDFs where unit polygons are vector fills (most maps made in Illustrator/ArcMap since ~2000) | Find the topmost filled path under the label, compare its *paint* (solid color or pattern-tile hash) with each legend swatch's paint. If the label sits outside its polygon, follow its leader line. | ~96% of labels agree |
| **Raster (approximate)** | `rasterMatch.js` | Scanned maps, or anything without vector fills | Build a small color palette from a ring of pixels around the label and compare with each swatch's palette (CIELAB distance). Pattern dots show up as secondary palette colors. | ~56% (baseline to improve) |

"Agree" means the color evidence points at the same unit as the printed label.
Disagreements are often legitimate: labels with leader lines, labels on
contacts, or map-maker typos ("Qa", "Kf?"). Look at them before "fixing" them.

## The paint idea

`src/lib/pdf/vectorShapes.js` walks the PDF drawing commands and records
every filled shape with its paint:

```js
{ kind: 'rgb', color: '#ffe7ce' }                                     // solid
{ kind: 'pattern', key: 'pat:709bd3ff', colors: ['#ffdd67', '#fb3199'] } // tile
```

Pattern keys hash the pattern tile's *contents*, not the PDF object name, so
the legend swatch and the map polygons match even if the PDF uses separate
pattern objects for each.

## Work loop

```bash
npm run color:lab -- fixtures/pikeview/OF-01-03_Pikeview_Geologic_Map.pdf
```

This prints accuracy for both strategies and the most common confusions, and
writes these to `.lab/` (gitignored):

- `*-labels.png`: the whole map, each label boxed green (agrees), red
  (disagrees, with what color says), or gray (unknown)
- `*-crop-NN.png`: close-ups of disagreements
- `*-report.json`: per-label details, including raster palettes

Unit tests for this folder are in `tests/unit/color.test.js` (small synthetic
shapes, so they're fast). The fixture test asserts a minimum vector agreement
on Pikeview, so a regression fails CI.

## Ideas to try next

- **Raster:** sample *inside* the polygon instead of a ring around the
  label (flood-fill from the label until the color changes), and compare the
  dot/stripe frequency, not just colors.
- **Raster:** learn per-map "ignore" colors automatically (topo linework,
  roads) instead of only the base-layer mask color.
- **Vector:** for labels that still disagree, try the nearest polygon edge
  within ~1 label height.
- **Patterns for the UI:** render the swatch tile on its own (the tile's
  operator list is in the paint) for crisp pattern previews at any zoom.
