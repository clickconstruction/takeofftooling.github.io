'use strict';
// Flow editors: the conduit wizard writes only on Save (T1-07), Undo/Redo ask
// before they move the manifest under an open editor (T1-06), and derived
// children are reconciled at write time (T1-24).
const { test, expect } = require('@playwright/test');

// Seed one conduit run and open the wizard on it. Returns its id.
async function openConduitRun(page, { quantity = 150, price = 1.1 } = {}) {
  return page.evaluate(({ quantity, price }) => {
    const item = TakeoffState.addItem({
      type: 'conduit',
      description: '3/4" EMT',
      quantity,
      price,
      labor: 0,
    });
    TakeoffApp.navigateToConduit(item.id);
    return item.id;
  }, { quantity, price });
}

const childrenOf = (page, id) =>
  page.evaluate((id) => (TakeoffState.getItemById(id).children || []).map((c) => ({
    type: c.type,
    description: c.description,
    quantity: c.quantity,
    price: c.price,
    meta: c.meta,
  })), id);

const undoDepth = (page) => page.evaluate(() => {
  // no accessor for the stack depth: count how many undos are available
  let n = 0;
  while (TakeoffState.canUndo() && n < 20) { TakeoffState.undo(); n++; }
  while (TakeoffState.canRedo()) TakeoffState.redo();
  return n;
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (_) {} });
});

test('conduit: a typed fitting survives Back and Cancel asks before dropping it', async ({ page }) => {
  await page.goto('/');
  const id = await openConduitRun(page);

  // entering the flow is not an edit
  expect(await page.evaluate(() => TakeoffState.getFlowDirty())).toBe(false);

  await page.locator('#conduit-next-fittings').click();
  await expect(page.locator('.fittings-table')).toBeVisible();

  const row = page.locator('.fittings-table tbody tr').first();
  await row.locator('input[data-field="description"]').fill('1" EMT connector');
  await row.locator('input[data-field="description"]').dispatchEvent('change');
  await row.locator('input[data-field="quantity"]').fill('3');
  await row.locator('input[data-field="quantity"]').dispatchEvent('change');
  await row.locator('input[data-field="price"]').fill('2.40');
  await row.locator('input[data-field="price"]').dispatchEvent('change');

  // Back is navigation only — nothing on the bid yet, and the flag stays armed
  await page.locator('#conduit-back-trench').click();
  await expect(page.locator('#trench-qty')).toBeVisible();
  expect(await childrenOf(page, id)).toEqual([]);
  expect(await page.evaluate(() => TakeoffState.getFlowDirty())).toBe(true);

  // Cancel now asks. Dismissing keeps the editor open and the row alive.
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  await page.locator('#conduit-cancel-btn').click();
  expect(dialogs).toBe(1);
  await expect(page.locator('#trench-qty')).toBeVisible();

  await page.locator('#conduit-next-fittings').click();
  await expect(page.locator('.fittings-table tbody tr').first().locator('input[data-field="description"]'))
    .toHaveValue('1" EMT connector');
});

test('conduit: Cancel is on every step, and a no-change pass costs one undo frame', async ({ page }) => {
  await page.goto('/');
  const id = await openConduitRun(page);
  const before = await undoDepth(page);

  await expect(page.locator('#conduit-cancel-btn')).toBeVisible();
  await page.locator('#conduit-next-fittings').click();
  await expect(page.locator('#conduit-cancel-btn')).toBeVisible();
  await page.locator('#conduit-next-overage').click();
  await expect(page.locator('#conduit-cancel-btn')).toBeVisible();

  // no dialog: nothing was touched
  page.on('dialog', (d) => { throw new Error('unexpected dialog: ' + d.message()); });
  await page.locator('#conduit-save-btn').click();
  await expect.poll(() => page.evaluate(() => TakeoffState.getCurrentView())).toBe('manifest');

  // no "Trenching: 0 - N/A @ N/A" child, and no overage on a 0% run
  expect(await childrenOf(page, id)).toEqual([]);
  expect(await undoDepth(page) - before).toBeLessThanOrEqual(1);
});

test('conduit: Save writes trenching, fittings and overage in one batch', async ({ page }) => {
  await page.goto('/');
  const id = await openConduitRun(page, { quantity: 150, price: 1.1 });

  await page.locator('#trench-qty').fill('100');
  await page.locator('#trench-material').fill('Dirt');
  await page.locator('#trench-depth').fill('24in');
  await page.locator('#trench-price-per-foot').fill('15');
  const before = await undoDepth(page);

  await page.locator('#conduit-next-fittings').click();
  const row = page.locator('.fittings-table tbody tr').first();
  await row.locator('input[data-field="description"]').fill('1" EMT connector');
  await row.locator('input[data-field="description"]').dispatchEvent('change');
  await row.locator('input[data-field="quantity"]').fill('3');
  await row.locator('input[data-field="quantity"]').dispatchEvent('change');

  await page.locator('#conduit-next-overage').click();
  await page.locator('.overage-buttons button[data-percent="10"]').click();
  await page.locator('#conduit-save-btn').click();

  const kids = await childrenOf(page, id);
  expect(kids.map((k) => k.type).sort()).toEqual(['fitting', 'overage', 'trenching']);
  const trench = kids.find((k) => k.type === 'trenching');
  expect(trench.description).toBe('Trenching: 100 - Dirt @ 24in');
  expect(trench.meta).toMatchObject({ feet: 100, material: 'Dirt', depth: '24in', pricePerFoot: 15 });
  const overage = kids.find((k) => k.type === 'overage');
  expect(overage.quantity).toBe(15);
  expect(overage.price).toBe(1.1);

  // one frame for the whole run
  expect(await undoDepth(page) - before).toBe(1);
});

test('conduit: a book-side write into the fittings buffer arms the discard guard', async ({ page }) => {
  await page.goto('/');
  await openConduitRun(page);
  await page.locator('#conduit-next-fittings').click();
  expect(await page.evaluate(() => TakeoffState.getFlowDirty())).toBe(false);

  // exactly what views/laborBookTargets.js does on a fill: write the buffer
  // straight through TakeoffState, no view listener involved
  await page.evaluate(() => {
    const temp = TakeoffState.getConduitTempData();
    temp.fittings[0].description = 'CADDY hanger';
    temp.fittings[0].price = 4.25;
    TakeoffState.setConduitTempData(temp);
    TakeoffApp.render();
  });
  expect(await page.evaluate(() => TakeoffState.getFlowDirty())).toBe(true);

  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  await page.locator('#conduit-cancel-btn').click();
  expect(dialogs).toBe(1);
});

test('undo asks before it moves the manifest under an open editor', async ({ page }) => {
  await page.goto('/');
  const id = await openConduitRun(page);
  // something to undo: save a run, re-open it, then dirty the buffer
  await page.locator('#conduit-next-fittings').click();
  await page.locator('#conduit-next-overage').click();
  await page.locator('.overage-buttons button[data-percent="10"]').click();
  await page.locator('#conduit-save-btn').click();
  const saved = await childrenOf(page, id);
  expect(saved.some((k) => k.type === 'overage')).toBe(true);

  await page.evaluate((id) => TakeoffApp.navigateToConduit(id), id);
  await page.locator('#conduit-cancel-btn').waitFor();
  await page.evaluate(() => {
    TakeoffState.setConduitTempData({ overagePercent: 15 });
    TakeoffState.setFlowDirty(true);
  });

  // Cancel on the confirm must leave BOTH the manifest and the view alone
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(dialogs).toBe(1);
  expect(await page.evaluate(() => TakeoffState.getCurrentView())).toBe('conduit');
  expect(await childrenOf(page, id)).toEqual(saved);
  expect(await page.evaluate(() => TakeoffState.getFlowDirty())).toBe(true);
});

test('redo asks before it moves the manifest under an open editor', async ({ page }) => {
  await page.goto('/');
  const id = await openConduitRun(page);
  await page.evaluate(() => {
    // one undone edit to redo
    TakeoffState.updateItem(TakeoffState.getTopLevelItems().slice(-1)[0].id, { quantity: 200 });
    TakeoffState.undo();
  });
  await page.evaluate((id) => TakeoffApp.navigateToConduit(id), id);
  await page.locator('#conduit-cancel-btn').waitFor();
  await page.evaluate(() => {
    TakeoffState.setConduitTempData({ trenchQty: '50' });
    TakeoffState.setFlowDirty(true);
  });
  const qtyBefore = await page.evaluate((id) => TakeoffState.getItemById(id).quantity, id);

  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(dialogs).toBe(1);
  expect(await page.evaluate(() => TakeoffState.getCurrentView())).toBe('conduit');
  expect(await page.evaluate((id) => TakeoffState.getItemById(id).quantity, id)).toBe(qtyBefore);
});

// The single call site lands in manifest.js's handleFieldUpdate (owned by
// another change); the spec drives the helper the same way that call will.
test('syncDerivedChildren keeps overage and trenching children honest', async ({ page }) => {
  await page.goto('/');
  const id = await openConduitRun(page, { quantity: 150, price: 1.1 });
  await page.locator('#trench-qty').fill('150');
  await page.locator('#trench-material').fill('Dirt');
  await page.locator('#trench-depth').fill('24in');
  await page.locator('#trench-price-per-foot').fill('15');
  await page.locator('#conduit-next-fittings').click();
  await page.locator('#conduit-next-overage').click();
  await page.locator('.overage-buttons button[data-percent="10"]').click();
  await page.locator('#conduit-save-btn').click();

  const edit = (childType, updates) => page.evaluate(({ id, childType, updates }) => {
    const child = TakeoffState.getItemById(id).children.find((c) => c.type === childType);
    TakeoffState.updateItem(child.id, updates);
    TakeoffViewShared.syncDerivedChildren(child.id);
    return child.id;
  }, { id, childType, updates });

  // parent 150 -> 200 ft: the waste follows
  await page.evaluate((id) => {
    TakeoffState.updateItem(id, { quantity: 200 });
    TakeoffViewShared.syncDerivedChildren(id);
  }, id);
  let overage = (await childrenOf(page, id)).find((k) => k.type === 'overage');
  expect(overage.quantity).toBe(20);

  // parent price 1.10 -> 1.25: so does the unit price
  await page.evaluate((id) => {
    TakeoffState.updateItem(id, { price: 1.25 });
    TakeoffViewShared.syncDerivedChildren(id);
  }, id);
  overage = (await childrenOf(page, id)).find((k) => k.type === 'overage');
  expect(overage.price).toBe(1.25);

  // typing over the child is an override: the percentage is dropped and the
  // label stops claiming one, so nothing recomputes over it again
  await edit('overage', { quantity: 26 });
  overage = (await childrenOf(page, id)).find((k) => k.type === 'overage');
  expect(overage.quantity).toBe(26);
  expect(overage.description).toBe('Conduit overage (manual)');
  expect(overage.meta.overagePercent).toBeUndefined();
  await page.evaluate((id) => {
    TakeoffState.updateItem(id, { quantity: 300 });
    TakeoffViewShared.syncDerivedChildren(id);
  }, id);
  overage = (await childrenOf(page, id)).find((k) => k.type === 'overage');
  expect(overage.quantity).toBe(26);

  // a trench correction on the manifest sticks: meta follows the row, so
  // re-opening the wizard reads 100, not 150
  await edit('trenching', { quantity: 100 });
  let trench = (await childrenOf(page, id)).find((k) => k.type === 'trenching');
  expect(trench.meta.feet).toBe(100);
  expect(trench.description).toBe('Trenching: 100 - Dirt @ 24in');
  await edit('trenching', { price: 18 });
  trench = (await childrenOf(page, id)).find((k) => k.type === 'trenching');
  expect(trench.meta.pricePerFoot).toBe(18);

  await page.evaluate((id) => TakeoffApp.navigateToConduit(id), id);
  await page.locator('.conduit-step-pill[data-step="1"]').click();
  await expect(page.locator('#trench-qty')).toHaveValue('100');
  // money in a flow input now reads the way it reads everywhere else (B2):
  // 18 is '18.00', not '18'
  await expect(page.locator('#trench-price-per-foot')).toHaveValue('18.00');
});

// ---- B8 / T2-19: the two kinds of add-on, and the step labels ----

test('conduit: rentals and fill are separate tables, and the group lands on the child', async ({ page }) => {
  await page.goto('/');
  const id = await openConduitRun(page, { quantity: 220, price: 0.68 });

  // both groups have their own table only once they hold a row
  await expect(page.locator('.trenching-addons-table')).toHaveCount(0);
  await page.locator('.trenching-addon-btn[data-description="BACKHOE"]').click();
  await page.locator('.trenching-addon-btn[data-description="TRENCHING SAND"]').click();

  const rentals = page.locator('.trenching-addons-table[data-group="rental"]');
  const fill = page.locator('.trenching-addons-table[data-group="fill"]');
  await expect(rentals.locator('tbody tr')).toHaveCount(1);
  await expect(fill.locator('tbody tr')).toHaveCount(1);
  await expect(rentals.locator('tbody tr td').first()).toHaveText('BACKHOE');
  await expect(fill.locator('tbody tr td').first()).toHaveText('TRENCHING SAND');

  // one unit vocabulary per kind of thing — no "3 hours of sand"
  expect((await rentals.locator('thead th').allTextContents()).join('|'))
    .toContain('Hours or days');
  expect((await rentals.locator('thead th').allTextContents()).join('|'))
    .toContain('($ per hour or day)');
  expect((await fill.locator('thead th').allTextContents()).join('|')).toContain('Quantity');
  expect((await fill.locator('thead th').allTextContents()).join('|')).toContain('($ each)');
  // "Additional Labor" had no unit at all
  expect((await fill.locator('thead th').allTextContents()).join('|')).toContain('(hrs)');

  const setRow = async (table, qty, price) => {
    await table.locator('input[data-field="quantity"]').fill(qty);
    await table.locator('input[data-field="quantity"]').dispatchEvent('change');
    await table.locator('input[data-field="price"]').fill(price);
    await table.locator('input[data-field="price"]').dispatchEvent('change');
  };
  await setRow(rentals, '4', '350');
  await setRow(fill, '10', '24');

  await page.locator('#conduit-next-fittings').click();
  await page.locator('#conduit-next-overage').click();
  await page.locator('#conduit-save-btn').click();

  const addons = (await childrenOf(page, id)).filter((k) => k.type === 'trenchingAddon');
  expect(addons.map((a) => [a.description, a.meta?.addonGroup, a.quantity, a.price])).toEqual([
    ['BACKHOE', 'rental', 4, 350],
    ['TRENCHING SAND', 'fill', 10, 24],
  ]);

  // and the group survives a round trip through the buffer
  await page.evaluate((id) => TakeoffApp.navigateToConduit(id), id);
  await page.locator('.conduit-step-pill[data-step="1"]').click();
  await expect(page.locator('.trenching-addons-table[data-group="rental"] tbody tr')).toHaveCount(1);
  await expect(page.locator('.trenching-addons-table[data-group="fill"] tbody tr')).toHaveCount(1);
});

test('conduit: a legacy add-on with no group is filed by its description', async ({ page }) => {
  await page.goto('/');
  const id = await page.evaluate(() => {
    const item = TakeoffState.addItem({ type: 'conduit', description: '1" EMT', quantity: 150, price: 1.1, labor: 0 });
    // saved before the split: no meta at all
    TakeoffState.addItem({ type: 'trenchingAddon', description: 'BACKHOE', quantity: 4, labor: 0, price: 350, parentId: item.id });
    TakeoffState.addItem({ type: 'trenchingAddon', description: 'ASPHALT PATCH', quantity: 8, labor: 0, price: 12, parentId: item.id });
    TakeoffApp.navigateToConduit(item.id);
    return item.id;
  });
  await page.locator('.conduit-step-pill[data-step="1"]').click();
  await expect(page.locator('.trenching-addons-table[data-group="rental"] tbody tr td').first()).toHaveText('BACKHOE');
  await expect(page.locator('.trenching-addons-table[data-group="fill"] tbody tr td').first()).toHaveText('ASPHALT PATCH');

  await page.locator('#conduit-next-fittings').click();
  await page.locator('#conduit-next-overage').click();
  await page.locator('#conduit-save-btn').click();
  const addons = (await childrenOf(page, id)).filter((k) => k.type === 'trenchingAddon');
  expect(addons.map((a) => [a.description, a.meta?.addonGroup])).toEqual([
    ['BACKHOE', 'rental'],
    ['ASPHALT PATCH', 'fill'],
  ]);
});

test('conduit: the fitting preset fills the blank row instead of landing under it', async ({ page }) => {
  await page.goto('/');
  await openConduitRun(page);
  await page.locator('#conduit-next-fittings').click();
  const rows = page.locator('.fittings-table tbody tr');
  await expect(rows).toHaveCount(1);

  await page.locator('#fittings-preset').selectOption('90° Elbow');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('input[data-field="description"]')).toHaveValue('90° Elbow');
  await expect(rows.first().locator('input[data-field="quantity"]')).toHaveValue('1');

  // with no blank row left, the next pick appends
  await page.locator('#fittings-preset').selectOption('Coupling');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).locator('input[data-field="description"]')).toHaveValue('Coupling');
});

test('conduit and wire: one length line with its unit, and the chosen % stays pressed', async ({ page }) => {
  await page.goto('/');
  const id = await openConduitRun(page, { quantity: 220, price: 0.68 });

  // one add-on and one fitting row on screen, so every kind of number input
  // is checked below
  await page.locator('.trenching-addon-btn[data-description="BACKHOE"]').click();
  for (const step of [1, 2, 3]) {
    await page.locator(`.conduit-step-pill[data-step="${step}"]`).click();
    const lines = await page.locator('.parent-summary-line').allTextContents();
    expect(lines).toEqual(['Parent: 3/4" EMT', 'Length: 220 ft']);
    // number inputs ask for the decimal keypad (B12 F6)
    expect(await page.evaluate(() =>
      Array.from(document.querySelectorAll('.flow-page input[type="number"]')).filter((el) => !el.getAttribute('inputmode')).length
    )).toBe(0);
  }

  const pct = (p) => page.locator(`.overage-buttons button[data-percent="${p}"]`);
  await expect(pct(10)).not.toHaveClass(/active/);
  await pct(10).click();
  await expect(pct(10)).toHaveClass(/active/);
  await expect(pct(10)).toHaveAttribute('aria-pressed', 'true');
  await expect(pct(15)).not.toHaveClass(/active/);

  // a custom % belongs to no button, so nothing stays lit
  await page.locator('#overage-percent').fill('12');
  await expect(pct(10)).not.toHaveClass(/active/);
  await expect(page.locator('#overage-percent-total')).toContainText('220 + 27 additional');

  await page.evaluate((id) => { TakeoffState.setFlowDirty(false); TakeoffApp.navigateToManifest(); void id; }, id);

  const wireId = await page.evaluate(() => {
    const item = TakeoffState.addItem({ type: 'wire', description: '#12 THHN', quantity: 500, price: 0.3, labor: 0 });
    TakeoffApp.navigateToWire(item.id);
    return item.id;
  });
  expect(await page.locator('.parent-summary-line').allTextContents()).toEqual(['Parent: #12 THHN', 'Length: 500 ft']);
  await page.locator('.overage-buttons button[data-percent="5"]').click();
  await expect(page.locator('.overage-buttons button[data-percent="5"]')).toHaveClass(/active/);
  expect(wireId).toBeTruthy();
});

test('flows print a supplier price the way the rest of the app does', async ({ page }) => {
  await page.goto('/');
  await openConduitRun(page);
  await page.locator('#conduit-next-fittings').click();
  // exactly what a book fill writes: a 4-decimal supplier price
  await page.evaluate(() => {
    const temp = TakeoffState.getConduitTempData();
    temp.fittings[0] = { description: 'SERVICE POST CONNECTOR', quantity: 6, labor: 0.0833, price: 58.4697 };
    TakeoffState.setConduitTempData(temp);
    TakeoffApp.render();
  });
  const row = page.locator('.fittings-table tbody tr').first();
  await expect(row.locator('input[data-field="price"]')).toHaveValue('58.47');
  await expect(row.locator('input[data-field="labor"]')).toHaveValue('0.08');

  // under a dollar keeps four places, so a $0.1334 part is not rounded away
  await page.evaluate(() => {
    const temp = TakeoffState.getConduitTempData();
    temp.fittings[0].price = 0.1334;
    TakeoffState.setConduitTempData(temp);
    TakeoffApp.render();
  });
  await expect(row.locator('input[data-field="price"]')).toHaveValue('0.1334');
});

test('wire MAC adapters carry a price, like conduit fittings', async ({ page }) => {
  await page.goto('/');
  const id = await page.evaluate(() => {
    const item = TakeoffState.addItem({ type: 'wire', description: '#12 THHN', quantity: 500, price: 0.3, labor: 0 });
    TakeoffApp.navigateToWire(item.id);
    return item.id;
  });

  const headers = await page.locator('.wire-flow table thead th').allTextContents();
  expect(headers).toContain('Price');

  const row = page.locator('.wire-flow table tbody tr').first();
  await row.locator('input[data-field="description"]').fill('MAC connector');
  await row.locator('input[data-field="description"]').dispatchEvent('change');
  await row.locator('input[data-field="quantity"]').fill('6');
  await row.locator('input[data-field="quantity"]').dispatchEvent('change');
  await row.locator('input[data-field="price"]').fill('206.45');
  await row.locator('input[data-field="price"]').dispatchEvent('change');
  await page.locator('#wire-save-btn').click();

  const mac = (await childrenOf(page, id)).find((k) => k.type === 'macAdapter');
  expect(mac).toMatchObject({ quantity: 6, price: 206.45 });

  // and it comes back on screen instead of hiding in the stored child
  await page.evaluate((id) => TakeoffApp.navigateToWire(id), id);
  await expect(page.locator('.wire-flow table tbody tr').first().locator('input[data-field="price"]'))
    .toHaveValue('206.45');
});
