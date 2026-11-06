import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { E2E_LIBRARY } from './global-setup.js';

const MANITOU = path.resolve('fixtures/manitou/OF-03-19.pdf');
const PIKEVIEW = path.resolve('fixtures/pikeview/OF-01-03_Pikeview_Geologic_Map.pdf');

test.describe('home, catalog and map URLs', () => {
  test('home: welcome banner, then the upload box, then the catalog banner', async ({ page }) => {
    await page.goto('/');
    const [welcome, upload, banner] = await Promise.all(
      ['welcome-banner', 'upload-box', 'catalog-banner'].map((id) => page.getByTestId(id).boundingBox()),
    );
    await expect(page.getByTestId('welcome-banner')).toContainText('Welcome');
    expect(welcome.y + welcome.height).toBeLessThanOrEqual(upload.y);
    expect(upload.y + upload.height).toBeLessThanOrEqual(banner.y);
    await page.getByTestId('catalog-banner').click();
    await expect(page).toHaveURL(/\/catalog$/);
  });

  test('catalog: a card per library map, with thumbnails; a card opens its own URL', async ({ page }) => {
    await page.goto('/catalog');
    const cards = page.getByTestId('catalog-card');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('[data-testid=catalog-card][data-id=manitou_springs]')).toContainText('Manitou Springs');
    // The first visit renders the thumbnail from the plate and saves it; a card never stays blank.
    await expect(page.locator('[data-id=pikeview] img')).toHaveJSProperty('complete', true);
    await expect.poll(async () => (await page.request.get('/api/library/pikeview/thumb')).status(), { timeout: 90_000 }).toBe(200);

    await page.locator('[data-testid=catalog-card][data-id=pikeview]').click();
    await expect(page).toHaveURL(/\/mapviewer\/pikeview$/);
    await expect(page.getByTestId('stat-units')).toHaveText('26 units');
    await expect(page.getByTestId('nav-current-map')).toContainText('Pikeview');
  });

  test('a map URL works on its own, survives a reload, and the navbar leads back', async ({ page }) => {
    await page.goto('/mapviewer/pikeview');
    await expect(page.getByTestId('stat-units')).toHaveText('26 units');
    await page.reload();
    await expect(page.getByTestId('stat-units')).toHaveText('26 units');
    await page.getByTestId('nav-catalog').click();
    await expect(page).toHaveURL(/\/catalog$/);
    await page.goBack();
    await expect(page.getByTestId('stat-units')).toHaveText('26 units');
    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('welcome-banner')).toBeVisible();
  });

  test('an unknown map id says so and links back to the catalog', async ({ page }) => {
    await page.goto('/mapviewer/no_such_map');
    await expect(page.getByTestId('viewer-error')).toContainText('no_such_map');
    await page.getByRole('link', { name: 'Back to the catalog' }).click();
    await expect(page).toHaveURL(/\/catalog$/);
  });

  test('dropping a map already in the library says it was identified and shows its card; nothing is saved twice', async ({ page }) => {
    const before = (await (await page.request.get('/api/library')).json()).length;
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(MANITOU);
    await expect(page).toHaveURL(/\/catalog$/);
    await expect(page.getByTestId('identified-banner')).toContainText('Map identified as “Manitou Springs”');
    await expect(page.locator('[data-testid=catalog-card][data-highlighted]')).toHaveAttribute('data-id', 'manitou_springs');
    expect((await (await page.request.get('/api/library')).json()).length).toBe(before);
  });

  test('dropping a new map saves it, opens it at its own URL, and lists it in the catalog', async ({ page }) => {
    // Same map, different bytes (a new title), so it is a new file to the library.
    const doc = await PDFDocument.load(fs.readFileSync(PIKEVIEW));
    doc.setTitle(`e2e copy ${Date.now()}`);
    const bytes = Buffer.from(await doc.save());
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles({ name: 'E2E Upload Copy.pdf', mimeType: 'application/pdf', buffer: bytes });
    await expect(page).toHaveURL(/\/mapviewer\/e2e_upload_copy$/);
    await expect(page.getByTestId('stat-units')).toHaveText('26 units');
    await page.goto('/catalog');
    await expect(page.locator('[data-testid=catalog-card][data-id=e2e_upload_copy]')).toBeVisible();
  });

  test('something that is not a PDF is refused with a message', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
    await expect(page.getByTestId('upload-error')).toContainText('not a PDF');
    await expect(page).toHaveURL(/\/$/);
  });
});

test('a map that comes as a plate + a pamphlet: saved in its own folder, merged, opened; the same pair again is recognized', async ({ page }) => {
  // Split the Manitou publication back into its two parts (pages 1-46 = pamphlet, page 47 = plate).
  const src = await PDFDocument.load(fs.readFileSync(MANITOU));
  const part = async (indices) => {
    const d = await PDFDocument.create();
    (await d.copyPages(src, indices)).forEach((p) => d.addPage(p));
    return Buffer.from(await d.save());
  };
  const pamphlet = await part([...Array(46).keys()]);
  const plate = await part([46]);
  const files = (form) => form.getByTestId('pamphlet-input').setInputFiles({ name: 'pamphlet.pdf', mimeType: 'application/pdf', buffer: pamphlet })
    .then(() => form.getByTestId('plate-input').setInputFiles({ name: 'Plate 319.pdf', mimeType: 'application/pdf', buffer: plate }));

  await page.goto('/');
  await expect(page.getByTestId('plate-input')).toHaveCount(0); // the form is tucked away until asked for
  await page.getByTestId('two-file-toggle').click();
  await expect(page.getByTestId('pair-submit')).toBeDisabled();
  await files(page);
  await expect(page.getByTestId('pair-title')).toHaveValue('Plate 319'); // from the plate's name, editable
  await page.getByTestId('pair-title').fill('E2E Pair Map');
  await page.getByTestId('pair-submit').click();

  await expect(page).toHaveURL(/\/mapviewer\/e2e_pair_map$/);
  await expect(page.getByTestId('stat-units')).toHaveText('48 units', { timeout: 120_000 });
  await expect(page.getByTestId('stat-descriptions')).toHaveText('48 full descriptions'); // the pamphlet came along

  const folder = path.join(E2E_LIBRARY, 'e2e_pair_map');
  expect(fs.readdirSync(folder).sort()).toEqual(['merged.pdf', 'pamphlet.pdf', 'plate.pdf']);

  await page.goto('/');
  await page.getByTestId('two-file-toggle').click();
  await files(page);
  await page.getByTestId('pair-submit').click();
  await expect(page).toHaveURL(/\/catalog$/);
  await expect(page.getByTestId('identified-banner')).toContainText('Map identified as “E2E Pair Map”');
  await expect(page.locator('[data-testid=catalog-card][data-highlighted] ')).toContainText('plate + pamphlet');
});
