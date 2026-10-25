// Extract positioned text from a pdf.js page.
//
// Works on any pdf.js PDFPageProxy (browser or Node). Returns plain objects in
// page units (see geometry.js): {str, x0, y0, x1, y1, baseline, fontSize,
// fontName, bold, italic, angle}.
//
// NOTE: font names (needed for bold detection) are only available when the
// document was opened with `fontExtraProperties: true` AND fonts have been
// loaded, which happens during page.getOperatorList(). The pipeline calls
// getOperatorList() first for that reason.

import { applyMatrix, bboxOfPoints, multiply } from '../geometry.js';

const BOLD_RE = /bold|black|heavy|semibold|demi/i;
const ITALIC_RE = /italic|oblique/i;

export async function extractTextItems(page, viewport) {
  const content = await page.getTextContent({ includeMarkedContent: false });
  const fontInfo = new Map();
  const items = [];

  for (const raw of content.items) {
    if (!raw.str || !raw.str.trim()) continue;

    if (!fontInfo.has(raw.fontName)) {
      let realName = '';
      try {
        if (page.commonObjs.has(raw.fontName)) {
          realName = page.commonObjs.get(raw.fontName)?.name || '';
        }
      } catch {
        realName = '';
      }
      const style = content.styles[raw.fontName] || {};
      fontInfo.set(raw.fontName, {
        name: realName || style.fontFamily || raw.fontName,
        bold: BOLD_RE.test(realName),
        italic: ITALIC_RE.test(realName),
        ascent: style.ascent ?? 0.8,
        descent: style.descent ?? -0.2,
      });
    }
    const font = fontInfo.get(raw.fontName);

    // Text space -> page units. raw.transform already includes font size.
    const m = multiply(viewport.transform, raw.transform);
    const fontSize = Math.hypot(raw.transform[2], raw.transform[3]);
    // raw.width is in PDF units along the baseline; convert to text-space x.
    const scaleX = Math.hypot(raw.transform[0], raw.transform[1]) || 1;
    const w = raw.width / scaleX;
    const asc = font.ascent;
    const desc = font.descent;
    const corners = [
      applyMatrix(m, 0, desc),
      applyMatrix(m, w, desc),
      applyMatrix(m, w, asc),
      applyMatrix(m, 0, asc),
    ];
    const bb = bboxOfPoints(corners);
    const origin = applyMatrix(m, 0, 0);
    const angle = Math.atan2(m[1], m[0]);

    items.push({
      str: raw.str,
      x0: bb.x0,
      y0: bb.y0,
      x1: bb.x1,
      y1: bb.y1,
      baseline: origin[1],
      originX: origin[0],
      fontSize,
      fontName: font.name,
      bold: font.bold,
      italic: font.italic,
      angle,
    });
  }
  return items;
}

/**
 * Split multi-word items into one item per word, estimating word positions
 * proportionally. Unit codes on maps are usually their own text run, but some
 * PDFs pack "Qal Alluvium" into one run; splitting lets us find the code.
 */
export function splitWords(items) {
  const out = [];
  for (const it of items) {
    const s = it.str;
    if (!/\s/.test(s.trim()) || Math.abs(it.angle) > 0.05) {
      out.push({ ...it, str: s.trim() });
      continue;
    }
    const width = it.x1 - it.x0;
    const perChar = width / Math.max(1, s.length);
    const re = /\S+/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      out.push({
        ...it,
        str: m[0],
        x0: it.x0 + m.index * perChar,
        x1: it.x0 + (m.index + m[0].length) * perChar,
        splitFrom: it,
      });
    }
  }
  return out;
}

/**
 * Group items into visual lines (same baseline, roughly), sorted top-to-bottom
 * and left-to-right. Each line: {items, text, x0, x1, y0, y1, baseline}.
 */
export function groupLines(items, { tolerance = 0.35 } = {}) {
  const sorted = [...items].sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0);
  const lines = [];
  for (const it of sorted) {
    const tol = tolerance * it.fontSize;
    let line = null;
    for (let k = lines.length - 1; k >= 0 && k >= lines.length - 4; k--) {
      if (Math.abs(lines[k].baseline - it.baseline) <= tol) {
        line = lines[k];
        break;
      }
    }
    if (!line) {
      line = { items: [], baseline: it.baseline };
      lines.push(line);
    }
    line.items.push(it);
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x0 - b.x0);
    let text = '';
    let prev = null;
    for (const it of line.items) {
      if (prev) {
        const gap = it.x0 - prev.x1;
        if (gap > 0.15 * it.fontSize && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      }
      text += it.str;
      prev = it;
    }
    line.text = text.replace(/\s+/g, ' ').trim();
    line.x0 = Math.min(...line.items.map((i) => i.x0));
    line.x1 = Math.max(...line.items.map((i) => i.x1));
    line.y0 = Math.min(...line.items.map((i) => i.y0));
    line.y1 = Math.max(...line.items.map((i) => i.y1));
  }
  return lines;
}
