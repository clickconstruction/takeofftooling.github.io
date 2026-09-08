'use strict';
// Update Supplier Prices: loading a price file may never shrink the book's
// supply-house catalog, and may never move a part number to another MC item.
// J13 findings 1 and 2 (docs/journeys/maintain-catalog-and-team.md).
const { test, expect } = require('@playwright/test');

const TABS = ['gear', 'lighting', 'devices', 'conduit', 'wire', 'specialSystems'];

// Supplier sections and parts per tab, straight from the patched book.
async function catalog(page) {
  return page.evaluate(async (tabs) => {
    McBook.invalidate();
    await McBook.ensureLoaded();
    const per = {};
    let sections = 0;
    let parts = 0;
    for (const t of tabs) {
      const s = McBook.elliotSectionsForTab(t);
      const entries = s.reduce((n, x) => n + x.entries.length, 0);
      per[t] = { sections: s.length, parts: entries };
      sections += s.length;
      parts += entries;
    }
    return { per, sections, parts, importDate: McBook.elliotImportDate() };
  }, TABS);
}

async function openBook(page) {
  await page.locator('#labor-book-open-btn').click();
  await expect(page.locator('#labor-book-modal')).toHaveAttribute('aria-hidden', 'false');
  await page.locator('.labor-book-section-btn[data-section="assemblies"]').click();
  await expect(page.locator('#mc-book-status')).toContainText('assemblies loaded', { timeout: 30000 });
}

test('processing the bundled price file keeps every supply-house section and mapping', async ({ page }) => {
  test.setTimeout(180000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // the aborted cloud requests below are the test's own doing, not the app's
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED/.test(m.text())) errors.push(m.text()); });
  // cloud is production — never touch it from a test
  await page.context().route(/supabase/i, (r) => r.abort());
  page.on('dialog', (d) => d.accept());

  await page.goto('/');
  await openBook(page);

  const before = await catalog(page);
  expect(before.sections, 'the committed book ships a supplier catalog').toBeGreaterThan(0);
  expect(before.parts).toBeGreaterThan(1000);

  const committedMappings = await page.evaluate(async () => {
    const res = await fetch('mc-assemblies/elliot-item-mappings.json');
    return (await res.json()).mappings || {};
  });

  // the tool is admin-gated; this test drives it, so unhide the button
  await page.evaluate(() => {
    const btn = document.getElementById('mc-elliot-update-btn');
    btn.removeAttribute('hidden');
    btn.classList.remove('lb-hidden');
  });
  await page.locator('#mc-elliot-update-btn').click();
  await expect(page.locator('#mc-elliot-modal')).toHaveAttribute('aria-hidden', 'false');

  await page.locator('#mc-elliot-load-bundled').click();
  // T2-18 rewrote this line: "applied locally ✓" became a sentence
  await expect(page.locator('#mc-elliot-body')).toContainText('is loaded on this computer', { timeout: 120000 });

  // the overlay is stored, and its parts list survived the save
  const overlay = await page.evaluate(async () => {
    const base = JSON.parse(localStorage.getItem('mc-elliot-overlay'));
    const items = await McElliotState.loadOverlayItems();
    return { count: base.newItemsCount, incomplete: !!base.newItemsIncomplete, loaded: items ? items.length : 0, prices: Object.keys(base.itemPrices || {}).length };
  });
  expect(overlay.incomplete, 'the parts list was stored, not dropped').toBe(false);
  expect(overlay.loaded).toBe(overlay.count);
  expect(overlay.prices).toBeGreaterThan(0);

  // finding 1: the catalog must not shrink — immediately...
  const after = await catalog(page);
  expect(after.sections).toBeGreaterThanOrEqual(before.sections);
  expect(after.parts).toBeGreaterThanOrEqual(before.parts);
  for (const t of TABS) {
    expect(after.per[t].sections, `${t} sections`).toBeGreaterThanOrEqual(before.per[t].sections);
    expect(after.per[t].parts, `${t} parts`).toBeGreaterThanOrEqual(before.per[t].parts);
  }

  // finding 2: no committed mapping moved to a different MC item
  const moved = await page.evaluate((committed) => {
    const now = McElliotState.getEffectiveMappings();
    return Object.entries(committed)
      .filter(([pn, item]) => now[pn] !== undefined && Number(now[pn]) !== Number(item))
      .map(([pn, item]) => ({ pn, was: item, now: now[pn] }));
  }, committedMappings);
  expect(moved, 'an automatic match replaced a saved one').toEqual([]);

  // one supplier part number prices one MC item, in the live overlay
  const dupPartNumbers = await page.evaluate(() => {
    const sources = JSON.parse(localStorage.getItem('mc-elliot-overlay')).itemPartNumbers || {};
    const owner = new Map();
    const dups = [];
    for (const [itemNum, pn] of Object.entries(sources)) {
      if (owner.has(pn)) dups.push({ pn, items: [owner.get(pn), itemNum] });
      else owner.set(pn, itemNum);
    }
    return { dups, priced: Object.keys(sources).length };
  });
  expect(dupPartNumbers.priced).toBeGreaterThan(0);
  expect(dupPartNumbers.dups, 'one supplier part priced two MC items').toEqual([]);

  // held-back guesses are counted separately and land in the review list
  const heldConsistent = await page.evaluate(() => {
    const shown = document.body.textContent.includes('Held back');
    const queued = McElliotState.getQueue().filter((q) => q.heldPartNumber).length;
    return { shown, queued };
  });
  expect(heldConsistent.shown).toBe(heldConsistent.queued > 0);

  // finding 9: a part whose price did not move keeps the date it already had,
  // instead of every one of them reading "priced today"
  const dates = await page.evaluate(async () => {
    const published = await (await fetch('mc-assemblies/elliot-price-overlay.json')).json();
    const publishedDay = String(published.importedAt).slice(0, 10);
    const priorPrice = new Map(published.newItems.map((it) => [it[2], it[3]]));
    const items = await McElliotState.loadOverlayItems();
    let kept = 0;
    let restamped = 0;
    for (const it of items) {
      if (priorPrice.get(it[2]) !== it[3]) continue;
      if (it[4] === publishedDay) kept++;
      else restamped++;
    }
    return { kept, restamped, publishedDay };
  });
  expect(dates.kept, 'unchanged parts keep the published price date').toBeGreaterThan(1000);
  expect(dates.restamped, 'a part whose price never moved was re-dated today').toBe(0);

  // finding 11: the file that leaves this computer carries no local bookkeeping
  const sanitized = await page.evaluate(async () => Object.keys(McElliotCore.sanitizeOverlayForDownload(await McElliotState.getFullOverlay())));
  for (const field of ['newItemsCount', 'categoryCounts', 'newItemsIncomplete', 'newItemsTruncated', 'allCats']) {
    expect(sanitized, `${field} left the building`).not.toContain(field);
  }

  // finding 11/12: every download reports its size against the file it replaces
  // X11: confirmations now land in the app's one feedback region; the status
  // line keeps progress and refusals, which is what the last check reads.
  await page.locator('#mc-elliot-dl-overlay').click();
  await expect(page.locator('#toast-region')).toContainText(/parts \(published file: [\d,]+\)/, { timeout: 60000 });
  await page.locator('#mc-elliot-dl-mappings').click();
  await expect(page.locator('#toast-region')).toContainText(/confirmed matches \(published file: [\d,]+\)/, { timeout: 60000 });
  await page.locator('#mc-elliot-dl-catmap').click();
  await expect(page.locator('#toast-region')).toContainText(/categories \(published file: [\d,]+\)/, { timeout: 60000 });

  // the downloadable book is not allowed to carry fewer parts than the committed one
  await page.locator('#mc-elliot-dl-book').click();
  await expect(page.locator('#toast-region')).toContainText('supply-house parts', { timeout: 60000 });
  await expect(page.locator('#mc-elliot-status')).not.toContainText('Not downloaded');

  // ...and after a reload
  await page.reload();
  await openBook(page);
  const reloaded = await catalog(page);
  expect(reloaded.sections).toBeGreaterThanOrEqual(before.sections);
  expect(reloaded.parts).toBeGreaterThanOrEqual(before.parts);
  await expect(page.locator('#mc-book-status')).not.toContainText('0 new items');

  expect(errors).toEqual([]);
});

test('an overlay with no parts list leaves the published catalog alone', async ({ page }) => {
  test.setTimeout(120000);
  await page.context().route(/supabase/i, (r) => r.abort());
  await page.goto('/');
  await openBook(page);
  const before = await catalog(page);
  expect(before.parts).toBeGreaterThan(1000);

  // the shape J13 finding 1 produced: prices, no parts list
  await page.evaluate(() => {
    localStorage.setItem(
      'mc-elliot-overlay',
      JSON.stringify({
        version: 1,
        vendor: 'elliot',
        vendorLabel: 'Elliot Electric',
        sourceFile: 'HCP_1272501.csv',
        importedAt: new Date().toISOString(),
        enabledCategories: [],
        itemPrices: {},
        newItems: [],
        newItemsTruncated: true,
      })
    );
  });
  const after = await catalog(page);
  expect(after.parts).toBe(before.parts);
  expect(after.sections).toBe(before.sections);
  expect(after.importDate).toBe(before.importDate);
});

// ---------- the review list, seeded (J13 findings 4, 5, 6, 10) ----------

// A queue big enough to exercise the render cap and the thousands separator,
// spread over two categories.
function seedQueue(page, n) {
  return page.evaluate((count) => {
    const queue = [];
    for (let i = 0; i < count; i++) {
      const wire = i % 2 === 0;
      queue.push({
        itemNum: i + 1,
        itemName: (wire ? 'THHN CU SOLID ' : 'EMT CONNECTOR ') + i,
        oldPerEach: 0.5767,
        category: wire ? 'Wire' : 'Fittings',
        reason: "Another part fits the name just as well but costs a different price: THHN 14 STR at $0.1541.",
        reasonCode: 'near-tie',
        candidates: [
          { pn: 'PN' + i + 'A', desc: 'CANDIDATE A ' + i, perEach: 0.1334, score: 1 },
          { pn: 'PN' + i + 'B', desc: 'CANDIDATE B ' + i, perEach: 0.1334, score: 0.95 },
        ],
      });
    }
    localStorage.setItem('mc-elliot-review-queue', JSON.stringify({ version: 1, queue }));
  }, n);
}

async function openSupplierTool(page) {
  await page.evaluate(() => {
    const btn = document.getElementById('mc-elliot-update-btn');
    btn.removeAttribute('hidden');
    btn.classList.remove('lb-hidden');
  });
  await page.locator('#mc-elliot-update-btn').click();
  await expect(page.locator('#mc-elliot-modal')).toHaveAttribute('aria-hidden', 'false');
}

test('the review list groups by category, filters, says why, and remembers a pass', async ({ page }) => {
  test.setTimeout(120000);
  await page.context().route(/supabase/i, (r) => r.abort());
  await page.goto('/');
  await openBook(page);
  await seedQueue(page, 1234);
  await openSupplierTool(page);

  // the tab count reads like the body does (J13 finding 10)
  await expect(page.locator('#mc-elliot-tabs')).toContainText('Review Matches (1,234)');
  await page.locator('[data-eltab="review"]').click();

  // grouped, capped, and it says so
  await expect(page.locator('.mc-elliot-review-group')).toHaveCount(2);
  await expect(page.locator('.mc-elliot-review-row')).toHaveCount(200);
  await expect(page.locator('#mc-elliot-review-list')).toContainText('Showing the first 200 of 1,234');

  // every row says why it is uncertain (J13 finding 6)
  await expect(page.locator('.mc-elliot-review-why').first()).toContainText('costs a different price');

  // the row button is "Not this"; "Skip" belongs to the category table only
  await expect(page.locator('.mc-elliot-review-skip').first()).toHaveText('Not this');
  await expect(page.locator('#mc-elliot-review-list')).not.toContainText('Skip');

  // a filter box exists at all, narrows the list, and keeps the caret
  await page.locator('#mc-elliot-review-filter').fill('emt connector');
  await expect(page.locator('.mc-elliot-review-group')).toHaveCount(1);
  expect(await page.evaluate(() => document.activeElement.id)).toBe('mc-elliot-review-filter');
  await page.locator('#mc-elliot-review-filter').fill('');
  await expect(page.locator('.mc-elliot-review-group')).toHaveCount(2);

  // the category picker does the same in one click
  await page.selectOption('#mc-elliot-review-cat', 'Wire');
  await expect(page.locator('.mc-elliot-review-group')).toHaveCount(1);
  await expect(page.locator('.mc-elliot-review-group h4')).toContainText('Wire');
  await page.selectOption('#mc-elliot-review-cat', '');

  // a decision patches the one row instead of rebuilding the list
  await page.evaluate(() => {
    document.querySelectorAll('.mc-elliot-review-row')[5].setAttribute('data-untouched', 'yes');
  });
  const first = page.locator('.mc-elliot-review-row').first();
  const skippedItem = Number(await first.getAttribute('data-itemnum'));
  await first.locator('.mc-elliot-review-skip').click();

  // ...and it says so, out loud, and the row is gone (J13 finding 4)
  await expect(page.locator('#toast-region')).toContainText('Passed on');
  await expect(page.locator('.mc-elliot-review-row')).toHaveCount(199);
  await expect(page.locator('#mc-elliot-tabs')).toContainText('Review Matches (1,233)');
  expect(await page.locator('.mc-elliot-review-row[data-untouched]').count(), 'the other rows were not re-rendered').toBe(1);

  // the pass is remembered, so the next price file does not ask again (J13 finding 5)
  const remembered = await page.evaluate((n) => {
    const doc = JSON.parse(localStorage.getItem('mc-elliot-mappings'));
    const skipped = McElliotState.getSkippedItems();
    const rebuilt = McElliotCore.withoutSkipped([{ itemNum: n }, { itemNum: 999999 }], skipped);
    return { stored: doc.skipped, has: skipped.has(n), rebuilt: rebuilt.map((q) => q.itemNum) };
  }, skippedItem);
  expect(remembered.has).toBe(true);
  expect(remembered.rebuilt).toEqual([999999]);
  expect(remembered.stored.elliot).toContain(skippedItem);

  // a match confirms out loud too, naming what it took
  await page.locator('.mc-elliot-review-match').first().click();
  await expect(page.locator('#toast-region')).toContainText('Remembered for future price files');
  await expect(page.locator('.mc-elliot-review-row')).toHaveCount(198);
});


test('the first screen says what is true, and the word overlay is gone from the tool', async ({ page }) => {
  test.setTimeout(120000);
  await page.context().route(/supabase/i, (r) => r.abort());
  await page.goto('/');
  await openBook(page);
  const published = await catalog(page);
  await openSupplierTool(page);

  // J13 finding 3: the old copy claimed no supplier prices while 27,556 badged
  // parts rendered behind the modal
  const body = page.locator('#mc-elliot-body');
  await expect(body).toContainText('Nothing has been changed on this computer');
  await expect(body).toContainText(String(published.importDate));
  await expect(body).toContainText(published.parts.toLocaleString());

  for (const tab of ['upload', 'review', 'summary']) {
    await page.locator(`[data-eltab="${tab}"]`).click();
    await expect(body, `${tab} tab still says overlay`).not.toContainText(/overlay/i);
  }
});
