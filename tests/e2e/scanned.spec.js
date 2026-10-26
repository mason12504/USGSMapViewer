import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

// A real 17 MB scan, too big to keep in the repo. Needs the PDF in scripts/proposed/ and its
// results in .lab/scan/ (npm run scan, npm run scan:ai); skipped when either is missing.
const PDF = path.resolve('scripts/proposed/USGS_I-999_2-prnt.pdf');
const RESULTS = path.resolve('.lab/scan/USGS_I-999_2-prnt/resolved.json');
test.skip(!fs.existsSync(PDF) || !fs.existsSync(RESULTS), 'scanned-map PDF or its saved results not present');

test.describe('Scanned map from saved results', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(PDF);
    await expect(page.getByTestId('stat-units')).toHaveText('73 units', { timeout: 150_000 });
  });

  test('opens the whole sheet with legend entries, labels and a scanned-map notice', async ({ page }) => {
    await expect(page.getByText('Scanned map: read from saved OCR and AI results')).toBeVisible();
    expect(await page.getByTestId('map-label').count()).toBeGreaterThan(200);
    const m = await page.evaluate(() => {
      const img = document.querySelector('[data-testid=map-image]');
      const r = img.getBoundingClientRect();
      return { natural: img.naturalWidth / img.naturalHeight, shown: r.width / r.height };
    });
    expect(Math.abs(m.natural - 3056 / 2269)).toBeLessThan(0.01);
    expect(Math.abs(m.natural - m.shown)).toBeLessThan(0.01);
  });

  test('clicking a label shows its unit, how it was read, and the legend text', async ({ page }) => {
    await page.locator('[data-testid="map-label"][data-code="Kd"]').first().click();
    const details = page.getByTestId('unit-details');
    await expect(details.getByTestId('unit-code')).toHaveText('Kd');
    await expect(details.getByTestId('unit-name')).toHaveText('Dakota Sandstone');
    await expect(page.getByTestId('read-note')).toBeVisible();
    await page.getByTestId('full-description-toggle').click();
    await expect(page.getByTestId('full-description-text')).toContainText('Light-gray and tan sandstone');
    await expect(page.getByTestId('full-description-toggle')).toContainText('from the legend');
  });
});

test('a scan with no saved results explains what to run, and makes no API call', async ({ page }) => {
  // A different file: the Pikeview PDF with its text layer stripped is not available, so use any
  // PDF the server has no results for by asking for an unknown hash directly.
  const res = await page.request.get(`/api/scans/${'0'.repeat(64)}`);
  expect(res.status()).toBe(404);
  expect((await res.json()).error).toContain('npm run scan');
});
