/**
 * TakeoffEvents — product telemetry: what estimators DO, counted, never what
 * they typed. Nothing in this file exists to identify a person or a bid.
 *
 * What travels: an event name from a fixed vocabulary, a small bag of
 * structural props (counts, booleans, short enums, durations), the viewport
 * width, whether the pointer is coarse (tablet vs mouse), an anonymous
 * per-install id (a random UUID in localStorage, not tied to an account), and
 * the signed-in user's id ONLY while they are signed in.
 *
 * What never travels: descriptions, project or job names, the price on any
 * one row, emails, addresses, plan pages, search terms. `sanitizeProps` is the
 * guard, not the call sites: a value survives only if it is a boolean, a
 * finite number, or a short spaceless enum token, and a key on the deny list
 * (description, name, email, price, …) is dropped whatever it holds. Anything
 * an estimator typed fails at least one of those tests.
 *
 * How it behaves: fire-and-forget. `log()` queues; the queue flushes every 5 s,
 * at 20 events, and on pagehide (keepalive). It never throws, never awaits, and
 * never retries — a batch that cannot be sent is dropped. It goes silent for
 * the session when the table is not there yet (404 / 42P01 — supabase/
 * 004_takeoff_events.sql is unapplied), when the endpoint refuses us
 * (401/403), when the device is offline, when Do-Not-Track or Global Privacy
 * Control is set, when localStorage carries `takeoff-telemetry-off`, and under
 * automation (`navigator.webdriver`) unless the page opts back in with
 * `takeoff-telemetry-test` — the Playwright suite must not file events as if an
 * estimator had done the work.
 *
 * The Supabase URL + publishable key come from js/cloud.js (TakeoffCloud
 * .getEndpoint) so they live in exactly one file.
 */
const TakeoffEvents = (function () {
  const TABLE = 'takeoff_events';
  const INSTALL_KEY = 'takeoff-install-id';
  const OPT_OUT_KEY = 'takeoff-telemetry-off';
  // Automation is silent by default — otherwise every Playwright spec in the
  // suite would file events as if an estimator had done the work. The spec
  // that is ABOUT telemetry opts itself back in with this key.
  const TEST_KEY = 'takeoff-telemetry-test';
  const MAX_BATCH = 20;   // flush at this many queued events
  const FLUSH_MS = 5000;  // …or this long after the first one
  const MAX_QUEUE = 100;  // hard ceiling; the oldest are dropped, never the app
  const MAX_KEYS = 12;

  const NAME_RE = /^[a-z][a-z0-9_]{2,39}$/;      // snake_case vocabulary
  const KEY_RE = /^[a-z][A-Za-z0-9_]{0,23}$/;    // camelCase prop keys
  const ENUM_RE = /^[A-Za-z0-9_.:+-]{1,32}$/;    // short, spaceless, quote-free
  // Keys that would carry content even when the value looks harmless.
  const DENY_KEYS = [
    'description', 'desc', 'name', 'projectname', 'title', 'label', 'text', 'note', 'notes',
    'email', 'address', 'client', 'permitno', 'planpage', 'page',
    'query', 'term', 'search', 'url', 'href', 'filename',
    'price', 'unitprice', 'cost', 'total', 'rate',
  ];

  // ---------- pure helpers (unit-tested in events.test.js) ----------

  function isEventName(name) {
    return typeof name === 'string' && NAME_RE.test(name);
  }

  /**
   * The PII guard. Keeps booleans, finite numbers (2 dp) and short enum
   * tokens; drops everything else, including every key on DENY_KEYS. A row
   * description ('3/4" EMT') fails ENUM_RE on the space and the quote, so it
   * cannot leave the browser even if a call site passes it by mistake.
   */
  function sanitizeProps(props) {
    const out = {};
    if (!props || typeof props !== 'object' || Array.isArray(props)) return out;
    let kept = 0;
    for (const key of Object.keys(props)) {
      if (kept >= MAX_KEYS) break;
      if (!KEY_RE.test(key)) continue;
      if (DENY_KEYS.includes(key.toLowerCase())) continue;
      const value = props[key];
      if (typeof value === 'boolean') {
        out[key] = value;
        kept++;
      } else if (typeof value === 'number') {
        if (!Number.isFinite(value)) continue;
        out[key] = Math.round(value * 100) / 100;
        kept++;
      } else if (typeof value === 'string') {
        if (!ENUM_RE.test(value)) continue;
        out[key] = value;
        kept++;
      }
    }
    return out;
  }

  /** One queued event + the session context → the row POSTed to PostgREST. */
  function buildRow(event, ctx) {
    const props = Object.assign({}, event.props);
    if (ctx && ctx.appVersion) props.appVersion = ctx.appVersion;
    return {
      install_id: (ctx && ctx.installId) || null,
      user_id: (ctx && ctx.userId) || null,
      name: event.name,
      props,
      vw: typeof event.vw === 'number' ? event.vw : null,
      coarse_pointer: typeof event.coarsePointer === 'boolean' ? event.coarsePointer : null,
    };
  }

  /** Do-Not-Track / GPC / the local opt-out all mean the same thing: no. */
  function telemetryAllowed(env) {
    const e = env || {};
    return !(e.optOut || e.dnt || e.gpc);
  }

  /** The table isn't there yet (migration unapplied) — go quiet, drop the batch. */
  function isMissingTable(status, body) {
    if (status === 404) return true;
    return /42P01|PGRST20[25]/.test(String(body || ''));
  }

  /**
   * import_added's props, computed BEFORE the import writes (afterwards the
   * matched rows already carry the new counts). lookup(item) returns the
   * manifest row this line will merge into, or null when it adds a new one.
   */
  function importProps(items, separateRows, lookup) {
    const list = Array.isArray(items) ? items : [];
    let added = 0;
    let raised = 0;
    let lowered = 0;
    let untyped = 0;
    for (const item of list) {
      if (!item) continue;
      if (!item.type) untyped++;
      const existing = separateRows || typeof lookup !== 'function' ? null : lookup(item);
      if (!existing) {
        added++;
        continue;
      }
      if (item.quantity == null) continue;
      const was = Number(existing.quantity) || 0;
      const now = Number(item.quantity) || 0;
      if (now > was) raised++;
      else if (now < was) lowered++;
    }
    return { mode: separateRows ? 'separate' : 'merge', raised, added, lowered, untyped };
  }

  // ---------- runtime (browser only; inert under node:test) ----------

  const hasWindow = typeof window !== 'undefined' && typeof document !== 'undefined';
  // Optional build stamp: <meta name="app-version" content="…">. There is no
  // build step today, so this is usually absent and the field is omitted.
  const APP_VERSION = (function () {
    try {
      const meta = hasWindow ? document.querySelector('meta[name="app-version"]') : null;
      const v = meta && meta.getAttribute('content');
      return v && ENUM_RE.test(v) ? v : null;
    } catch (_) {
      return null;
    }
  })();

  let queue = [];
  let timer = null;
  let stopped = false;   // the table is missing, or the endpoint refuses us
  let allowed = null;    // resolved once per load
  let installId = null;

  function randomId() {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (_) { /* no crypto */ }
    return 'i-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // Anonymous, per browser install. Not an account, not a fingerprint — a
  // random id so "how many people" can be answered without knowing who.
  function getInstallId() {
    if (installId) return installId;
    try {
      installId = localStorage.getItem(INSTALL_KEY);
      if (!installId) {
        installId = randomId();
        localStorage.setItem(INSTALL_KEY, installId);
      }
    } catch (_) {
      installId = installId || randomId(); // private mode: this load only
    }
    return installId;
  }

  function readOptOut() {
    try {
      const v = localStorage.getItem(OPT_OUT_KEY);
      return !!v && v !== '0' && v !== 'false';
    } catch (_) {
      return false;
    }
  }

  function readDnt() {
    try {
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      const dnt = (nav && (nav.doNotTrack || nav.msDoNotTrack)) || (hasWindow && window.doNotTrack);
      return dnt === '1' || dnt === 'yes';
    } catch (_) {
      return false;
    }
  }

  function enabled() {
    if (stopped || !hasWindow) return false;
    if (allowed === null) {
      let gpc = false;
      try { gpc = typeof navigator !== 'undefined' && navigator.globalPrivacyControl === true; } catch (_) {}
      let automated = typeof navigator !== 'undefined' && navigator.webdriver === true;
      try {
        if (automated && localStorage.getItem(TEST_KEY) === '1') automated = false;
      } catch (_) { /* no storage: automation stays silent */ }
      allowed = telemetryAllowed({ optOut: readOptOut() || automated, dnt: readDnt(), gpc });
    }
    return allowed;
  }

  function viewportWidth() {
    try { return Math.round(window.innerWidth) || null; } catch (_) { return null; }
  }

  function coarsePointer() {
    try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (_) { return null; }
  }

  function endpoint() {
    try {
      if (typeof TakeoffCloud === 'undefined' || !TakeoffCloud.getEndpoint) return null;
      const ep = TakeoffCloud.getEndpoint();
      return ep && ep.url && ep.key ? ep : null;
    } catch (_) {
      return null;
    }
  }

  function handleResponse(res) {
    try {
      if (!res || res.ok) return;
      if (res.status === 401 || res.status === 403) {
        stopped = true; // the endpoint won't take these — stop asking
        return;
      }
      res.text().then((body) => {
        if (isMissingTable(res.status, body)) stopped = true;
      }, () => {});
    } catch (_) { /* telemetry never becomes its own error */ }
  }

  /**
   * Send whatever is queued. Fire-and-forget: nothing awaits this, and a batch
   * that cannot be sent is dropped rather than retried — telemetry must never
   * outweigh the work it is measuring.
   */
  function flush(opts) {
    try {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!queue.length) return;
      const batch = queue;
      queue = [];
      if (!enabled()) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const ep = endpoint();
      if (!ep) return;
      const ctx = { installId: getInstallId(), userId: ep.userId || null, appVersion: APP_VERSION };
      const rows = batch.map((event) => buildRow(event, ctx));
      const out = fetch(ep.url.replace(/\/+$/, '') + '/rest/v1/' + TABLE, {
        method: 'POST',
        keepalive: !!(opts && opts.keepalive),
        headers: {
          'Content-Type': 'application/json',
          apikey: ep.key,
          Authorization: 'Bearer ' + (ep.token || ep.key),
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(rows),
      });
      if (out && typeof out.then === 'function') out.then(handleResponse, () => {});
    } catch (_) { /* never throws */ }
  }

  /** Record one event. Safe to call from anywhere, including hot paths. */
  function log(name, props) {
    try {
      if (!enabled() || !isEventName(name)) return;
      queue.push({ name, props: sanitizeProps(props), vw: viewportWidth(), coarsePointer: coarsePointer() });
      if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
      if (queue.length >= MAX_BATCH) flush();
      else if (!timer) timer = setTimeout(flush, FLUSH_MS);
    } catch (_) { /* never throws */ }
  }

  if (hasWindow) {
    window.addEventListener('pagehide', () => flush({ keepalive: true }));
  }

  return {
    log,
    flush,
    importProps,
    // pure, for tests
    isEventName,
    sanitizeProps,
    buildRow,
    telemetryAllowed,
    isMissingTable,
    MAX_BATCH,
    FLUSH_MS,
    OPT_OUT_KEY,
    INSTALL_KEY,
  };
})();

// Node (unit tests); inert in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TakeoffEvents;
}
