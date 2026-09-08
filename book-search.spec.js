'use strict';
// The book's search, its chrome, and the part card's provenance trail.
// Covers T2-09 (ranking + the trade's words + honest bucket labels),
// T2-10 (the assemblies filter + the abbreviation key) and the B5/B6 batches.
const { test, expect } = require('@playwright/test');

const BUCKETS = {
  parts: 'Your book (hours)',
  assemblies: 'MC assemblies (hours + material)',
  elliot: 'Supply house · Elliot (prices)',
};

async function openBook(page) {
  await page.goto('/');
  await page.locator('#labor-book-open-btn').click();
  await expect(page.locator('#labor-book-modal')).toHaveAttribute('aria-hidden', 'false');
}

// Type a query and wait for the async (assemblies + supply house) halves.
async function search(page, term) {
  await page.locator('#labor-book-global-search').fill(term);
  await expect(page.locator('#labor-book-search-results')).toBeVisible();
  await expect(page.locator('.lb-search-loading')).toHaveCount(0, { timeout: 20000 });
}

const bucketNames = (page, bucket) =>
  page.locator(`.lb-search-group[data-bucket="${bucket}"] .lb-search-name`).allTextContents();

test('T2-09 — the book speaks the trade, and each bucket says what it brings', async ({ page }) => {
  await openBook(page);
  await search(page, '2p 20a breaker');

  // MC writes an enclosed breaker "ENCL CB 2P": the query used to find nothing
  const assemblies = await bucketNames(page, 'assemblies');
  expect(assemblies.length).toBeGreaterThan(0);
  expect(assemblies.join(' | ')).toMatch(/CB|BREAKER|BRKR/i);

  // the three buckets are named for what they carry, not for a vendor
  const headings = await page.locator('.lb-search-group h3').allTextContents();
  for (const label of Object.values(BUCKETS)) {
    expect(headings.some((h) => h.includes(label))).toBe(true);
  }
  await expect(page.locator('.lb-search-legend')).toContainText('hours');
});

test('T2-09 — a synonym matches a whole word, so support is not supply', async ({ page }) => {
  await openBook(page);
  await search(page, 'box support');

  const names = await bucketNames(page, 'elliot');
  expect(names.length).toBeGreaterThan(0);
  // the abbreviation "supp" reaches BOX SUPPORT and no longer reaches SUPPLY
  expect(names[0]).toMatch(/supp/i);
  expect(names.filter((n) => /power supply/i.test(n))).toEqual([]);
});

test('T2-09 — "exit sign" finds the exit lights', async ({ page }) => {
  await openBook(page);
  await search(page, 'exit sign');
  const hits = (await bucketNames(page, 'assemblies')).concat(await bucketNames(page, 'elliot'));
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.join(' | ')).toMatch(/exit/i);
});

test('T2-09 — the words you typed outrank the ones an abbreviation reached', async ({ page }) => {
  await page.goto('/');
  const out = await page.evaluate(() => {
    const rank = TakeoffUtils.makeSearchRanker('2p 20a breaker');
    return { literal: rank('20A 2P BREAKER 10KAIC'), synonym: rank('20A ENCL CB 2P 250V') };
  });
  expect(out.synonym).toBeGreaterThan(0);
  expect(out.literal).toBeGreaterThan(out.synonym);
});

test('B5 — Esc clears the term from anywhere in the book, then closes it', async ({ page }) => {
  await openBook(page);
  await search(page, 'pull elbow');

  // focus is on an Add button, not the search box — the case that used to
  // close the book while the term survived
  const add = page.locator('.lb-search-add').first();
  await add.focus();
  await page.keyboard.press('Escape');

  await expect(page.locator('#labor-book-modal')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#labor-book-global-search')).toHaveValue('');
  await expect(page.locator('#labor-book-tabs')).toBeVisible();
  expect(await page.evaluate(() => TakeoffLaborBookSearch.getTerm())).toBe('');

  // a second Escape closes, and reopening is not showing stale results
  await page.keyboard.press('Escape');
  await expect(page.locator('#labor-book-modal')).toHaveAttribute('aria-hidden', 'true');
  await page.locator('#labor-book-open-btn').click();
  await expect(page.locator('#labor-book-tabs')).toBeVisible();
  await expect(page.locator('#labor-book-search-results')).toBeHidden();
  // and the door primes the search box
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('labor-book-global-search');
});

test('B5 — closing the book drops the term with it', async ({ page }) => {
  await openBook(page);
  await search(page, 'wire nut');
  await page.locator('#labor-book-close-btn').click();
  expect(await page.evaluate(() => TakeoffLaborBookSearch.getTerm())).toBe('');
  await expect(page.locator('#labor-book-global-search')).toHaveValue('');
});

test('B5 — no fixture selected says so on the page, not in a dialog', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await openBook(page);
  await search(page, 'wire nut');
  await page.locator('.lb-search-add').first().click();
  await expect(page.locator('#toast-region')).toContainText('Pick a fixture');
  expect(dialogs).toEqual([]);
});

test('B5 — "Show all" has a way back to the first hundred', async ({ page }) => {
  await openBook(page);
  const block = page.locator('.lb-supplier-section').filter({ hasText: 'Distribution Equipment' }).first();
  await expect(block).toBeVisible({ timeout: 20000 });
  await block.locator('.labor-book-section-header').click();
  const rows = block.locator('tbody tr[data-entry]');
  await expect(rows).toHaveCount(100, { timeout: 20000 });

  await block.locator('.elliot-show-all-btn').click();
  expect(await rows.count()).toBeGreaterThan(100);

  await block.locator('.elliot-show-fewer-btn').click();
  await expect(rows).toHaveCount(100);
});

test('B5 — Export Groups & Sections is maintainer tooling, not footer furniture', async ({ page }) => {
  await openBook(page);
  await expect(page.locator('#labor-book-export-structure-btn')).toBeHidden();
});

test('B5 — a filled flow row counts once, not zero', async ({ page }) => {
  await page.goto('/');
  const row = await page.evaluate(() => {
    TakeoffState.setConduitTempData({ fittings: [{ description: '', quantity: 0, labor: 0, price: '' }] });
    TakeoffState.setLaborBookFillTarget({ kind: 'conduit-fitting', index: 0 });
    TakeoffLaborBookTargets.addEntryToTarget({ description: '1/2 EMT COUP D/S', labor: 0.03, price: '1.66' });
    return TakeoffState.getConduitTempData().fittings[0];
  });
  expect(row.description).toBe('1/2 EMT COUP D/S');
  expect(row.quantity).toBe(1);
  expect(row.price).toBe(1.66);
});

test('T2-10 — the Assemblies side has its own filter', async ({ page }) => {
  await openBook(page);
  await page.locator('.labor-book-section-btn[data-section="assemblies"]').click();
  await expect(page.locator('#mc-book-status')).toContainText('assemblies loaded', { timeout: 20000 });
  const filter = page.locator('#mc-book-search');
  await expect(filter).toBeVisible();

  await filter.fill('encl cb');
  await expect(page.locator('.mc-book-result-count')).toContainText(/matching section/, { timeout: 10000 });
  const sections = await page.locator('#mc-book-tree .mc-book-section-name').allTextContents();
  expect(sections.length).toBeGreaterThan(0);
  expect(sections[0]).toMatch(/cb/i);
  // the tree's shorthand is decoded where it is written
  await expect(page.locator('#mc-book-tree .mc-book-section-name').first()).toHaveAttribute('title', /enclosed circuit breaker/);

  // Esc clears the filter before it closes the book
  await filter.focus();
  await page.keyboard.press('Escape');
  await expect(filter).toHaveValue('');
  await expect(page.locator('#labor-book-modal')).toHaveAttribute('aria-hidden', 'false');
});

test('B5 — a category heading stops running label, count and note together', async ({ page }) => {
  await openBook(page);
  await page.locator('.labor-book-section-btn[data-section="assemblies"]').click();
  await expect(page.locator('#mc-book-status')).toContainText('assemblies loaded', { timeout: 20000 });
  const notes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.mc-book-group-note')).map((n) => ({
      inHeading: !!n.closest('h2'),
      afterHeading: n.previousElementSibling?.tagName,
    }))
  );
  expect(notes.length).toBeGreaterThan(0);
  for (const n of notes) {
    expect(n.inHeading).toBe(false);
    expect(n.afterHeading).toBe('H2');
  }
});

test('T2-10 — the Abbreviation Key decodes the screen behind it', async ({ page }) => {
  await openBook(page);
  await page.locator('#labor-book-abbreviation-key-btn').click();
  await expect(page.locator('#abbreviation-key-modal')).toHaveAttribute('aria-hidden', 'false');
  const text = await page.locator('#abbreviation-key-body').textContent();
  for (const code of ['D/S', 'S/S', 'D/C', 'S/C', 'W/C', 'nf / f', 'gd / hd', 'seb', 'encl cb', 'N3R']) {
    expect(text).toContain(code);
  }
});

test('B6 — a hand-typed price leaves a trail, and clearing it takes the badge with it', async ({ page }) => {
  await openBook(page);
  const where = await page.evaluate(() => {
    const type = 'gear';
    const section = Object.keys(TakeoffState.getLaborBookType(type))[0];
    return { type, section, index: 0 };
  });
  const read = () => page.evaluate((w) => {
    const r = TakeoffState.getLaborBookType(w.type)[w.section][w.index];
    return { price: r.price, priceSource: r.priceSource ?? null, pricedAt: r.pricedAt ?? null, offers: r.offers || [], history: r.history || [] };
  }, where);

  await page.evaluate((w) => TakeoffState.updateLaborBookRow(w.type, w.section, w.index, { price: '1180' }), where);
  const priced = await read();
  expect(priced.price).toBe('1180');
  expect(priced.offers).toHaveLength(1);
  expect(priced.offers[0].supplier).toBe('You');
  expect(priced.history).toHaveLength(1);

  // …and it reads as what it is: a hand price, not a supply house
  await page.evaluate(() => { TakeoffLaborBookView.render(); TakeoffLaborBookView.attachListeners(); });
  const badge = await page.evaluate((w) => {
    const row = Array.from(document.querySelectorAll(`.labor-book-row[data-type="${w.type}"][data-index="${w.index}"]`))
      .find((tr) => tr.dataset.section === w.section);
    return row?.querySelector('.lb-prov-badge')?.textContent || null;
  }, where);
  expect(badge).toContain('Hand-priced');

  // the first real quote wins over a hand price and keeps the trail of both
  await page.evaluate((w) => TakeoffState.recordPartPrice(w.type, w.section, w.index, { supplier: 'CED', price: 1140, at: '2026-09-01' }), where);
  const quoted = await read();
  expect(quoted.price).toBe('1140');
  expect(quoted.priceSource).toBe('CED');
  expect(quoted.offers.map((o) => o.supplier).sort()).toEqual(['CED', 'You']);
  expect(quoted.history).toHaveLength(2);

  // clearing the price clears where it came from
  await page.evaluate((w) => TakeoffState.updateLaborBookRow(w.type, w.section, w.index, { price: '' }), where);
  const cleared = await read();
  expect(cleared.price).toBe('');
  expect(cleared.priceSource).toBe(null);
  expect(cleared.pricedAt).toBe(null);

  // and the row shows the quiet "+ price" ghost again after a full render
  await page.evaluate(() => { TakeoffLaborBookView.render(); TakeoffLaborBookView.attachListeners(); });
  const ghost = await page.evaluate((w) => {
    const row = Array.from(document.querySelectorAll(`.labor-book-row[data-type="${w.type}"][data-index="${w.index}"]`))
      .find((tr) => tr.dataset.section === w.section);
    return row?.querySelector('.lb-prov-badge')?.textContent || null;
  }, where);
  expect(ghost).toBe('+ price');
});

test('B6 — clearing a price in the cell shows the ghost at once, not a "no date" pill', async ({ page }) => {
  await openBook(page);
  const where = await page.evaluate(() => {
    const type = 'gear';
    const section = Object.keys(TakeoffState.getLaborBookType(type))[0];
    TakeoffState.setActiveLaborBookTab(type);
    TakeoffState.updateLaborBookRow(type, section, 2, { price: '412.50' });
    TakeoffLaborBookView.render();
    TakeoffLaborBookView.attachListeners();
    return { type, section, index: 2 };
  });
  // the section starts collapsed — open it the way a user does
  await page.locator(`.labor-book-section[data-section="${where.section}"] .labor-book-section-header`).click();
  const rowSel = `.labor-book-row[data-type="${where.type}"][data-index="${where.index}"][data-section="${where.section}"]`;
  await expect(page.locator(`${rowSel} .lb-prov-badge`)).toContainText('Hand-priced');

  // clear it in the cell itself — the in-place patch, no full render after
  await page.locator(`${rowSel} .labor-book-price`).fill('');
  await page.locator(`${rowSel} .labor-book-price`).blur();

  const badge = page.locator(`${rowSel} .lb-prov-badge`);
  await expect(badge).toHaveText('+ price');
  await expect(badge).toHaveClass(/lb-prov-empty/);
  await expect(badge).not.toContainText('no date');
});

test('B6 — quotes keep one spelling, an empty date is allowed, history is in date order', async ({ page }) => {
  await openBook(page);
  const where = await page.evaluate(() => {
    const type = 'gear';
    const section = Object.keys(TakeoffState.getLaborBookType(type))[0];
    return { type, section, index: 1 };
  });
  const row = await page.evaluate((w) => {
    TakeoffState.recordPartPrice(w.type, w.section, w.index, { supplier: 'Summit Electric', price: 300, at: '2026-08-01' });
    // same house, typed in a hurry: the row must not disagree with the table
    TakeoffState.recordPartPrice(w.type, w.section, w.index, { supplier: 'summit electric', price: 310, at: '2026-09-02' });
    // a quote whose date nobody remembers is a real answer
    TakeoffState.recordPartPrice(w.type, w.section, w.index, { supplier: 'Crescent', price: 295, at: '' });
    const r = TakeoffState.getLaborBookType(w.type)[w.section][w.index];
    return { priceSource: r.priceSource, offers: r.offers, history: r.history };
  }, where);

  expect(row.priceSource).toBe('Summit Electric');
  expect(row.offers.map((o) => o.supplier)).toEqual(['Summit Electric', 'Crescent']);
  expect(row.offers[1].at).toBe(null);

  // the card renders the change log newest-date first, undated last
  await page.evaluate((w) => TakeoffLaborBookCard.openForBookRow(w.type, w.section, w.index), where);
  const dates = await page.locator('.pc-history .pc-hist-date').allTextContents();
  expect(dates).toEqual(['2026-09-02', '2026-08-01', 'no date']);
  await expect(page.locator('.pc-note')).toContainText('In use');
});

test('B6 — the record form says what is missing instead of doing nothing', async ({ page }) => {
  await openBook(page);
  await page.evaluate(() => {
    const section = Object.keys(TakeoffState.getLaborBookType('gear'))[0];
    TakeoffLaborBookCard.openForBookRow('gear', section, 0);
  });
  await page.locator('#part-card-price').fill('999');
  await page.locator('#part-card-record-btn').click();
  await expect(page.locator('#part-card-error')).toBeVisible();
  await expect(page.locator('#part-card-error')).toContainText('supply house');
});

test('B6 — the part card scrolls on a 768 px laptop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 768 });
  await openBook(page);
  await page.evaluate(() => {
    const section = Object.keys(TakeoffState.getLaborBookType('gear'))[0];
    const houses = ['CED', 'Border States', 'Crescent', 'Rexel', 'Graybar', 'Summit Electric', 'City Electric'];
    houses.forEach((h, i) => {
      TakeoffState.recordPartPrice('gear', section, 2, { supplier: h, price: 100 + i, at: `2026-0${(i % 8) + 1}-1${i % 9}` });
    });
    TakeoffLaborBookCard.openForBookRow('gear', section, 2);
  });
  const box = await page.evaluate(() => {
    const el = document.querySelector('.part-card-content');
    el.scrollTop = 400;
    return { overflowY: getComputedStyle(el).overflowY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop };
  });
  expect(box.overflowY).toBe('auto');
  if (box.scrollHeight > box.clientHeight) expect(box.scrollTop).toBeGreaterThan(0);
});
