'use strict';
// X11 — one feedback system. Before this the app said "that worked" six ways:
// a native alert(), a ✓ swapped into a button for 1.2 s, a status line the
// next render wiped, a bar under the header, or nothing. This pins the shape
// of the replacement: ONE aria-live region, outside #main-content, stacking at
// most three, dismissible, and surviving a render().
const { test, expect } = require('@playwright/test');

const region = (page) => page.locator('#toast-region');
const toasts = (page) => page.locator('#toast-region .toast');

async function seedRow(page, item) {
  return page.evaluate((it) => {
    const row = TakeoffState.addItem(Object.assign({ parentId: null, quantity: 1, labor: 0, planPage: '' }, it));
    TakeoffApp.render();
    return row.id;
  }, item);
}

test('there is exactly one polite live region, and it is not inside #main-content', async ({ page }) => {
  await page.goto('/');
  await expect(region(page)).toHaveCount(1);
  await expect(region(page)).toHaveAttribute('aria-live', 'polite');
  await expect(region(page)).toHaveAttribute('role', 'status');
  const placement = await page.evaluate(() => {
    const el = document.getElementById('toast-region');
    return {
      parentIsBody: el.parentElement === document.body,
      inMain: !!document.getElementById('main-content').contains(el),
      inApp: !!document.getElementById('app').contains(el),
      liveRegions: document.querySelectorAll('[aria-live]').length,
    };
  });
  expect(placement).toEqual({ parentIsBody: true, inMain: false, inApp: false, liveRegions: 1 });
});

test('three real actions all report into the same region', async ({ page }) => {
  await page.context().route(/supabase/i, (r) => r.abort());
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');

  // 1. a book add — the receipt that used to be #labor-book-flash
  const fixtureId = await seedRow(page, { type: 'lighting', description: 'Panel LP-2', quantity: 4 });
  await page.evaluate((id) => {
    TakeoffApp.showLaborBookModal(id);
    TakeoffLaborBookTargets.addEntryToTarget({ description: '2x4 LED Troffer', labor: 0.5, price: '84.20' });
  }, fixtureId);
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page).first()).toContainText('Added 2x4 LED Troffer');
  await expect(toasts(page).first()).toContainText('×4 under Panel LP-2');

  // 2. copying the purchase list — the 1.5 s "Copied!" button swap
  await page.evaluate(() => {
    TakeoffApp.hideLaborBookModal();
    TakeoffApp.render();
  });
  await page.locator('#purchase-list-toggle-btn').click();
  await page.locator('#purchase-list-copy-btn').click();
  await expect(toasts(page)).toHaveCount(2);
  await expect(toasts(page).nth(1)).toContainText('Purchase list copied');
  // and the button is still the verb, not a receipt that has to time out
  await expect(page.locator('#purchase-list-copy-btn')).toHaveText('Copy');

  // 3. an import link from the future — one of the alert() dialogs (v1 and
  //    v2 are both read now, so the refused version is 3)
  page.on('dialog', (d) => { d.dismiss(); throw new Error('unexpected dialog: ' + d.message()); });
  await page.evaluate(() => {
    const b64 = btoa(JSON.stringify({ v: 3, items: [{ description: 'Duplex Receptacle', count: 12 }] }));
    location.hash = '#import=' + b64; // the hashchange listener does the rest
  });
  await expect(toasts(page)).toHaveCount(3);
  await expect(toasts(page).nth(2)).toContainText('version 3');

  // all three landed in ONE region, in the order they happened
  await expect(region(page)).toHaveCount(1);
});

test('the stack tops out at three, dismisses on click, and a render() does not wipe it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    for (const n of [1, 2, 3, 4]) TakeoffToast.show('Notice number ' + n, { timeout: 0 });
  });
  // the fourth pushes the first out rather than growing a column
  await expect(toasts(page)).toHaveCount(3);
  await expect(region(page)).not.toContainText('Notice number 1');
  await expect(region(page)).toContainText('Notice number 4');

  // a full re-render replaces #main-content wholesale; the region is elsewhere
  await page.evaluate(() => TakeoffApp.render());
  await expect(toasts(page)).toHaveCount(3);
  await expect(region(page)).toContainText('Notice number 4');

  // every toast can be put away by hand
  await toasts(page).first().locator('.toast-dismiss').click();
  await expect(toasts(page)).toHaveCount(2);
  await expect(region(page)).not.toContainText('Notice number 2');
});

test('a toast times out, an action button runs and closes it, and a keyed one replaces in place', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => TakeoffToast.show('Gone shortly', { timeout: 300 }));
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page)).toHaveCount(0, { timeout: 5000 });

  await page.evaluate(() => {
    window.__acted = 0;
    TakeoffToast.show('Undo that?', { timeout: 0, action: { label: 'Undo', onClick: () => { window.__acted++; } } });
  });
  await toasts(page).first().locator('.toast-action').click();
  expect(await page.evaluate(() => window.__acted)).toBe(1);
  await expect(toasts(page)).toHaveCount(0);

  // a run of adds is one piece of news, not three lines of it
  await page.evaluate(() => {
    TakeoffToast.show('Added part one', { key: 'book-add', timeout: 0 });
    TakeoffToast.show('Added part two', { key: 'book-add', timeout: 0 });
    TakeoffToast.show('Added part three', { key: 'book-add', timeout: 0 });
  });
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page)).toContainText('Added part three');
});

test('the stack never sits on the page and stays readable at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.evaluate(() => TakeoffToast.show('The book’s supply-house prices are from the file published 2025-11-04 (5,946 parts).', { timeout: 0 }));
  const box = await toasts(page).first().boundingBox();
  expect(box.width).toBeLessThanOrEqual(375);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(812);

  // the region itself takes no clicks: the bid underneath is still reachable
  const passesThrough = await page.evaluate(() => {
    const r = document.getElementById('toast-region').getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + 2, r.top - 4);
    return getComputedStyle(document.getElementById('toast-region')).pointerEvents === 'none' && !!hit;
  });
  expect(passesThrough).toBe(true);
  // no horizontal overflow from the toast
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('no alert() survives on the paths the estimator can keep working through', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.context().route(/supabase/i, (r) => r.abort());
  await page.goto('/');

  // the book with no fixture chosen (was a page-blocking alert)
  await seedRow(page, { type: 'conduit', description: '3/4" EMT Homerun', quantity: 220 });
  await page.evaluate(() => {
    TakeoffApp.showLaborBookModal();
    TakeoffLaborBookTargets.addEntryToTarget({ description: 'Coupling', labor: 0.1, price: '1.10' });
  });
  await expect(toasts(page).last()).toContainText('Pick a fixture');
  await expect(toasts(page).last()).toHaveAttribute('data-kind', 'warn');

  // a corrupted share link (was an alert too)
  await page.evaluate(() => {
    location.hash = '#d=not-base64!!';
  });
  await expect(page.locator('#app-notice')).toContainText('could not be opened');

  expect(dialogs, 'nothing on these paths blocks the page any more').toEqual([]);
});
