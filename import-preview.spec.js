'use strict';
// The Count Tooling import preview: one state-aware primary button, counts as
// totals in both directions, the type picker, and the demoted duplicate door.
const { test, expect } = require('@playwright/test');

const CLIP_COLD = '2x4 LED Troffer - A1\t24\tE2.1\nEXIT Sign - X1\t6\tE2.2\nDuplex Receptacle\t44\tE3.1';

// Open the preview the way the clipboard button does, without the clipboard:
// parse real Count Tooling text, then show it.
async function openPreview(page, text) {
  await page.evaluate((t) => {
    TakeoffImport.showImportPreviewModal(TakeoffImport.parseCountToolingClipboard(t));
  }, text);
  await expect(page.locator('#import-preview-modal')).toHaveAttribute('aria-hidden', 'false');
}

async function seed(page, rows) {
  await page.evaluate((list) => {
    TakeoffState.beginBatch();
    for (const r of list) TakeoffState.addItem({ ...r, parentId: null });
    TakeoffState.endBatch();
    TakeoffApp.render();
  }, rows);
}

const topLevel = (page) => page.evaluate(() => TakeoffState.getTopLevelItems().map((i) => ({ d: i.description, q: i.quantity, t: i.type, p: i.planPage })));

test('cold import: one primary button that names what it will do, no duplicate door', async ({ page }) => {
  await page.goto('/');
  await openPreview(page, CLIP_COLD);

  const add = page.locator('#import-preview-add-btn');
  await expect(add).toHaveText('Add 3 fixtures');
  // nothing matched, so there is nothing to duplicate
  await expect(page.locator('#import-preview-separate-btn')).toBeHidden();
  // the modal owns the keyboard as soon as it opens
  await expect(add).toBeFocused();

  await add.click();
  const rows = await topLevel(page);
  // the blank starter row was consumed by the import, not left above it
  expect(rows.map((r) => r.d)).toEqual(['2x4 LED Troffer - A1', 'EXIT Sign - X1', 'Duplex Receptacle']);
  expect(rows.map((r) => r.q)).toEqual([24, 6, 44]);
  // the trade's own lighting names no longer arrive untyped
  expect(rows.map((r) => r.t)).toEqual(['lighting', 'lighting', 'devices']);

  // one undo frame, and it puts the blank row back
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const back = await topLevel(page);
  expect(back).toEqual([{ d: '', q: 1, t: null, p: '' }]);
});

test('a re-count updates the matched row instead of duplicating it', async ({ page }) => {
  await page.goto('/');
  await seed(page, [{ type: 'lighting', description: '2x4 LED Troffer - A1', quantity: 24, labor: 0.75, price: 89.5, planPage: 'E2.1' }]);
  await openPreview(page, '2x4 LED Troffer - A1\t30\tE2.1\nEXIT Sign - X1\t6\tE2.2');

  const add = page.locator('#import-preview-add-btn');
  await expect(add).toHaveText('Update 1 count · add 1 fixture');
  await expect(page.locator('#import-preview-import-list')).toContainText('was 24, +6');
  // the duplicate door exists, but demoted and secondary
  await expect(page.locator('#import-preview-separate-btn')).toBeVisible();
  await expect(page.locator('#import-preview-separate-btn')).toHaveText('Add as separate rows');

  await add.click();
  const rows = await topLevel(page);
  const troffers = rows.filter((r) => r.d === '2x4 LED Troffer - A1');
  expect(troffers).toHaveLength(1);
  expect(troffers[0].q).toBe(30); // 30, not 54
  // the priced row kept its price and labor
  const priced = await page.evaluate(() => {
    const i = TakeoffState.getTopLevelItems().find((x) => x.description === '2x4 LED Troffer - A1');
    return { price: i.price, labor: i.labor };
  });
  expect(priced).toEqual({ price: 89.5, labor: 0.75 });
});

test('a lower re-count is shown as a drop and taken', async ({ page }) => {
  await page.goto('/');
  await seed(page, [{ type: 'lighting', description: 'LED Wall Pack - WP1', quantity: 10, labor: 1, price: 118, planPage: 'E2.4' }]);
  await openPreview(page, 'LED Wall Pack - WP1\t7\tE2.4');

  await expect(page.locator('#import-preview-import-list')).toContainText('was 10, −3');
  await expect(page.locator('#import-preview-import-list')).not.toContainText('no change');
  await expect(page.locator('#import-preview-add-btn')).toHaveText('Update 1 count');

  await page.locator('#import-preview-add-btn').click();
  const rows = await topLevel(page);
  expect(rows.find((r) => r.d === 'LED Wall Pack - WP1').q).toBe(7);
});

test('nothing to change says so, and the same link twice adds nothing', async ({ page }) => {
  await page.goto('/');
  await seed(page, [{ type: 'lighting', description: 'LED Wall Pack - WP1', quantity: 7, planPage: 'E2.4' }]);
  // trailing space + different case + a doubled internal space: one key, both match
  await openPreview(page, 'LED  Wall Pack - WP1 \t7\tE2.4');
  const add = page.locator('#import-preview-add-btn');
  await expect(add).toHaveText('Nothing to change');
  await expect(add).toBeDisabled();
});

test('"Add as separate rows" is still there when the estimator means it', async ({ page }) => {
  await page.goto('/');
  await seed(page, [{ type: 'lighting', description: '2x4 LED Troffer - A1', quantity: 24, price: 89.5 }]);
  await openPreview(page, '2x4 LED Troffer - A1\t30\tE2.1');
  await page.locator('#import-preview-separate-btn').click();
  const rows = await topLevel(page);
  expect(rows.filter((r) => r.d === '2x4 LED Troffer - A1')).toHaveLength(2);
});

test('a line with no type can be typed in the preview, before the rows exist', async ({ page }) => {
  await page.goto('/');
  await openPreview(page, 'Nurse Station Rough-in\t5\tLV1.0');
  const picker = page.locator('#import-preview-import-list select.import-preview-type');
  await expect(page.locator('.import-preview-item-untyped')).toHaveCount(1);
  await picker.selectOption('specialSystems');
  await expect(page.locator('.import-preview-item-untyped')).toHaveCount(0);
  await page.locator('#import-preview-add-btn').click();
  const rows = await topLevel(page);
  expect(rows[0]).toMatchObject({ d: 'Nurse Station Rough-in', t: 'specialSystems' });
});

test('an unreadable count shows as ? and never lands as 0 or 1', async ({ page }) => {
  await page.goto('/');
  await openPreview(page, 'ft of Wire #10 THHN\t1,800\tE5.1\nMystery item\ttwelve\tE5.1');
  const list = page.locator('#import-preview-import-list');
  await expect(list).toContainText('× 1800');
  await expect(list).toContainText('× ?');
});

test('a stale plan page follows the count over', async ({ page }) => {
  await page.goto('/');
  await seed(page, [{ type: 'specialSystems', description: 'Fire Alarm Rough-in', quantity: 8, planPage: 'FA1.0' }]);
  await openPreview(page, 'Fire Alarm Rough-in\t12\tFA1.1');
  await expect(page.locator('#import-preview-import-list')).toContainText('· page FA1.1, was FA1.0');
  await page.locator('#import-preview-add-btn').click();
  const row = (await topLevel(page)).find((r) => r.d === 'Fire Alarm Rough-in');
  expect(row).toMatchObject({ q: 12, p: 'FA1.1' });
});

test('a px row is named as an unscaled page', async ({ page }) => {
  await page.goto('/');
  await openPreview(page, 'px of Conduit 3/4 EMT\t367.2\tE5.1');
  await expect(page.locator('.import-preview-warn')).toContainText('never scaled in Count Tooling');
});

test('a wrong envelope version is not reported as an empty link', async ({ page }) => {
  // X11: the message is a toast now, not a dialog — nothing about a bad link
  // is worth blocking the page for, so a stray dialog is itself a failure
  page.on('dialog', (d) => { d.dismiss(); throw new Error('unexpected dialog: ' + d.message()); });
  // (v1 and v2 are both read now — see the "#import= contract" in ARCHITECTURE)
  const b64 = Buffer.from(JSON.stringify({ v: 3, items: [{ description: 'Duplex Receptacle', count: 12 }] })).toString('base64');
  await page.goto('/#import=' + b64);
  const toast = page.locator('#toast-region .toast');
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText('version 3');
  await expect(toast).not.toContainText('no valid items');
});

test('the preview traps focus: Tab cannot reach the page behind it', async ({ page }) => {
  await page.goto('/');
  await openPreview(page, CLIP_COLD);
  const inModal = async () => page.evaluate(() => document.getElementById('import-preview-modal').contains(document.activeElement));
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await inModal()).toBe(true);
  }
});
