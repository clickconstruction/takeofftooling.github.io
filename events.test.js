'use strict';
/**
 * Unit tests for js/events.js — the PII guard, the row builder, the opt-out
 * rules, the missing-table detector, and import_added's counts. Everything
 * here is pure: the queue/flush transport is exercised by events.spec.js.
 * Run: npm run test:unit
 */
const test = require('node:test');
const assert = require('node:assert');
const events = require('./js/events.js');

test('sanitizeProps keeps counts, booleans and short enums', () => {
  const out = events.sanitizeProps({ rows: 12, hasRate: true, kind: 'conduit', variant: 'purchase-list' });
  assert.deepStrictEqual(out, { rows: 12, hasRate: true, kind: 'conduit', variant: 'purchase-list' });
});

test('sanitizeProps drops anything an estimator typed', () => {
  const out = events.sanitizeProps({
    description: '3/4" EMT',          // deny-listed key
    kind: '3/4" EMT coupling',        // allowed key, but spaces + quote
    note: 'Panel A feeder',
    email: 'someone@example.com',
    price: 12.5,                      // a specific row's price
    total: 9800,
    client: 'Acme Electric',
    rows: 3,                          // the count survives
  });
  assert.deepStrictEqual(out, { rows: 3 });
});

test('sanitizeProps drops non-scalars, NaN and unknown key shapes', () => {
  const out = events.sanitizeProps({
    rows: NaN,
    items: [1, 2, 3],
    meta: { a: 1 },
    Bad_Key: 1,           // must start lowercase
    ok: 1.239,            // numbers round to 2 dp
    missing: null,
  });
  assert.deepStrictEqual(out, { ok: 1.24 });
});

test('sanitizeProps caps the number of keys and survives junk input', () => {
  const wide = {};
  for (let i = 0; i < 40; i++) wide['k' + i] = i;
  assert.strictEqual(Object.keys(events.sanitizeProps(wide)).length, 12);
  assert.deepStrictEqual(events.sanitizeProps(null), {});
  assert.deepStrictEqual(events.sanitizeProps('flow_saved'), {});
  assert.deepStrictEqual(events.sanitizeProps([1, 2]), {});
});

test('isEventName accepts the snake_case vocabulary only', () => {
  for (const name of ['session_start', 'flow_saved', 'book_add_to_target', 'undo']) {
    assert.strictEqual(events.isEventName(name), true, name);
  }
  for (const bad of ['Flow Saved', 'flow-saved', '', null, 42, 'a', 'x'.repeat(50)]) {
    assert.strictEqual(events.isEventName(bad), false, String(bad));
  }
});

test('buildRow carries the install id, the viewport and no user when signed out', () => {
  const row = events.buildRow(
    { name: 'session_start', props: { rows: 2 }, vw: 1440, coarsePointer: false },
    { installId: 'abc-123', userId: null, appVersion: null }
  );
  assert.deepStrictEqual(row, {
    install_id: 'abc-123',
    user_id: null,
    name: 'session_start',
    props: { rows: 2 },
    vw: 1440,
    coarse_pointer: false,
  });
});

test('buildRow carries the user id only when one is supplied, plus the build stamp', () => {
  const row = events.buildRow(
    { name: 'undo', props: { frames: 3 }, vw: 820, coarsePointer: true },
    { installId: 'i-1', userId: 'user-uuid', appVersion: '2026-09-07' }
  );
  assert.strictEqual(row.user_id, 'user-uuid');
  assert.strictEqual(row.coarse_pointer, true);
  assert.deepStrictEqual(row.props, { frames: 3, appVersion: '2026-09-07' });
});

test('telemetryAllowed: the opt-out key, Do-Not-Track and GPC each say no', () => {
  assert.strictEqual(events.telemetryAllowed({}), true);
  assert.strictEqual(events.telemetryAllowed({ optOut: true }), false);
  assert.strictEqual(events.telemetryAllowed({ dnt: true }), false);
  assert.strictEqual(events.telemetryAllowed({ gpc: true }), false);
});

test('isMissingTable recognizes an unapplied migration', () => {
  assert.strictEqual(events.isMissingTable(404, ''), true);
  assert.strictEqual(events.isMissingTable(400, '{"code":"42P01"}'), true);
  assert.strictEqual(events.isMissingTable(404, 'Not Found'), true);
  assert.strictEqual(events.isMissingTable(500, 'server exploded'), false);
  assert.strictEqual(events.isMissingTable(201, ''), false);
});

test('importProps counts raises, lowers, adds and untyped lines (merge mode)', () => {
  const manifest = new Map([
    ['2x4 troffer', { quantity: 10 }],
    ['recessed can', { quantity: 40 }],
    ['exit sign', { quantity: 5 }],
  ]);
  const items = [
    { description: '2x4 troffer', quantity: 14, type: 'lighting' },   // raised
    { description: 'recessed can', quantity: 32, type: 'lighting' },  // lowered
    { description: 'exit sign', quantity: 5, type: 'lighting' },      // unchanged
    { description: 'wall pack', quantity: 3, type: null },            // added + untyped
  ];
  const props = events.importProps(items, false, (it) => manifest.get(it.description));
  assert.deepStrictEqual(props, { mode: 'merge', raised: 1, added: 1, lowered: 1, untyped: 1 });
});

test('importProps in separate-rows mode counts every line as an add', () => {
  const items = [
    { description: '2x4 troffer', quantity: 14, type: 'lighting' },
    { description: '2x4 troffer', quantity: 6, type: 'lighting' },
  ];
  const props = events.importProps(items, true, () => ({ quantity: 10 }));
  assert.deepStrictEqual(props, { mode: 'separate', raised: 0, added: 2, lowered: 0, untyped: 0 });
});

test('importProps survives an unreadable count and junk input', () => {
  const props = events.importProps([{ description: 'x', quantity: null, type: 'lighting' }], false, () => ({ quantity: 4 }));
  assert.deepStrictEqual(props, { mode: 'merge', raised: 0, added: 0, lowered: 0, untyped: 0 });
  assert.deepStrictEqual(events.importProps(null, false), { mode: 'merge', raised: 0, added: 0, lowered: 0, untyped: 0 });
});

test('the whole import_added payload survives the PII guard', () => {
  const props = events.importProps(
    [{ description: '3/4" EMT', quantity: 3, type: null }],
    false,
    () => null
  );
  assert.deepStrictEqual(events.sanitizeProps(props), { mode: 'merge', raised: 0, added: 1, lowered: 0, untyped: 1 });
});

test('log and flush never throw outside a browser', () => {
  assert.doesNotThrow(() => events.log('session_start', { rows: 1 }));
  assert.doesNotThrow(() => events.log(null, null));
  assert.doesNotThrow(() => events.flush());
});
