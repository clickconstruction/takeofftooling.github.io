'use strict';
// Labor & Price Book modal: Parts render, Assemblies book fetches + Elliot meta, search works.
const { test, expect } = require('@playwright/test');

test('labor book opens, assemblies load with Elliot prices, search returns results', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await page.locator('#labor-book-open-btn').click();
  await expect(page.locator('#labor-book-modal')).toHaveAttribute('aria-hidden', 'false');

  // Parts side renders tab buttons from state defaults
  await expect(page.locator('#labor-book-tabs button').first()).toBeVisible();

  // Assemblies side loads the committed book (with Elliot supplier data)
  await page.locator('.labor-book-section-btn[data-section="assemblies"]').click();
  await expect(page.locator('#mc-book-status')).toContainText('assemblies loaded', { timeout: 15000 });
  await expect(page.locator('#mc-book-status')).toContainText('Elliot prices applied');

  // Global search spans parts + assemblies
  await page.locator('#labor-book-global-search').fill('EMT');
  await expect(page.locator('#labor-book-search-results')).toBeVisible();
  await expect(page.locator('#labor-book-search-results')).toContainText(/EMT/i, { timeout: 10000 });

  expect(errors).toEqual([]);
});
