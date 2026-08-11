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

function setBookPrice(page, price) {
  return page.evaluate((p) => {
    TakeoffState.updateLaborBookRow('wire', 'THHN CU', 0, { price: p });
    TakeoffState.persistNow();
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
