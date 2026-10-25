import path from 'node:path';
import { expect, test } from '@playwright/test';

const PDF = path.resolve('fixtures/pikeview/OF-01-03_Pikeview_Geologic_Map.pdf');

test.describe('Pikeview map', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(PDF);
    await expect(page.getByTestId('stat-units')).toHaveText('26 units');
  });

  test('parses the legend and labels from the PDF', async ({ page }) => {
    await expect(page.getByTestId('map-image')).toBeVisible();
    const labels = page.getByTestId('map-label');
    expect(await labels.count()).toBeGreaterThan(330);
    await expect(page.getByTestId('legend-item')).toHaveCount(26);
  });

  test('clicking a label shows its unit, with a color check', async ({ page }) => {
    await page.locator('[data-testid="map-label"][data-code="Qsw"]').first().click();
    const details = page.getByTestId('unit-details');
    await expect(details.getByTestId('unit-code')).toHaveText('Qsw');
    await expect(details.getByTestId('unit-name')).toHaveText('Sheetwash deposits');
    await expect(details).toContainText('Holocene and late Pleistocene');
    await expect(details.getByTestId('color-check')).toBeVisible();
  });

  test('legend search + select highlights a unit', async ({ page }) => {
    await page.getByTestId('legend-search').fill('dawson');
    const item = page.locator('[data-testid="legend-item"][data-code="Kda"]');
    await item.click();
    await expect(page.getByTestId('unit-name')).toHaveText('Lower part of the Dawson Formation');
  });

  test('AI legend check runs against the MOCK API', async ({ page }) => {
    await page.getByRole('button', { name: 'AI legend check' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('MOCK response');
    await expect(dialog).toContainText('agree on 26 of 26');
  });

  test('screenshot for review', async ({ page }) => {
    await page.locator('[data-testid="map-label"][data-code="Kda"]').first().click();
    await page.getByTestId('toggle-color-check').check();
    await page.screenshot({ path: 'test-results/explorer.png' });
  });
});
