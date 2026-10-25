import path from 'node:path';
import { expect, test } from '@playwright/test';

// A whole publication: 46 report pages + the plate as page 47.
const PDF = path.resolve('fixtures/manitou/OF-03-19.pdf');

test.describe('Manitou Springs publication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(PDF);
    await expect(page.getByTestId('stat-units')).toHaveText('48 units', { timeout: 120_000 });
  });

  test('finds the plate and attaches the report descriptions', async ({ page }) => {
    await expect(page.getByTestId('stat-descriptions')).toHaveText('48 full descriptions');
    await expect(page.getByText('plate p.47 of 47')).toBeVisible();
  });

  test('map image keeps its aspect ratio (no stretching)', async ({ page }) => {
    const m = await page.evaluate(() => {
      const img = document.querySelector('[data-testid=map-image]');
      const r = img.getBoundingClientRect();
      return { natural: img.naturalWidth / img.naturalHeight, shown: r.width / r.height };
    });
    expect(Math.abs(m.natural - m.shown)).toBeLessThan(0.01);
  });

  test('brief by default, full report text on demand, in a scrollable box and a reader', async ({ page }) => {
    await page.locator('[data-testid="map-label"][data-code="Ypp"]').first().click();
    const details = page.getByTestId('unit-details');
    await expect(details.getByTestId('unit-name')).toHaveText('Pikes Peak Granite');
    await expect(details).toContainText('Middle Proterozoic');
    await expect(page.getByTestId('full-description-text')).toHaveCount(0); // brief only

    await page.getByTestId('full-description-toggle').click();
    await expect(page.getByTestId('full-description-text')).toContainText('Pink, light reddish-brown');
    const scrolls = await page.getByTestId('full-description-text').evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrolls).toBe(true);

    await page.getByTestId('full-description-expand').click();
    await expect(page.getByTestId('full-description-modal')).toContainText('Report page 23');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('full-description-modal')).toHaveCount(0);
  });

  test('legend search finds a unit that has a full description', async ({ page }) => {
    await page.getByTestId('legend-search').fill('lykins');
    await page.locator('[data-testid="legend-item"][data-code="TRPl"]').click();
    await page.getByTestId('full-description-toggle').click();
    await expect(page.getByTestId('full-description-text')).toContainText('Nonresistant');
  });

  test('full plate view shows the whole sheet with cross-section labels', async ({ page }) => {
    const mapLabels = await page.getByTestId('map-label').count();
    await page.getByTestId('view-plate').click();
    await expect(page.getByTestId('plate-loading')).toHaveCount(0, { timeout: 120_000 });
    await expect(page.getByTestId('map-frame')).toBeAttached();
    expect(await page.getByTestId('map-label').count()).toBeGreaterThan(mapLabels);

    const m = await page.evaluate(() => {
      const img = document.querySelector('[data-testid=map-image]');
      const r = img.getBoundingClientRect();
      return { natural: img.naturalWidth / img.naturalHeight, shown: r.width / r.height };
    });
    expect(Math.abs(m.natural - 2592 / 3024)).toBeLessThan(0.01); // the whole sheet
    expect(Math.abs(m.natural - m.shown)).toBeLessThan(0.01);

    await page.getByTestId('toggle-other-labels').uncheck();
    expect(await page.getByTestId('map-label').count()).toBe(mapLabels);
  });
});
