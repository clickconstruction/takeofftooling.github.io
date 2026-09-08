'use strict';
// X6: the zones of the Labor & Price Book that no search reached. The walks
// measured '1900 box', 'single pole switch', 'pull string', 'toggle switch',
// 'occ sensor', 'photocell', 'disconnect 60a', 'romex' and 'mac adapter' all
// returning nothing from the estimator's own book — the vocabulary (T2-09) was
// there, the content was not. These run against the live book, so they also
// cover the merge that puts the new sections into an existing workspace.
const { test, expect } = require('@playwright/test');

async function openBook(page) {
  await page.goto('/');
  await page.locator('#labor-book-open-btn').click();
  await expect(page.locator('#labor-book-modal')).toHaveAttribute('aria-hidden', 'false');
}

// Type a query and wait for the async (assemblies + supply house) halves, so a
// "no matches" line can never be read mid-flight.
async function search(page, term) {
  await page.locator('#labor-book-global-search').fill(term);
  await expect(page.locator('#labor-book-search-results')).toBeVisible();
  await expect(page.locator('.lb-search-loading')).toHaveCount(0, { timeout: 20000 });
}

const curatedNames = (page) =>
  page.locator('.lb-search-group[data-bucket="parts"] .lb-search-name').allTextContents();

test('X6 — "1900 box" finds the box in your own book, with hours on it', async ({ page }) => {
  await openBook(page);
  await search(page, '1900 box');

  const names = await curatedNames(page);
  expect(names.length).toBeGreaterThan(0);
  expect(names.join(' | ')).toMatch(/1900 box/i);

  // the point of the curated row is the hours the catalog does not carry
  const hrs = await page
    .locator('.lb-search-group[data-bucket="parts"] .lb-search-row')
    .first()
    .locator('.lb-search-num')
    .first()
    .textContent();
  expect(hrs).toMatch(/hrs/);
});

test('X6 — "mac adapter" reaches the MC connectors, which the catalog prices at zero hours', async ({ page }) => {
  await openBook(page);
  await search(page, 'mac adapter');

  const names = await curatedNames(page);
  expect(names.length).toBeGreaterThan(0);
  expect(names.join(' | ')).toMatch(/MC connector/i);

  // the supply house still answers with prices — this adds the hours beside it
  const rows = page.locator('.lb-search-group[data-bucket="parts"] .lb-search-row').first();
  await expect(rows.locator('.lb-search-context')).toContainText('MC and NM Connectors');
});

test('X6 — every query the walks measured at zero now returns curated hits', async ({ page }) => {
  await openBook(page);
  for (const term of [
    'single pole switch',
    '3 way switch',
    'toggle switch',
    'dimmer switch',
    'occ sensor',
    'photocell',
    'disconnect 60a',
    'romex',
    'pull string',
    '4 square box',
  ]) {
    await search(page, term);
    const names = await curatedNames(page);
    expect(names, `"${term}" found nothing in the estimator's own book`).not.toEqual([]);
  }
});

test('X6 — a book stored at the previous defaults version takes the new sections on boot', async ({ page }) => {
  // a v3 workspace: the whole shipped book minus everything X6 added
  await page.addInitScript(() => {
    localStorage.setItem(
      'takeoff-book',
      JSON.stringify({
        v: 1,
        savedAt: '2026-01-01T00:00:00.000Z',
        laborBook: { gear: { Switchboards: [{ name: '600a', labor: 16, price: '' }] }, devices: {}, lighting: {} },
        laborBookMeta: { defaultsVersion: 3, removedV: 2, removed: {}, removedLegacy: {} },
      })
    );
  });
  await page.goto('/');
  await page.waitForTimeout(800); // past the 400 ms book-save debounce

  const doc = await page.evaluate(() => JSON.parse(localStorage.getItem('takeoff-book')));
  expect(Object.keys(doc.laborBook.devices)).toContain('Boxes');
  expect(Object.keys(doc.laborBook.devices)).toContain('MC and NM Connectors');
  expect(Object.keys(doc.laborBook.lighting)).toContain('Photocells');
  expect(Object.keys(doc.laborBook.gear)).toContain('Disconnects');
  expect(doc.laborBookMeta.defaultsVersion).toBe(4);
  // the boot merge alone must not move the book's clock past another device's
  expect(doc.savedAt).toBe('2026-01-01T00:00:00.000Z');
});
