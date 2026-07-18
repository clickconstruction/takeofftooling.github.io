'use strict';
// App boot + manifest basics: loads clean, add a row, edit persists, undo works.
const { test, expect } = require('@playwright/test');

test('app boots without console errors and manifest edits persist', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await expect(page).toHaveTitle('Takeoff Tooling');

  // seed row exists; type a description (auto-sets quantity to 1)
  const desc = page.locator('input[data-field="description"]').first();
  await desc.fill('2x4 Troffer');
  await desc.dispatchEvent('change');
  await expect(page.locator('input[data-field="description"]').first()).toHaveValue('2x4 Troffer');

  // add a second row
  await page.getByRole('button', { name: 'Add Row' }).click();
  expect(await page.locator('input[data-field="description"]').count()).toBeGreaterThanOrEqual(2);

  // state persisted through the storage adapter
  // note: app globals are top-level consts (global lexical scope), not window.*
  const persisted = await page.evaluate(() => {
    TakeoffState.persistNow();
    const ws = JSON.parse(localStorage.getItem('takeoff-workspace'));
    return ws && ws.v === 1 && ws.manifest.some((m) => m.description === '2x4 Troffer');
  });
  expect(persisted).toBe(true);

  // undo #1 removes the added row, undo #2 reverts the description edit
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('input[data-field="description"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('input[data-field="description"]').first()).not.toHaveValue('2x4 Troffer');

  expect(errors).toEqual([]);
});

test('structured #import= handoff shows the preview modal', async ({ page }) => {
  const payload = { v: 1, source: 'counttooling', items: [{ description: 'Duplex Receptacle', count: 12, page: '2' }] };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  await page.goto('/#import=' + b64);
  const modal = page.locator('#import-preview-modal');
  await expect(modal).toHaveAttribute('aria-hidden', 'false');
  await expect(modal).toContainText('Duplex Receptacle');
  await page.locator('#import-preview-all-btn').click();
  // imported item is appended after the blank seed row — assert via state
  await expect.poll(() =>
    page.evaluate(() => TakeoffState.getTopLevelItems().some((i) => i.description === 'Duplex Receptacle'))
  ).toBe(true);
});
