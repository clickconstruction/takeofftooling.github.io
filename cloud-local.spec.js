'use strict';
// The signed-out half of the cloud/book work: everything here runs without an
// account (the cloud project is production and is never signed into from a dev
// machine). The signed-in decisions are unit-tested in cloudSync.test.js.
const { test, expect } = require('@playwright/test');

function seedBook(page, doc) {
  return page.addInitScript((d) => localStorage.setItem('takeoff-book', JSON.stringify(d)), doc);
}

// --- T2-11: the "the shared book moved" line names the rows ---------------

test('a defaults upgrade says which parts moved, and says it once', async ({ page }) => {
  // A stored book at the previous defaults version whose "1/2 EMT" strap
  // carries a stale number the user never touched.
  await page.goto('/');
  const { version, section, name, defaultLabor } = await page.evaluate(() => {
    const conduit = LABOR_BOOK_DEFAULTS.conduit;
    const sectionName = Object.keys(conduit).find((s) => conduit[s].length);
    const row = conduit[sectionName][0];
    return {
      version: LABOR_BOOK_DEFAULTS_VERSION,
      section: sectionName,
      name: row.name,
      defaultLabor: row.labor,
    };
  });

  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  const book = await page.evaluate(() => JSON.parse(JSON.stringify(LABOR_BOOK_DEFAULTS)));
  book.conduit[section][0].labor = Number(defaultLabor) + 7; // what the old defaults shipped
  await seedBook(page, {
    v: 1,
    savedAt: '2026-02-02T00:00:00.000Z',
    laborBook: book,
    laborBookMeta: { defaultsVersion: version - 1, removedV: 2, removed: {}, removedLegacy: {} },
  });

  await page.goto('/');
  const notice = page.locator('#cloud-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('The shared parts book was updated');
  await expect(notice).toContainText(name); // the row is named, not just counted

  await page.click('#cloud-notice-dismiss');
  await expect(page.locator('#cloud-notice')).toHaveCount(0);

  // the upgrade is recorded, so a later boot has nothing to announce
  await page.waitForTimeout(700);
  const doc = await page.evaluate(() => JSON.parse(localStorage.getItem('takeoff-book')));
  expect(doc.laborBookMeta.defaultsVersion).toBe(version);
  expect(doc.laborBook.conduit[section][0].labor).toBe(defaultLabor);
});

test('a book already at the current defaults says nothing', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator('#cloud-notice')).toHaveCount(0);
});

// --- wave-1 leftover: inferred gaps heal, they are not blacklisted --------

test('a partial legacy book fills back in and proposes no removals', async ({ page }) => {
  await page.goto('/');
  const oneSection = await page.evaluate(() => {
    const wire = LABOR_BOOK_DEFAULTS.wire;
    const s = Object.keys(wire)[0];
    return { section: s, rows: [JSON.parse(JSON.stringify(wire[s][0]))] };
  });
  await page.evaluate(() => localStorage.clear());
  await seedBook(page, {
    v: 1,
    savedAt: '2026-01-04T00:00:00.000Z',
    laborBook: { wire: { [oneSection.section]: oneSection.rows } },
    laborBookMeta: null, // pre-provenance: bootstrap runs
  });

  await page.goto('/');
  await page.waitForTimeout(800);
  const doc = await page.evaluate(() => JSON.parse(localStorage.getItem('takeoff-book')));
  // every default row of that section is back (they were blacklisted before)
  const restored = await page.evaluate((s) => LABOR_BOOK_DEFAULTS.wire[s].length, oneSection.section);
  expect(doc.laborBook.wire[oneSection.section].length).toBe(restored);
  expect(doc.laborBookMeta.removed).toEqual({});
  expect(doc.laborBookMeta.removedV).toBe(2);
  // and nothing is proposed to the maintainer
  const corrections = await page.evaluate(() => TakeoffState.getBookCorrections());
  expect(corrections.filter((c) => c.kind === 'remove')).toEqual([]);
});

test('a pre-split removed map is honoured but never shared', async ({ page }) => {
  await page.goto('/');
  const seed = await page.evaluate(() => {
    const wire = LABOR_BOOK_DEFAULTS.wire;
    const section = Object.keys(wire)[0];
    const rows = JSON.parse(JSON.stringify(wire[section]));
    const goneName = rows[0].name;
    rows.shift();
    return { section, rows, goneName };
  });
  await page.evaluate(() => localStorage.clear());
  await seedBook(page, {
    v: 1,
    savedAt: '2026-01-05T00:00:00.000Z',
    laborBook: { wire: { [seed.section]: seed.rows } },
    laborBookMeta: { defaultsVersion: 1, removed: { wire: { [seed.section]: [seed.goneName] } } },
  });

  await page.goto('/');
  await page.waitForTimeout(800);
  const doc = await page.evaluate(() => JSON.parse(localStorage.getItem('takeoff-book')));
  const names = doc.laborBook.wire[seed.section].map((r) => r.name);
  expect(names).not.toContain(seed.goneName); // the delete stands
  expect(doc.laborBookMeta.removedLegacy.wire[seed.section]).toContain(seed.goneName);
  expect(doc.laborBookMeta.removed).toEqual({});
  const corrections = await page.evaluate(() => TakeoffState.getBookCorrections());
  expect(corrections.filter((c) => c.kind === 'remove')).toEqual([]);
});

// --- B14: provenance flags heal ------------------------------------------

test('deleting a default row and adding it back leaves no removal behind', async ({ page }) => {
  await page.goto('/');
  const where = await page.evaluate(() => {
    const wire = LABOR_BOOK_DEFAULTS.wire;
    const section = Object.keys(wire)[0];
    return { section, row: JSON.parse(JSON.stringify(wire[section][0])) };
  });

  await page.evaluate(
    ({ section, row }) => {
      TakeoffState.removeLaborBookRow('wire', section, 0);
      TakeoffState.addLaborBookRow('wire', section, { name: row.name, labor: row.labor, price: row.price });
    },
    where
  );
  const corrections = await page.evaluate(() => TakeoffState.getBookCorrections());
  expect(corrections.filter((c) => c.name === where.row.name)).toEqual([]);
});

test('typing a row back to the shipped numbers clears the edited flag', async ({ page }) => {
  await page.goto('/');
  const state = await page.evaluate(() => {
    const wire = LABOR_BOOK_DEFAULTS.wire;
    const section = Object.keys(wire)[0];
    const def = wire[section][0];
    TakeoffState.updateLaborBookRow('wire', section, 0, { labor: Number(def.labor) + 5 });
    const away = !!TakeoffState.getLaborBook().wire[section][0].edited;
    TakeoffState.updateLaborBookRow('wire', section, 0, { labor: def.labor });
    return { away, back: !!TakeoffState.getLaborBook().wire[section][0].edited };
  });
  expect(state.away).toBe(true);
  expect(state.back).toBe(false);
  expect(await page.evaluate(() => TakeoffState.getBookCorrections())).toEqual([]);
});

// --- X4: a promoted catalog part is not a correction ---------------------

test('a catalog part copied into the book is not shared until someone costs it', async ({ page }) => {
  await page.goto('/');
  const where = await page.evaluate(() => {
    const section = Object.keys(LABOR_BOOK_DEFAULTS.wire)[0];
    TakeoffState.promoteCatalogPart('wire', section, 'Elliot Electric', {
      name: 'MC CONN 1/2 STL ZINC',
      price: '106.29',
      partNumber: 'E-99123',
      pricedAt: '2026-09-01',
    });
    return { section, name: 'MC CONN 1/2 STL ZINC' };
  });

  const mine = async () =>
    page.evaluate((n) => TakeoffState.getBookCorrections().filter((c) => c.name === n), where.name);

  // the row is userAdded, so the diff used to call it a brand-new part and
  // ship the supply house its own catalog price back, with zero hours
  expect(await mine()).toEqual([]);

  // hours are a real contribution: now it goes
  await page.evaluate(
    ({ section, name }) => {
      const index = TakeoffState.getLaborBook().wire[section].findIndex((r) => r.name === name);
      TakeoffState.recordPartLabor('wire', section, index, 1.25);
    },
    where
  );
  const shared = await mine();
  expect(shared.length).toBe(1);
  expect(shared[0].kind).toBe('new');
  expect(shared[0].new.labor).toBe(1.25);
  expect(shared[0].new.partNumber).toBe('E-99123');
});

// --- T2-15: the browser asks before an editor's work goes ----------------

test('closing the tab in a dirty flow editor asks first', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    TakeoffState.setCurrentView('device');
    TakeoffState.setFlowDirty(true);
  });
  let asked = false;
  page.on('dialog', (d) => {
    asked = d.type() === 'beforeunload';
    d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 300));
  expect(asked).toBe(true);
});

test('closing the tab on the manifest asks nothing', async ({ page }) => {
  await page.goto('/');
  let asked = false;
  page.on('dialog', (d) => {
    asked = true;
    d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await new Promise((r) => setTimeout(r, 300));
  expect(asked).toBe(false);
});

// --- B13/B14 copy and controls -------------------------------------------

test('the reload item says it keeps your data and is not dressed as danger', async ({ page }) => {
  await page.goto('/');
  const btn = page.locator('#cache-clear-reload-btn');
  await expect(btn).toHaveText('Reload app (keeps your data)');
  await expect(btn).not.toHaveClass(/header-menu-item-danger/);
});

// X3: the temporary password is gone entirely — an account is created for the
// directory and the person signs in with the emailed code. (The earlier
// assertion here pinned the plain-text field's type; the field itself is what
// the owner decided to drop.)
test('adding a user hands over no password at all', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#users-add-password')).toHaveCount(0);
  await expect(page.locator('.users-hint')).toContainText('There is no password to hand over');
  await expect(page.locator('.users-hint')).toContainText('set their own password');
});

test('a forgotten password has a way back, and it asks for the email first', async ({ page }) => {
  await page.goto('/');
  await page.click('#cloud-btn');
  const forgot = page.locator('#cloud-forgot-btn');
  await expect(forgot).toHaveText('Forgot your password?');
  await forgot.click();
  await expect(page.locator('#cloud-modal-msg')).toHaveText('Enter your email first.');
});

test('an empty Sign In answers, and the answer is cleared on the next try', async ({ page }) => {
  await page.goto('/');
  await page.click('#cloud-btn');
  const msg = page.locator('#cloud-modal-msg');
  await page.click('#cloud-password-btn');
  await expect(msg).toHaveText('Enter your email first.');
  await page.fill('#cloud-email-input', 'someone@example.com');
  await page.click('#cloud-password-btn');
  await expect(msg).toHaveText('Enter your password, or use the emailed code below.');
});

test('signed out, the migrated legacy workspace does not read as an old date', async ({ page }) => {
  const legacy = {
    v: 1,
    savedAt: '2026-06-14T12:00:00.000Z',
    manifest: [{ id: 'i1', type: 'lighting', description: '2x4 troffer', quantity: 3, labor: 1, planPage: '', parentId: null, price: 100, children: [] }],
    laborRate: 82,
  };
  await page.addInitScript((d) => localStorage.setItem('takeoff-workspace', JSON.stringify(d)), legacy);
  await page.goto('/');
  const idx = await page.evaluate(() => JSON.parse(localStorage.getItem('takeoff-projects-index')));
  expect(idx.projects[0].createdAt).toBe('2026-06-14T12:00:00.000Z');
  expect(Date.parse(idx.projects[0].updatedAt)).toBeGreaterThan(Date.parse('2026-06-14T12:00:00.000Z'));
  // the document itself keeps the legacy clock (it is what the cloud compares)
  const project = await page.evaluate((id) => JSON.parse(localStorage.getItem('takeoff-project-' + id)), idx.projects[0].id);
  expect(project.savedAt).toBe('2026-06-14T12:00:00.000Z');
});

// --- T2-11: the row itself says it is shared -----------------------------

test('a shared row is marked in the book, on the hours cell', async ({ page }) => {
  await page.goto('/');
  // Sharing is a signed-in state and this machine never signs in, so stand in
  // for the cloud's answer: these are the rows a consenting user is sharing.
  const target = await page.evaluate(() => {
    const wire = LABOR_BOOK_DEFAULTS.wire;
    const section = Object.keys(wire)[0];
    const name = wire[section][0].name;
    const key = ['wire', section, name].join('\u0001');
    TakeoffCloud.getSharedRowKeys = () => new Set([key]);
    TakeoffState.setActiveLaborBookTab('wire');
    return { section, name };
  });
  await page.click('#labor-book-open-btn');
  await page.click(`.labor-book-section[data-section="${target.section}"] .labor-book-section-header`);

  const row = page.locator(`.labor-book-row[data-section="${target.section}"][data-index="0"]`);
  // the cue sits with the hours, not on the price badge (a labor-only fix has
  // no price badge at all)
  await expect(row.locator('.lb-hrs-cell .lb-shared-chip')).toHaveText('shared');
  // and only on that row
  await expect(page.locator(`.labor-book-row[data-section="${target.section}"][data-index="1"] .lb-shared-chip`)).toHaveCount(0);
});
