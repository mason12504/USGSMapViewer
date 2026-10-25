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

  test('shows the whole sheet, not a crop, with cross-section labels', async ({ page }) => {
    const m = await page.evaluate(() => {
      const img = document.querySelector('[data-testid=map-image]');
      const r = img.getBoundingClientRect();
      return { natural: img.naturalWidth / img.naturalHeight, shown: r.width / r.height };
    });
    expect(Math.abs(m.natural - 2592 / 3024)).toBeLessThan(0.01); // the whole page
    expect(Math.abs(m.natural - m.shown)).toBeLessThan(0.01);

    const all = await page.getByTestId('map-label').count();
    expect(all).toBeGreaterThan(528); // map labels + cross-section/chart labels
    await page.getByTestId('toggle-other-labels').uncheck();
    expect(await page.getByTestId('map-label').count()).toBe(528);
  });

  test('middle-mouse drag pans the sheet; the map-frame outline and zoom-to-map work', async ({ page }) => {
    await page.getByTestId('zoom-to-map').click();
    const scroller = page.getByTestId('map-scroller');
    const box = await scroller.boundingBox();
    const read = () => scroller.evaluate((el) => [el.scrollLeft, el.scrollTop]);
    const [l0, t0] = await read();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 - 80, { steps: 6 });
    await page.mouse.up({ button: 'middle' });
    const [l1, t1] = await read();
    expect(l1 - l0).toBeGreaterThan(100); // dragging left reveals what is to the right
    expect(t1 - t0).toBeGreaterThan(60);

    // A left-button drag pans too, and does not select what it started on.
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 240, { steps: 6 });
    await page.mouse.up();
    const [l2, t2] = await read();
    expect(l2 - l1).toBeGreaterThan(80);
    expect(t2 - t1).toBeGreaterThan(40);
    await expect(page.getByTestId('unit-details')).toHaveCount(0);

    await page.waitForTimeout(300); // clicks right after a drag are ignored
    // A plain click (no movement) still selects a label.
    await page.locator('[data-testid="map-label"][data-code="Ypp"]').first().click();
    await expect(page.getByTestId('unit-details')).toBeVisible();

    await expect(page.getByTestId('map-frame')).toHaveCount(0);
    await page.getByTestId('toggle-map-frame').check();
    await expect(page.getByTestId('map-frame')).toBeAttached();
  });
});
