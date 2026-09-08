'use strict';
// Telemetry (X17): the app posts structural events — and only structural
// events. This spec captures the outgoing request body and asserts both halves:
// the names and props are there, and nothing an estimator typed is (the seeded
// row description must not appear anywhere in the payload). Also pins the
// opt-out key: with takeoff-telemetry-off set, nothing is sent at all.
const { test, expect } = require('@playwright/test');

// Loud on purpose: spaces, a quote, a dash and a job name. If any of this
// reaches the wire, the PII guard is broken.
const RUN = '3/4" EMT — Panel LP-2 feeder';
const FITTING = '1" EMT connector — Acme';

// Capture every takeoff_events POST; abort the rest of Supabase (production).
async function captureEvents(page) {
  const bodies = [];
  await page.context().route(/supabase\.co/i, async (route) => {
    const url = route.request().url();
    if (url.includes('/rest/v1/takeoff_events')) {
      try {
        bodies.push({ rows: JSON.parse(route.request().postData() || '[]'), raw: route.request().postData() || '' });
      } catch (_) {
        bodies.push({ rows: [], raw: route.request().postData() || '' });
      }
      await route.fulfill({ status: 201, contentType: 'application/json', body: '' });
      return;
    }
    await route.abort();
  });
  return bodies;
}

const allRows = (bodies) => bodies.flatMap((b) => b.rows);
const rawText = (bodies) => bodies.map((b) => b.raw).join('\n');
const byName = (bodies, name) => allRows(bodies).filter((r) => r.name === name);

// Telemetry is silent under automation (navigator.webdriver) so the rest of the
// suite files no events; the spec that is ABOUT telemetry opts itself back in.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem('takeoff-telemetry-test', '1');
    } catch (_) {}
  });
});

test('a flow save and a purchase list are reported as counts, with no bid content', async ({ page }) => {
  const bodies = await captureEvents(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');

  // Seed a conduit run and walk the wizard: fittings row, then Save.
  await page.evaluate(({ run }) => {
    const item = TakeoffState.addItem({ type: 'conduit', description: run, quantity: 150, price: 1.1, labor: 0 });
    TakeoffApp.navigateToConduit(item.id);
  }, { run: RUN });
  await page.locator('#conduit-next-fittings').click();
  const row = page.locator('.fittings-table tbody tr').first();
  await row.locator('input[data-field="description"]').fill(FITTING);
  await row.locator('input[data-field="description"]').dispatchEvent('change');
  await row.locator('input[data-field="quantity"]').fill('4');
  await row.locator('input[data-field="quantity"]').dispatchEvent('change');
  await row.locator('input[data-field="price"]').fill('2.40');
  await row.locator('input[data-field="price"]').dispatchEvent('change');
  await page.locator('#conduit-next-overage').click();
  await page.locator('#conduit-save-btn').click();

  // Back on the manifest: generate the purchase list.
  await page.locator('#purchase-list-toggle-btn').click();
  await expect(page.locator('.purchase-list-open')).toBeVisible();

  // Fire-and-forget: nothing in the app awaits the send, so the spec asks for it.
  await page.evaluate(() => TakeoffEvents.flush());
  await expect.poll(() => allRows(bodies).length, { timeout: 5000 }).toBeGreaterThan(0);

  // Batched: the boot event and the two actions ride one request.
  expect(bodies.length).toBe(1);

  const boot = byName(bodies, 'session_start');
  expect(boot.length).toBe(1);
  expect(typeof boot[0].props.vw).toBe('number');
  expect(typeof boot[0].props.coarsePointer).toBe('boolean');
  expect(typeof boot[0].props.standalone).toBe('boolean');

  const saved = byName(bodies, 'flow_saved');
  expect(saved.length).toBe(1);
  expect(saved[0].props.kind).toBe('conduit');
  expect(saved[0].props.rows).toBe(1);            // the one fitting
  expect(saved[0].props.componentPrice).toBe(true);

  const po = byName(bodies, 'purchase_list_generated');
  expect(po.length).toBe(1);
  expect(po[0].props.lines).toBe(2);              // the run + its fitting
  expect(po[0].props.unpriced).toBe(0);

  // Every row is anonymous, viewport-stamped, and carries no account.
  for (const r of allRows(bodies)) {
    expect(typeof r.install_id).toBe('string');
    expect(r.install_id.length).toBeGreaterThan(7);
    expect(r.user_id).toBe(null);                 // signed out
    expect(typeof r.vw).toBe('number');
    expect(typeof r.coarse_pointer).toBe('boolean');
  }

  // The guard, stated as the thing it protects: no description, no job name,
  // no price string from the bid anywhere in what left the browser.
  const raw = rawText(bodies);
  expect(raw).not.toContain(RUN);
  expect(raw).not.toContain(FITTING);
  expect(raw).not.toContain('EMT');
  expect(raw).not.toContain('Panel');
  expect(raw).not.toContain('2.40');
  expect(errors).toEqual([]);
});

test('the takeoff-telemetry-off key stops every send', async ({ page }) => {
  const bodies = await captureEvents(page);
  await page.addInitScript(() => { try { localStorage.setItem('takeoff-telemetry-off', '1'); } catch (_) {} });
  await page.goto('/');
  await page.evaluate(() => {
    TakeoffEvents.log('purchase_list_generated', { lines: 3, unpriced: 0 });
    TakeoffEvents.flush();
  });
  await page.waitForTimeout(500);
  expect(allRows(bodies).length).toBe(0);
});
