'use strict';
// Unit tests for js/cloudSync.js — the project sync/push decisions (node:test).
// The cloud project is production and cannot be signed into from a dev
// machine, so these rules are only ever exercised here.
const test = require('node:test');
const assert = require('node:assert/strict');
const Sync = require('./js/cloudSync.js');

const T0 = '2026-09-01T10:00:00.000Z'; // the copy both devices pulled
const T1 = '2026-09-01T11:00:00.000Z'; // one device saved
const T2 = '2026-09-01T12:00:00.000Z'; // the other device saved

function project(savedAt, manifest, name) {
  return { v: 1, id: 'p1', savedAt, name: name || 'Lakeside', manifest: manifest || [], laborRate: 0 };
}

const bidA = [{ id: 'i1', type: 'lighting', quantity: 4 }];
const bidB = [{ id: 'i1', type: 'lighting', quantity: 9 }];

test('same bid on both sides is in sync whatever the clocks say', () => {
  assert.equal(Sync.decideProjectSync(project(T1, bidA), project(T2, bidA), T0).action, 'in-sync');
});

test('no local copy: adopt the remote', () => {
  assert.equal(Sync.decideProjectSync(null, project(T1, bidA), null).action, 'adopt');
});

test('remote is newer and the local copy is the untouched pull: adopt', () => {
  // local savedAt === the stamp we last reconciled with → no unsynced work
  const d = Sync.decideProjectSync(project(T0, bidA), project(T1, bidB), T0);
  assert.equal(d.action, 'adopt');
});

test('remote is newer but the local copy changed since the pull: keep both', () => {
  const d = Sync.decideProjectSync(project(T2, bidA), project(T1, bidB), T0);
  // NOTE: local clock ahead of remote is still the "local is newer" branch;
  // this case is remote newer *and* local edited after the pull:
  const d2 = Sync.decideProjectSync(project(T1, bidA), project(T2, bidB), T0);
  assert.equal(d2.action, 'adopt-keep-local');
  assert.match(d2.keepName, /^Lakeside \(conflict — /);
  assert.equal(d.action, 'push-keep-remote'); // remote moved past what we saw
});

test('remote is newer and nothing is known about the pull: keep both (never overwrite blind)', () => {
  const d = Sync.decideProjectSync(project(T0, bidA), project(T1, bidB), null);
  assert.equal(d.action, 'adopt-keep-local');
});

test('local is newer and the remote is the row we last saw: plain push', () => {
  assert.equal(Sync.decideProjectSync(project(T2, bidB), project(T1, bidA), T1).action, 'push');
});

test('local is newer but the remote moved since we saw it: keep the remote copy', () => {
  const d = Sync.decideProjectSync(project(T2, bidB), project(T1, bidA), T0);
  assert.equal(d.action, 'push-keep-remote');
  assert.match(d.keepName, /^Lakeside \(conflict — /);
});

test('push precondition: no row yet, or the row is still the one we saw', () => {
  assert.equal(Sync.decideProjectPush(project(T2, bidB), null, T1).action, 'push');
  assert.equal(Sync.decideProjectPush(project(T2, bidB), project(T1, bidA), T1).action, 'push');
});

test('push precondition: the row already holds this bid', () => {
  assert.equal(Sync.decideProjectPush(project(T2, bidA), project(T1, bidA), T0).action, 'in-sync');
});

test('push precondition: the row moved since we saw it — fork it, do not overwrite', () => {
  const d = Sync.decideProjectPush(project(T2, bidB), project(T1, bidA), T0);
  assert.equal(d.action, 'fork-remote');
  assert.match(d.keepName, /^Lakeside \(conflict — /);
});

test('push precondition: an unseen row is never overwritten', () => {
  assert.equal(Sync.decideProjectPush(project(T2, bidB), project(T1, bidA), null).action, 'fork-remote');
});

test('conflict names carry a device time and never nest', () => {
  const once = Sync.conflictName('Lakeside', T1);
  const twice = Sync.conflictName(once, T2);
  assert.equal((twice.match(/conflict/g) || []).length, 1);
  assert.ok(twice.startsWith('Lakeside (conflict — '));
  assert.notEqual(once, twice);
  assert.equal(Sync.conflictName('', T1).startsWith('Untitled project (conflict — '), true);
});

test('sameContent compares the bid, not the clock', () => {
  assert.equal(Sync.sameContent(project(T1, bidA), project(T2, bidA)), true);
  assert.equal(Sync.sameContent(project(T1, bidA), project(T1, bidB)), false);
  assert.equal(Sync.sameContent(project(T1, bidA), project(T1, bidA, 'Other name')), false);
  assert.equal(Sync.sameContent(null, project(T1, bidA)), false);
});

test('a rename alone is a real change (it is what the project list shows)', () => {
  const d = Sync.decideProjectSync(project(T0, bidA, 'Lakeside'), project(T1, bidA, 'Lakeside Mall'), T0);
  assert.equal(d.action, 'adopt');
});

// --- Starter projects (T2-13) -----------------------------------------

const starter = [{ id: 'r1', type: null, description: '', quantity: 1, children: [] }];
const typedIn = [{ id: 'r1', type: 'lighting', description: '2x4 troffer', quantity: 4, children: [] }];
const childOnly = [{ id: 'r1', description: '', children: [{ id: 'c1', description: '3/4" EMT' }] }];

test('a boot starter is a starter; a typed row is not', () => {
  assert.equal(Sync.isStarterProject(project(T1, starter)), true);
  assert.equal(Sync.isStarterProject(project(T1, [])), true);
  assert.equal(Sync.isStarterProject(project(T1, typedIn)), false);
  assert.equal(Sync.isStarterProject(project(T1, childOnly)), false, 'a described child counts');
  assert.equal(Sync.isStarterProject(null), true);
});

test('only a project with real work earns a cloud row', () => {
  assert.equal(Sync.shouldPushNewProject(project(T1, starter)), false);
  assert.equal(Sync.shouldPushNewProject(project(T1, typedIn)), true);
});

test('a fresh device on a starter opens the newest remote bid', () => {
  const remote = [
    { id: 'a', savedAt: T0, manifest: typedIn },
    { id: 'b', savedAt: T2, manifest: typedIn },
    { id: 'c', savedAt: T1, manifest: typedIn },
  ];
  assert.equal(Sync.pickProjectToOpen({ id: 'local', manifest: starter }, remote), 'b');
});

test('a project with work in it is never switched away from', () => {
  const remote = [{ id: 'a', savedAt: T2, manifest: typedIn }];
  assert.equal(Sync.pickProjectToOpen({ id: 'local', manifest: typedIn }, remote), null);
});

test('remote starters are not worth switching to', () => {
  const remote = [{ id: 'a', savedAt: T2, manifest: starter }];
  assert.equal(Sync.pickProjectToOpen({ id: 'local', manifest: starter }, remote), null);
  assert.equal(Sync.pickProjectToOpen({ id: 'local', manifest: starter }, []), null);
});

test('the open project already being the newest remote bid is not a switch', () => {
  const remote = [{ id: 'local', savedAt: T2, manifest: typedIn }];
  assert.equal(Sync.pickProjectToOpen({ id: 'local', manifest: starter }, remote), null);
});

// --- Tombstones (T2-14) -----------------------------------------------

test('a tombstone hides the row it names', () => {
  const map = Sync.withTombstone(Sync.emptyTombstones(), 'projects', 'p1', T1);
  assert.equal(Sync.isTombstoned(map, 'projects', 'p1', T0), true, 'an older copy stays deleted');
  assert.equal(Sync.isTombstoned(map, 'projects', 'p1', T1), true, 'the copy that was deleted');
  assert.equal(Sync.isTombstoned(map, 'projects', 'p1', T2), false, 'saved again after the delete');
  assert.equal(Sync.isTombstoned(map, 'projects', 'other', T0), false);
});

test('a tombstone can be withdrawn, and never moves backwards', () => {
  let map = Sync.withTombstone(Sync.emptyTombstones(), 'assemblies', 'a1', T2);
  map = Sync.withTombstone(map, 'assemblies', 'a1', T0);
  assert.equal(map.assemblies.a1, T2);
  map = Sync.withoutTombstone(map, 'assemblies', 'a1');
  assert.equal(Sync.isTombstoned(map, 'assemblies', 'a1', null), false);
});

test('deleted assemblies do not come back from the other device', () => {
  const remote = [{ id: 'a1', name: 'Break room duplex' }, { id: 'a2', name: 'Corridor whip' }];
  const local = [{ id: 'a2', name: 'Corridor whip' }];
  const map = Sync.withTombstone(Sync.emptyTombstones(), 'assemblies', 'a1', T1);
  assert.deepEqual(Sync.mergeAssemblies(remote, local, map).map((a) => a.id), ['a2']);
  // without the tombstone the union resurrects it — the bug this closes
  assert.deepEqual(Sync.mergeAssemblies(remote, local, Sync.emptyTombstones()).map((a) => a.id), ['a1', 'a2']);
});

test('removedIds names what a save dropped', () => {
  assert.deepEqual(Sync.removedIds([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }]), ['a']);
  assert.deepEqual(Sync.removedIds([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }]), []);
  assert.deepEqual(Sync.removedIds(null, null), []);
});

test('a malformed tombstone row degrades to no tombstones', () => {
  assert.deepEqual(Sync.normalizeTombstones(null), { v: 1, projects: {}, assemblies: {} });
  assert.deepEqual(Sync.normalizeTombstones({ projects: { p1: 5 } }).projects, {});
  assert.deepEqual(Sync.normalizeTombstones({ projects: { p1: T1 } }).projects, { p1: T1 });
});

// --- Sharing consent (T2-12) ------------------------------------------

test('sharing consent is off unless the account row says on', () => {
  assert.equal(Sync.readShareConsent(null), false);
  assert.equal(Sync.readShareConsent({ v: 1, on: false }), false);
  assert.equal(Sync.readShareConsent({ on: true }), false, 'unversioned row is not consent');
  assert.equal(Sync.readShareConsent({ v: 1, on: true }), true);
  assert.equal(Sync.readShareConsent(Sync.shareConsentRow(true, T1)), true);
  assert.equal(Sync.readShareConsent(Sync.shareConsentRow(false, T1)), false);
});

// --- Promoted catalog parts (X4) --------------------------------------
// A row copied out of the supply house's catalog, exactly as
// TakeoffState.promoteCatalogPart writes it.

function promoted(extra) {
  return {
    name: 'MC CONN 1/2 STL',
    labor: 0,
    price: '106.29',
    partNumber: 'E1234',
    userAdded: true,
    priceSource: 'Elliot Electric',
    pricedAt: '2026-09-01',
    offers: [{ supplier: 'Elliot Electric', price: 106.29, at: '2026-09-01', by: 'import' }],
    history: [{ at: '2026-09-01', kind: 'price', supplier: 'Elliot Electric', value: 106.29, by: 'import' }],
    ...extra,
  };
}

test('a freshly promoted catalog part is not a correction', () => {
  assert.equal(Sync.isUnquotedPromotion(promoted()), true);
  assert.equal(Sync.isUnquotedPromotion(promoted({ price: '', offers: [], history: [] })), false,
    'nothing was imported — that is a hand-built row');
});

test('hours on a promoted part make it worth sharing', () => {
  assert.equal(Sync.isUnquotedPromotion(promoted({ labor: 1.25 })), false);
  // …and hours typed through the part card leave a history line as well
  assert.equal(
    Sync.isUnquotedPromotion(promoted({
      labor: 0.5,
      history: [{ at: '2026-09-02', kind: 'labor', value: 0.5, by: 'robert' }, ...promoted().history],
    })),
    false
  );
});

test('a quote on a promoted part makes it worth sharing', () => {
  const quoted = promoted({
    offers: [
      { supplier: 'Elliot Electric', price: 106.29, at: '2026-09-01', by: 'import' },
      { supplier: 'Border States', price: 98.4, at: '2026-09-03', by: 'robert' },
    ],
  });
  assert.equal(Sync.isUnquotedPromotion(quoted), false);
  // a price typed straight into the row is recorded as a "You" offer
  const handPriced = promoted({
    offers: [...promoted().offers, { supplier: 'You', price: 99, at: '2026-09-03', by: 'robert' }],
  });
  assert.equal(Sync.isUnquotedPromotion(handPriced), false);
});

test('a book row that was never promoted is never held back', () => {
  assert.equal(Sync.isUnquotedPromotion(null), false);
  assert.equal(Sync.isUnquotedPromotion({ name: '1/2" EMT strap', labor: 0.02, edited: true }), false);
  assert.equal(Sync.isUnquotedPromotion(promoted({ userAdded: false })), false);
});

// --- Lid-close flush (X15) --------------------------------------------

const CREDS = {
  baseUrl: 'https://example.supabase.co',
  apiKey: 'sb_publishable_test',
  accessToken: 'jwt-abc',
  userId: 'u1',
  rpcAvailable: true,
};

test('a pending book row goes up as the same upsert the normal path sends', () => {
  const { requests, deferred } = Sync.buildKeepalivePushes({
    ...CREDS,
    values: { book: { v: 1, savedAt: T1, laborBook: {} } },
  });
  assert.equal(deferred.length, 0);
  assert.equal(requests.length, 1);
  const r = requests[0];
  assert.equal(r.url, 'https://example.supabase.co/rest/v1/takeoff_store');
  assert.equal(r.options.method, 'POST');
  assert.equal(r.options.keepalive, true);
  assert.equal(r.options.headers.apikey, 'sb_publishable_test');
  assert.equal(r.options.headers.Authorization, 'Bearer jwt-abc');
  assert.match(r.options.headers.Prefer, /resolution=merge-duplicates/);
  const body = JSON.parse(r.options.body);
  assert.deepEqual(body, [{ user_id: 'u1', key: 'book', value: { v: 1, savedAt: T1, laborBook: {} } }]);
});

test('a pending project goes through the same overwrite guard', () => {
  const { requests } = Sync.buildKeepalivePushes({
    ...CREDS,
    projects: [{ project: project(T2, bidB), expectedUpdatedAt: T1 }],
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://example.supabase.co/rest/v1/rpc/takeoff_upsert_project');
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.p_id, 'p1');
  assert.equal(body.p_name, 'Lakeside');
  assert.equal(body.p_updated_at, T2);
  assert.equal(body.p_expected_updated_at, T1, 'the guard travels with it');
  assert.deepEqual(body.p_data, { manifest: bidB, laborRate: 0 });
});

test('without the upsert guard a project is deferred, never blind-written', () => {
  const { requests, deferred } = Sync.buildKeepalivePushes({
    ...CREDS,
    rpcAvailable: false,
    values: { assemblies: [] },
    projects: [{ project: project(T2, bidB), expectedUpdatedAt: T1 }],
  });
  assert.deepEqual(requests.map((r) => r.what.kind), ['store']);
  assert.deepEqual(deferred, [{ kind: 'project', id: 'p1', updatedAt: T2 }]);
});

test('signed out — or mid-refresh, with no token — nothing is sent', () => {
  const { requests, deferred } = Sync.buildKeepalivePushes({
    ...CREDS,
    accessToken: null,
    values: { book: {} },
    projects: [{ project: project(T1, bidA) }],
  });
  assert.equal(requests.length, 0);
  assert.deepEqual(deferred, [{ kind: 'store', key: 'book' }, { kind: 'project', id: 'p1' }]);
});

test('a bid too big for the keepalive budget is left to the normal path', () => {
  const big = { v: 1, savedAt: T1, laborBook: { note: 'x'.repeat(5000) } };
  const { requests, deferred } = Sync.buildKeepalivePushes({
    ...CREDS,
    values: { book: big, assemblies: [{ id: 'a1' }] },
    maxBytes: 1000,
  });
  assert.deepEqual(requests.map((r) => r.what.key), ['assemblies']);
  assert.deepEqual(deferred, [{ kind: 'store', key: 'book' }]);
});

test('the budget is shared across the requests, not per request', () => {
  const row = { v: 1, pad: 'x'.repeat(300) };
  const { requests, deferred } = Sync.buildKeepalivePushes({
    ...CREDS,
    values: { book: row, assemblies: row, deleted: row },
    maxBytes: 800,
  });
  assert.equal(requests.length, 2);
  assert.equal(deferred.length, 1);
});

test('nothing pending, nothing to send', () => {
  assert.deepEqual(Sync.buildKeepalivePushes({ ...CREDS }), { requests: [], deferred: [] });
  assert.deepEqual(Sync.buildKeepalivePushes(), { requests: [], deferred: [] });
});
