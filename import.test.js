'use strict';
/**
 * Unit tests for js/import.js — the CountTooling clipboard parser and the
 * structured-payload normalizer, run against the checked-in CountTooling
 * export fixture (import-files/counttooling-export.fixture.txt). The same
 * fixture lives in the CountTooling repo, where a spec asserts its exporter
 * still produces it — so neither side can drift silently.
 * Run: npm run test:unit
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// import.js reads TakeoffState.ITEM_TYPES at call time for payload type validation.
global.TakeoffState = { ITEM_TYPES: ['lighting', 'gear', 'devices', 'conduit', 'wire', 'specialSystems', 'permits', 'powerCoCharges', 'temporaryPower'] };
const TakeoffImport = require('./js/import.js');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'import-files', 'counttooling-export.fixture.txt'), 'utf8');

test('fixture: every CountTooling convention survives the parse', () => {
  const { items, plansUrl, skipped } = TakeoffImport.parseCountToolingClipboard(FIXTURE);
  assert.strictEqual(skipped, 0);
  assert.strictEqual(plansUrl, 'https://counttooling.com/app/?t=0f4c2a1e-6b7d-4e3a-9c21-8d5f6a7b9c0d');
  assert.strictEqual(items.length, 10, 'children nest under parents, footer is not a row');

  const byDesc = Object.fromEntries(items.map((i) => [i.description, i]));

  // [Group] prefix → group, off the description
  assert.strictEqual(byDesc['Duplex Receptacle'].group, 'LP-1 / 7');
  assert.strictEqual(byDesc['Duplex Receptacle'].unit, 'ea');
  assert.strictEqual(byDesc['Duplex Receptacle'].type, 'devices');
  assert.strictEqual(byDesc['Duplex Receptacle'].quantity, 6);
  assert.strictEqual(byDesc['Duplex Receptacle'].planPage, '1');

  // two-space indent → child of the row above
  assert.deepStrictEqual(byDesc['Duplex Receptacle'].children.map((c) => [c.description, c.quantity, c.unit]), [['4" Square Box', 6, 'ea']]);
  assert.deepStrictEqual(byDesc['1/2" EMT'].children.map((c) => c.description), ['Coupling', '1-Hole Strap']);

  // ft of → unit ft, conduit unless the name says cable/wire
  assert.strictEqual(byDesc['1/2" EMT'].unit, 'ft');
  assert.strictEqual(byDesc['1/2" EMT'].type, 'conduit');
  assert.strictEqual(byDesc['1/2" EMT'].quantity, 143);
  assert.strictEqual(byDesc['MC 12/2'].unit, 'ft');
  assert.strictEqual(byDesc['MC 12/2'].type, 'wire');
  assert.strictEqual(byDesc['MC 12/2'].planPage, '1, 3');

  // px of → unscaled, flagged
  assert.strictEqual(byDesc['Feeder to LP-2'].unit, 'px');
  assert.strictEqual(byDesc['Feeder to LP-2'].quantity, 1840);

  // type inference on counts
  assert.strictEqual(byDesc['Switch S3'].type, 'devices');
  assert.strictEqual(byDesc['Panel LP-1'].type, 'gear');
  assert.strictEqual(byDesc['Type A'].type, 'lighting');
  assert.strictEqual(byDesc['Exit Sign'].type, 'lighting');
  assert.strictEqual(byDesc['Data Drop'].type, 'specialSystems');
  assert.strictEqual(byDesc['Panel LP-1'].group, null);
});

test('parser: PipeTooling-style four-column rows and comma-free names', () => {
  const { items } = TakeoffImport.parseCountToolingClipboard('WC\t12\tRestroom A\t1, 2\n');
  assert.strictEqual(items[0].group, 'Restroom A');
  assert.strictEqual(items[0].planPage, '1, 2');
});

test('parser: skips lines without a quantity and never throws on junk', () => {
  const { items, skipped } = TakeoffImport.parseCountToolingClipboard('just words\n\n\t3\nOK\tabc\nReal\t2\n');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(skipped, 3);
});

test('inferType: lengths default to conduit, wire-ish names to wire', () => {
  assert.strictEqual(TakeoffImport.inferType('3/4" EMT', 'ft'), 'conduit');
  assert.strictEqual(TakeoffImport.inferType('#12 THHN', 'ft'), 'wire');
  assert.strictEqual(TakeoffImport.inferType('Cat6', 'ft'), 'wire');
  assert.strictEqual(TakeoffImport.inferType('Feeder', 'px'), 'conduit');
  assert.strictEqual(TakeoffImport.inferType('Something odd', 'ea'), null);
});

test('payload v2: explicit unit/type/group/children win; invalid type falls back', () => {
  const parsed = TakeoffImport.parsePayload({
    v: 2,
    source: 'counttooling',
    project: { name: 'Maple St TI', plansUrl: 'https://counttooling.com/app/?t=0f4c2a1e-6b7d-4e3a-9c21-8d5f6a7b9c0d' },
    items: [
      { description: 'Duplex Receptacle · 20A GFCI', quantity: 6, unit: 'ea', type: 'devices', pages: '1', group: 'LP-1 / 7', meta: { mountHeightIn: 44 }, children: [{ description: 'Connector', quantity: 12, unit: 'ea' }] },
      { description: '1/2" EMT', quantity: 143, unit: 'ft', type: 'nonsense', pages: '1' },
      { description: 'ft of MC 12/2', count: 2100, page: '1, 3' },
    ],
  });
  assert.strictEqual(parsed.project.name, 'Maple St TI');
  assert.match(parsed.project.plansUrl, /t=0f4c2a1e/);
  const [a, b, c] = parsed.items;
  assert.strictEqual(a.type, 'devices');
  assert.strictEqual(a.group, 'LP-1 / 7');
  assert.deepStrictEqual(a.meta, { mountHeightIn: 44 });
  assert.strictEqual(a.children.length, 1);
  assert.strictEqual(b.type, 'conduit', 'invalid type → inference from unit');
  assert.strictEqual(b.unit, 'ft');
  assert.strictEqual(c.unit, 'ft', 'name convention still read when unit is absent');
  assert.strictEqual(c.description, 'MC 12/2');
  assert.strictEqual(c.type, 'wire');
});

test('payload v1 still imports', () => {
  const parsed = TakeoffImport.parsePayload({ v: 1, source: 'counttooling', items: [{ description: 'Duplex Receptacle', count: 12, page: '2' }] });
  assert.strictEqual(parsed.items.length, 1);
  assert.strictEqual(parsed.items[0].quantity, 12);
  assert.strictEqual(parsed.items[0].planPage, '2');
  assert.strictEqual(parsed.items[0].unit, 'ea');
});

test('payload: rejects foreign shapes', () => {
  assert.strictEqual(TakeoffImport.parsePayload({ v: 3, items: [] }), null);
  assert.strictEqual(TakeoffImport.parsePayload(null), null);
  assert.strictEqual(TakeoffImport.parsePayload({ v: 2, items: 'nope' }), null);
});

// The fixture CountTooling's own spec generates and asserts (takeoff-handoff.spec.js
// there writes takeoff-handoff.fixture.txt; this is that file). If CountTooling's
// exporter changes shape, this test and that spec fail together.
test('real CountTooling export (shared fixture) parses with the same shape CountTooling asserts', () => {
  const real = fs.readFileSync(path.join(__dirname, 'import-files', 'counttooling-export.real.fixture.txt'), 'utf8');
  const { items, skipped } = TakeoffImport.parseCountToolingClipboard(real);
  assert.strictEqual(skipped, 0);
  assert.deepStrictEqual(items.map((i) => [i.description, i.quantity, i.unit, i.group, i.planPage, i.children.map((c) => [c.description, c.quantity])]), [
    ['Duplex Receptacle', 2, 'ea', 'LP-1 / 7', '1', [['4" Square Box', 2]]],
    ['1/2" EMT', 10, 'ft', 'LP-1 / 7', '1', [['Coupling', 1]]],
    ['Panel LP-1', 1, 'ea', null, '1', []],
    ['Feeder', 100, 'px', null, '2', []],
  ]);
  assert.strictEqual(items[0].type, 'devices');
  assert.strictEqual(items[1].type, 'conduit');
  assert.strictEqual(items[2].type, 'gear');
});
