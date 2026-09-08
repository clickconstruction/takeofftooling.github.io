'use strict';
// Device flow: field commits, component-quantity semantics, per-run assemblies,
// the collapsed-to-chips shape, Undo load, and the no-change save.
// Covers T1-01 (devices half), T1-08, T1-09, T2-04 (devices half), T2-07,
// T2-08 (flow half) and B7.
const { test, expect } = require('@playwright/test');

// Seed a 20-run devices line and open its flow editor.
async function openDeviceFlow(page, quantity = 20) {
  await page.goto('/');
  return page.evaluate((qty) => {
    const it = TakeoffState.addItem({
      type: 'devices',
      description: 'Office receptacle runs',
      quantity: qty,
      labor: 0.18,
      price: null,
      parentId: null,
    });
    TakeoffApp.navigateToDevice(it.id);
    return it.id;
  }, quantity);
}

test('T1-01 — the first click after typing a quantity is not swallowed', async ({ page }) => {
  await openDeviceFlow(page);

  // sections start as chips (B7) — open Boxes first
  await page.getByRole('button', { name: '+ Box', exact: true }).click();
  const boxes = page.locator('.flow-section', { has: page.getByRole('heading', { name: 'Boxes' }) });
  const desc = boxes.locator('input[data-field="description"]').first();
  const qty = boxes.locator('input[data-field="quantity"]').first();

  await desc.fill('4" square box');
  await qty.fill('40');

  // The mechanism, pinned directly: leaving an edited field must not rebuild
  // the page. It used to, so the control the estimator was aiming at was
  // destroyed between mousedown (which fires `change`) and click, and the
  // first click after typing did nothing. Measured on the pre-fix code:
  // both nodes came back isConnected === false.
  const survived = await page.evaluate(() => {
    const save = document.getElementById('device-save-btn');
    const input = document.querySelector('input[data-field="quantity"]');
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { save: save.isConnected, input: input.isConnected };
  });
  expect(survived).toEqual({ save: true, input: true });

  await boxes.getByRole('button', { name: '+ Box', exact: true }).click();
  await expect(boxes.locator('input[data-field="description"]')).toHaveCount(2);

  // and the typed values survived the render the click did cause
  await expect(boxes.locator('input[data-field="description"]').first()).toHaveValue('4" square box');
  await expect(boxes.locator('input[data-field="quantity"]').first()).toHaveValue('40');

  // ×2 on the same row, again on the first click after typing
  await boxes.locator('input[data-field="quantity"]').first().fill('30');
  await boxes.locator('.device-qty-x2-btn').first().click();
  await expect(boxes.locator('input[data-field="quantity"]').first()).toHaveValue('60');

  // and Save lands on the first click too
  await page.locator('#device-save-btn').click();
  await expect(page.locator('#device-save-btn')).toHaveCount(0);
  const saved = await page.evaluate(() =>
    TakeoffState.getTopLevelItems().find((i) => i.description === 'Office receptacle runs')
      .children.map((c) => [c.description, c.quantity])
  );
  expect(saved).toContainEqual(['4" square box', 60]);
});

test('T1-08 — component rows are seeded with the run count and the screen says so', async ({ page }) => {
  await openDeviceFlow(page);

  // B7: an untouched flow is eight chips, no tables (was ~1,200 px of empty
  // tables at 1440). Every section name is still on screen.
  await expect(page.locator('.flow-section')).toHaveCount(0);
  await expect(page.locator('.device-section-chips .add-device-section-chip')).toHaveCount(8);

  // the row a chip adds carries the parent's 20, not 1 — and the caret lands
  // in the description it just made
  await page.getByRole('button', { name: '+ Box', exact: true }).click();
  const boxes = page.locator('.flow-section', { has: page.getByRole('heading', { name: 'Boxes' }) });
  await expect(boxes.locator('input[data-field="quantity"]').first()).toHaveValue('20');
  await expect(boxes.locator('input[data-field="description"]').first()).toBeFocused();

  // the column head declares the rule
  await expect(page.locator('.flow-section thead').first()).toContainText('Quantity (all 20 runs)');

  // a row added later is seeded the same way
  await boxes.getByRole('button', { name: '+ Box', exact: true }).click();
  await expect(boxes.locator('input[data-field="quantity"]').nth(1)).toHaveValue('20');

  // the panel prints both readings of the same money, and no summed Quantity
  await page.getByRole('button', { name: '+ Outlet/Switch', exact: true }).click();
  const outlets = page.locator('.flow-section', { has: page.getByRole('heading', { name: 'Outlets and Switches' }) });
  await expect(page.locator('#device-cum-qty')).toHaveCount(0);
  await outlets.locator('input[data-field="description"]').first().fill('Decora receptacle');
  await outlets.locator('input[data-field="price"]').first().fill('3.85');
  await expect(page.locator('#device-cum-price')).toHaveText('77.00');
  await expect(page.locator('#device-cum-per-run')).toHaveText('— $3.85 per run');

  // blank seeded rows still never reach the bid (isMeaningfulRow ignores qty)
  await page.locator('#device-save-btn').click();
  const kids = await page.evaluate(() =>
    TakeoffState.getTopLevelItems().find((i) => i.description === 'Office receptacle runs').children.length
  );
  expect(kids).toBe(1);
});

test('T1-09 — a saved assembly is a per-run recipe and loads onto a different run count', async ({ page }) => {
  const id20 = await openDeviceFlow(page, 20);

  await page.getByRole('button', { name: '+ Outlet/Switch', exact: true }).click();
  const outlets = page.locator('.flow-section', { has: page.getByRole('heading', { name: 'Outlets and Switches' }) });
  await outlets.locator('input[data-field="description"]').first().fill('Decora receptacle');
  await outlets.locator('input[data-field="price"]').first().fill('3.85');
  await outlets.locator('input[data-field="labor"]').first().fill('0.023');

  await page.locator('#device-save-assembly-btn').click();
  await page.locator('#device-assembly-name').fill('Break room duplex');
  await page.locator('#device-assembly-name-save').click();

  const stored = await page.evaluate(() => {
    const a = TakeoffState.getAssemblies().find((x) => x.name === 'Break room duplex');
    return { perRun: a.perRun, sourceQty: a.sourceQty, qty: a.sections.outletsAndSwitches[0].quantity };
  });
  expect(stored).toEqual({ perRun: true, sourceQty: 20, qty: 1 });

  // the card reads per run, not as a naked extended total
  await expect(page.locator('.assembly-card-price').first()).toHaveText(/\$3\.85 per run · 0\.02 hrs per run · 1 part/);

  // load it onto an 8-run line
  await page.evaluate((prev) => {
    TakeoffState.setFlowDirty(false);
    const it = TakeoffState.addItem({ type: 'devices', description: 'Corridor runs', quantity: 8, parentId: null });
    TakeoffApp.navigateToDevice(it.id);
    return prev;
  }, id20);
  await page.locator('#assemblies-load-btn').click();

  const outlets8 = page.locator('.flow-section', { has: page.getByRole('heading', { name: 'Outlets and Switches' }) });
  await expect(outlets8.locator('input[data-field="quantity"]').first()).toHaveValue('8');
  await expect(page.locator('#device-cum-price')).toHaveText('30.80');
  await expect(page.locator('#device-flow-note')).toContainText('quantities set for 8 runs');
});

test('T1-09 — a legacy (totals) assembly loads unscaled and says so', async ({ page }) => {
  await openDeviceFlow(page, 8);
  await page.evaluate(() => {
    // the pre-perRun shape: absolute quantities, no flag
    TakeoffState.setAssemblies([{
      id: 'legacy-1',
      name: 'Old preset',
      sections: { outletsAndSwitches: [{ description: 'Decora receptacle', quantity: 20, labor: 0, price: 3.85 }] },
      createdAt: new Date().toISOString(),
    }]);
    TakeoffApp.render();
  });
  await page.locator('#assemblies-load-btn').click();
  const outlets = page.locator('.flow-section', { has: page.getByRole('heading', { name: 'Outlets and Switches' }) });
  await expect(outlets.locator('input[data-field="quantity"]').first()).toHaveValue('20');
  await expect(page.locator('#device-flow-note')).toContainText('saved as totals');
});

test('T1-09 — a per-run ratio rounds up to whole parts on load', async ({ page }) => {
  await openDeviceFlow(page, 8);
  await page.evaluate(() => {
    // one support per 20 runs = 0.05 per run; 0.05 × 8 = 0.4 parts, which is
    // not orderable — the load must round up to 1.
    TakeoffState.setAssemblies([{
      id: 'ratio-1',
      name: 'Support recipe',
      perRun: true,
      sourceQty: 20,
      sections: { backBoxSupport: [{ description: 'CADDY box support', quantity: 0.05, labor: 0, price: 1.2 }] },
      createdAt: new Date().toISOString(),
    }]);
    TakeoffApp.render();
  });
  await page.locator('#assemblies-load-btn').click();
  const support = page.locator('.flow-section', { has: page.getByRole('heading', { name: 'Back Box Support' }) });
  await expect(support.locator('input[data-field="quantity"]').first()).toHaveValue('1');
  // a legacy assembly's blank seed rows do not come back as tables
  await expect(page.locator('.flow-section')).toHaveCount(1);
});

test('B7 — the page is titled with the run, and the two saves read differently', async ({ page }) => {
  await openDeviceFlow(page);
  await expect(page.locator('.device-header-row h2')).toHaveText('Office receptacle runs — parts');
  await expect(page.locator('#device-save-btn')).toHaveText('Save parts to the bid');
  await expect(page.locator('#device-save-assembly-btn')).toHaveText('Save as an assembly →');

  // the assembly-name row carries no second Cancel (the page already has one)
  await page.locator('#device-save-assembly-btn').click();
  await expect(page.locator('#device-assembly-name-cancel')).toHaveCount(0);
  await expect(page.locator('.flow-actions #device-cancel-btn')).toHaveCount(1);
});

test('B7 — a saved assembly carries only rows with substance', async ({ page }) => {
  await openDeviceFlow(page, 20);
  await page.getByRole('button', { name: '+ Outlet/Switch', exact: true }).click();
  const outlets = page.locator('.flow-section', { has: page.getByRole('heading', { name: 'Outlets and Switches' }) });
  await outlets.locator('input[data-field="description"]').first().fill('Decora receptacle');
  await outlets.locator('input[data-field="price"]').first().fill('3.85');
  // an empty row the estimator opened and left alone must not be stored
  await page.getByRole('button', { name: '+ Screws', exact: true }).click();

  await page.locator('#device-save-assembly-btn').click();
  await page.locator('#device-assembly-name').fill('Break room duplex');
  await page.locator('#device-assembly-name-save').click();

  const sections = await page.evaluate(() =>
    Object.keys(TakeoffState.getAssemblies().find((x) => x.name === 'Break room duplex').sections)
  );
  expect(sections).toEqual(['outletsAndSwitches']);

  // and the card lists only real rows, not eight lines of "- × 1 | Labor: 0"
  await page.locator('.assemblies-section-header').click();
  await page.locator('.assembly-card-header').first().click();
  await expect(page.locator('.assembly-card-body li')).toHaveCount(1);
});

test('T2-07 — a load that replaces parts says so and can be undone', async ({ page }) => {
  await openDeviceFlow(page, 20);
  await page.evaluate(() => {
    TakeoffState.setAssemblies([{
      id: 'a-1',
      name: 'Break room duplex',
      perRun: true,
      sourceQty: 20,
      sections: { outletsAndSwitches: [{ description: 'Decora receptacle', quantity: 1, labor: 0.02, price: 3.85 }] },
      createdAt: new Date().toISOString(),
    }]);
    TakeoffApp.render();
  });

  // something to lose: a row typed a moment ago in another section
  await page.getByRole('button', { name: '+ Misc.', exact: true }).click();
  const misc = page.locator('.flow-section', { has: page.getByRole('heading', { name: 'Misc.' }) });
  await misc.locator('input[data-field="description"]').first().fill('Corridor pull string');

  await page.locator('#assemblies-load-btn').click();
  await expect(page.locator('#device-flow-note')).toContainText('Replaced 1 part');
  await expect(page.locator('.flow-section', { has: page.getByRole('heading', { name: 'Misc.' }) })).toHaveCount(0);

  await page.locator('#device-undo-load-btn').click();
  const miscBack = page.locator('.flow-section', { has: page.getByRole('heading', { name: 'Misc.' }) });
  await expect(miscBack.locator('input[data-field="description"]').first()).toHaveValue('Corridor pull string');
  await expect(page.locator('#device-flow-note')).toContainText('Load undone');
});

test('T2-07 — a load onto an empty flow puts no decision on the happy path', async ({ page }) => {
  await openDeviceFlow(page, 20);
  await page.evaluate(() => {
    TakeoffState.setAssemblies([{
      id: 'a-1', name: 'Break room duplex', perRun: true, sourceQty: 20,
      sections: { boxes: [{ description: '4" square box', quantity: 1, labor: 0.1, price: 2.5 }] },
      createdAt: new Date().toISOString(),
    }]);
    TakeoffApp.render();
  });
  await page.locator('#assemblies-load-btn').click();
  await expect(page.locator('#device-flow-note')).not.toContainText('Replaced');
  await expect(page.locator('#device-undo-load-btn')).toHaveCount(0);
});

test('T2-08 — a flow row has one book door (PB), not two', async ({ page }) => {
  await openDeviceFlow(page);
  await page.getByRole('button', { name: '+ Box', exact: true }).click();
  const cell = page.locator('.flow-section .labor-book-cell').first();
  await expect(cell.locator('.part-book-icon-btn')).toHaveCount(1);
  await expect(cell.locator('.labor-book-icon-btn')).toHaveCount(0);
  expect(await page.evaluate(() => typeof TakeoffApp.showLaborBookModalForDeviceRow)).toBe('undefined');
});

// --- X8: a saved recipe can be renamed and re-recorded, not only replaced ---

// Seed one saved recipe on an N-run line. Every render collapses the
// assemblies section and its cards again, so expanding is its own step.
async function openWithAssembly(page, quantity = 20, assembly = {}) {
  await openDeviceFlow(page, quantity);
  await page.evaluate((a) => {
    TakeoffState.setAssemblies([{
      id: 'a-1',
      name: 'Break room duplex',
      perRun: true,
      sourceQty: 20,
      sections: { outletsAndSwitches: [{ description: 'Decora receptacle', quantity: 1, labor: 0.02, price: 3.85 }] },
      createdAt: new Date().toISOString(),
      ...a,
    }]);
    TakeoffApp.render();
  }, assembly);
  await expandAssemblyCard(page);
}

async function expandAssemblyCard(page) {
  await page.locator('.assemblies-section-header').click();
  await page.locator('.assembly-card-header').first().click();
  await expect(page.locator('.assembly-card-actions').first()).toBeVisible();
}

test('X8 — a saved recipe can be renamed in place, keeping its id', async ({ page }) => {
  await openWithAssembly(page);

  await page.locator('.assembly-rename-btn').first().click();
  const input = page.locator('.assembly-rename-input').first();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('Break room duplex');
  await input.fill('Break room duplex — TR');
  await input.press('Enter');

  const stored = await page.evaluate(() => TakeoffState.getAssemblies().map((a) => [a.id, a.name]));
  // the id survives: the cloud merges assemblies as a union by id, so a rename
  // has to be an edit of that row, not a second copy of it
  expect(stored).toEqual([['a-1', 'Break room duplex — TR']]);
  await expect(page.locator('.assembly-card-header').first()).toContainText('Break room duplex — TR');
  await expect(page.locator('#assemblies-select option').first()).toHaveText('Break room duplex — TR');
  await expect(page.locator('#device-flow-note')).toContainText('Renamed');
});

test('X8 — Update from this run overwrites the recipe with per-run rows, and can be undone', async ({ page }) => {
  // re-record from an 8-run line: the stored quantity must be the ratio, not 8
  await openWithAssembly(page, 8);

  await page.getByRole('button', { name: '+ Box', exact: true }).click();
  const boxes = page.locator('.flow-section', { has: page.getByRole('heading', { name: 'Boxes' }) });
  await boxes.locator('input[data-field="description"]').first().fill('1900 box');
  await boxes.locator('input[data-field="labor"]').first().fill('0.1');
  await boxes.locator('input[data-field="quantity"]').first().fill('16'); // 2 per run

  await expandAssemblyCard(page); // the renders above folded it back up
  await page.locator('.assembly-update-btn').first().click();

  const after = await page.evaluate(() => {
    const a = TakeoffState.getAssemblies()[0];
    return { id: a.id, perRun: a.perRun, sourceQty: a.sourceQty, sections: Object.keys(a.sections), qty: a.sections.boxes[0].quantity };
  });
  expect(after).toEqual({ id: 'a-1', perRun: true, sourceQty: 8, sections: ['boxes'], qty: 2 });
  await expect(page.locator('#device-flow-note')).toContainText('Updated "Break room duplex" from this run — 1 part');

  // the old rows are one click away
  await page.locator('#device-undo-update-btn').click();
  const back = await page.evaluate(() => {
    const a = TakeoffState.getAssemblies()[0];
    return { sourceQty: a.sourceQty, sections: Object.keys(a.sections), desc: a.sections.outletsAndSwitches[0].description };
  });
  expect(back).toEqual({ sourceQty: 20, sections: ['outletsAndSwitches'], desc: 'Decora receptacle' });
  await expect(page.locator('#device-flow-note')).toContainText('Update undone');
});

test('X8 — Update from an empty run refuses instead of blanking the recipe', async ({ page }) => {
  await openWithAssembly(page, 20);
  await page.locator('.assembly-update-btn').first().click();
  await expect(page.locator('#device-flow-note')).toContainText('Nothing on this run to record');
  const kept = await page.evaluate(() => Object.keys(TakeoffState.getAssemblies()[0].sections));
  expect(kept).toEqual(['outletsAndSwitches']);
});

test('X8 — editing a recipe never marks the run dirty, so Cancel leaves without a guard', async ({ page }) => {
  await openWithAssembly(page, 20);
  await page.locator('.assembly-rename-btn').first().click();
  await page.locator('.assembly-rename-input').first().fill('Corridor duplex');
  await page.locator('.assembly-rename-save').first().click();

  // assemblies are a cabinet of recipes, not the bid: nothing is waiting on
  // Save, so the flow is still clean and Cancel must not stop to ask
  expect(await page.evaluate(() => TakeoffState.getFlowDirty())).toBe(false);
  let asked = false;
  page.on('dialog', (d) => { asked = true; d.dismiss(); });
  await page.locator('#device-cancel-btn').click();
  await expect(page.locator('#device-cancel-btn')).toHaveCount(0);
  expect(asked).toBe(false);
});

test('T2-04 — a no-change save pushes no undo frame and keeps the child ids', async ({ page }) => {
  await page.goto('/');
  // depth without disturbing the manifest: unwind, then wind back up
  const depth = () =>
    page.evaluate(() => {
      let n = 0;
      while (TakeoffState.canUndo()) { TakeoffState.undo(); n++; }
      while (TakeoffState.canRedo()) TakeoffState.redo();
      return n;
    });

  const id = await page.evaluate(() => {
    const it = TakeoffState.addItem({ type: 'devices', description: 'Office receptacle runs', quantity: 20, parentId: null });
    TakeoffState.addItem({ type: 'box', description: '4" square box', quantity: 20, labor: 0.1, price: 2.5, parentId: it.id });
    TakeoffState.addItem({ type: 'cover', description: 'Decora plate', quantity: 20, labor: 0.05, price: 0.8, parentId: it.id });
    TakeoffApp.navigateToDevice(it.id);
    return it.id;
  });
  const idsOf = () => page.evaluate((i) => (TakeoffState.getItemById(i).children || []).map((c) => c.id), id);

  const before = await idsOf();
  const depthBefore = await depth();

  await page.locator('#device-save-btn').click();
  expect(await idsOf()).toEqual(before);
  expect(await depth()).toBe(depthBefore);

  // an edited save is one frame, and the row that did not change keeps its id
  await page.evaluate((i) => TakeoffApp.navigateToDevice(i), id);
  const boxes = page.locator('.flow-section', { has: page.getByRole('heading', { name: 'Boxes' }) });
  await boxes.locator('input[data-field="quantity"]').first().fill('40');
  await page.locator('#device-save-btn').click();
  expect(await depth()).toBe(depthBefore + 1);
  expect(await idsOf()).toEqual(before);
});
