'use strict';
/**
 * Unit tests for js/import.js — the pure half of the Count Tooling import:
 * type inference, the count parser, the clipboard parser and the summary the
 * primary button's label is built from.
 * Run: npm run test:unit
 */
const test = require('node:test');
const assert = require('node:assert');
const imp = require('./js/import.js');
const utils = require('./js/utils.js');

const byDesc = (rows) => new Map(rows.map((r) => [utils.descKey(r.description), r]));

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
  assert.strictEqual(imp.inferType('Dimmer - D1'), 'devices');
  assert.strictEqual(imp.inferType('ft of Conduit 3/4 EMT'), 'conduit');
  assert.strictEqual(imp.inferType('px of Conduit 3/4 EMT'), 'conduit');
  assert.strictEqual(imp.inferType('Fixture Whip'), 'conduit');
  assert.strictEqual(imp.inferType('ft of Wire #12 THHN'), 'wire');
  assert.strictEqual(imp.inferType('Fire Alarm Rough-in'), 'specialSystems');
  assert.strictEqual(imp.inferType('Fire Alarm Panel'), 'specialSystems');
  assert.strictEqual(imp.inferType('Nurse Call Station'), 'specialSystems');
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

test('parseCountToolingClipboard: rows, counts and pages', () => {
  const items = imp.parseCountToolingClipboard(
    '2x4 LED Troffer - A1\t24\tE2.1\nft of Wire #10 THHN\t1,800\tE5.1\nEXIT Sign - X1\t6\tE2.2'
  );
  assert.strictEqual(items.length, 3);
  assert.deepStrictEqual(
    items.map((i) => [i.description, i.quantity, i.planPage, i.type]),
    [
      ['2x4 LED Troffer - A1', 24, 'E2.1', 'lighting'],
      ['ft of Wire #10 THHN', 1800, 'E5.1', 'wire'],
      ['EXIT Sign - X1', 6, 'E2.2', 'lighting'],
    ]
  );
});

test('parseCountToolingClipboard: the signed-in "View link:" footer is not a fixture', () => {
  const items = imp.parseCountToolingClipboard(
    'Duplex Receptacle\t44\tE3.1\nView link:\thttps://counttooling.com/app/?t=8f3c9d'
  );
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].description, 'Duplex Receptacle');
  // a real fixture that happens to start with those words is kept
  const kept = imp.parseCountToolingClipboard('View link: Panel\t3\tE1');
  assert.strictEqual(kept.length, 1);
});

test('summarizeImport / primaryLabel: the button carries the receipt', () => {
  const manifest = byDesc([
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
  const manifest = byDesc([{ description: 'Wall Pack', quantity: 10 }]);
  const s = imp.summarizeImport([{ description: 'Wall Pack', quantity: null }], manifest);
  assert.deepStrictEqual([s.updates, s.adds, s.unreadable], [0, 0, 1]);
  assert.strictEqual(imp.primaryLabel(s), 'Nothing to change');
});

test('the match key is the purchase list\'s key: internal whitespace collapses', () => {
  const manifest = byDesc([{ description: 'LED Wall Pack - WP1', quantity: 10 }]);
  const s = imp.summarizeImport([{ description: 'LED  Wall Pack - WP1', quantity: 12 }], manifest);
  assert.deepStrictEqual([s.updates, s.adds], [1, 0]); // matched, not a duplicate
});
