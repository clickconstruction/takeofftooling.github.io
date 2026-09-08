'use strict';
// Switching bids while a flow editor is open used to swap the manifest under
// the editor: a blank page at best, and — when the other bid was a copy that
// shared row ids — a silent save into the wrong bid.
const { test, expect } = require('@playwright/test');

// The real switcher: open the header project menu and pick a bid.
async function switchViaMenu(page, id) {
  await page.locator('#project-switch-btn').click();
  await page.locator(`#project-menu .project-menu-item[data-id="${id}"]`).click();
}

// Two bids: "Alpha" (open, with a device run) and a duplicate of it.
async function seedTwoBids(page) {
  await page.goto('/');
  return page.evaluate(() => {
    for (const item of TakeoffState.getTopLevelItems().slice()) TakeoffState.removeItem(item.id);
    TakeoffState.setProjectName('Alpha');
    const run = TakeoffState.addItem({ type: 'devices', description: 'Receptacle run', quantity: 4, labor: 0, price: null, planPage: '', parentId: null });
    TakeoffState.persistNow();
    const copyId = TakeoffState.duplicateProject(TakeoffState.getCurrentProject().id);
    TakeoffApp.render();
    return { alphaId: TakeoffState.getCurrentProject().id, copyId, runId: run.id };
  });
}

test('a duplicate does not share row ids with its source', async ({ page }) => {
  const { alphaId, copyId, runId } = await seedTwoBids(page);
  const copyIds = await page.evaluate((id) => {
    const data = TakeoffStorage.loadProject(id);
    return data.manifest.map((m) => m.id);
  }, copyId);
  expect(copyIds).not.toContain(runId);
  expect(alphaId).not.toBe(copyId);
});

test('switching bids from an open flow editor lands on the manifest, never a blank page', async ({ page }) => {
  const { copyId, runId } = await seedTwoBids(page);
  await page.evaluate((id) => TakeoffApp.navigateToDevice(id), runId);
  await expect(page.locator('#main-content')).toContainText('Receptacle run');

  // clean editor: the switch goes through without asking
  await page.evaluate((id) => TakeoffState.switchProject(id) && TakeoffApp.render(), copyId);
  const state = await page.evaluate(() => ({
    view: TakeoffState.getCurrentView(),
    len: document.getElementById('main-content').innerHTML.length,
  }));
  expect(state.view).toBe('manifest');
  expect(state.len).toBeGreaterThan(0);
  await expect(page.locator('#main-content table').first()).toBeVisible();
});

test('a dirty flow editor blocks the switch when the estimator keeps the edits', async ({ page }) => {
  const { alphaId, copyId, runId } = await seedTwoBids(page);
  await page.evaluate((id) => TakeoffApp.navigateToDevice(id), runId);
  await page.evaluate(() => TakeoffState.setFlowDirty(true));

  // Cancel on the discard question: we stay in the editor, on the same bid
  page.once('dialog', (d) => d.dismiss());
  await switchViaMenu(page, copyId);
  expect(await page.evaluate(() => TakeoffState.getCurrentView())).toBe('device');
  expect(await page.evaluate(() => TakeoffState.getCurrentProject().id)).toBe(alphaId);

  // OK: the editor is left first, then the bid changes
  page.once('dialog', (d) => d.accept());
  await switchViaMenu(page, copyId);
  expect(await page.evaluate(() => TakeoffState.getCurrentView())).toBe('manifest');
  expect(await page.evaluate(() => TakeoffState.getCurrentProject().id)).toBe(copyId);
  expect(await page.evaluate(() => document.getElementById('main-content').innerHTML.length)).toBeGreaterThan(0);
});

test('a row typed on one bid is never saved into its twin', async ({ page }) => {
  const { alphaId, copyId, runId } = await seedTwoBids(page);
  await page.evaluate((id) => TakeoffApp.navigateToDevice(id), runId);
  // an empty section is a chip now, so open one before there is a row to type in
  await page.locator('#main-content .add-device-section-btn').first().click();
  // type into the first component row and mark the editor dirty
  const firstDesc = page.locator('#main-content input[data-field="description"]').first();
  await firstDesc.fill('MEANT-FOR-ALPHA');
  await firstDesc.dispatchEvent('change');

  // switch to the twin (accepting the discard question if it comes)
  page.on('dialog', (d) => d.accept());
  await switchViaMenu(page, copyId);
  // the editor must be gone; if it survived (the old behaviour) Save would
  // write Alpha's row into the twin, so press it and prove the leak
  expect(await page.evaluate(() => TakeoffState.getCurrentView())).toBe('manifest');
  if (await page.locator('#device-save-btn').count()) await page.locator('#device-save-btn').click();

  const leaked = await page.evaluate(() =>
    JSON.stringify(TakeoffState.getManifest()).includes('MEANT-FOR-ALPHA')
  );
  expect(leaked, 'the twin must not have received the row typed on Alpha').toBe(false);

  // and Alpha still opens
  await page.evaluate((id) => TakeoffState.switchProject(id) && TakeoffApp.render(), alphaId);
  expect(await page.evaluate(() => TakeoffState.getCurrentProject().id)).toBe(alphaId);
});

test('creating a bid from inside a flow editor leaves the editor', async ({ page }) => {
  const { runId } = await seedTwoBids(page);
  await page.evaluate((id) => TakeoffApp.navigateToDevice(id), runId);
  await page.locator('#header-menu-btn').click();
  await page.locator('#new-takeoff-btn').click();
  await page.locator('#projects-new-name').fill('Bravo');
  await page.locator('#projects-new-create').click();
  expect(await page.evaluate(() => TakeoffState.getCurrentView())).toBe('manifest');
  expect(await page.evaluate(() => TakeoffState.getCurrentProject().name)).toBe('Bravo');
  expect(await page.evaluate(() => document.getElementById('main-content').innerHTML.length)).toBeGreaterThan(0);
});

test('render falls back to the manifest when a flow’s row is gone', async ({ page }) => {
  const { runId } = await seedTwoBids(page);
  await page.evaluate((id) => TakeoffApp.navigateToDevice(id), runId);
  await page.evaluate((id) => {
    TakeoffState.removeItem(id);
    TakeoffApp.render();
  }, runId);
  expect(await page.evaluate(() => TakeoffState.getCurrentView())).toBe('manifest');
  expect(await page.evaluate(() => document.getElementById('main-content').innerHTML.length)).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// T2-02 — naming a job used to end in a dialog that would not close, with the
// typed name still in the field and a stray "Untitled project" left behind.
// ---------------------------------------------------------------------------

// The ☰ route into "name this job": it opens Manage Projects with {create:true}.
async function openNameThisJob(page) {
  await page.locator('#header-menu-btn').click();
  await page.locator('#new-takeoff-btn').click();
  await expect(page.locator('#projects-modal')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#projects-new-name')).toBeVisible();
}

const projectNames = (page) => page.evaluate(() => TakeoffState.getProjects().map((p) => p.name));

test('T2-02 — Create closes the dialog, empties the field, and mints no second bid', async ({ page }) => {
  await page.goto('/');
  await openNameThisJob(page);
  await page.locator('#projects-new-name').fill('Harbor View Clinic TI');
  await page.locator('#projects-new-create').click();

  // pre-fix: aria-hidden stayed "false", the create row was still 306x34 with
  // the name in it, and a second Enter minted "Harbor View Clinic TI" twice
  await expect(page.locator('#projects-modal')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#projects-new-name')).toHaveValue('');
  expect(await page.evaluate(() => TakeoffState.getCurrentProject().name)).toBe('Harbor View Clinic TI');
  // the untouched boot bid was claimed, not left behind as "Untitled project"
  expect(await projectNames(page)).toEqual(['Harbor View Clinic TI']);
});

test('T2-02 — Esc from the name field closes the dialog', async ({ page }) => {
  await page.goto('/');
  await openNameThisJob(page);
  await page.locator('#projects-new-name').fill('Half a name');
  await page.locator('#projects-new-name').press('Escape');
  // pre-fix: the field's own keydown ate Escape, so two presses closed nothing
  await expect(page.locator('#projects-modal')).toHaveAttribute('aria-hidden', 'true');
  expect(await projectNames(page)).toEqual(['Untitled project']);
});

test('T2-02 — a bid with work on it is kept when the next one is named', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    TakeoffState.addItem({ type: 'lighting', description: '2x4 LED Flat Panel F1', quantity: 12, labor: 0.5, price: 118, parentId: null });
    TakeoffState.persistNow();
  });
  await openNameThisJob(page);
  await page.locator('#projects-new-name').fill('Riverside Elementary');
  await page.locator('#projects-new-create').click();
  expect((await projectNames(page)).sort()).toEqual(['Riverside Elementary', 'Untitled project']);
});

test('T2-02 — Rename lives in the switcher, and the header stays the switcher', async ({ page }) => {
  await page.goto('/');
  await page.locator('#project-switch-btn').click();
  await page.locator('#project-menu-rename').click();
  const input = page.locator('#project-menu-rename-input');
  await expect(input).toBeFocused();
  await input.fill('Northgate Clinic — Level 3');
  await input.press('Enter');

  await expect(page.locator('#project-switch-name')).toContainText('Northgate');
  expect(await page.evaluate(() => TakeoffState.getCurrentProject().name)).toBe('Northgate Clinic — Level 3');
  // the header is still the switcher: it reopens the menu, it is not a field
  await expect(page.locator('#project-menu')).toHaveAttribute('aria-hidden', 'true');
  await page.locator('#project-switch-btn').click();
  await expect(page.locator('#project-menu')).toHaveAttribute('aria-hidden', 'false');
});

// ---------------------------------------------------------------------------
// T2-16 — nothing in the app ever said it saved.
// ---------------------------------------------------------------------------

test('T2-16 — the switcher says when the bid was last saved', async ({ page }) => {
  await page.goto('/');
  const saved = page.locator('#project-switch-saved');
  // pre-fix: 0 hits for save/saved/saving anywhere in the chrome, and fmtAgo's
  // finest grain was "today"
  await expect(saved).toHaveText(/^Saved (just now|1 min ago|\d+ min ago)$/);
  await expect(page.locator('#project-switch-btn')).toHaveAttribute('title', /Saved /);

  // and the formatter itself resolves minutes, not just days
  const ages = await page.evaluate(() => {
    const at = (ms) => TakeoffProjectsView.fmtAgo(new Date(Date.now() - ms).toISOString());
    return { now: at(3000), two: at(2 * 60000), hours: at(3 * 3600000), yest: at(30 * 3600000) };
  });
  expect(ages).toEqual({ now: 'just now', two: '2 min ago', hours: 'today', yest: 'yesterday' });
});

test('T2-16 — the saved line adds no row to the header below 900px', async ({ page }) => {
  await page.setViewportSize({ width: 899, height: 800 });
  await page.goto('/');
  await page.evaluate(() => {
    TakeoffState.setProjectName('Northgate Medical Office Building — Level 3 East Wing');
    TakeoffProjectsView.updateHeader();
  });
  const rows = (hideSaved) => page.evaluate((hide) => {
    document.getElementById('project-switch-saved').style.display = hide ? 'none' : '';
    const kids = [...document.querySelector('header').children].map((k) => k.getBoundingClientRect());
    const out = [];
    for (const r of kids.sort((a, b) => a.top - b.top)) {
      const row = out.find((x) => Math.min(x.bottom, r.bottom) - Math.max(x.top, r.top) > 2);
      if (row) { row.top = Math.min(row.top, r.top); row.bottom = Math.max(row.bottom, r.bottom); } else out.push({ top: r.top, bottom: r.bottom });
    }
    document.getElementById('project-switch-saved').style.display = '';
    return out.length;
  }, hideSaved);
  expect(await rows(false)).toBe(await rows(true));
});

// ---------------------------------------------------------------------------
// B11 — the projects surface: pinning, names, counts, delete.
// ---------------------------------------------------------------------------

// Three bids whose updatedAt order is C, B, A (newest first).
async function seedThreeBids(page) {
  await page.goto('/');
  return page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    TakeoffState.setProjectName('Alpha');
    TakeoffState.persistNow();
    const a = TakeoffState.getCurrentProject().id;
    await wait(5);
    TakeoffState.createProject('Bravo');
    const b = TakeoffState.getCurrentProject().id;
    await wait(5);
    TakeoffState.createProject('Charlie');
    const c = TakeoffState.getCurrentProject().id;
    await wait(5);
    TakeoffState.switchProject(a);
    TakeoffApp.render();
    TakeoffProjectsView.updateHeader();
    return { a, b, c };
  });
}

const menuOrder = (page) => page.evaluate(() => [...document.querySelectorAll('#project-menu .project-menu-item')].map((b) => b.title));
const tableOrder = (page) => page.evaluate(() => [...document.querySelectorAll('.projects-table tbody tr .projects-name')].map((s) => s.title));

test('B11 — the open bid is pinned to the top of both lists', async ({ page }) => {
  await seedThreeBids(page);
  await page.locator('#project-switch-btn').click();
  // pre-fix: sorted by updatedAt, so the open bid sat at index 13 of 24
  expect(await menuOrder(page)).toEqual(['Alpha', 'Charlie', 'Bravo']);
  await page.locator('#project-menu-manage').click();
  expect(await tableOrder(page)).toEqual(['Alpha', 'Charlie', 'Bravo']);
});

test('B11 — renaming a bid does not move it to the top', async ({ page }) => {
  await seedThreeBids(page);
  await page.locator('#project-switch-btn').click();
  await page.locator('#project-menu-manage').click();
  // Bravo is last; rename it and it must stay last
  const bravoRow = page.locator('.projects-table tbody tr', { has: page.locator('.projects-name[title="Bravo"]') });
  await bravoRow.locator('.projects-rename-btn').click();
  const input = page.locator('.projects-rename-input');
  await input.fill('Bravo Tower');
  await input.press('Enter');
  // pre-fix: applyRename stamped savedAt, so the renamed bid jumped to row 1
  expect(await tableOrder(page)).toEqual(['Alpha', 'Charlie', 'Bravo Tower']);
});

test('B11 — the Lines column counts components, not just parents', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    for (const item of TakeoffState.getTopLevelItems().slice()) TakeoffState.removeItem(item.id);
    const p = TakeoffState.addItem({ type: 'devices', description: 'Receptacle run', quantity: 4, labor: 0, price: null, parentId: null });
    TakeoffState.addItem({ type: null, description: '4 sq box', quantity: 4, labor: 0.2, price: 3, parentId: p.id });
    TakeoffState.addItem({ type: null, description: 'Mud ring', quantity: 4, labor: 0.05, price: 1, parentId: p.id });
    TakeoffApp.render();
  });
  // deliberately NOT persistNow: the storage copy is 400ms behind, and the
  // count used to be read off it (5 while memory held 6)
  await page.locator('#project-switch-btn').click();
  await page.locator('#project-menu-manage').click();
  await expect(page.locator('.projects-table thead')).toContainText('Lines');
  await expect(page.locator('.projects-table thead')).toContainText('Last edited');
  await expect(page.locator('.projects-table thead')).not.toContainText('Rows');
  const lines = await page.evaluate(() => document.querySelector('.projects-table tbody tr td.projects-meta').textContent.trim());
  expect(lines).toBe('3');
});

test('B11 — Delete confirms in the row with the line count, and never on the open bid', async ({ page }) => {
  const { b } = await seedThreeBids(page);
  await page.evaluate((id) => {
    const data = TakeoffStorage.loadProject(id);
    data.manifest = [
      { id: 'x1', type: 'devices', description: 'Receptacle run', quantity: 4, parentId: null, children: [{ id: 'x2', description: 'box', quantity: 4, parentId: 'x1', children: [] }] },
      { id: 'x3', type: 'lighting', description: 'Troffer', quantity: 9, parentId: null, children: [] },
    ];
    TakeoffStorage.saveProject(data);
  }, b);

  await page.locator('#project-switch-btn').click();
  await page.locator('#project-menu-manage').click();

  // the open bid keeps a Delete button, disabled, with the reason on it
  const openRow = page.locator('.projects-table tbody tr', { has: page.locator('.projects-name[title="Alpha"]') });
  await expect(openRow.locator('.projects-delete-btn')).toBeDisabled();
  await expect(openRow.locator('.projects-delete-btn')).toHaveAttribute('title', /open/i);

  // no native confirm: it is answered inside the row, and it says how much
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  const bravoRow = page.locator('.projects-table tbody tr', { has: page.locator('.projects-name[title="Bravo"]') });
  await bravoRow.locator('.projects-delete-btn').click();
  const confirmRow = page.locator('.projects-confirming');
  await expect(confirmRow).toContainText('Bravo');
  await expect(confirmRow).toContainText('3 lines');
  expect(dialogs).toBe(0);

  await confirmRow.locator('.projects-delete-no').click();
  expect(await tableOrder(page)).toEqual(['Alpha', 'Charlie', 'Bravo']);

  await bravoRow.locator('.projects-delete-btn').click();
  await page.locator('.projects-confirming .projects-delete-yes').click();
  expect(await tableOrder(page)).toEqual(['Alpha', 'Charlie']);
  expect(dialogs).toBe(0);
});

test('B11 — long names keep their suffix, and the full name is on the title', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    TakeoffState.setProjectName('Northgate Medical Office Building — Level 3 East Wing');
    TakeoffState.persistNow();
    TakeoffState.createProject('Northgate Medical Office Building — Level 3 West Wing');
    TakeoffApp.render();
    TakeoffProjectsView.updateHeader();
  });
  await page.locator('#project-switch-btn').click();
  const names = await page.evaluate(() => [...document.querySelectorAll('.project-menu-name')].map((n) => n.textContent));
  // pre-fix: a tail ellipsis at 250px rendered both as one identical line
  expect(names[0]).not.toBe(names[1]);
  for (const n of names) expect(n).toMatch(/Wing$/);
  expect(await menuOrder(page)).toContain('Northgate Medical Office Building — Level 3 West Wing');
  await expect(page.locator('#project-switch-btn')).toHaveAttribute('title', /Northgate Medical Office Building — Level 3 West Wing/);
});

// ---------------------------------------------------------------------------
// X9 — a bid can be closed out. The switcher lists live bids only; Manage
// projects splits the list into Live and Archived.
// ---------------------------------------------------------------------------

const liveOrder = (page) =>
  page.evaluate(() => [...document.querySelectorAll('#projects-list > .projects-table tbody tr .projects-name')].map((s) => s.title));
const archivedOrder = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.projects-table-archived tbody tr .projects-name')].map((s) => s.title));
const rowFor = (page, name) =>
  page.locator('.projects-table tbody tr', { has: page.locator(`.projects-name[title="${name}"]`) });

async function openManage(page) {
  await page.locator('#project-switch-btn').click();
  await page.locator('#project-menu-manage').click();
  await expect(page.locator('#projects-modal')).toHaveAttribute('aria-hidden', 'false');
}

async function archiveBid(page, name) {
  await rowFor(page, name).locator('.projects-archive-btn').click();
}

test('X9 — archiving takes a bid out of the switcher and counts it in the footer', async ({ page }) => {
  await seedThreeBids(page); // Alpha (open), Charlie, Bravo
  await openManage(page);
  await archiveBid(page, 'Charlie');

  // it moved from the Live list into the Archived section, and stayed whole
  expect(await liveOrder(page)).toEqual(['Alpha', 'Bravo']);
  expect(await archivedOrder(page)).toEqual(['Charlie']);
  await expect(page.locator('#projects-count')).toHaveText('2 live · 1 archived');

  await page.locator('#projects-modal-close').click();
  await page.locator('#project-switch-btn').click();
  // pre-X9: the switcher listed every bid ever started
  expect(await menuOrder(page)).toEqual(['Alpha', 'Bravo']);
  await expect(page.locator('#project-menu-archived')).toHaveText('1 archived');
});

test('X9 — the archived line opens Manage projects on the Archived section, and Unarchive brings the bid back', async ({ page }) => {
  await seedThreeBids(page);
  await openManage(page);
  await archiveBid(page, 'Charlie');
  await page.locator('#projects-modal-close').click();

  await page.locator('#project-switch-btn').click();
  await page.locator('#project-menu-archived').click();
  await expect(page.locator('#projects-modal')).toHaveAttribute('aria-hidden', 'false');
  // the section is expanded, not left collapsed for a second click
  expect(await page.evaluate(() => document.getElementById('projects-archived').open)).toBe(true);
  expect(await archivedOrder(page)).toEqual(['Charlie']);

  await rowFor(page, 'Charlie').locator('.projects-unarchive-btn').click();
  expect(await liveOrder(page)).toEqual(['Alpha', 'Charlie', 'Bravo']);
  await expect(page.locator('#projects-archived')).toHaveCount(0);
  await expect(page.locator('#projects-count')).toHaveText('3 projects');

  await page.locator('#projects-modal-close').click();
  await page.locator('#project-switch-btn').click();
  expect(await menuOrder(page)).toEqual(['Alpha', 'Charlie', 'Bravo']);
  await expect(page.locator('#project-menu-archived')).toHaveCount(0);
});

test('X9 — the bid you have open cannot be archived, and says why', async ({ page }) => {
  await seedThreeBids(page);
  await openManage(page);
  const openRow = rowFor(page, 'Alpha');
  await expect(openRow.locator('.projects-archive-btn')).toBeDisabled();
  await expect(openRow.locator('.projects-archive-btn')).toHaveAttribute('title', /open/i);
  // and the state layer refuses it too, not just the button
  const refused = await page.evaluate(() => TakeoffState.setProjectArchived(TakeoffState.getCurrentProject().id, true));
  expect(refused).toBe(false);
  expect(await page.evaluate(() => TakeoffState.isProjectArchived())).toBe(false);
});

test('X9 — an archived bid is still archived after a reload, in the document and the index', async ({ page }) => {
  const { c } = await seedThreeBids(page);
  await openManage(page);
  await archiveBid(page, 'Charlie');

  const stored = await page.evaluate((id) => {
    const doc = JSON.parse(localStorage.getItem('takeoff-project-' + id));
    const entry = JSON.parse(localStorage.getItem('takeoff-projects-index')).projects.find((p) => p.id === id);
    return { docArchived: doc.archived, docAt: doc.archivedAt, entryArchived: entry.archived, entryAt: entry.archivedAt };
  }, c);
  expect(stored.docArchived).toBe(true);
  expect(stored.entryArchived).toBe(true);
  expect(Date.parse(stored.docAt)).toBeGreaterThan(0);
  expect(stored.entryAt).toBe(stored.docAt);

  await page.reload();
  await page.locator('#project-switch-btn').click();
  expect(await menuOrder(page)).toEqual(['Alpha', 'Bravo']);
  await expect(page.locator('#project-menu-archived')).toHaveText('1 archived');
});

test('X9 — archiving does not reorder the bids, and a duplicate of an archived bid is live', async ({ page }) => {
  await seedThreeBids(page);
  await openManage(page);
  const before = await liveOrder(page);
  expect(before).toEqual(['Alpha', 'Charlie', 'Bravo']);

  await archiveBid(page, 'Bravo');
  // the copy of a closed-out bid is work you are picking back up
  await rowFor(page, 'Bravo').locator('.projects-duplicate-btn').click();
  // the copy is a new bid, so it leads the live list; the source stays closed
  expect(await liveOrder(page)).toEqual(['Alpha', 'Bravo 2', 'Charlie']);
  expect(await archivedOrder(page)).toEqual(['Bravo']);

  await rowFor(page, 'Bravo').locator('.projects-unarchive-btn').click();
  // Bravo comes back behind Charlie, exactly where it was: archiving is not an
  // edit, so neither closing it nor reopening it moved it
  expect(await liveOrder(page)).toEqual(['Alpha', 'Bravo 2', 'Charlie', 'Bravo']);
});

test('X9 — opening an archived bid still names it in the switcher, and it can be unarchived from there', async ({ page }) => {
  await seedThreeBids(page);
  await openManage(page);
  await archiveBid(page, 'Charlie');
  await rowFor(page, 'Charlie').locator('.projects-switch-btn').click();

  // it is the bid the header names, so the menu has to list it whatever its state
  expect(await page.evaluate(() => TakeoffState.getCurrentProject().name)).toBe('Charlie');
  expect(await archivedOrder(page)).toEqual(['Charlie']);
  await rowFor(page, 'Charlie').locator('.projects-unarchive-btn').click();
  expect(await liveOrder(page)).toEqual(['Charlie', 'Alpha', 'Bravo']);

  await page.locator('#projects-modal-close').click();
  await page.locator('#project-switch-btn').click();
  expect(await menuOrder(page)).toEqual(['Charlie', 'Alpha', 'Bravo']);
});

test('X9 — a project document claiming archived with anything but true is live', async ({ page }) => {
  const { b } = await seedThreeBids(page);
  const state = await page.evaluate((id) => {
    const doc = TakeoffStorage.loadProject(id);
    doc.archived = 'yes'; // an imported or hand-edited document
    doc.archivedAt = 'whenever';
    TakeoffStorage.saveProject(doc);
    TakeoffState.switchProject(id);
    return { archived: TakeoffState.isProjectArchived() };
  }, b);
  expect(state.archived).toBe(false);
});

test('X9 — the archived section stacks on a phone with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await seedThreeBids(page);
  await openManage(page);
  await archiveBid(page, 'Charlie');
  const geom = await page.evaluate(() => {
    const row = document.querySelector('.projects-table-archived tbody tr');
    const cells = [...row.querySelectorAll('td')].map((td) => Math.round(td.getBoundingClientRect().top));
    const btn = row.querySelector('.projects-unarchive-btn').getBoundingClientRect();
    return {
      stacked: new Set(cells).size === cells.length,
      btnRight: btn.right,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
  expect(geom.stacked).toBe(true);
  expect(geom.btnRight).toBeLessThanOrEqual(geom.innerWidth);
  expect(geom.scrollWidth).toBe(geom.innerWidth);
});

test('B11 — the switcher menu scrolls and keeps its footer outside the scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await page.goto('/');
  await page.evaluate(() => {
    for (let i = 0; i < 24; i++) TakeoffState.createProject(`Bid ${i + 1}`);
    TakeoffApp.render();
  });
  await page.locator('#project-switch-btn').click();
  const geo = await page.evaluate(() => {
    const menu = document.getElementById('project-menu').getBoundingClientRect();
    const list = document.querySelector('.project-menu-list');
    const foot = document.querySelector('.project-menu-footer').getBoundingClientRect();
    return {
      menuBottom: menu.bottom,
      innerHeight: window.innerHeight,
      overflow: getComputedStyle(list).overflowY,
      scrolls: list.scrollHeight > list.clientHeight,
      footInsideList: list.contains(document.querySelector('.project-menu-footer')),
      footBottom: foot.bottom,
    };
  });
  // pre-fix: max-height none + overflow hidden gave a 919px menu in a 900px
  // window with the footer painted at y 922
  expect(geo.overflow).toBe('auto');
  expect(geo.scrolls).toBe(true);
  expect(geo.footInsideList).toBe(false);
  expect(geo.footBottom).toBeLessThanOrEqual(geo.innerHeight);
});
