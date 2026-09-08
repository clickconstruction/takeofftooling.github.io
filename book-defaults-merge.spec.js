'use strict';
// Boot-time reconciliation of a stored Labor & Price Book with the shipped
// defaults (js/state.js upgradeLaborBook → js/laborBookMerge.js).
const { test, expect } = require('@playwright/test');

const readBook = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('takeoff-book') || 'null'));

function seedBook(page, doc) {
  return page.addInitScript((d) => localStorage.setItem('takeoff-book', JSON.stringify(d)), doc);
}

test('a book stored with the duplicate PVC GLUE rows converges on the renamed QUART / PINT rows', async ({ page }) => {
  await seedBook(page, {
    v: 1,
    savedAt: '2026-01-01T00:00:00.000Z',
    laborBook: {
      conduit: {
        'PVC GLUE': [
          { name: 'PVC GLUE', labor: 5, price: '' },
          { name: 'PVC GLUE', labor: 5, price: '' },
        ],
        STRAP: [{ name: '1/2" STRAP', labor: 9, price: '', edited: true }],
      },
    },
    laborBookMeta: { defaultsVersion: 2, removed: {} },
  });
  await page.goto('/');
  await page.waitForTimeout(800); // past the 400 ms book-save debounce

  const doc = await readBook(page);
  // v3 renamed the two same-named rows by can size; the stale pair is dropped
  // and both renamed defaults adopted (neither is proposed as a correction)
  expect(doc.laborBook.conduit['PVC GLUE']).toEqual([
    { name: 'PVC GLUE QUART', labor: 15, price: '' },
    { name: 'PVC GLUE PINT', labor: 5, price: '' },
  ]);
  expect(doc.laborBook.conduit.STRAP[0].labor).toBe(9); // the user's edit stands
  // a merge-only save must not move the book's clock ahead of another
  // device's copy in the cloud
  expect(doc.savedAt).toBe('2026-01-01T00:00:00.000Z');
});

test('a partial book gets its missing sections back instead of being recorded as current', async ({ page }) => {
  await seedBook(page, {
    v: 1,
    savedAt: '2026-01-03T00:00:00.000Z',
    laborBook: { gear: { Switchboards: [{ name: '600a', labor: 16, price: '' }] } },
    laborBookMeta: null,
  });
  await page.goto('/');
  await page.waitForTimeout(800);

  const doc = await readBook(page);
  expect(Object.keys(doc.laborBook.conduit).length).toBeGreaterThan(40);
  expect(Object.keys(doc.laborBook.wire).length).toBeGreaterThan(2);
  expect(doc.savedAt).toBe('2026-01-03T00:00:00.000Z');
});

test('an edit after the boot merge does stamp a fresh save time', async ({ page }) => {
  await seedBook(page, {
    v: 1,
    savedAt: '2026-01-01T00:00:00.000Z',
    laborBook: { conduit: { 'PVC GLUE': [{ name: 'PVC GLUE', labor: 5, price: '' }, { name: 'PVC GLUE', labor: 5, price: '' }] } },
    laborBookMeta: { defaultsVersion: 2, removed: {} },
  });
  await page.goto('/');
  await page.waitForTimeout(800);
  expect((await readBook(page)).savedAt).toBe('2026-01-01T00:00:00.000Z');

  await page.evaluate(() => TakeoffState.updateLaborBookRow('conduit', 'PVC GLUE', 0, { labor: 12 }));
  await page.waitForTimeout(800);
  const doc = await readBook(page);
  expect(doc.savedAt).not.toBe('2026-01-01T00:00:00.000Z');
  expect(doc.laborBook.conduit['PVC GLUE'][0].labor).toBe(12);
});
