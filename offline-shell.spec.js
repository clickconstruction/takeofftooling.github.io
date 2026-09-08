'use strict';
// The app survives a reload with no signal (X2 / J11-F7): the app-shell
// service worker in sw.js keeps index.html, the stylesheet and every js/
// file on the device — and keeps nothing at all from Supabase or the CDNs.
//
// js/app.js deliberately does not register the worker when
// navigator.webdriver is true (a fresh profile per Playwright context would
// have every unrelated spec paying for an install), so this spec registers
// it by hand and then exercises the real sw.js.
const { test, expect } = require('@playwright/test');

/** Register sw.js and wait until it controls the page. */
async function installWorker(page) {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
        // claim() may already have landed between the two lines above
        if (navigator.serviceWorker.controller) resolve();
      });
    }
    return !!reg;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test('the head declares the web manifest, and it resolves', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.webmanifest');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f0f11');

  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.short_name).toBe('Takeoff');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((i) => i.sizes)).toContain('512x512');
  for (const icon of manifest.icons) {
    expect((await request.get('/' + icon.src)).ok()).toBe(true);
  }
});

test('app.js registers the worker on its own once the automation flag is off', async ({ page }) => {
  // the guard in js/app.js is the only reason the rest of the suite never
  // sees a worker; spoof the flag and the real registration line runs
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  await page.goto('/');
  await expect.poll(() =>
    page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))
  ).toBeGreaterThan(0);
  await expect.poll(() =>
    page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r && r.active && r.active.scriptURL))
  ).toContain('/sw.js');
});

test('an offline reload still opens the bid, with the edits intact', async ({ page, context }) => {
  await page.goto('/');
  await installWorker(page);

  // Type into the seed row, then reload once online so the page is served
  // through the worker and the shell is definitely cached.
  const desc = page.locator('input[data-field="description"]').first();
  await desc.fill('Offline Troffer');
  await desc.dispatchEvent('change');
  await page.evaluate(() => TakeoffState.persistAllNow());
  await page.reload();
  await expect(page.locator('#main-content')).toBeVisible();

  // Pull the plug.
  await context.setOffline(true);
  await page.reload();

  await expect(page.locator('#main-content')).toBeVisible();
  await expect(page.locator('input[data-field="description"]').first()).toHaveValue('Offline Troffer');
  // and the app is genuinely running, not a cached snapshot of markup
  expect(await page.evaluate(() => TakeoffState.getTopLevelItems().length)).toBeGreaterThan(0);

  await context.setOffline(false);
});

test('the worker caches nothing off this origin — no Supabase, no CDN', async ({ page }) => {
  await page.goto('/');
  await installWorker(page);
  await page.reload();

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const urls = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) urls.push(req.url);
    }
    return { names, urls };
  });

  expect(cached.names.length).toBeGreaterThan(0);
  expect(cached.names.every((n) => n.startsWith('takeoff-'))).toBe(true);
  expect(cached.urls.length).toBeGreaterThan(0);

  const origin = new URL(page.url()).origin;
  const foreign = cached.urls.filter((u) => !u.startsWith(origin));
  expect(foreign).toEqual([]);
  expect(cached.urls.filter((u) => /supabase\.co|jsdelivr|cdnjs|gstatic|googleapis/i.test(u))).toEqual([]);

  // the shell it does hold is the real load order out of index.html
  expect(cached.urls.some((u) => u.endsWith('/js/app.js'))).toBe(true);
  expect(cached.urls.some((u) => u.endsWith('/js/state.js'))).toBe(true);
  expect(cached.urls.some((u) => u.endsWith('/css/styles.css'))).toBe(true);
});

test('Reload app clears the caches and unregisters the worker', async ({ page }) => {
  await page.goto('/');
  await installWorker(page);
  await page.reload();
  expect(await page.evaluate(() => caches.keys().then((k) => k.length))).toBeGreaterThan(0);

  await page.locator('#header-menu-btn').click();
  // the handler clears, unregisters, then location.replace()s — wait for that
  // navigation, or the assertions below race the context being destroyed
  const reloaded = page.waitForNavigation({ waitUntil: 'load' });
  await page.locator('#cache-clear-reload-btn').click();
  await reloaded;
  await expect(page.locator('#main-content')).toBeVisible();

  await expect.poll(() => page.evaluate(() => caches.keys().then((k) => k.length))).toBe(0);
  await expect.poll(() =>
    page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))
  ).toBe(0);
});
