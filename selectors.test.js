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

// Quantity 0 means none of it — no material, no hours, no purchase line.
// (This test previously pinned the opposite rule: a qty-0 row with labor or a
// price counted once, which made the summary, the purchase list and the PDF
// disagree on the same bid. The rule was dropped deliberately.)
test('getTotalLabor multiplies per-unit hours by qty; qty 0 contributes nothing', () => {
  const m = [
    item({ quantity: 3, labor: 2 }),           // 6
    item({ quantity: 0, labor: 1.5 }),         // 0
    item({ quantity: 2, labor: 1, children: [item({ parentId: 'x', quantity: 4, labor: 0.5 })] }), // 2 + 2
  ];
  assert.strictEqual(sel.getTotalLabor(m), 10);
});

test('getTotalLabor is the summary labor total, by construction', () => {
  const m = [
    item({ type: 'gear', quantity: 2, labor: 3 }),
    item({ type: 'permits', quantity: 1, labor: 3, price: 500 }),
  ];
  assert.strictEqual(sel.getTotalLabor(m), sel.getSummaryBreakdown(m).laborTotal);
  assert.strictEqual(sel.getTotalLabor(m), 9);
});

test('getPurchaseList merges identical descriptions and skips other-charge types', () => {
  const m = [
    item({ description: 'EMT 1/2"', quantity: 10, price: 0.5 }),
    item({ description: 'emt  1/2"', quantity: 5, price: 0.6 }), // case/whitespace-insensitive merge
    item({ description: 'Permit', quantity: 1, price: 500, type: 'permits' }), // skipped
    item({
      description: 'Fixture group', quantity: 1, price: null, // price-less parent w/ children = grouping, own line skipped
      children: [item({ parentId: 'x', description: 'Box', quantity: 2, price: 3 })],
    }),
  ];
  const { lines, totalCost } = sel.getPurchaseList(m);
  assert.deepStrictEqual(lines.map((l) => l.description).sort(), ['Box', 'EMT 1/2"']);
  const emt = lines.find((l) => l.description === 'EMT 1/2"');
  assert.strictEqual(emt.quantity, 15);
  assert.strictEqual(emt.priceVaries, true);
  // a varying price reads as a range, not one of the two prices
  assert.strictEqual(emt.unitPriceLow, 0.5);
  assert.strictEqual(emt.unitPriceHigh, 0.6);
  assert.strictEqual(emt.extended, 8); // 10*0.5 + 5*0.6
  assert.strictEqual(totalCost, 14); // 8 + 6
});

test('getPurchaseList keeps a priced parent, and folds its overage into that line', () => {
  const m = [
    // conduit run with an overage child: the footage itself is material, and
    // the waste is bought as part of it — one orderable line, not two
    item({
      description: '3/4" EMT', type: 'conduit', quantity: 220, price: 0.68,
      children: [item({ parentId: 'x', type: 'overage', description: 'Conduit overage (10%)', quantity: 22, price: 0.68, meta: { overagePercent: 10 } })],
    }),
    // device run (no own price) stays a grouping
    item({
      description: 'Receptacle run', type: 'devices', quantity: 12, price: null,
      children: [item({ parentId: 'x', description: 'Duplex receptacle', quantity: 12, price: 3.85 })],
    }),
  ];
  const { lines, totalCost } = sel.getPurchaseList(m);
  assert.deepStrictEqual(
    lines.map((l) => l.description).sort(),
    ['3/4" EMT (incl. 10% overage)', 'Duplex receptacle']
  );
  const emt = lines.find((l) => l.description.startsWith('3/4" EMT'));
  assert.strictEqual(emt.quantity, 242); // 220 + 22
  assert.strictEqual(emt.extended, 164.56);
  assert.strictEqual(totalCost, 210.76); // 164.56 + 46.20 — unchanged
});

test('getPurchaseList folds two runs of one size without merging their overage descriptions', () => {
  const m = [
    item({
      id: 'a', description: '3/4" EMT', type: 'conduit', quantity: 150, price: 1.12,
      children: [item({ parentId: 'a', type: 'overage', description: 'Conduit overage (10%)', quantity: 15, price: 1.12, meta: { overagePercent: 10 } })],
    }),
    item({
      id: 'b', description: '3/4" EMT', type: 'conduit', quantity: 80, price: 1.12,
      children: [item({ parentId: 'b', type: 'overage', description: 'Conduit overage (10%)', quantity: 8, price: 1.12, meta: { overagePercent: 10 } })],
    }),
  ];
  const { lines } = sel.getPurchaseList(m);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].description, '3/4" EMT (incl. 10% overage)');
  assert.strictEqual(lines[0].quantity, 253); // 150 + 15 + 80 + 8
});

test('getPurchaseList folds an unpriced overage as unpriced quantity', () => {
  const m = [
    item({
      id: 'a', description: '#12 THHN', type: 'wire', quantity: 100, price: 0.2,
      children: [item({ parentId: 'a', type: 'overage', description: 'Wire overage (10%)', quantity: 10, price: null, meta: { overagePercent: 10 } })],
    }),
  ];
  const { lines, unpricedCount } = sel.getPurchaseList(m);
  assert.strictEqual(lines[0].quantity, 110);
  assert.strictEqual(lines[0].extended, 20); // the unpriced 10 add no cost
  assert.strictEqual(lines[0].unpriced, true);
  assert.strictEqual(unpricedCount, 1);
});

test('getPurchaseList skips a row at quantity 0 and so does the summary', () => {
  const m = [item({ type: 'gear', description: 'Panel LP-2', quantity: 0, price: 980, labor: 6.5 })];
  assert.deepStrictEqual(sel.getPurchaseList(m).lines, []);
  const s = sel.getSummaryBreakdown(m);
  assert.strictEqual(s.materials.gear, 0);
  assert.strictEqual(s.labor.gear, 0);
  assert.strictEqual(s.laborTotal, 0);
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

// T2-19: the tax rate is the project's, not the app's.
test('getSummaryBreakdown taxes at the rate it is given, and defaults to 8.5%', () => {
  const m = [item({ type: 'gear', quantity: 1, price: 1000 })];
  assert.strictEqual(sel.getSummaryBreakdown(m).salesTax, 85);        // no rate: the old constant
  assert.strictEqual(sel.getSummaryBreakdown(m).taxRate, 8.5);
  assert.strictEqual(sel.getSummaryBreakdown(m, 0).salesTax, 0);      // a job outside sales tax
  assert.strictEqual(sel.getSummaryBreakdown(m, 10.25).salesTax, 102.5);
  assert.strictEqual(sel.getSummaryBreakdown(m, 10.25).materialsTotal, 1102.5);
  // unreadable rates fall back rather than zeroing the tax silently
  assert.strictEqual(sel.getSummaryBreakdown(m, 'nonsense').salesTax, 85);
  assert.strictEqual(sel.getSummaryBreakdown(m, -3).salesTax, 0);
});

// T2-19: a trench is a sub-contract and a backhoe is hired — neither is stock.
test('trenching and rentals are other charges, untaxed and off the purchase list', () => {
  const m = [
    item({
      id: 'run', type: 'conduit', description: '2" PVC run', quantity: 220, price: 1,
      children: [
        item({ parentId: 'run', type: 'trenching', description: '220 - Trenching: Dirt @ 24 in', quantity: 220, price: 15, labor: 0.01 }),
        item({ parentId: 'run', type: 'trenchingAddon', description: 'BACKHOE', quantity: 4, price: 350, meta: { addonGroup: 'rental' } }),
        item({ parentId: 'run', type: 'trenchingAddon', description: 'TRENCHING SAND', quantity: 20, price: 12, meta: { addonGroup: 'fill' } }),
        // saved before the flow recorded the group: still material
        item({ parentId: 'run', type: 'trenchingAddon', description: 'ASPHALT PATCH', quantity: 10, price: 8 }),
      ],
    }),
  ];
  const s = sel.getSummaryBreakdown(m, 8.5);
  assert.strictEqual(s.materials.conduit, 220 + 240 + 80); // the run, the sand, the patch
  assert.strictEqual(s.otherCharges.siteWork, 3300 + 1400);
  assert.strictEqual(s.otherTotal, 4700);
  assert.strictEqual(s.salesTax, 45.9); // 8.5% of $540 of stock — not of $5,240
  // the trench's hours are still worked, and they belong to the run
  assert.strictEqual(s.labor.conduit, 2.2);

  const { lines } = sel.getPurchaseList(m);
  assert.deepStrictEqual(lines.map((l) => l.description).sort(), ['2" PVC run', 'ASPHALT PATCH', 'TRENCHING SAND']);
});

// B2: one rounding convention, so the two artifacts never differ by a cent.
test('the summary and the purchase list agree to the cent on 4-decimal prices', () => {
  const m = [
    item({ type: 'wire', description: '#12 THHN', quantity: 3, price: 0.1234 }),
    item({ type: 'wire', description: '#10 THHN', quantity: 7, price: 0.2051 }),
    item({ type: 'gear', description: 'Panel LP-2', quantity: 2, price: 980.125 }),
  ];
  assert.strictEqual(sel.getSummaryBreakdown(m).materialsSubtotal, sel.getPurchaseList(m).totalCost);
});

// B9: a minus sign is a typo, and it must not mean one thing to the summary
// and another to the list.
test('negative prices, hours and counts are read as zero by both readers', () => {
  const m = [
    item({ type: 'specialSystems', description: 'Card reader', quantity: 20, price: -28, labor: -0.4 }),
    item({ type: 'gear', description: 'Panel LP-1', quantity: -10, price: 3.8 }),
  ];
  const s = sel.getSummaryBreakdown(m);
  assert.strictEqual(s.materials.specialSystems, 0);
  assert.strictEqual(s.labor.specialSystems, 0);
  assert.strictEqual(s.materials.gear, 0);
  assert.strictEqual(s.laborTotal, 0);
  const { lines, totalCost } = sel.getPurchaseList(m);
  assert.strictEqual(totalCost, 0);
  assert.deepStrictEqual(lines.map((l) => l.extended), [0]); // the -10 row drops out; the other reads $0
});

// B9: $0 is a price. Blank is not, and blank is what gets flagged.
test('a $0 price is priced; a blank price is what counts as unpriced', () => {
  const m = [
    item({ type: 'gear', description: 'Owner-furnished panel', quantity: 1, price: 0 }),
    item({ type: 'gear', description: 'Disconnect', quantity: 1, price: null }),
  ];
  const { lines, unpricedCount } = sel.getPurchaseList(m);
  const free = lines.find((l) => l.description === 'Owner-furnished panel');
  assert.strictEqual(free.unitPrice, 0);
  assert.strictEqual(free.extended, 0);
  assert.strictEqual(free.unpriced, false);
  const blank = lines.find((l) => l.description === 'Disconnect');
  assert.strictEqual(blank.unitPrice, null);
  assert.strictEqual(blank.unpriced, true);
  assert.strictEqual(unpricedCount, 1);
});

test('getSummaryBreakdown counts labor typed on an other-charges row', () => {
  const m = [
    item({ type: 'gear', quantity: 1, price: 100, labor: 2 }),
    item({ type: 'permits', quantity: 1, price: 500, labor: 3 }),
  ];
  const s = sel.getSummaryBreakdown(m);
  assert.strictEqual(s.otherCharges.permits, 500);
  assert.strictEqual(s.labor.other, 3);   // hours are worked even though the money is an other charge
  assert.strictEqual(s.materials.gear, 100);
  assert.strictEqual(s.laborTotal, 5);
});

// X10: the summary can say where a type's hours came from.
test('getSummaryBreakdown splits each type\'s hours into run hours and part hours', () => {
  const m = [
    item({
      id: 'run', type: 'conduit', description: '3/4" EMT Homerun', quantity: 220, labor: 0.024,
      children: [
        item({ id: 'f1', parentId: 'run', type: 'fitting', description: 'EMT connector', quantity: 12, labor: 0.5 }),
      ],
    }),
    item({ id: 'ltg', type: 'lighting', description: '2x4 Troffer', quantity: 10, labor: 0.6 }),
  ];
  const s = sel.getSummaryBreakdown(m);

  // conduit: 220 × 0.024 on the run, 12 × 0.5 on its parts
  assert.strictEqual(Math.round(s.laborByOrigin.conduit.parent * 100) / 100, 5.28);
  assert.strictEqual(s.laborByOrigin.conduit.component, 6);
  // the split always adds back up to the bucket the screen already showed
  assert.strictEqual(
    Math.round((s.laborByOrigin.conduit.parent + s.laborByOrigin.conduit.component) * 100) / 100,
    Math.round(s.labor.conduit * 100) / 100
  );
  // a type with no components has no component half at all
  assert.strictEqual(s.laborByOrigin.lighting.parent, 6);
  assert.strictEqual(s.laborByOrigin.lighting.component, 0);
});

test('a component\'s hours are split under the parent\'s bucket, and a trench stays a component', () => {
  const m = [
    item({
      id: 'run', type: 'conduit', quantity: 100, labor: 0,
      children: [
        // a sub-contract: its dollars are an other charge, its hours are the run's
        item({ id: 't', parentId: 'run', type: 'trenching', quantity: 100, labor: 0.1, price: 15 }),
      ],
    }),
    item({ id: 'p', type: 'permits', quantity: 1, labor: 3, price: 500 }),
  ];
  const s = sel.getSummaryBreakdown(m);
  assert.strictEqual(s.laborByOrigin.conduit.parent, 0);
  assert.strictEqual(s.laborByOrigin.conduit.component, 10);
  // permit hours are typed on the row itself
  assert.strictEqual(s.laborByOrigin.other.parent, 3);
  assert.strictEqual(s.laborByOrigin.other.component, 0);
});
