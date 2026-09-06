'use strict';
// Organize Categories view (preview): opens from the book modal, renders one
// lane per tab from the real book, supports place mode and the editor drawer,
// and returns to the book.
const { test, expect } = require('@playwright/test');

test('organize view opens from the book, boards render, drawer and place mode work', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await page.locator('#labor-book-open-btn').click();
  await page.locator('#labor-book-organize-btn').click();

  // book modal closed, one lane per tab with the conduit groups from defaults
  await expect(page.locator('#labor-book-modal')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.org-lane')).toHaveCount(6);
  const conduitLane = page.locator('.org-lane', { has: page.locator('.org-lane-name', { hasText: 'Conduit' }) });
  await expect(conduitLane.locator('.org-gname', { hasText: 'Fittings' })).toBeVisible();
  // every lane ends with an Ungrouped bucket
  await expect(page.locator('.org-group.org-ungrouped')).toHaveCount(6);

  // clicking a section opens the editor drawer with its rows
  const chip = page.locator('.org-chip', { hasText: 'Switchboards' }).first();
  await chip.click();
  await expect(page.locator('#org-drawer')).toBeVisible();
  await expect(page.locator('.org-drawer-name')).toHaveValue('Switchboards');
  await expect(page.locator('.org-rows-table tbody tr').first()).toBeVisible();
  await page.locator('.org-drawer-close').click();
  await expect(page.locator('#org-drawer')).toBeHidden();

  // ✥ arms place mode; Escape cancels it
  await chip.hover();
  await chip.locator('[data-act="pick-sec"]').click();
  await expect(page.locator('#org-place-banner')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#org-place-banner')).toBeHidden();

  // place a section into another tab's Ungrouped bucket, then discard
  await chip.hover();
  await chip.locator('[data-act="pick-sec"]').click();
  const wireLoose = page.locator('.org-lane', { has: page.locator('.org-lane-name', { hasText: 'Wire' }) })
    .locator('.org-group.org-ungrouped .org-group-head');
  await wireLoose.click();
  await expect(page.locator('#org-summary')).toContainText('1 pending change');
  await page.locator('#org-discard-btn').click();
  await expect(page.locator('#org-summary')).toContainText('No pending changes');

  // back returns to the manifest with the book modal reopened
  await page.locator('#org-back-btn').click();
  await expect(page.locator('#labor-book-modal')).toHaveAttribute('aria-hidden', 'false');

  expect(errors).toEqual([]);
});
