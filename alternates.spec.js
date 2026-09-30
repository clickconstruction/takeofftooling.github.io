'use strict';
// ALTERNATES (2026-09-30): a group the customer wants priced with and without.
// Guards the fact arriving (a pasted "--- Alternate: <name> ---" block lands on
// the project and the preview says so), the mark on the rows, the tag's menu
// as the switch, the with-and-without table under the summary, the text
// PipeTooling reads (alternates last under the heading), and persistence.
const { test, expect } = require('@playwright/test');

async function seed(page, rows) {
  await page.evaluate((list) => {
    for (const r of list) {
      const parent = TakeoffState.addItem({
        type: r.type || null, description: r.description, quantity: r.quantity, unit: r.unit || 'ea',
        labor: r.labor || 0, price: r.price ?? null, planPage: r.planPage || '', group: r.group || null, parentId: null,
      });
      for (const c of r.children || []) {
        TakeoffState.addItem({ type: c.type || null, description: c.description, quantity: c.quantity, labor: c.labor || 0, price: c.price ?? null, parentId: parent.id });
      }
    }
    TakeoffApp.render();
  }, rows);
}

const ROWS = [
  { type: 'devices', description: 'Duplex Receptacle', quantity: 24, group: 'LP-1 / 7', labor: 0.5, price: 18.4, planPage: 'E2.1' },
  { type: 'devices', description: 'Duplex Receptacle', quantity: 6, group: 'Break room', labor: 0.5, price: 18.4, planPage: 'E2.2',
    children: [{ type: 'misc', description: 'Box 4-11/16', quantity: 6, price: 1 }] },
  { type: 'conduit', description: '3/4" EMT', quantity: 140, unit: 'ft', group: 'Break room', labor: 0.04, price: 1.12, planPage: 'E2.2' },
  { type: 'permits', description: 'City permit', quantity: 1, price: 650 },
];

test('the tag is the switch: marks, the split table, the PipeTooling text, and the fact survives a reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await seed(page, ROWS);
  await page.evaluate(() => { TakeoffState.setLaborRate(92); TakeoffState.setTaxRate(0); TakeoffApp.render(); });

  // No alternate yet: tags are plain, no split, the text has no heading.
  await expect(page.locator('.alt-chip')).toHaveCount(0);
  await expect(page.locator('#summary-alt-split')).toHaveCount(0);

  // Tap the Break room tag → the menu → Alternate on.
  await page.locator('.row-group-tag[data-group="Break room"]').first().click();
  const toggle = page.locator('.group-tag-menu-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(page.locator('.alt-chip')).toHaveCount(2);            // the two top-level rows (a child has no plan cell)
  await expect(page.locator('tr.manifest-row-alt')).toHaveCount(3);  // the child row wears the tint with its parent
  expect(await page.evaluate(() => TakeoffState.getAlternateGroups())).toEqual(['Break room']);

  // The split: base = 24 × 18.40 + permit; the alternate = 6 × 18.40 + 6 boxes + 140 × 1.12; labor 12 h / 8.6 h.
  const split = page.locator('#summary-alt-split');
  await expect(split).toBeVisible();
  const text = (await split.innerText()).replace(/\s+/g, ' ');
  expect(text).toContain('Base + Break room With it');
  expect(text).toContain('Materials (with tax) $441.60 $273.20 $714.80');
  expect(text).toContain('Labor hours 12.00 8.60 20.60');
  expect(text).toContain('Other charges $650.00 — $650.00');
  expect(text).toContain('Direct cost $2,195.60 $1,064.40 $3,260.00');

  // The text PipeTooling reads: the alternate's rows last under the heading.
  const out = await page.evaluate(() => TakeoffHandoff.buildPipeToolingText(TakeoffState.getManifest(), TakeoffState.getCurrentProject()));
  const lines = out.text.split('\n');
  const head = lines.indexOf('--- Alternate: Break room ---');
  expect(head).toBeGreaterThan(0);
  expect(lines[head - 1]).toBe('');
  expect(lines.slice(0, head - 1)).toEqual(['[LP-1 / 7] Duplex Receptacle\t24\tE2.1']);
  expect(lines.slice(head + 1)).toEqual(['[Break room] Duplex Receptacle\t6\tE2.2', '  [Break room] Box 4-11/16\t6\tE2.2', '[Break room] ft of 3/4" EMT\t140.00\tE2.2']);
  expect(out.alternates).toEqual(['Break room']);
  const rows = await page.evaluate(() => TakeoffHandoff.buildPipeToolingRows(TakeoffState.getManifest(), TakeoffState.getCurrentProject()));
  expect(rows.filter((r) => r.alternate === true).map((r) => r.description)).toEqual(['Duplex Receptacle', 'Box 4-11/16', '3/4" EMT']);

  // A quantity edit redraws the split in place (no render).
  const qty = page.locator('tr:has(input[data-field="description"][value="3/4\\" EMT"]) input[data-field="quantity"]');
  await qty.fill('240');
  await qty.press('Tab');
  await expect(page.locator('#summary-alt-split')).toContainText('$385.20');   // 6 × 18.40 + 6 + 240 × 1.12

  // Persisted with the project.
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => typeof TakeoffState !== 'undefined' && TakeoffState.getTopLevelItems().length > 0);
  expect(await page.evaluate(() => TakeoffState.getAlternateGroups())).toEqual(['Break room']);
  await expect(page.locator('#summary-alt-split')).toBeVisible();

  // Off again from the same menu.
  await page.locator('.row-group-tag[data-group="Break room"]').first().click();
  await expect(page.locator('.group-tag-menu-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.group-tag-menu-toggle').click();
  await expect(page.locator('.alt-chip')).toHaveCount(0);
  await expect(page.locator('#summary-alt-split')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a pasted CountTooling export with an alternate block: the preview names it, Add lands it on the project', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  const text = [
    '[LP-1 / 7] Duplex Receptacle\t24\tE2.1',
    '',
    '--- Alternate: Break room ---',
    '[Break room] Duplex Receptacle\t6\tE2.2',
    '[Break room] ft of 3/4" EMT\t140.00\tE2.2',
    '',
    '--- Water sizing ---',
    'Cold main\t1″\t3 fixtures · 12 WSFU\t8.0 gpm\t5.1 fps\t✓',
  ].join('\n');
  await page.evaluate((t) => TakeoffImport.importText(t), text);
  const modal = page.locator('#import-preview-modal');
  await expect(modal).toHaveAttribute('aria-hidden', 'false');
  await expect(modal.locator('.import-preview-notice-alt')).toContainText('1 alternate: Break room');
  await expect(modal.locator('.group-tag-alt')).toHaveCount(2);
  await expect(modal.locator('.import-preview-desc', { hasText: 'Cold main' })).toHaveCount(0);   // a schedule row, never a count
  await page.locator('#import-preview-add-btn').click();
  await expect(modal).toHaveAttribute('aria-hidden', 'true');
  expect(await page.evaluate(() => TakeoffState.getAlternateGroups())).toEqual(['Break room']);
  expect(await page.evaluate(() => TakeoffState.getTopLevelItems().filter((i) => i.description).map((i) => [i.description, i.group]))).toEqual([
    ['Duplex Receptacle', 'LP-1 / 7'], ['Duplex Receptacle', 'Break room'], ['3/4" EMT', 'Break room'],
  ]);
  await expect(page.locator('.alt-chip')).toHaveCount(2);
  await expect(page.locator('#summary-alt-split')).toBeVisible();
  expect(errors).toEqual([]);
});
