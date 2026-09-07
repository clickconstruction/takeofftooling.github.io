'use strict';
/**
 * The CountTooling → TakeoffTooling → PipeTooling round trip, in the browser:
 * the checked-in CountTooling export (import-files/counttooling-export.fixture.txt)
 * goes through the paste path and lands as typed, unit-tagged, grouped rows
 * with children; the plans link reaches the project; px rows stay out of the
 * totals; the tax rate is a project setting; and "Copy for PipeTooling"
 * reproduces the text PipeTooling's Counts import reads.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'import-files', 'counttooling-export.fixture.txt'), 'utf8');

test('CountTooling fixture imports faithfully and copies back out for PipeTooling', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  await page.evaluate((text) => TakeoffImport.importText(text), FIXTURE);
  const modal = page.locator('#import-preview-modal');
  await expect(modal).toHaveAttribute('aria-hidden', 'false');
  await expect(modal).toContainText('unscaled');           // px notice
  await expect(modal).toContainText('Plans link found');   // footer detected
  await expect(modal.locator('.import-preview-item-child')).toHaveCount(3);
  await page.locator('#import-preview-all-btn').click();
  await expect(modal).toHaveAttribute('aria-hidden', 'true');

  const shape = await page.evaluate(() => {
    const tops = TakeoffState.getTopLevelItems().filter((i) => (i.description || '').trim());
    const by = Object.fromEntries(tops.map((i) => [i.description, i]));
    return {
      count: tops.length,
      recept: { unit: by['Duplex Receptacle'].unit, type: by['Duplex Receptacle'].type, group: by['Duplex Receptacle'].group, children: by['Duplex Receptacle'].children.map((c) => [c.description, c.quantity, c.type]) },
      emt: { unit: by['1/2" EMT'].unit, type: by['1/2" EMT'].type, qty: by['1/2" EMT'].quantity, children: by['1/2" EMT'].children.map((c) => [c.description, c.type]) },
      feeder: { unit: by['Feeder to LP-2'].unit },
      plansUrl: TakeoffState.getCurrentProject().plansUrl,
      unscaled: TakeoffState.getSummaryBreakdown().unscaledCount,
      taxRate: TakeoffState.getTaxRate(),
    };
  });
  expect(shape.count).toBe(10);
  expect(shape.recept).toEqual({ unit: 'ea', type: 'devices', group: 'LP-1 / 7', children: [['4" Square Box', 6, 'misc']] });
  expect(shape.emt).toEqual({ unit: 'ft', type: 'conduit', qty: 143, children: [['Coupling', 'fitting'], ['1-Hole Strap', 'fitting']] });
  expect(shape.feeder.unit).toBe('px');
  expect(shape.plansUrl).toBe('https://counttooling.com/app/?t=0f4c2a1e-6b7d-4e3a-9c21-8d5f6a7b9c0d');
  expect(shape.unscaled).toBe(1);
  expect(shape.taxRate).toBe(8.25);

  // header plans link, unit tags, group tag, unscaled note, tax input
  await expect(page.locator('#project-plans-link')).toBeVisible();
  await expect(page.locator('tr.row-unscaled')).toHaveCount(1);
  await expect(page.locator('.group-tag').first()).toHaveText('LP-1 / 7');
  await expect(page.locator('.summary-unscaled-note')).toContainText('1 unscaled row');
  await page.locator('#tax-rate-input').fill('8');
  await page.locator('#tax-rate-input').press('Tab');
  await expect.poll(() => page.evaluate(() => TakeoffState.getTaxRate())).toBe(8);

  // the way back out: PipeTooling's Counts-import text, with the plans link footer
  const out = await page.evaluate(() => TakeoffHandoff.buildPipeToolingText(TakeoffState.getManifest(), TakeoffState.getCurrentProject()));
  const lines = out.text.split('\n');
  expect(lines).toContain('[LP-1 / 7] Duplex Receptacle\t6\t1');
  expect(lines).toContain('  [LP-1 / 7] 4" Square Box\t6\t1');
  expect(lines).toContain('[LP-1 / 7] ft of 1/2" EMT\t143.00\t1');
  expect(lines).toContain('  [LP-1 / 7] Coupling\t15\t1');
  expect(lines).toContain('ft of MC 12/2\t2100.00\t1, 3');
  expect(lines).toContain('px of Feeder to LP-2\t1840\t4');
  expect(lines[lines.length - 1]).toBe('View link:\thttps://counttooling.com/app/?t=0f4c2a1e-6b7d-4e3a-9c21-8d5f6a7b9c0d');
  expect(out).toMatchObject({ counts: 10, feet: 2, unscaled: 1 });

  // the header menu button reaches the same text
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#header-menu-btn').click();
  await page.locator('#copy-pipetooling-btn').click();
  await expect(page.locator('#toast-region .toast', { hasText: 'Copied' })).toContainText('Copied 13 rows for PipeTooling');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(out.text);

  // a second import as overages raises nothing (same totals) and adds nothing
  await page.evaluate((text) => TakeoffImport.importText(text), FIXTURE);
  await page.locator('#import-preview-overages-btn').click();
  expect(await page.evaluate(() => TakeoffState.getTopLevelItems().filter((i) => (i.description || '').trim()).length)).toBe(10);

  expect(errors).toEqual([]);
});

test('paste fallback opens when the clipboard is unavailable', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); });
  await page.locator('#import-count-tooling-btn').click();
  await expect(page.locator('#import-paste-modal')).toHaveAttribute('aria-hidden', 'false');
  await page.locator('#import-paste-text').fill('Type A\t14\t2\n');
  await page.locator('#import-paste-import-btn').click();
  await expect(page.locator('#import-preview-modal')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#import-preview-modal')).toContainText('Type A');
});
