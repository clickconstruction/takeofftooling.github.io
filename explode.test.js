'use strict';
/**
 * Unit tests for js/explode.js — the assembly kernel the flows and the agent door share.
 * Run: npm run test:unit
 */
const test = require('node:test');
const assert = require('node:assert');
const X = require('./js/explode.js');

const book = [
  { name: '4" Square Box, 1-1/2" deep', labor: 0.25, price: 3.9 },
  { name: '4" Square 1-Gang Mud Ring', labor: 0.1, price: 2.4 },
  { name: '1-Gang Duplex Plate', labor: 0.05, price: 0.9 },
  { name: '1-Gang Decora Plate', labor: 0.05, price: 1.1 },
  { name: '1/2" EMT SET-SCREW COUPLING STEEL', labor: 0.04, price: 0.42 },
  { name: '1/2" 1-HOLE STRAP STEEL', labor: 0.03, price: 0.18 },
];

test('a receptacle explodes into box, ring, plate and two connectors, priced from the book by name', () => {
  const kids = X.explodeItem({ id: 'a', type: 'devices', description: 'Duplex Receptacle', quantity: 6, unit: 'ea' }, { book });
  assert.deepStrictEqual(kids.map((k) => [k.description, k.quantity, k.type]), [
    ['4" Square Box, 1-1/2" deep', 6, 'box'],
    ['4" Square 1-Gang Mud Ring', 6, 'box'],
    ['1-Gang Duplex Plate', 6, 'cover'],
    ['1/2" EMT Set-Screw Connector', 12, 'misc'],
  ]);
  assert.strictEqual(kids[0].labor, 0.25);
  assert.strictEqual(kids[0].price, 3.9);
  assert.strictEqual(kids[3].labor, null, 'no book row → unpriced, never guessed');
  assert.strictEqual(kids[3].meta.needsPricing, true);
  assert.strictEqual(kids[0].meta.fromTemplate, 'receptacle');
});

test('GFCI wins over the plain receptacle template and takes a Decora plate', () => {
  const kids = X.explodeItem({ type: 'devices', description: '20A GFCI Receptacle', quantity: 2, unit: 'ea' }, { book });
  assert.ok(kids.some((k) => k.description === '1-Gang Decora Plate'));
  assert.strictEqual(X.findTemplate({ type: 'devices', description: '20A GFCI Receptacle' }).id, 'gfci-receptacle');
});

test('an EMT run explodes per 10 ft and per run, sized from its description; token lookup finds the coupling', () => {
  const kids = X.explodeItem({ type: 'conduit', description: '1/2" EMT', quantity: 143, unit: 'ft' }, { book });
  const by = Object.fromEntries(kids.map((k) => [k.description, k]));
  assert.strictEqual(by['1/2" EMT SET-SCREW COUPLING STEEL'].quantity, 15, 'ceil(143/10) couplings, matched by tokens');
  assert.strictEqual(by['1/2" 1-HOLE STRAP STEEL'].quantity, 15, 'token match, book spelling wins');
  assert.strictEqual(by['1/2" EMT Set-Screw Connector'].quantity, 2, 'two per run');
  assert.strictEqual(by['1/2" EMT Set-Screw Connector'].meta.needsPricing, true);
  assert.ok(kids.every((k) => k.type === 'fitting'));
});

test('sizes parse from the common spellings', () => {
  assert.strictEqual(X.sizeOf('3/4" EMT'), '3/4"');
  assert.strictEqual(X.sizeOf('1-1/4 in EMT'), '1-1/4"');
  assert.strictEqual(X.sizeOf('1" PVC Sch 40'), '1"');
  assert.strictEqual(X.sizeOf('MC 12/2'), '');
});

test('no template, zero quantity, or an unscaled run → no children', () => {
  assert.deepStrictEqual(X.explodeItem({ type: 'gear', description: 'Panel LP-1', quantity: 1, unit: 'ea' }, { book }), []);
  assert.deepStrictEqual(X.explodeItem({ type: 'devices', description: 'Duplex Receptacle', quantity: 0, unit: 'ea' }, { book }), []);
  assert.deepStrictEqual(X.explodeItem({ type: 'conduit', description: '1/2" EMT', quantity: 1840, unit: 'px' }, { book }), []);
  assert.deepStrictEqual(X.explodeItem({ type: 'conduit', description: 'EMT', quantity: 40, unit: 'ft' }, { book }).map((k) => k.description), [], 'unsized run → sized fittings skipped');
});

test('explodeManifest fills childless parents only and reports counts', () => {
  const manifest = [
    { id: 'a', type: 'devices', description: 'Duplex Receptacle', quantity: 2, unit: 'ea', children: [] },
    { id: 'b', type: 'devices', description: 'Switch S3', quantity: 1, unit: 'ea', children: [{ id: 'b1', parentId: 'b', description: 'hand-picked box', quantity: 1 }] },
    { id: 'c', type: 'gear', description: 'Panel LP-1', quantity: 1, unit: 'ea', children: [] },
  ];
  const r = X.explodeManifest(manifest, { book });
  assert.strictEqual(r.exploded, 1);
  assert.strictEqual(r.manifest[0].children.length, 4);
  assert.strictEqual(r.manifest[0].children[0].parentId, 'a');
  assert.deepStrictEqual(r.manifest[1].children.map((c) => c.description), ['hand-picked box'], 'existing children win');
  assert.strictEqual(r.manifest[2].children.length, 0);
  assert.strictEqual(manifest[0].children.length, 0, 'inputs untouched');
  assert.strictEqual(r.unpriced, 1);
});

test('flattenBook walks type → section → rows', () => {
  const flat = X.flattenBook({ devices: { Receptacles: [{ name: 'A', labor: 1, price: 2 }] }, wire: { X: [{ name: 'B' }] } });
  assert.deepStrictEqual(flat.map((r) => [r.name, r.type, r.section]), [['A', 'devices', 'Receptacles'], ['B', 'wire', 'X']]);
});
