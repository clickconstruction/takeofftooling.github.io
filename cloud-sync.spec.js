'use strict';
// Cloud sync + shared-corrections round trip, end to end against the real
// Supabase project. Needs a dedicated NON-ADMIN test account supplied via
// .env.local (TAKEOFF_TEST_EMAIL / TAKEOFF_TEST_PASSWORD — loaded by
// playwright.config.js); skips cleanly when absent. Sign-in is programmatic
// through the page's own supabase client — no credentials pass through forms.
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.TAKEOFF_TEST_EMAIL;
const PASSWORD = process.env.TAKEOFF_TEST_PASSWORD;
// Public constants shipped in js/cloud.js (publishable key; RLS is the gate).
const SB = {
  url: 'https://awjcdxqhvgnqsrlnoyxr.supabase.co',
  key: 'sb_publishable_vMFyQ4I0LqZD6yhfoF_Zbw_9MsPoC9G',
};

test.skip(!EMAIL || !PASSWORD, 'no test account in .env.local (TAKEOFF_TEST_EMAIL / TAKEOFF_TEST_PASSWORD)');

// The test account's own suggestion rows, read with its RLS-scoped session.
function fetchOwnSuggestions(page) {
  return page.evaluate(async ({ url, key }) => {
    const c = supabase.createClient(url, key);
    const { data, error } = await c.from('takeoff_suggestions').select('part_name,kind,new_value,status');
    return { rows: data || [], error: error ? error.message : null };
  }, SB);
}

function fetchOwnProjects(page) {
  return page.evaluate(async ({ url, key }) => {
    const c = supabase.createClient(url, key);
    const { data, error } = await c.from('takeoff_projects').select('id,name,data,updated_at');
    return { rows: data || [], error: error ? error.message : null };
  }, SB);
}

function setBookPrice(page, price) {
  return page.evaluate((p) => {
    TakeoffState.updateLaborBookRow('wire', 'THHN CU', 0, { price: p });
    TakeoffState.persistAllNow();
  }, price);
}

test('cloud round trip: sign in, share a correction, revert prunes it, opt-out withdraws all', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');

  // Programmatic sign-in: the UMD client shares localStorage with the app's
  // client, so after a reload the app boots already authenticated.
  const signInError = await page.evaluate(async ({ url, key, email, password }) => {
    const c = supabase.createClient(url, key);
    const { error } = await c.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }, { ...SB, email: EMAIL, password: PASSWORD });
  expect(signInError).toBeNull();
  await page.reload();
  await expect(page.locator('#cloud-btn')).toHaveText('✓ Cloud', { timeout: 20000 });

  // a non-admin account must never see the review panel entry
  await expect(page.locator('#review-suggestions-btn')).toBeHidden();

  try {
    // opt in through the real UI
    await page.locator('#cloud-btn').click();
    await page.locator('#cloud-share-toggle').check();

    // a price correction lands in takeoff_suggestions after the debounced push
    await setBookPrice(page, '111.11');
    await expect
      .poll(async () => {
        const { rows } = await fetchOwnSuggestions(page);
        return rows.some((r) => r.part_name === '14' && r.kind === 'edit' && r.new_value && r.new_value.price === '111.11');
      }, { timeout: 20000 })
      .toBe(true);

    // reverting to the default value prunes the shared row
    await setBookPrice(page, '95.00');
    await expect
      .poll(async () => {
        const { rows } = await fetchOwnSuggestions(page);
        return rows.some((r) => r.part_name === '14');
      }, { timeout: 20000 })
      .toBe(false);

    // opt-out withdraws everything that was shared
    await setBookPrice(page, '123.45');
    await expect
      .poll(async () => (await fetchOwnSuggestions(page)).rows.length, { timeout: 20000 })
      .toBeGreaterThan(0);
    const toggle = page.locator('#cloud-share-toggle');
    if (!(await toggle.isVisible())) await page.locator('#cloud-btn').click();
    await toggle.uncheck();
    await expect
      .poll(async () => (await fetchOwnSuggestions(page)).rows.length, { timeout: 20000 })
      .toBe(0);
  } finally {
    // leave the test account's book clean and the session closed
    await setBookPrice(page, '95.00');
    await page.waitForTimeout(2000); // let the final workspace push flush
    await page.evaluate(async ({ url, key }) => {
      const c = supabase.createClient(url, key);
      await c.auth.signOut();
    }, SB);
  }
});

// Build an applyBookReorganization payload from the live book: every tab's
// sections in one Ungrouped bucket, except `groupTab` where `groupSections`
// go into a named group. Runs in the page context.
function applyLayout(page, groupName, groupTab, groupSections) {
  return page.evaluate(({ groupName, groupTab, groupSections }) => {
    const book = TakeoffState.getLaborBook();
    const tabs = TakeoffState.getLaborBookTabOrder().map((key) => {
      const sections = Object.keys(book[key] || {}).map((name) => ({
        name,
        items: book[key][name],
        origin: { tab: key, name },
      }));
      if (key !== groupTab) return { key, groups: [{ name: null, sections }] };
      const grouped = sections.filter((s) => groupSections.includes(s.name));
      const loose = sections.filter((s) => !groupSections.includes(s.name));
      return { key, groups: [{ name: groupName, sections: grouped }, { name: null, sections: loose }] };
    });
    TakeoffState.applyBookReorganization({ tabs });
    TakeoffCloud.flushPending();
  }, { groupName, groupTab, groupSections });
}

function fetchOwnBookDoc(page) {
  return page.evaluate(async ({ url, key }) => {
    const c = supabase.createClient(url, key);
    const { data, error } = await c.from('takeoff_store').select('key,value').eq('key', 'book');
    return { row: (data && data[0]) || null, error: error ? error.message : null };
  }, SB);
}

function fetchOwnLayoutSuggestion(page) {
  return page.evaluate(async ({ url, key }) => {
    const c = supabase.createClient(url, key);
    const { data, error } = await c.from('takeoff_layout_suggestions').select('value,status');
    return { rows: data || [], error: error ? error.message : null, missing: !!(error && /takeoff_layout_suggestions/.test(error.message || '')) };
  }, SB);
}

test('layout round trip: groups sync in the book doc, pull to a fresh device, layout suggestion shared', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');

  const signInError = await page.evaluate(async ({ url, key, email, password }) => {
    const c = supabase.createClient(url, key);
    const { error } = await c.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }, { ...SB, email: EMAIL, password: PASSWORD });
  expect(signInError).toBeNull();
  await page.reload();
  await expect(page.locator('#cloud-btn')).toHaveText('✓ Cloud', { timeout: 20000 });

  try {
    // opt into sharing so the layout suggestion goes up alongside the book
    await page.locator('#cloud-btn').click();
    await page.locator('#cloud-share-toggle').check();
    await page.keyboard.press('Escape');

    // apply a reorganization: THHN CU into a named group on the wire tab
    await applyLayout(page, 'SyncLayout Group', 'wire', ['THHN CU']);

    // the book doc in takeoff_store now carries laborBookGroups
    await expect
      .poll(async () => {
        const { row } = await fetchOwnBookDoc(page);
        const g = row && row.value && row.value.laborBookGroups;
        return !!(g && g.wire && g.wire.some((x) => x.name === 'SyncLayout Group' && x.sections.includes('THHN CU')));
      }, { timeout: 20000 })
      .toBe(true);

    // the layout suggestion row exists (unless the 003 migration is unapplied)
    const layout = await fetchOwnLayoutSuggestion(page);
    if (!layout.missing) {
      await expect
        .poll(async () => {
          const { rows } = await fetchOwnLayoutSuggestion(page);
          return rows.some((r) => r.status === 'pending' && r.value && r.value.groups && r.value.groups.wire
            && r.value.groups.wire.some((g) => g.name === 'SyncLayout Group'));
        }, { timeout: 20000 })
        .toBe(true);
    } else {
      console.warn('takeoff_layout_suggestions missing — apply supabase/003 to cover layout sharing');
    }

    // fresh device: wipe the local book, reload signed in → cloud pull
    // restores the groups
    await page.evaluate(() => localStorage.removeItem('takeoff-book'));
    await page.reload();
    await expect(page.locator('#cloud-btn')).toHaveText('✓ Cloud', { timeout: 20000 });
    await expect
      .poll(async () => page.evaluate(() => {
        const g = TakeoffState.getLaborBookGroups('wire');
        return !!(g && g.some((x) => x.name === 'SyncLayout Group'));
      }), { timeout: 20000 })
      .toBe(true);
  } finally {
    // cleanup: back to a pristine default book (layout null → the shared
    // layout row is withdrawn on the next push), sharing off, signed out
    await page.evaluate(async () => {
      TakeoffState.adoptBook({
        v: 1,
        laborBook: JSON.parse(JSON.stringify(LABOR_BOOK_DEFAULTS)),
        laborBookMeta: { defaultsVersion: LABOR_BOOK_DEFAULTS_VERSION, removed: {} },
      });
      TakeoffState.persistAllNow();
      TakeoffCloud.flushPending();
    });
    await expect
      .poll(async () => {
        const { row } = await fetchOwnBookDoc(page);
        return row && row.value ? row.value.laborBookGroups || null : 'pending';
      }, { timeout: 20000 })
      .toBe(null);
    const after = await fetchOwnLayoutSuggestion(page);
    if (!after.missing) {
      await expect.poll(async () => (await fetchOwnLayoutSuggestion(page)).rows.length, { timeout: 20000 }).toBe(0);
    }
    const toggle = page.locator('#cloud-share-toggle');
    if (!(await toggle.isVisible())) await page.locator('#cloud-btn').click();
    await toggle.uncheck();
    await page.evaluate(async ({ url, key }) => {
      const c = supabase.createClient(url, key);
      await c.auth.signOut();
    }, SB);
  }
});

test('projects round trip: create syncs a row, rename updates it, delete removes it', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');

  const signInError = await page.evaluate(async ({ url, key, email, password }) => {
    const c = supabase.createClient(url, key);
    const { error } = await c.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }, { ...SB, email: EMAIL, password: PASSWORD });
  expect(signInError).toBeNull();
  await page.reload();
  await expect(page.locator('#cloud-btn')).toHaveText('✓ Cloud', { timeout: 20000 });

  const name = 'SyncTest ' + Date.now();
  const projectId = await page.evaluate((n) => {
    const id = TakeoffState.createProject(n);
    TakeoffState.addItem({ description: 'Sync row', type: 'gear', quantity: 1, labor: 1, price: 10 });
    TakeoffState.persistNow();
    TakeoffCloud.flushPending();
    return id;
  }, name);

  try {
    // create lands as a takeoff_projects row carrying the manifest
    await expect
      .poll(async () => {
        const { rows } = await fetchOwnProjects(page);
        const r = rows.find((x) => x.id === projectId);
        return !!(r && r.name === name && r.data && Array.isArray(r.data.manifest) && r.data.manifest.some((m) => m.description === 'Sync row'));
      }, { timeout: 20000 })
      .toBe(true);

    // rename follows
    await page.evaluate(() => {
      TakeoffState.setProjectName('SyncTest renamed');
      TakeoffState.persistNow();
      TakeoffCloud.flushPending();
    });
    await expect
      .poll(async () => {
        const { rows } = await fetchOwnProjects(page);
        const r = rows.find((x) => x.id === projectId);
        return r ? r.name : null;
      }, { timeout: 20000 })
      .toBe('SyncTest renamed');
  } finally {
    // cleanup: switch off the test project and delete it → row disappears
    await page.evaluate((id) => {
      const other = TakeoffState.getProjects().find((p) => p.id !== id);
      if (other) TakeoffState.switchProject(other.id);
      TakeoffState.deleteProject(id);
    }, projectId);
    await expect
      .poll(async () => {
        const { rows } = await fetchOwnProjects(page);
        return rows.some((x) => x.id === projectId);
      }, { timeout: 20000 })
      .toBe(false);
  }
});
