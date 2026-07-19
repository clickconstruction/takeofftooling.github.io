'use strict';
/**
 * Unit tests for js/selectors.js — pure computed views over a manifest.
 * Run: npm run test:unit
 */
const test = require('node:test');
const assert = require('node:assert');
const sel = require('./js/selectors.js');

const item = (over) => ({
  id: 'x', type: null, description: 'item', quantity: 0, labor: 0,
  planPage: '', parentId: null, price: null, children: [], meta: null, ...over,
});

test('getTotalLabor multiplies per-unit hours by qty; qty-0 with labor counts once', () => {
  const m = [
    item({ quantity: 3, labor: 2 }),           // 6
    item({ quantity: 0, labor: 1.5 }),         // counts once: 1.5
    item({ quantity: 2, labor: 1, children: [item({ parentId: 'x', quantity: 4, labor: 0.5 })] }), // 2 + 2
  ];
  assert.strictEqual(sel.getTotalLabor(m), 11.5);
});

test('getTotalPrice sums price × qty including children', () => {
  const m = [item({ quantity: 2, price: 10, children: [item({ parentId: 'x', quantity: 3, price: 1 })] })];
  assert.strictEqual(sel.getTotalPrice(m), 23);
});

test('getPurchaseList merges identical descriptions and skips other-charge types', () => {
  const m = [
    item({ description: 'EMT 1/2"', quantity: 10, price: 0.5 }),
    item({ description: 'emt  1/2"', quantity: 5, price: 0.6 }), // case/whitespace-insensitive merge
    item({ description: 'Permit', quantity: 1, price: 500, type: 'permits' }), // skipped
    item({
      description: 'Fixture group', quantity: 1, price: 99, // parent w/ children = grouping, own line skipped
      children: [item({ parentId: 'x', description: 'Box', quantity: 2, price: 3 })],
    }),
  ];
  const { lines, totalCost } = sel.getPurchaseList(m);
  assert.deepStrictEqual(lines.map((l) => l.description).sort(), ['Box', 'EMT 1/2"']);
  const emt = lines.find((l) => l.description === 'EMT 1/2"');
  assert.strictEqual(emt.quantity, 15);
  assert.strictEqual(emt.priceVaries, true);
  assert.strictEqual(emt.extended, 8); // 10*0.5 + 5*0.6
  assert.strictEqual(totalCost, 14); // 8 + 6
});

test('getFlattenedItems adds _depth', () => {
  const m = [item({ children: [item({ parentId: 'x' })] })];
  const flat = sel.getFlattenedItems(m);
  assert.deepStrictEqual(flat.map((i) => i._depth), [0, 1]);
});

test('getSummaryBreakdown rolls children into the top-level parent type and taxes materials', () => {
  const m = [
    item({ type: 'devices', quantity: 2, price: 10, labor: 1, children: [
      item({ parentId: 'x', type: 'box', quantity: 4, price: 2.5, labor: 0.25 }), // box → devices bucket
    ] }),
    item({ type: 'permits', quantity: 1, price: 100 }),
  ];
  const s = sel.getSummaryBreakdown(m);
  assert.strictEqual(s.materials.devices, 30); // 20 + 10
  assert.strictEqual(s.labor.devices, 3);      // 2 + 1
  assert.strictEqual(s.materials.misc, 0);
  assert.strictEqual(s.otherCharges.permits, 100);
  assert.strictEqual(Math.round(s.salesTax * 1000) / 1000, 2.55); // 8.5% of 30
  assert.strictEqual(s.laborTotal, 3);
});
