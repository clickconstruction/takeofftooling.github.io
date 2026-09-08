'use strict';
// The manifest table as a keyboard instrument (B1) and Undo telling the truth
// (T2-03, T2-04): focus lands where the work is, Tab walks fields rather than
// buttons, Enter adds a row, and the Undo button matches the stack it acts on.
const { test, expect } = require('@playwright/test');

const activeField = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName}:${el.dataset ? el.dataset.field || '' : ''}` : 'none';
  });

const rowOf = (page, description) =>
  page.locator(`tr:has(input[data-field="description"][value="${description}"])`);

test('adding a row lands the cursor in its description', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add Row' }).click();
  expect(await activeField(page)).toBe('INPUT:description');
  // and it is the NEW row's description, not the one above it
  const focusedIsLast = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input[data-field="description"]')];
    return document.activeElement === inputs[inputs.length - 1];
  });
  expect(focusedIsLast).toBe(true);
});

test('Enter in the last field of a row adds the next row and moves to it', async ({ page }) => {
  await page.goto('/');
  const before = await page.locator('input[data-field="description"]').count();
  const plan = page.locator('input[data-field="planPage"]').first();
  await plan.click();
  await plan.press('Enter');

  await expect(page.locator('input[data-field="description"]')).toHaveCount(before + 1);
  expect(await activeField(page)).toBe('INPUT:description');
});

test('picking a non-flow type lands on that row\'s labor field', async ({ page }) => {
  await page.goto('/');
  const desc = page.locator('input[data-field="description"]').first();
  await desc.fill('2x4 Troffer');
  await desc.dispatchEvent('change');

  await page.locator('.select-type-btn').first().click();
  await page.locator('#type-modal [data-type="lighting"]').click();

  expect(await activeField(page)).toBe('INPUT:labor');
  // the untyped chip is gone, replaced by the badge it was shaped like
  await expect(page.locator('.type-badge-empty')).toHaveCount(0);
});

test('Tab from a description reaches the quantity in one stop, and the row buttons keep one', async ({ page }) => {
  await page.goto('/');
  const desc = page.locator('input[data-field="description"]').first();
  await desc.click();
  await page.keyboard.press('Tab');
  expect(await activeField(page)).toBe('INPUT:quantity');

  // the book icon is still reachable — a roving group, not a hole
  const stops = await page.evaluate(() => {
    const row = document.querySelector('tbody tr[data-id]');
    return [...row.querySelectorAll('.row-btn')].filter((b) => b.tabIndex === 0).length;
  });
  expect(stops).toBe(1);

  // and the arrow keys walk the rest of the group
  await page.locator('.labor-book-icon-btn').first().focus();
  await page.keyboard.press('ArrowRight');
  const nowOn = await page.evaluate(() => document.activeElement.className);
  expect(nowOn).toContain('row-btn');
  expect(nowOn).not.toContain('labor-book-icon-btn');

  // X13: the trash is in that group — ArrowLeft off the book icon reaches it,
  // and focus alone reveals it
  await page.locator('.labor-book-icon-btn').first().focus();
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => document.activeElement.className)).toContain('remove-btn');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.activeElement).opacity)).toBe('1');
});

// X12: the chip's text is the way back to the picker; the pencil stays the
// one-click door into a flow editor, and the × is gone.
test('a typed row is re-typed from the chip, and a flow row keeps its pencil', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    TakeoffState.addItem({ type: 'lighting', description: '2x4 Troffer', quantity: 10, labor: 0.6, price: 118, parentId: null });
    const run = TakeoffState.addItem({ type: 'conduit', description: 'PVC run A', quantity: 100, labor: 0.02, price: 1, parentId: null });
    TakeoffState.addItem({ parentId: run.id, type: 'fitting', description: 'PVC glue', quantity: 1, price: 12 });
    TakeoffApp.render();
  });
  await expect(page.locator('.clear-type-btn')).toHaveCount(0);

  // a non-flow chip: its text opens the picker, and "No type" is at the bottom
  await rowOf(page, '2x4 Troffer').locator('.type-badge-text').click();
  await expect(page.locator('#type-modal')).toHaveAttribute('aria-hidden', 'false');
  await page.locator('#type-modal [data-type="gear"]').click();
  expect(await page.evaluate(() => TakeoffState.getTopLevelItems().find((i) => i.description === '2x4 Troffer').type)).toBe('gear');

  // a flow chip: the pencil opens the editor in one click
  await rowOf(page, 'PVC run A').locator('.type-badge-flow').click();
  expect(await page.evaluate(() => TakeoffState.getCurrentView())).toBe('conduit');
  await page.evaluate(() => TakeoffApp.navigateToManifest());

  // ...and its text opens the picker instead, where "No type" untypes the row
  await rowOf(page, 'PVC run A').locator('.type-badge-text').click();
  await expect(page.locator('#type-modal [data-type=""]')).toHaveText('No type');
  await page.locator('#type-modal [data-type=""]').click();
  const run = () => page.evaluate(() => TakeoffState.getTopLevelItems().find((i) => i.description === 'PVC run A'));
  expect((await run()).type).toBe(null);
  expect((await run()).children.length).toBe(1); // nothing is lost on the way
  await expect(rowOf(page, 'PVC run A').locator('.select-type-btn')).toHaveCount(1);
});

test('the first-run hint comes back when the last description is cleared', async ({ page }) => {
  await page.goto('/');
  const hint = page.locator('#manifest-first-run-hint');
  await expect(hint).toBeVisible();

  const desc = page.locator('input[data-field="description"]').first();
  await desc.fill('2x4 Troffer');
  await expect(hint).toBeHidden();
  await expect(page.locator('#manifest-below')).not.toHaveClass(/manifest-empty-hide/);

  await desc.fill('');
  await expect(hint).toBeVisible();
  await expect(page.locator('#manifest-below')).toHaveClass(/manifest-empty-hide/);
});

// T2-03: the button is refreshed by the edits that skip a render.
test('Undo wakes up after a typed quantity and after a spinner click', async ({ page }) => {
  await page.goto('/');
  const undo = page.locator('#undo-btn');
  // a cold boot has nothing to undo: the starter row is not an edit
  await expect(undo).toBeDisabled();
  expect(await page.evaluate(() => TakeoffState.canUndo())).toBe(false);

  const qty = page.locator('input[data-field="quantity"]').first();
  await qty.fill('99');
  await qty.dispatchEvent('change');
  await expect(undo).toBeEnabled();

  // and Redo stops claiming a redo the edit already dropped
  await undo.click();
  await expect(page.locator('#redo-btn')).toBeEnabled();
  const qty2 = page.locator('input[data-field="quantity"]').first();
  await qty2.fill('7');
  await qty2.dispatchEvent('change');
  await expect(page.locator('#redo-btn')).toBeDisabled();

  await page.locator('.qty-up-btn').first().click();
  await expect(undo).toBeEnabled();
});

test('Ctrl-Z outside a field undoes; inside one it is left to the browser', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    TakeoffState.addItem({ type: 'gear', description: 'Panel LP-2', quantity: 1, price: 980, parentId: null });
    TakeoffApp.render();
  });
  const rows = await page.evaluate(() => TakeoffState.getTopLevelItems().length);

  // inside a text field: the app keeps its hands off
  await page.locator('input[data-field="description"]').first().click();
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => TakeoffState.getTopLevelItems().length)).toBe(rows);

  // outside one: it undoes
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => page.evaluate(() => TakeoffState.getTopLevelItems().length)).toBe(rows - 1);
});

// T2-04: frames that undo nothing.
test('re-sending the same value after a pause pushes no second undo frame', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    TakeoffState.addItem({ type: 'gear', description: 'Panel LP-2', quantity: 40, price: 980, parentId: null });
    TakeoffApp.render();
  });
  const depth = () => page.evaluate(() => {
    let n = 0;
    while (TakeoffState.canUndo() && TakeoffState.undo()) n++;
    while (TakeoffState.canRedo()) TakeoffState.redo();
    return n;
  });
  const before = await depth();

  const qty = rowOf(page, 'Panel LP-2').locator('input[data-field="quantity"]');
  await qty.fill('55');
  await page.waitForTimeout(1400); // past the 1.2 s coalescing window
  await qty.dispatchEvent('change'); // the same 55 again, as a blur would send

  expect(await depth()).toBe(before + 1);
  await expect(rowOf(page, 'Panel LP-2').locator('input[data-field="quantity"]')).toHaveValue('55');
});

test('deleting the last row and its blank replacement are one undo', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    TakeoffState.addItem({ type: 'gear', description: 'Panel LP-2', quantity: 1, price: 980, parentId: null });
    TakeoffApp.render();
  });
  page.on('dialog', (d) => d.accept());
  // clear the starter row too, so the delete below is the last row
  await page.evaluate(() => {
    const starter = TakeoffState.getTopLevelItems().find((i) => !i.description);
    if (starter) TakeoffState.removeItem(starter.id);
    TakeoffApp.render();
  });

  await rowOf(page, 'Panel LP-2').locator('.remove-btn').click();
  await expect(page.locator('input[data-field="description"]')).toHaveCount(1);
  await expect(page.locator('input[data-field="description"]').first()).toHaveValue('');

  await page.locator('#undo-btn').click();
  await expect(page.locator('input[data-field="description"]').first()).toHaveValue('Panel LP-2');
});
