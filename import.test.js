'use strict';
/**
 * Unit tests for js/import.js — the pure half of the CountTooling import:
 * the clipboard parser (run against the checked-in CountTooling export
 * fixtures under import-files/), the structured-payload normalizer, type
 * inference, the count parser and the summary the primary button's label is
 * built from. The fixtures also live in the CountTooling repo, where a spec
 * asserts its exporter still produces them — so neither side drifts silently.
 * Run: npm run test:unit
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// import.js reads TakeoffState.ITEM_TYPES at call time for payload type validation.
global.TakeoffState = { ITEM_TYPES: ['lighting', 'gear', 'devices', 'conduit', 'wire', 'specialSystems', 'permits', 'powerCoCharges', 'temporaryPower'] };
const imp = require('./js/import.js');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'import-files', 'counttooling-export.fixture.txt'), 'utf8');

const byKey = (rows) => new Map(rows.map((r) => [imp.itemKey(r.description, r.unit), r]));

// --- the clipboard parser, against CountTooling's own export ---

test('fixture: every CountTooling convention survives the parse', () => {
  const { items, plansUrl, skipped, unreadable } = imp.parseCountToolingClipboard(FIXTURE);
  assert.strictEqual(skipped, 0);
  assert.strictEqual(unreadable, 0);
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

// The fixture CountTooling's own spec generates and asserts (takeoff-handoff.spec.js
// there writes takeoff-handoff.fixture.txt; this is that file). If CountTooling's
// exporter changes shape, this test and that spec fail together.
test('real CountTooling export (shared fixture) parses with the same shape CountTooling asserts', () => {
  const real = fs.readFileSync(path.join(__dirname, 'import-files', 'counttooling-export.real.fixture.txt'), 'utf8');
  const { items, skipped } = imp.parseCountToolingClipboard(real);
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

test('parser: PipeTooling-style four-column rows and comma-free names', () => {
  const { items } = imp.parseCountToolingClipboard('WC\t12\tRestroom A\t1, 2\n');
  assert.strictEqual(items[0].group, 'Restroom A');
  assert.strictEqual(items[0].planPage, '1, 2');
});

test('parser: skips lines that cannot be rows, keeps an unreadable count as "?", never throws on junk', () => {
  const { items, skipped, unreadable } = imp.parseCountToolingClipboard('just words\n\n\t3\nOK\tabc\nReal\t2\n');
  // 'just words' has one cell and '\t3' has no name: neither can be a row.
  // 'OK\tabc' IS a row whose count could not be read — it stays in the preview
  // as '× ?' rather than vanishing (and never lands as 0 or 1 silently).
  assert.strictEqual(skipped, 2);
  assert.strictEqual(unreadable, 1);
  assert.deepStrictEqual(items.map((i) => [i.description, i.quantity]), [['OK', null], ['Real', 2]]);
});

test('parser: rows, counts and pages (thousands separators read; "ft of" becomes the unit)', () => {
  const { items } = imp.parseCountToolingClipboard(
    '2x4 LED Troffer - A1\t24\tE2.1\nft of Wire #10 THHN\t1,800\tE5.1\nEXIT Sign - X1\t6\tE2.2'
  );
  assert.strictEqual(items.length, 3);
  assert.deepStrictEqual(
    items.map((i) => [i.description, i.quantity, i.unit, i.planPage, i.type]),
    [
      ['2x4 LED Troffer - A1', 24, 'ea', 'E2.1', 'lighting'],
      ['Wire #10 THHN', 1800, 'ft', 'E5.1', 'wire'],
      ['EXIT Sign - X1', 6, 'ea', 'E2.2', 'lighting'],
    ]
  );
});

test('parser: the signed-in "View link:" footer is not a fixture, and its URL is the plans link', () => {
  const { items, plansUrl } = imp.parseCountToolingClipboard(
    'Duplex Receptacle\t44\tE3.1\nView link:\thttps://counttooling.com/app/?t=8f3c9d'
  );
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].description, 'Duplex Receptacle');
  assert.strictEqual(plansUrl, 'https://counttooling.com/app/?t=8f3c9d');
  // a real fixture that happens to start with those words is kept
  const kept = imp.parseCountToolingClipboard('View link: Panel\t3\tE1');
  assert.strictEqual(kept.items.length, 1);
  assert.strictEqual(kept.plansUrl, null);
});

// --- type inference ---

test('inferType: lengths default to conduit, wire-ish names to wire', () => {
  assert.strictEqual(imp.inferType('3/4" EMT', 'ft'), 'conduit');
  assert.strictEqual(imp.inferType('#12 THHN', 'ft'), 'wire');
  assert.strictEqual(imp.inferType('Cat6', 'ft'), 'wire');
  assert.strictEqual(imp.inferType('Feeder', 'px'), 'conduit');
  assert.strictEqual(imp.inferType('Something odd', 'ea'), null);
});

test('inferType: the trade\'s own lighting names', () => {
  for (const d of [
    '2x4 LED Troffer - A1',
    '6" LED Downlight - D3',
    'EXIT Sign - X1',
    'Emergency Light - EM2',
    'Wall Sconce - S2',
    'LED High Bay 150W',
    'High-Bay - HB1',
    'LED Wall Pack - WP1',
    '2x2 LED Flat Panel - F1',
    'Pendant - P4',
    '[Lighting] 2x4 LED Troffer - A1',
    'Vapor Tight 4ft',
    'Linear Light 8ft',
    'Type A',
    'Type F2',
  ]) {
    assert.strictEqual(imp.inferType(d), 'lighting', d);
  }
});

test('inferType: gear compounds beat the device word inside them', () => {
  assert.strictEqual(imp.inferType('Switchgear MSB'), 'gear');
  assert.strictEqual(imp.inferType('Transfer Switch ATS-1'), 'gear');
  assert.strictEqual(imp.inferType('Disconnect Switch 60A'), 'gear');
  assert.strictEqual(imp.inferType('Switchboard SWBD-1'), 'gear');
  assert.strictEqual(imp.inferType('Lighting Contactor LC-1'), 'gear');
  // and the plain ones still land where they did
  assert.strictEqual(imp.inferType('Panel LP-2'), 'gear');
  assert.strictEqual(imp.inferType('75 kVA Transformer'), 'gear');
});

test('inferType: lighting is tested before generic gear', () => {
  // 'panel' used to send every flat panel to Gear
  assert.strictEqual(imp.inferType('2x2 LED Flat Panel - F1'), 'lighting');
  assert.strictEqual(imp.inferType('LED Panel 2x4'), 'lighting');
});

test('inferType: devices, conduit, wire, special systems', () => {
  assert.strictEqual(imp.inferType('Duplex Receptacle'), 'devices');
  assert.strictEqual(imp.inferType('GFCI Receptacle - R2'), 'devices');
  assert.strictEqual(imp.inferType('Occupancy Sensor - OS1'), 'devices');
  assert.strictEqual(imp.inferType('Single Pole Switch'), 'devices');
  assert.strictEqual(imp.inferType('Switch S3'), 'devices');
  assert.strictEqual(imp.inferType('Dimmer - D1'), 'devices');
  assert.strictEqual(imp.inferType('ft of Conduit 3/4 EMT'), 'conduit');
  assert.strictEqual(imp.inferType('px of Conduit 3/4 EMT'), 'conduit');
  assert.strictEqual(imp.inferType('Fixture Whip'), 'conduit');
  assert.strictEqual(imp.inferType('ft of Wire #12 THHN'), 'wire');
  assert.strictEqual(imp.inferType('Fire Alarm Rough-in'), 'specialSystems');
  assert.strictEqual(imp.inferType('Fire Alarm Panel'), 'specialSystems');
  assert.strictEqual(imp.inferType('Nurse Call Station'), 'specialSystems');
  assert.strictEqual(imp.inferType('Data Drop'), 'specialSystems');
  assert.strictEqual(imp.inferType('FA Horn/Strobe'), 'specialSystems');
});

test('inferType: no false positives on the words the trade reuses', () => {
  for (const d of ['Beam clamp', 'Conduit clamp — no wait', 'Strip heater', 'Jack chain', 'Voltmeter', 'Unistrut 10ft']) {
    const t = imp.inferType(d);
    assert.ok(t !== 'lighting' && t !== 'devices', `${d} → ${t}`);
  }
  assert.strictEqual(imp.inferType('Strip heater'), null);
  assert.strictEqual(imp.inferType('Jack chain'), null);
  assert.strictEqual(imp.inferType('Voltmeter'), null);
  assert.strictEqual(imp.inferType(''), null);
  assert.strictEqual(imp.inferType(null), null);
});

// --- the count parser ---

test('parseCount: thousands separators, currency, units', () => {
  assert.strictEqual(imp.parseCount('1,800'), 1800);
  assert.strictEqual(imp.parseCount('"2,400"'), 2400);
  assert.strictEqual(imp.parseCount('$21,450.75'), 21450.75);
  assert.strictEqual(imp.parseCount('74.8'), 74.8);
  assert.strictEqual(imp.parseCount(74.8), 74.8);
  assert.strictEqual(imp.parseCount(' 220 ft '), 220);
  assert.strictEqual(imp.parseCount('44'), 44);
});

test('parseCount: an unreadable cell is null, never 0 or 1', () => {
  assert.strictEqual(imp.parseCount('https://counttooling.com/app/?t=8f3c'), null);
  assert.strictEqual(imp.parseCount('twelve'), null);
  assert.strictEqual(imp.parseCount('12-14'), null);
  assert.strictEqual(imp.parseCount(''), null);
  assert.strictEqual(imp.parseCount(null), null);
  assert.strictEqual(imp.parseCount(undefined), null);
  assert.strictEqual(imp.parseCount(NaN), null);
});

// --- the structured payload (#import=) ---

test('payload v2: explicit unit/type/group/children win; invalid type falls back', () => {
  const parsed = imp.parsePayload({
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
  const parsed = imp.parsePayload({ v: 1, source: 'counttooling', items: [{ description: 'Duplex Receptacle', count: 12, page: '2' }] });
  assert.strictEqual(parsed.items.length, 1);
  assert.strictEqual(parsed.items[0].quantity, 12);
  assert.strictEqual(parsed.items[0].planPage, '2');
  assert.strictEqual(parsed.items[0].unit, 'ea');
});

test('payload: rejects foreign shapes', () => {
  assert.strictEqual(imp.parsePayload({ v: 3, items: [] }), null);
  assert.strictEqual(imp.parsePayload(null), null);
  assert.strictEqual(imp.parsePayload({ v: 2, items: 'nope' }), null);
});

test('importFromPayload says which versions it reads instead of reporting an empty link', () => {
  const v3 = imp.importFromPayload({ v: 3, items: [{ description: 'Duplex Receptacle', count: 12 }] });
  assert.strictEqual(v3.count, 0);
  assert.match(v3.message, /version 3/);
  assert.match(v3.message, /version 1 and 2/);
  assert.doesNotMatch(v3.message, /no valid items/);
  const none = imp.importFromPayload({ v: 2, items: 'nope' });
  assert.strictEqual(none.count, 0);
  assert.match(none.message, /did not carry any counts/);
  const empty = imp.importFromPayload({ v: 2, items: [{ description: '   ' }] });
  assert.strictEqual(empty.count, 0);
  assert.match(empty.message, /no valid items/);
});

// --- the receipt the primary button carries ---

test('summarizeImport / primaryLabel: the button carries the receipt', () => {
  const manifest = byKey([
    { description: '2x4 LED Troffer - A1', quantity: 24 },
    { description: 'LED Wall Pack - WP1', quantity: 10 },
  ]);

  // cold: nothing on the bid
  const cold = imp.summarizeImport(
    [{ description: 'A', quantity: 1 }, { description: 'B', quantity: 2 }, { description: 'C', quantity: 3 }],
    new Map()
  );
  assert.deepStrictEqual([cold.updates, cold.adds, cold.matched], [0, 3, 0]);
  assert.strictEqual(imp.primaryLabel(cold), 'Add 3 fixtures');

  // a re-count: one raised, one lowered, two new
  const recount = imp.summarizeImport(
    [
      { description: '2x4 LED Troffer - A1', quantity: 30 },
      { description: 'LED Wall Pack - WP1', quantity: 7 },
      { description: 'EXIT Sign - X1', quantity: 6 },
      { description: 'Duplex Receptacle', quantity: 44 },
    ],
    manifest
  );
  assert.deepStrictEqual([recount.updates, recount.adds, recount.matched], [2, 2, 2]);
  assert.strictEqual(imp.primaryLabel(recount), 'Update 2 counts · add 2 fixtures');

  // singulars
  const one = imp.summarizeImport(
    [{ description: '2x4 LED Troffer - A1', quantity: 30 }, { description: 'EXIT Sign - X1', quantity: 6 }],
    manifest
  );
  assert.strictEqual(imp.primaryLabel(one), 'Update 1 count · add 1 fixture');

  // the same link opened twice: nothing left to do, and the label says so
  const again = imp.summarizeImport(
    [{ description: '2X4 led troffer - a1 ', quantity: 24 }, { description: 'LED  Wall Pack - WP1', quantity: 10 }],
    manifest
  );
  assert.deepStrictEqual([again.updates, again.adds, again.matched], [0, 0, 2]);
  assert.strictEqual(imp.primaryLabel(again), 'Nothing to change');
});

test('summarizeImport: an unreadable count is not counted as an update', () => {
  const manifest = byKey([{ description: 'Wall Pack', quantity: 10 }]);
  const s = imp.summarizeImport([{ description: 'Wall Pack', quantity: null }], manifest);
  assert.deepStrictEqual([s.updates, s.adds, s.unreadable], [0, 0, 1]);
  assert.strictEqual(imp.primaryLabel(s), 'Nothing to change');
});

test('the match key is the purchase list\'s key plus the unit', () => {
  // internal whitespace collapses: matched, not a duplicate
  const manifest = byKey([{ description: 'LED Wall Pack - WP1', quantity: 10 }]);
  const s = imp.summarizeImport([{ description: 'LED  Wall Pack - WP1', quantity: 12 }], manifest);
  assert.deepStrictEqual([s.updates, s.adds], [1, 0]);
  // 100 ft of EMT and a count of the same name are two different rows
  const lengths = byKey([{ description: '1/2" EMT', quantity: 100, unit: 'ft' }]);
  const t = imp.summarizeImport([{ description: '1/2" EMT', quantity: 12, unit: 'ea' }], lengths);
  assert.deepStrictEqual([t.updates, t.adds], [0, 1]);
  assert.strictEqual(imp.itemKey('1/2" EMT', 'ft'), imp.itemKey(' 1/2"  emt ', 'ft'));
  assert.notStrictEqual(imp.itemKey('1/2" EMT', 'ft'), imp.itemKey('1/2" EMT', 'ea'));
});
