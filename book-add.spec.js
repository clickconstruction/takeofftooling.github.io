'use strict';
// Labor & Price Book → the bid: which price an assembly lands at, which
// quantity a part inherits, and pricing a fixture from its own book row.
// Covers T1-02, T1-03, T1-11 and T1-13(c).
const { test, expect } = require('@playwright/test');

// Seed one top-level row and open the book from it (the manifest row's door).
async function openBookFor(page, item) {
  await page.goto('/');
  const id = await page.evaluate((it) => {
    const row = TakeoffState.addItem(Object.assign({ parentId: null }, it));
    TakeoffApp.showLaborBookModal(row.id);
    return row.id;
  }, item);
  await expect(page.locator('#labor-book-modal')).toHaveAttribute('aria-hidden', 'false');
  return id;
}

// The conduit tab nests sections inside collapsed groups; everything else
// lists sections directly. Open whatever is in the way of the first row.
async function expandFirstSection(page) {
  const group = page.locator('.labor-book-group-header').first();
  if (await group.count()) await group.click();
  await page.locator('.labor-book-section-header').first().click();
  await expect(page.locator('.labor-book-add-btn').first()).toBeVisible();
}

const childrenOf = (page, id) =>
  page.evaluate((i) => (TakeoffState.getItemById(i).children || []).map((c) => ({
    description: c.description, quantity: c.quantity, price: c.price, labor: c.labor,
  })), id);

test('T1-13(c) — a book row is described by its section, whatever the name length', async ({ page }) => {
  await page.goto('/');
  const out = await page.evaluate(() => {
    const d = TakeoffLaborBookTargets.describeBookRow;
    return {
      // 11 characters: used to lose its section, so an elbow and a coupling
      // both landed as '1/2" EMT(S)' and merged into one unorderable line
      long: d('1/2" EMT(S)', 'EMT fittings (SS) - Couplings'),
      short: d('1" EMT(R)', 'EMT fittings (RT) - Connectors'),
      elbow: d('1/2" EMT(S)', 'EMT fittings (SS) Elbows'),
      panel: d('600a', 'Panels.3PH'),
      none: d('Something', ''),
    };
  });
  expect(out.long).toBe('1/2" EMT(S) EMT fittings (SS) - Couplings');
  expect(out.short).toBe('1" EMT(R) EMT fittings (RT) - Connectors');
  expect(out.elbow).toBe('1/2" EMT(S) EMT fittings (SS) Elbows');
  expect(out.long).not.toBe(out.elbow);
  expect(out.panel).toBe('600a Panel (3PH)');
  expect(out.none).toBe('Something');
});

test('T1-03 — a conduit run gets one part, a counted fixture gets its count', async ({ page }) => {
  // 220 ft of homerun: the quantity is footage, not a number of couplings
  const runId = await openBookFor(page, {
    type: 'conduit', description: '3/4" EMT Homerun', quantity: 220, labor: 0.05, price: 1.1,
  });
  await expandFirstSection(page);
  await page.locator('.labor-book-add-btn').first().click();

  const kids = await childrenOf(page, runId);
  expect(kids).toHaveLength(1);
  expect(kids[0].quantity).toBe(1);
  await expect(page.locator('#toast-region')).toContainText('×1 under 3/4" EMT Homerun — set the count');

  // a counted fixture still inherits its count
  const gearId = await openBookFor(page, {
    type: 'gear', description: 'Panel LP-2', quantity: 24, labor: 6.5, price: null,
  });
  await expandFirstSection(page);
  await page.locator('.labor-book-add-btn').first().click();
  const gearKids = await childrenOf(page, gearId);
  expect(gearKids).toHaveLength(1);
  expect(gearKids[0].quantity).toBe(24);
  await expect(page.locator('#toast-region')).toContainText('×24 under Panel LP-2');
});

test('T1-03 — the banner says which of the two rules applies', async ({ page }) => {
  await openBookFor(page, { type: 'conduit', description: '3/4" EMT Homerun', quantity: 220, price: 1.1 });
  await expect(page.locator('#labor-book-apply-to')).toContainText('parts land ×1 — set the count');

  await openBookFor(page, { type: 'lighting', description: '2x4 Troffer', quantity: 24, price: null });
  await expect(page.locator('#labor-book-apply-to')).toContainText('×24 on the bid');
});

test('T1-02 — the tolerance rule: explode only when the parts add back up', async ({ page }) => {
  await page.goto('/');
  const out = await page.evaluate(() => {
    const c = (price, qty) => ({ description: 'x', qty, labor: 0, price });
    return {
      tolerance: McBook.PRICE_TOLERANCE,
      exact: McBook.compositionReconstructsBook([c(10, 2), c(5, 1)], { price: 25 }),
      within: McBook.compositionReconstructsBook([c(10, 2), c(5, 1)], { price: 26 }),
      outside: McBook.compositionReconstructsBook([c(1, 2), c(0.76, 1)], { price: 193.65 }),
      // a fully priced composition that simply doesn't reconstruct (#12 MTR TERM)
      pricedButWrong: McBook.compositionReconstructsBook([c(23.88, 1)], { price: 42.52 }),
      // an unpriced component makes the sum unknowable, never 0
      unpriced: McBook.compositionReconstructsBook([c(10, 2), c(null, 1)], { price: 20 }),
      sumUnpriced: McBook.componentsPrice([c(10, 2), c(null, 1)]),
      sumPriced: McBook.componentsPrice([c(10, 2), c(5, 1)]),
      noBookPrice: McBook.compositionReconstructsBook([c(10, 1)], { price: 0 }),
    };
  });
  expect(out.tolerance).toBe(0.1);
  expect(out.exact).toBe(true);
  expect(out.within).toBe(true);
  expect(out.outside).toBe(false);
  expect(out.pricedButWrong).toBe(false);
  expect(out.unpriced).toBe(false);
  expect(out.sumUnpriced).toBe(null);
  expect(out.sumPriced).toBe(25);
  expect(out.noBookPrice).toBe(false);
});

test('T1-02 — an out-of-tolerance assembly lands rolled up at the book price', async ({ page }) => {
  const gearId = await openBookFor(page, {
    type: 'gear', description: 'Panel A', quantity: 3, labor: 0, price: null,
  });

  const msg = await page.evaluate(async () => {
    await McBook.ensureLoaded();
    const hits = McBook.searchAssemblies('100A ENCL CB 2P 250V', 5);
    const entry = hits.find((h) => h.entry.name === '100A ENCL CB 2P 250V')?.entry || hits[0].entry;
    const comps = await McBook.getComposition(entry.assmNum);
    return {
      status: await McBook.addAssemblyEntry(entry),
      bookPrice: entry.price,
      bookLabor: entry.labor,
      hadComponents: !!(comps && comps.length),
      reconstructs: McBook.compositionReconstructsBook(comps, entry),
    };
  });

  // the assembly does have components — they just don't add up to the row
  expect(msg.hadComponents).toBe(true);
  expect(msg.reconstructs).toBe(false);
  expect(msg.status).toContain('book price');

  const kids = await childrenOf(page, gearId);
  expect(kids).toHaveLength(1);
  expect(Number(kids[0].price)).toBeCloseTo(Number(msg.bookPrice), 2);
  expect(Number(kids[0].labor)).toBeCloseTo(Number(msg.bookLabor), 3);
  expect(kids[0].quantity).toBe(3); // gear counts, so the parts inherit the count
  await expect(page.locator('#toast-region')).toContainText('book price');
});

test('T1-11 — a priced fixture is priced by its own book row, not doubled', async ({ page }) => {
  const id = await openBookFor(page, {
    type: 'gear', description: 'SWBD-1', quantity: 1, labor: 30, price: 18400,
  });

  // the banner offers pricing first, with adding underneath demoted
  await expect(page.locator('#labor-book-apply-to')).toContainText("Add on a Gear row replaces this row's price and labor");
  await expect(page.locator('#labor-book-add-underneath-btn')).toBeVisible();

  await expandFirstSection(page);
  const firstRow = page.locator('.labor-book-row').first();
  const bookName = await firstRow.locator('.labor-book-name').inputValue();
  await firstRow.locator('.labor-book-price').fill('17995');
  await firstRow.locator('.labor-book-price').dispatchEvent('change');
  const bookLabor = Number(await firstRow.locator('.labor-book-hrs').inputValue());
  await firstRow.locator('.labor-book-add-btn').click();

  const row = await page.evaluate((i) => TakeoffState.getItemById(i), id);
  expect(row.children).toHaveLength(0);        // no second copy of the switchboard
  expect(row.description).toBe('SWBD-1');      // the estimator's own name survives
  expect(row.price).toBe(17995);
  expect(row.labor).toBe(bookLabor);
  expect(row.meta.priceSource).toBeTruthy();   // provenance rode onto the bid row
  expect(bookName.length).toBeGreaterThan(0);
});

test('T1-11 — "Add as a part underneath" is still one click away', async ({ page }) => {
  const id = await openBookFor(page, {
    type: 'gear', description: 'SWBD-1', quantity: 1, labor: 30, price: 18400,
  });
  await page.locator('#labor-book-add-underneath-btn').click();
  await expect(page.locator('#labor-book-apply-to')).toContainText('Adding parts under');

  await expandFirstSection(page);
  await page.locator('.labor-book-add-btn').first().click();

  const row = await page.evaluate((i) => TakeoffState.getItemById(i), id);
  expect(row.children).toHaveLength(1);
  expect(row.price).toBe(18400); // the fixture's own price untouched
});

test('T1-11 — a fixture with children or no price keeps today\'s add-underneath door', async ({ page }) => {
  await openBookFor(page, { type: 'gear', description: 'Panel LP-2', quantity: 2, price: null });
  await expect(page.locator('#labor-book-apply-to')).toContainText('Adding parts under');
  await expect(page.locator('#labor-book-add-underneath-btn')).toHaveCount(0);
});

test('T1-02 — an in-tolerance assembly still explodes, in one undo frame', async ({ page }) => {
  const gearId = await openBookFor(page, {
    type: 'gear', description: 'Panel A', quantity: 2, labor: 0, price: null,
  });
  const res = await page.evaluate(async () => {
    await McBook.ensureLoaded();
    for (const h of McBook.searchAssemblies('emt', 400)) {
      const comps = await McBook.getComposition(h.entry.assmNum);
      if (comps && comps.length > 1 && McBook.compositionReconstructsBook(comps, h.entry)) {
        return { status: await McBook.addAssemblyEntry(h.entry), n: comps.length, name: h.entry.name };
      }
    }
    return null;
  });
  expect(res).not.toBeNull();
  expect(res.status).toContain('from components');
  expect(await childrenOf(page, gearId)).toHaveLength(res.n);

  // the whole explosion is still one undo frame
  await page.evaluate(() => TakeoffState.undo());
  expect(await childrenOf(page, gearId)).toHaveLength(0);
});

test('T2-08 — a stray click on a book row adds nothing', async ({ page }) => {
  const id = await openBookFor(page, { type: 'gear', description: 'Panel LP-2', quantity: 2, price: null });
  await expandFirstSection(page);

  // the tr itself, not the Add button: two of these silently put +50 labor hrs
  // under a fixture with nothing on screen to say so
  await page.locator('.labor-book-row').first().dispatchEvent('click');
  await page.locator('.labor-book-row').first().locator('td').last().dispatchEvent('click');
  expect(await childrenOf(page, id)).toHaveLength(0);

  // Add still adds
  await page.locator('.labor-book-add-btn').first().click();
  expect(await childrenOf(page, id)).toHaveLength(1);
});

test('T2-08 — the fittings door clears a stale search and promises ×1', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const run = TakeoffState.addItem({
      type: 'conduit', description: '3/4" EMT Homerun', quantity: 220, labor: 0.05, price: 1.1, parentId: null,
    });
    TakeoffApp.navigateToConduit(run.id);
    TakeoffState.setConduitStep(2);
    TakeoffApp.render();
    // a term left in the box by an earlier PB fill
    TakeoffLaborBookSearch.setTerm('mc connector');
    TakeoffApp.showLaborBookModalForConduitFittings(run.id);
  });

  // the door promised the Fittings group, so the tree is on screen — not the
  // previous search's results
  await expect(page.locator('#labor-book-global-search')).toHaveValue('');
  await expect(page.locator('#labor-book-tabs')).not.toHaveClass(/lb-hidden/);
  const fittings = page.locator('.labor-book-group[data-group="Fittings"]');
  await expect(fittings).toHaveCount(1);
  await expect(fittings).not.toHaveClass(/labor-book-group-collapsed/);

  // and the banner states the rule the add actually follows
  await expect(page.locator('#labor-book-apply-to')).toContainText('Adding fittings to');
  await expect(page.locator('#labor-book-apply-to')).toContainText('each lands ×1');
  await expect(page.locator('#labor-book-apply-to')).not.toContainText('×220');

  await fittings.locator('.labor-book-section-header').first().click();
  await fittings.locator('.labor-book-add-btn').first().click();
  const added = await page.evaluate(() => (TakeoffState.getConduitTempData().fittings || []).map((f) => f.quantity));
  expect(added).toContain(1);
});

test('T1-02 — an unpriced component is null, never 0', async ({ page }) => {
  await page.goto('/');
  const found = await page.evaluate(async () => {
    await McBook.ensureLoaded();
    for (const h of McBook.searchAssemblies('emt', 400)) {
      const comps = await McBook.getComposition(h.entry.assmNum);
      const gap = (comps || []).find((c) => !(Number(c.price) > 0));
      if (gap) return { price: gap.price, isNull: gap.price === null };
    }
    return null;
  });
  // if the committed book has no unpriced component in this slice, the rule is
  // still pinned by the unit-style checks above; only assert when one exists
  if (found) expect(found.isNull).toBe(true);
});
