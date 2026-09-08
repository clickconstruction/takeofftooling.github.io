'use strict';
// A share link has to carry the labor rate, or the recipient reads the same
// bid at a different grand total. Two browser contexts stand in for two
// estimators; the recipient keeps a rate of their own on their own bid.
const { test, expect } = require('@playwright/test');

const BID = [
  { type: 'lighting', description: '2x4 LED Troffer', quantity: 10, labor: 0.75, price: 89.5 },
  { type: 'wire', description: '#12 THHN', quantity: 3000, labor: 0.006, price: 0.18 },
];

async function seedAndShare(page, rate) {
  await page.goto('/');
  return page.evaluate(({ rows, rate }) => {
    for (const item of TakeoffState.getTopLevelItems().slice()) TakeoffState.removeItem(item.id);
    TakeoffState.setProjectName('Cedar Ridge Clinic');
    TakeoffState.setLaborRate(rate);
    TakeoffState.setTaxRate(8.5); // the dossier's bid was taxed at 8.5% (a new bid now starts at 8.25)
    for (const r of rows) TakeoffState.addItem({ ...r, planPage: '', parentId: null });
    TakeoffApp.render();
    // build the same envelope the "Export via link" menu item builds
    const envelope = {
      v: 2,
      app: 'takeoff-tooling',
      exportedAt: new Date().toISOString(),
      name: TakeoffState.getCurrentProject().name,
      laborRate: TakeoffState.getLaborRate(),
      taxRate: TakeoffState.getTaxRate(),
      manifest: TakeoffState.getManifest(),
    };
    const s = TakeoffState.getSummaryBreakdown();
    return {
      hash: '#d=' + btoa(unescape(encodeURIComponent(JSON.stringify(envelope)))),
      grand: s.materialsTotal + s.laborTotal * TakeoffState.getLaborRate() + s.otherTotal,
    };
  }, { rows: BID, rate });
}

// The share verb moved out of the ☰ menu and under Print Options, where the
// estimator is already standing when the bid goes out.
// Print Options only exist once the bid has a described row (an empty bid
// hides the whole block).
async function seedRow(page) {
  await page.evaluate(() => {
    for (const item of TakeoffState.getTopLevelItems().slice()) TakeoffState.removeItem(item.id);
    for (const r of [{ type: 'lighting', description: '2x4 LED Troffer', quantity: 10, labor: 0.75, price: 89.5 }]) {
      TakeoffState.addItem({ ...r, planPage: '', parentId: null });
    }
    TakeoffApp.render();
  });
}

async function openPrintOptions(page) {
  if (!(await page.locator('#copy-share-link-btn').isVisible())) {
    await page.locator('#print-options-toggle').click();
  }
}

test('the export envelope carries laborRate and the job details', async ({ page }) => {
  await page.goto('/');
  await seedRow(page);
  await page.evaluate(() => {
    TakeoffState.setLaborRate(92);
    TakeoffState.setProjectDetails({ client: 'Ridgeline Construction', permitNo: 'E-2026-0413' });
  });
  // read the envelope the button actually writes, via the clipboard
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await openPrintOptions(page);
  await page.locator('#copy-share-link-btn').click();
  // X11: the copy reports itself in the app's one feedback region, not by
  // rewriting the button's own label
  await expect(page.locator('#toast-region')).toContainText('Share link copied');
  const url = await page.evaluate(() => navigator.clipboard.readText());
  const envelope = JSON.parse(decodeURIComponent(escape(atob(url.split('#d=')[1]))));
  expect(envelope.v).toBe(2);
  expect(envelope.laborRate).toBe(92);
  expect(envelope.details).toEqual({ client: 'Ridgeline Construction', permitNo: 'E-2026-0413' });
});

test('the share verb lives under Print Options, not in the ☰ menu', async ({ page }) => {
  await page.goto('/');
  await seedRow(page);
  await expect(page.locator('#export-link-btn')).toHaveCount(0);
  // the retired Print-with-Form modal is gone with it
  await expect(page.locator('#form-modal')).toHaveCount(0);
  await openPrintOptions(page);
  await expect(page.locator('#copy-share-link-btn')).toBeVisible();
});

test('job details survive a reload and a project switch, and never block the first fixture', async ({ page }) => {
  await page.goto('/');
  await seedRow(page);
  // nothing about the details is on the way in: the panel is closed, and the
  // bid is typed without opening it
  await openPrintOptions(page);
  await expect(page.locator('.job-details-fields')).toBeHidden();
  await page.locator('#job-details-toggle').click();
  await page.locator('.print-panel input[data-detail="address"]').fill('1450 Cedar Ridge Rd');
  await page.locator('.print-panel input[data-detail="client"]').fill('Ridgeline Construction');
  const mine = await page.evaluate(() => {
    TakeoffState.persistNow();
    return TakeoffState.getCurrentProject().id;
  });

  // a second bid carries none of the first one's answers
  await page.evaluate(() => TakeoffState.createProject('Second bid'));
  expect(await page.evaluate(() => TakeoffState.getProjectDetails())).toEqual({});

  // ...and the first one still has them after a reload
  await page.evaluate((id) => TakeoffState.switchProject(id), mine);
  await page.reload();
  expect(await page.evaluate(() => TakeoffState.getProjectDetails())).toEqual({
    address: '1450 Cedar Ridge Rd',
    client: 'Ridgeline Construction',
  });
});

test('a shared bid opens at the sender’s rate and leaves the recipient’s own bid alone', async ({ browser }) => {
  const sender = await browser.newContext();
  const senderPage = await sender.newPage();
  const { hash, grand } = await seedAndShare(senderPage, 92);
  expect(grand).toBeCloseTo(4402.98 - 500, 2); // same bid as the dossier, minus its permit row

  // recipient carries a rate of their own
  const recipient = await browser.newContext();
  const page = await recipient.newPage();
  await page.goto('/');
  await page.evaluate(() => {
    TakeoffState.setProjectName('My own bid');
    TakeoffState.setLaborRate(60);
    TakeoffState.persistNow();
  });
  const ownProjectId = await page.evaluate(() => TakeoffState.getCurrentProject().id);

  await page.goto('/' + hash);
  await expect.poll(() => page.evaluate(() => TakeoffState.getCurrentProject().name)).toContain('Cedar Ridge Clinic');

  // the shared copy reads at the sender's rate, to the cent
  expect(await page.evaluate(() => TakeoffState.getLaborRate())).toBe(92);
  const sharedGrand = await page.evaluate(() => {
    const s = TakeoffState.getSummaryBreakdown();
    return s.materialsTotal + s.laborTotal * TakeoffState.getLaborRate() + s.otherTotal;
  });
  expect(sharedGrand).toBeCloseTo(grand, 2);
  await expect(page.locator('#labor-rate-input')).toHaveValue('92');

  // ...and their own bid still carries 60
  await page.evaluate((id) => TakeoffState.switchProject(id), ownProjectId);
  expect(await page.evaluate(() => TakeoffState.getLaborRate())).toBe(60);

  await sender.close();
  await recipient.close();
});

test('a legacy link with no laborRate still inherits the recipient’s rate', async ({ page }) => {
  const legacy = { v: 2, app: 'takeoff-tooling', name: 'Old share', manifest: [{ type: 'lighting', description: 'Troffer', quantity: 2, labor: 1, price: 10 }] };
  const hash = '#d=' + Buffer.from(JSON.stringify(legacy)).toString('base64');
  await page.goto('/');
  await page.evaluate(() => TakeoffState.setLaborRate(60));
  await page.goto('/' + hash);
  await expect.poll(() => page.evaluate(() => TakeoffState.getCurrentProject().name)).toContain('Old share');
  expect(await page.evaluate(() => TakeoffState.getLaborRate())).toBe(60);
});

test('an imported bid gets fresh row ids', async ({ page }) => {
  const shared = {
    v: 2,
    app: 'takeoff-tooling',
    name: 'Twin',
    laborRate: 50,
    manifest: [
      { id: 'MEANT-FOR-ALPHA', type: 'devices', description: 'Receptacle run', quantity: 4, labor: 0, price: null, children: [{ id: 'CHILD-OF-ALPHA', type: 'box', description: '4-square', quantity: 4, labor: 0.2, price: 3 }] },
    ],
  };
  const hash = '#d=' + Buffer.from(JSON.stringify(shared)).toString('base64');
  await page.goto('/' + hash);
  await expect.poll(() => page.evaluate(() => TakeoffState.getTopLevelItems().length)).toBeGreaterThan(0);
  const ids = await page.evaluate(() => {
    const top = TakeoffState.getTopLevelItems().find((i) => i.description === 'Receptacle run');
    return { top: top.id, child: top.children[0].id, childParent: top.children[0].parentId };
  });
  expect(ids.top).not.toBe('MEANT-FOR-ALPHA');
  expect(ids.child).not.toBe('CHILD-OF-ALPHA');
  expect(ids.childParent).toBe(ids.top);
});

// --- What the recipient is holding, and how many copies of it — B10 --------

function linkFor(envelope) {
  return '#d=' + Buffer.from(JSON.stringify(envelope)).toString('base64');
}

const SHARED = {
  v: 2,
  app: 'takeoff-tooling',
  exportedAt: '2026-09-06T15:04:00.000Z',
  name: 'Northgate Retail',
  laborRate: 92,
  details: { client: 'Ridgeline Construction', address: '1450 Cedar Ridge Rd', permitNo: 'E-2026-0413' },
  manifest: [{ type: 'lighting', description: '2x4 LED Troffer', quantity: 10, labor: 0.75, price: 89.5 }],
};

test('a shared bid says what it is, in the sender’s own date, and can be dismissed', async ({ page }) => {
  await page.goto('/' + linkFor(SHARED));
  const banner = page.locator('#app-notice');
  await expect(banner).toBeVisible();
  const text = await banner.locator('.app-notice-text').textContent();
  expect(text).toContain('Copy of Northgate Retail');
  expect(text).toContain('shared Sep 6 by link');
  expect(text).toContain('edits stay on this device');
  await page.locator('#app-notice-dismiss').click();
  await expect(banner).toHaveCount(0);
});

test('the job details ride the link and land on the copy', async ({ page }) => {
  await page.goto('/' + linkFor(SHARED));
  await expect.poll(() => page.evaluate(() => TakeoffState.getCurrentProject().name)).toBe('Northgate Retail');
  expect(await page.evaluate(() => TakeoffState.getProjectDetails())).toEqual(SHARED.details);
  // and they survive the round trip through storage
  await page.evaluate(() => TakeoffState.persistNow());
  await page.reload();
  expect(await page.evaluate(() => TakeoffState.getProjectDetails())).toEqual(SHARED.details);
});

test('junk in the details is dropped rather than stored', async ({ page }) => {
  const nasty = { ...SHARED, exportedAt: '2026-09-06T16:00:00.000Z', details: { client: '  Ridgeline  ', evil: 'x', permitNo: 42, address: { nope: true } } };
  await page.goto('/' + linkFor(nasty));
  await expect.poll(() => page.evaluate(() => TakeoffState.getCurrentProject().name)).toContain('Northgate');
  expect(await page.evaluate(() => TakeoffState.getProjectDetails())).toEqual({ client: 'Ridgeline' });
});

test('the same link opened twice reopens one copy instead of making an identical twin', async ({ page }) => {
  await page.goto('/' + linkFor(SHARED));
  await expect.poll(() => page.evaluate(() => TakeoffState.getCurrentProject().name)).toBe('Northgate Retail');
  const first = await page.evaluate(() => ({ id: TakeoffState.getCurrentProject().id, count: TakeoffState.getProjects().length }));

  await page.goto('/' + linkFor(SHARED));
  await expect.poll(() => page.locator('#app-notice').count()).toBe(1);
  const second = await page.evaluate(() => ({ id: TakeoffState.getCurrentProject().id, count: TakeoffState.getProjects().length }));
  expect(second.count).toBe(first.count);
  expect(second.id).toBe(first.id);
  await expect(page.locator('#app-notice .app-notice-text')).toContainText('Reopened your copy of Northgate Retail');

  // a NEW link for the same bid is a different bid, and gets the ' 2' suffix
  await page.goto('/' + linkFor({ ...SHARED, exportedAt: '2026-09-07T09:00:00.000Z' }));
  await expect.poll(() => page.evaluate(() => TakeoffState.getCurrentProject().name)).toBe('Northgate Retail 2');
  expect(await page.evaluate(() => TakeoffState.getProjects().length)).toBe(first.count + 1);
});

test('Duplicate takes the same “ 2” suffix', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => TakeoffState.setProjectName('Northgate Retail'));
  const names = await page.evaluate(() => {
    const id = TakeoffState.getCurrentProject().id;
    TakeoffState.duplicateProject(id);
    TakeoffState.duplicateProject(id);
    return TakeoffState.getProjects().map((p) => p.name);
  });
  expect(names).toContain('Northgate Retail 2');
  expect(names).toContain('Northgate Retail 3');
  expect(names.some((n) => n.includes('(copy)'))).toBe(false);
});

test('a shaped-but-empty link says so instead of doing nothing', async ({ page }) => {
  await page.goto('/');
  const before = await page.evaluate(() => TakeoffState.getProjects().length);
  await page.goto('/' + linkFor({ v: 2, app: 'takeoff-tooling', name: 'Empty' }));
  await expect(page.locator('#app-notice')).toBeVisible();
  await expect(page.locator('#app-notice .app-notice-text')).toContainText('carried no takeoff rows');
  expect(await page.evaluate(() => TakeoffState.getProjects().length)).toBe(before);
});

test('a truncated link says so without a dialog', async ({ page }) => {
  await page.goto('/#d=' + 'bm90IGJhc2U2NA'.slice(0, 9));
  await expect(page.locator('#app-notice .app-notice-text')).toContainText('could not be opened');
});
