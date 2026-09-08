'use strict';
/**
 * The assembly kernel in the UI (the Explode button), the bid stamp + review lane
 * chips, and the Manage Projects review select — the human-side surfaces of the
 * twin seat-and-door build. The agent door itself (import-manifest) is a Deno
 * function exercised by its callers; its kernel is unit-tested in explode.test.js.
 */
const { test, expect } = require('@playwright/test');

test('Explode fills a receptacle row with its assembly, priced from the book', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');

  // a typed, named, counted receptacle row (via the import path — same shape as the door)
  await page.evaluate(() => TakeoffImport.importText('Duplex Receptacle\t6\t1\n'));
  await page.locator('#import-preview-add-btn').click();
  const explode = page.locator('.explode-btn');
  await expect(explode).toHaveCount(1);
  await expect(explode).toHaveAttribute('title', /Receptacle assembly/);
  // it is one of the row's icon buttons, not a browser-default block: same
  // colour and box as the book icon beside it (it used to be a white square)
  const boxes = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      const c = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { bg: c.backgroundColor, color: c.color, border: c.borderStyle, w: Math.round(r.width), h: Math.round(r.height) };
    };
    return { explode: pick('.explode-btn'), book: pick('.labor-book-icon-btn') };
  });
  expect(boxes.explode).toEqual(boxes.book);
  await explode.click();

  const kids = await page.evaluate(() => {
    const parent = TakeoffState.getTopLevelItems().find((i) => i.description === 'Duplex Receptacle');
    return parent.children.map((c) => ({ d: c.description, q: c.quantity, t: c.type, priced: c.price != null }));
  });
  expect(kids.map((k) => k.d)).toEqual(['4" Square Box, 1-1/2" deep', '4" Square 1-Gang Mud Ring', '1-Gang Duplex Plate', '1/2" EMT Set-Screw Connector']);
  expect(kids.map((k) => k.q)).toEqual([6, 6, 6, 12]);
  expect(kids.slice(0, 3).every((k) => k.priced)).toBe(true);     // curated defaults price these
  expect(kids[3].priced).toBe(false);                             // no book row → left unpriced, never guessed
  await expect(page.locator('#toast-region .toast', { hasText: 'Added 4 assembly rows' })).toBeVisible();
  // once children exist the button is gone (the estimator's rows win)
  await expect(page.locator('.explode-btn')).toHaveCount(0);
  // one undo frame removes the whole assembly
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await page.evaluate(() => TakeoffState.getTopLevelItems().find((i) => i.description === 'Duplex Receptacle').children.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('bid stamp and review lane: chips in the header, select in Manage Projects, persisted on the project', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    TakeoffState.setExternalRef('b409');
    TakeoffState.setReviewStatus('ready');
    TakeoffState.persistNow();
    TakeoffProjectsView.updateHeader();
  });
  await expect(page.locator('#project-ref-chip')).toHaveText('b409');
  await expect(page.locator('#project-review-chip')).toHaveText('Ready for review');
  await expect(page.locator('#project-review-chip')).toHaveAttribute('data-status', 'ready');

  const doc = await page.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem('takeoff-projects-index'));
    return JSON.parse(localStorage.getItem('takeoff-project-' + idx.currentId));
  });
  expect(doc.externalRef).toBe('b409');
  expect(doc.reviewStatus).toBe('ready');

  await page.evaluate(() => TakeoffProjectsView.openModal());
  const sel = page.locator('.projects-review-select').first();
  await expect(sel).toHaveValue('ready');
  await sel.selectOption('reviewed');
  await expect(page.locator('#project-review-chip')).toHaveText('Reviewed');
  await expect(page.locator('#toast-region .toast', { hasText: 'Marked reviewed' })).toBeVisible();
  await sel.selectOption('draft');
  await expect(page.locator('#project-review-chip')).toBeHidden();
});
