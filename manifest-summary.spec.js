'use strict';
// The manifest table's live numbers: a field edit must not destroy the control
// the estimator is aiming at (T1-01), an open purchase list must move with the
// bid (T1-12), the list must merge and read like something you can order
// (T1-13), the trash icon must remove the row it sits on (T1-14), and a row at
// quantity 0 must count as none of it, everywhere (T1-05).
const { test, expect } = require('@playwright/test');

// Seed rows straight into state, then render: faster and less brittle than
// typing a bid in, and it exercises the same render/attachListeners path.
async function seed(page, rows) {
  await page.evaluate((list) => {
    for (const r of list) {
      const parent = TakeoffState.addItem({
        type: r.type || null, description: r.description, quantity: r.quantity,
        labor: r.labor || 0, price: r.price ?? null, planPage: '', parentId: null,
      });
      for (const c of r.children || []) {
        TakeoffState.addItem({
          type: c.type || null, description: c.description, quantity: c.quantity,
          labor: c.labor || 0, price: c.price ?? null, meta: c.meta || null, parentId: parent.id,
        });
      }
    }
    TakeoffApp.render();
  }, rows);
}

const rowQty = (page, description) =>
  page.locator(`tr:has(input[data-field="description"][value="${description}"]) input[data-field="quantity"]`);

test('typing a quantity then clicking the labor rate: the click lands, focus follows, the number sticks', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await seed(page, [{ type: 'gear', description: 'Panel LP-2', quantity: 1, price: 980, labor: 6.5 }]);

  const qty = rowQty(page, 'Panel LP-2');
  await qty.click();
  await qty.fill('4');

  // the pointer moves straight from the quantity field to the labor rate: the
  // field's change fires between mousedown and click
  const rate = page.locator('#labor-rate-input');
  await rate.click();
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('labor-rate-input');

  await rate.fill('92');
  await rate.dispatchEvent('change');
  expect(await page.evaluate(() => TakeoffState.getItemById(TakeoffState.getTopLevelItems().find((i) => i.description === 'Panel LP-2').id).quantity)).toBe(4);
  expect(await page.evaluate(() => TakeoffState.getLaborRate())).toBe(92);

  // 4 × 6.5 h × $92 = $2,392.00 on the screen, with no full re-render.
  // Hours print to two places and money carries separators (B2): one
  // formatter each, so 86.25 hrs never prints as 86.3 beside $7,935.
  await expect(page.locator('[data-summary="laborTotal"]')).toHaveText('26.00');
  await expect(page.locator('[data-summary="laborDollars"]')).toHaveText('$2,392.00');
  expect(errors).toEqual([]);
});

test('an open purchase list follows the bid as it is corrected', async ({ page }) => {
  await page.goto('/');
  await seed(page, [{ type: 'devices', description: 'Box 4-11/16', quantity: 15, price: 1.30 }]);
  await page.getByRole('button', { name: 'Generate purchase list (PO)' }).click();
  await expect(page.locator('.purchase-list-table')).toContainText('Box 4-11/16');
  await expect(page.locator('.purchase-list-table tbody .purchase-list-qty')).toHaveText('15');

  const qty = rowQty(page, 'Box 4-11/16');
  await qty.fill('25');
  await qty.dispatchEvent('change');

  await expect(page.locator('.purchase-list-table tbody .purchase-list-qty')).toHaveText('25');
  await expect(page.locator('.purchase-list-table tfoot .purchase-list-money')).toHaveText('$32.50');
  await expect(page.locator('[data-summary="materialsSubtotal"]')).toHaveText('$32.50');

  // the header buttons survive the refresh, so Hide still works right after an edit
  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(page.locator('.purchase-list-open')).toHaveCount(0);
});

test('the purchase list shows a price range and folds overage into its run', async ({ page }) => {
  await page.goto('/');
  await seed(page, [
    { type: 'gear', description: 'Panel LP-2', quantity: 1, price: 1100 },
    { type: 'gear', description: 'Panel LP-2', quantity: 1, price: 1250 },
    {
      type: 'conduit', description: '3/4" EMT Homerun', quantity: 220, price: 0.68,
      children: [{ type: 'overage', description: 'Conduit overage (10%)', quantity: 22, price: 0.68, meta: { overagePercent: 10 } }],
    },
  ]);
  await page.getByRole('button', { name: 'Generate purchase list (PO)' }).click();

  const panel = page.locator('.purchase-list-table tbody tr', { hasText: 'Panel LP-2' });
  await expect(panel.locator('.purchase-list-qty')).toHaveText('2');
  await expect(panel.locator('.purchase-list-money').first()).toHaveText('$1,100.00–$1,250.00');
  await expect(panel.locator('.purchase-list-money').nth(1)).toHaveText('$2,350.00');
  await expect(page.locator('.purchase-list-table')).not.toContainText('≠');

  // the waste is bought with the footage: one line, 242 ft, and it says so
  await expect(page.locator('.purchase-list-table')).not.toContainText('Conduit overage');
  const emt = page.locator('.purchase-list-table tbody tr', { hasText: 'EMT Homerun' });
  await expect(emt).toContainText('3/4" EMT Homerun (incl. 10% overage)');
  await expect(emt.locator('.purchase-list-qty')).toHaveText('242');
});

// X13: the trash is on every row, not behind a mode in the ☰ menu.
test('every row carries a trash, hidden until the row is under the pointer', async ({ page }) => {
  await page.goto('/');
  await seed(page, [
    { type: 'gear', description: 'Panel LP-1', quantity: 1, price: 500 },
    { type: 'conduit', description: '2" PVC run', quantity: 100, price: 1, children: [{ description: 'PVC glue', quantity: 1, price: 12 }] },
  ]);

  // one per row, children included — and the mode that used to gate them is gone
  const rows = await page.locator('.manifest-view tbody tr[data-id]').count();
  await expect(page.locator('.manifest-view .remove-btn')).toHaveCount(rows);
  expect(await page.evaluate(() => typeof TakeoffState.getShowRemoveIcons)).toBe('undefined');
  await expect(page.locator('#remove-toggle-btn')).toHaveCount(0);

  const trash = page.locator('tr:has(input[data-field="description"][value="Panel LP-1"]) .remove-btn');
  expect(await trash.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await page.locator('tr:has(input[data-field="description"][value="Panel LP-1"])').hover();
  await expect.poll(() => trash.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
});

test('at phone width the trash needs no hover', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await seed(page, [{ type: 'gear', description: 'Panel LP-1', quantity: 1, price: 500 }]);
  const trash = page.locator('tr:has(input[data-field="description"][value="Panel LP-1"]) .remove-btn');
  expect(await trash.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await expect(trash).toBeVisible();
  // and it did not push the card off the screen
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('clicking the middle of a row trash icon removes that row', async ({ page }) => {
  await page.goto('/');
  await seed(page, [
    { type: 'gear', description: 'Panel LP-1', quantity: 1, price: 500 },
    { type: 'gear', description: 'Panel LP-2', quantity: 1, price: 980 },
  ]);
  page.on('dialog', (d) => d.accept());

  const before = await page.evaluate(() => TakeoffState.getTopLevelItems().length);
  // the icon's centre, which is the <path> inside the button's SVG
  await page.locator('tr:has(input[data-field="description"][value="Panel LP-2"]) .remove-btn svg').click();

  await expect.poll(() => page.evaluate(() => TakeoffState.getTopLevelItems().length)).toBe(before - 1);
  expect(await page.evaluate(() => TakeoffState.getTopLevelItems().some((i) => i.description === 'Panel LP-2'))).toBe(false);
  expect(await page.evaluate(() => TakeoffState.canUndo())).toBe(true);
});

test('a row spun down to 0 contributes nothing, and the quantity greys out', async ({ page }) => {
  await page.goto('/');
  await seed(page, [{ type: 'gear', description: 'Panel LP-2', quantity: 1, price: 980, labor: 6.5 }]);
  await page.getByRole('button', { name: 'Generate purchase list (PO)' }).click();

  const qty = rowQty(page, 'Panel LP-2');
  await qty.fill('0');
  await qty.dispatchEvent('change');

  await expect(page.locator('[data-summary="mat.gear"]')).toHaveText('$0.00');
  await expect(page.locator('[data-summary="lab.gear"]')).toHaveText('0.00');
  await expect(page.locator('[data-summary="materialsSubtotal"]')).toHaveText('$0.00');
  await expect(page.locator('.purchase-list-meta')).toContainText('0 materials');
  await expect(qty).toHaveClass(/qty-zero/);

  // and it still reads as a deliberate 0 (not a blank field) after a full render
  await page.evaluate(() => TakeoffApp.render());
  await expect(rowQty(page, 'Panel LP-2')).toHaveValue('0');
  await expect(rowQty(page, 'Panel LP-2')).toHaveClass(/qty-zero/);

  // and back up again
  await page.locator('tr:has(input[data-field="description"][value="Panel LP-2"]) .qty-up-btn').click();
  await expect(page.locator('[data-summary="mat.gear"]')).toHaveText('$980.00');
  await expect(qty).not.toHaveClass(/qty-zero/);
});

// T2-19: the tax rate is the job's, and a trench is not stock.
test('the sales tax rate is the project\'s, and it survives a reload', async ({ page }) => {
  await page.goto('/');
  await seed(page, [{ type: 'gear', description: 'Panel LP-2', quantity: 1, price: 1000 }]);

  const tax = page.locator('#tax-rate-input');
  await expect(tax).toHaveValue('8.5');
  await expect(page.locator('[data-summary="salesTax"]')).toHaveText('$85.00');

  await tax.fill('10.25');
  await tax.dispatchEvent('change');
  await expect(page.locator('[data-summary="salesTax"]')).toHaveText('$102.50');
  await expect(page.locator('[data-summary="materialsTotal"]')).toHaveText('$1,102.50');

  // it belongs to the project document, so it comes back with the bid
  await page.evaluate(() => TakeoffState.persistNow());
  await page.reload();
  await expect(page.locator('#tax-rate-input')).toHaveValue('10.25');
  expect(await page.evaluate(() => TakeoffState.getTaxRate())).toBe(10.25);
});

test('a trench and a rental are other charges — untaxed, and not on the purchase list', async ({ page }) => {
  await page.goto('/');
  await seed(page, [
    {
      type: 'conduit', description: '2" PVC run', quantity: 220, price: 1,
      children: [
        { type: 'trenching', description: '220 - Trenching: Dirt @ 24 in', quantity: 220, price: 15 },
        { type: 'trenchingAddon', description: 'BACKHOE', quantity: 4, price: 350, meta: { addonGroup: 'rental' } },
        { type: 'trenchingAddon', description: 'TRENCHING SAND', quantity: 20, price: 12, meta: { addonGroup: 'fill' } },
      ],
    },
  ]);
  await page.getByRole('button', { name: /purchase list/i }).first().click();

  // $3,300 of trench + $1,400 of backhoe sit under Other charges, untaxed
  await expect(page.locator('[data-summary="oth.siteWork"]')).toHaveText('$4,700.00');
  await expect(page.locator('[data-summary="mat.conduit"]')).toHaveText('$460.00'); // run + sand
  await expect(page.locator('[data-summary="salesTax"]')).toHaveText('$39.10');     // 8.5% of $460
  // and nobody is asked to order a backhoe from the supply house
  await expect(page.locator('.purchase-list-table')).toContainText('TRENCHING SAND');
  await expect(page.locator('.purchase-list-table')).not.toContainText('BACKHOE');
  await expect(page.locator('.purchase-list-table')).not.toContainText('Trenching');
});

// B9: a minus sign is corrected where it was typed, and $0 is a price.
test('a negative price is clamped to 0 on change, and says so', async ({ page }) => {
  await page.goto('/');
  await seed(page, [{ type: 'specialSystems', description: 'Card reader', quantity: 20, price: 118 }]);
  const price = page.locator('tr:has(input[data-field="description"][value="Card reader"]) input[data-field="price"]');
  await price.fill('-28');
  await price.dispatchEvent('change');

  await expect(price).toHaveValue('0');
  await expect(price).toHaveClass(/input-invalid/);
  await expect(page.locator('[data-summary="mat.specialSystems"]')).toHaveText('$0.00');
  expect(await page.evaluate(() => TakeoffState.getTopLevelItems().find((i) => i.description === 'Card reader').price)).toBe(0);

  // the mark clears as soon as the field is typed in again
  await price.fill('118');
  await expect(price).not.toHaveClass(/input-invalid/);
});

test('a $0 price reads $0.00 and is not counted as missing', async ({ page }) => {
  await page.goto('/');
  await seed(page, [
    { type: 'gear', description: 'Owner-furnished panel', quantity: 1, price: 0 },
    { type: 'gear', description: 'Disconnect 60A', quantity: 1, price: null },
  ]);
  await page.getByRole('button', { name: /purchase list/i }).first().click();

  const free = page.locator('.purchase-list-table tbody tr', { hasText: 'Owner-furnished panel' });
  await expect(free.locator('.purchase-list-money').first()).toHaveText('$0.00');
  await expect(free.locator('.purchase-list-money').nth(1)).toHaveText('$0.00');
  const blank = page.locator('.purchase-list-table tbody tr', { hasText: 'Disconnect 60A' });
  await expect(blank.locator('.purchase-list-money').first()).toHaveText('—');
  await expect(page.locator('.purchase-list-meta')).toContainText('1 without a price');
});

test('hours typed on a permit row count in the labor total the screen shows', async ({ page }) => {
  await page.goto('/');
  await seed(page, [
    { type: 'gear', description: 'Panel LP-2', quantity: 1, price: 980, labor: 6.5 },
    { type: 'permits', description: 'City permit', quantity: 1, price: 1150, labor: 3 },
  ]);
  await expect(page.locator('[data-summary="lab.other"]')).toHaveText('3.00');
  await expect(page.locator('[data-summary="laborTotal"]')).toHaveText('9.50');
  // the screen's total and the number the PDF reads are the same by construction
  expect(await page.evaluate(() => TakeoffState.getTotalLabor())).toBe(9.5);
  expect(await page.evaluate(() => TakeoffState.getSummaryBreakdown().laborTotal)).toBe(9.5);
});

// X10: a type whose hours come from both halves says which half is which, and
// every number in the summary says how it is built.
test('the labor cell splits run hours from part hours, and only when there are both', async ({ page }) => {
  await page.goto('/');
  await seed(page, [
    {
      type: 'conduit', description: '3/4" EMT Homerun', quantity: 220, labor: 0.024, price: 0.68,
      children: [{ type: 'fitting', description: 'EMT connector', quantity: 12, labor: 0.5, price: 1.1 }],
    },
    { type: 'lighting', description: '2x4 Troffer', quantity: 10, labor: 0.6, price: 118 },
  ]);

  const conduitCell = page.locator('td:has([data-summary="lab.conduit"])');
  await expect(conduitCell).toHaveText('11.28 · runs 5.28 + parts 6.00');
  // a type with hours on the rows only stays a bare number — no standing furniture
  await expect(page.locator('td:has([data-summary="lab.lighting"])')).toHaveText('6.00');
  await expect(page.locator('[data-summary="laborTotal"]')).toHaveText('17.28');

  // and the split follows an edit that skips a re-render
  const qty = rowQty(page, 'EMT connector');
  await qty.fill('24');
  await qty.dispatchEvent('change');
  await expect(conduitCell).toHaveText('17.28 · runs 5.28 + parts 12.00');

  // every value says how it is built
  await expect(page.locator('[data-summary="mat.conduit"]')).toHaveAttribute('title', 'Sum of qty × price for Conduit rows and their parts, rounded per line');
  await expect(conduitCell).toHaveAttribute('title', 'Sum of qty × hours for Conduit rows and their parts');
  await expect(page.locator('[data-summary="salesTax"]')).toHaveAttribute('title', /sales tax rate/);
  await expect(page.locator('[data-summary="laborDollars"]')).toHaveAttribute('title', /labor rate/);
  await expect(page.locator('[data-summary="grandTotal"]')).toHaveAttribute('title', 'Materials total + labor $ + other charges');
  const untitled = await page.evaluate(() =>
    [...document.querySelectorAll('.manifest-summary [data-summary]')].filter((el) => !el.closest('[title]')).length);
  expect(untitled).toBe(0);
});

// X1: a bid row priced from the book notices when that book row moves.
test('a book-sourced row offers the book\'s new price, in one undo, only when it differs', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    TakeoffState.addItem({ type: 'gear', description: 'Panel LP-2', quantity: 1, price: 980, parentId: null });
    TakeoffApp.render();
  });

  // add a real book row under it, through the book's own add path
  const ref = await page.evaluate(() => {
    const parent = TakeoffState.getTopLevelItems().find((i) => i.description === 'Panel LP-2');
    const type = 'gear';
    const section = Object.keys(TakeoffState.getLaborBookType(type))[0];
    const rows = TakeoffState.getLaborBookType(type)[section];
    const index = 0;
    TakeoffState.updateLaborBookRow(type, section, index, { price: '3950', labor: 32 });
    document.getElementById('labor-book-apply-to').dataset.targetFixtureId = parent.id;
    TakeoffLaborBookTargets.addEntryToTarget({
      description: TakeoffLaborBookTargets.describeBookRow(rows[index].name, section),
      labor: rows[index].labor,
      price: String(rows[index].price),
    });
    return { type, section, index, name: rows[index].name };
  });

  // the row carries its link back to the book, and agrees with it: no chip
  const child = () => page.evaluate(() =>
    TakeoffState.getTopLevelItems().find((i) => i.description === 'Panel LP-2').children[0]);
  expect((await child()).meta.book).toEqual({ type: ref.type, section: ref.section, name: ref.name });
  await expect(page.locator('.book-price-chip')).toHaveCount(0);

  // the book gets a quote: now, and only now, the row says so
  await page.evaluate((r) => {
    TakeoffState.updateLaborBookRow(r.type, r.section, r.index, { price: '1140', labor: 35.5 });
    TakeoffApp.render();
  }, ref);
  const chip = page.locator('.book-price-chip');
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveText('book: $1,140.00');
  await expect(chip).toHaveAttribute('title', /35\.50 hrs/);

  const depth = () => page.evaluate(() => {
    let n = 0;
    while (TakeoffState.canUndo() && TakeoffState.undo()) n++;
    while (TakeoffState.canRedo()) TakeoffState.redo();
    return n;
  });
  const before = await depth();
  await chip.click();

  expect((await child()).price).toBe(1140);
  expect((await child()).labor).toBe(35.5);
  await expect(page.locator('.book-price-chip')).toHaveCount(0);
  expect(await depth()).toBe(before + 1); // price and hours are one undo
});

test('the book chip appears and goes as the price is typed, without a re-render', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const parent = TakeoffState.addItem({ type: 'gear', description: 'Panel LP-2', quantity: 1, price: 980, parentId: null });
    TakeoffState.addItem({
      parentId: parent.id, description: 'Breaker 100A', quantity: 1, price: 240, labor: 1,
      meta: { book: { type: 'gear', section: '__spec__', name: 'Breaker 100A' } },
    });
    TakeoffState.getLaborBookType('gear').__spec__ = [{ name: 'Breaker 100A', labor: 1, price: '265' }];
    TakeoffApp.render();
  });

  const chip = page.locator('.book-price-chip');
  await expect(chip).toHaveText('book: $265.00');

  // typing the book's number in by hand settles it: the chip is gone, and no
  // re-render happened (the field still has focus)
  const price = page.locator('tr:has(input[data-field="description"][value="Breaker 100A"]) input[data-field="price"]');
  await price.click();
  await price.fill('265');
  await price.dispatchEvent('change');
  await expect(chip).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement.dataset.field)).toBe('price');

  await price.fill('240');
  await price.dispatchEvent('change');
  await expect(chip).toHaveText('book: $265.00');
});
