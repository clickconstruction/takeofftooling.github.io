'use strict';
/**
 * Takeoff Tooling app-shell service worker.
 *
 * Why: an estimator on a job site edits fine with no signal, but a refresh
 * used to give a blank browser error page — the app could not survive an
 * offline reload (J11-F7). This keeps the shell on the device so a reload
 * works with no network at all.
 *
 * Strategy, deliberately small:
 *   - install  : precache the shell (index.html, the stylesheet, every js/
 *                file in index.html's load order, the manifest and icons).
 *   - navigate : network first, fall back to the cached index.html. Online
 *                you always get fresh code; offline you get the app.
 *   - shell    : network first, fall back to cache — same reason.
 *   - book data: mc-assemblies/*.json are cache first with a background
 *                refresh. They are 12 MB together, so they are NOT
 *                precached: they land the first time the estimator opens
 *                the book, which is what the book's offline message says.
 *   - anything cross-origin (Supabase, the jsDelivr/cdnjs CDNs, Google
 *     Fonts) is never intercepted and never cached, so "zero network while
 *     signed out" stays observable in devtools and in tests.
 *
 * Deploy note: bump CACHE_VERSION whenever a shell file changes, or
 * returning visitors keep the old copy until their next network-first hit.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `takeoff-shell-${CACHE_VERSION}`;
const DATA_CACHE = `takeoff-data-${CACHE_VERSION}`;

// Always precached, whatever index.html says.
const CORE_ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

/**
 * The rest of the shell is read out of index.html at install time rather
 * than listed here: index.html already holds the authoritative load order,
 * and a hand-copied second list goes stale the first time a script tag is
 * added. Only same-origin js/ and css/ references are taken — the CDN
 * <script>s and the Google Fonts <link> are skipped on purpose.
 */
function shellAssetsFrom(html) {
  const found = new Set();
  const re = /(?:src|href)\s*=\s*"((?:js|css)\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) found.add(m[1]);
  return [...found];
}

// The six JSONs the app fetches at runtime (mcBook.js + mcElliotState.js).
// tab-mapping.json is build config and is never fetched by the app.
const DATA_PATHS = [
  'mc-assemblies/mc-labor-book.json',
  'mc-assemblies/mc-price-model.json',
  'mc-assemblies/elliot-price-overlay.json',
  'mc-assemblies/elliot-item-mappings.json',
  'mc-assemblies/elliot-category-mapping.json',
  'mc-assemblies/vendor-profiles.json',
];
const DATA_URLS = DATA_PATHS.map((p) => new URL(p, self.registration.scope).href);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    let assets = CORE_ASSETS;
    try {
      const indexRes = await fetch(new Request('index.html', { cache: 'reload' }));
      if (indexRes && indexRes.ok) {
        assets = CORE_ASSETS.concat(shellAssetsFrom(await indexRes.text()));
      }
    } catch (err) { /* offline at install time — handled per-asset below */ }
    // One-by-one rather than addAll: a single 404 must not sink the install.
    await Promise.all(assets.map(async (asset) => {
      try {
        const res = await fetch(new Request(asset, { cache: 'reload' }));
        if (res && res.ok) await cache.put(asset, res.clone());
      } catch (err) { /* offline at install time — picked up on a later load */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('takeoff-') && k !== SHELL_CACHE && k !== DATA_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// The page asks for this when "Reload app (keeps your data)" is pressed.
self.addEventListener('message', (event) => {
  if (event.data === 'takeoff-skip-waiting') self.skipWaiting();
});

/** Cache first, then refresh in the background — for the big book JSONs. */
async function cacheFirst(request) {
  const cache = await caches.open(DATA_CACHE);
  const hit = await cache.match(request);
  if (hit) {
    // Refresh for next time; never block this response on it.
    fetch(request).then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
    }).catch(() => {});
    return hit;
  }
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

/** Network first, cached copy as the offline fallback — for the shell. */
async function networkFirst(request, fallbackKey) {
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(fallbackKey || request, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await caches.match(fallbackKey || request, { cacheName: SHELL_CACHE });
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never touch anything off this origin: Supabase, the CDNs, Google Fonts.
  // Not intercepted, not cached, not counted.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // A share link's #hash never reaches the network, so index.html is the
    // right fallback for every in-app URL.
    event.respondWith(networkFirst(request, new URL('index.html', self.registration.scope).href));
    return;
  }

  if (DATA_URLS.includes(url.href)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
