'use strict';
// Unit tests for js/laborBookMerge.js (node:test; *.test.js = units, *.spec.js = Playwright).
const test = require('node:test');
const assert = require('node:assert/strict');
const Merge = require('./js/laborBookMerge.js');

function defaults() {
  return {
    wire: {
      'THHN CU': [
        { name: '14', labor: 0.003, price: '95.00' },
        { name: '12', labor: 0.004, price: '215.00' },
      ],
      Terminations: [{ name: '# 22-6', labor: 0.2, price: '' }],
    },
  };
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

test('bootstrap flags edited and user-added rows, records removed defaults', () => {
  const book = clone(defaults());
  book.wire['THHN CU'][0].price = '110.00'; // user changed a price
  book.wire['THHN CU'].splice(1, 1); // user deleted "12"
  book.wire['THHN CU'].push({ name: 'XHHW 10', labor: 0.005, price: '300.00' }); // user part
  book.wire['My Section'] = [{ name: 'Custom', labor: 1, price: '5.00' }]; // user section

  const removed = Merge.bootstrap(book, defaults());
  assert.equal(book.wire['THHN CU'][0].edited, true);
  assert.equal(book.wire['THHN CU'][1].userAdded, true);
  assert.equal(book.wire['My Section'][0].userAdded, true);
  assert.deepEqual(removed, { wire: { 'THHN CU': ['12'] } });
  // untouched row in another section gets no flags
  assert.equal(book.wire.Terminations[0].edited, undefined);
});

test('mergeDefaults upgrades untouched rows and keeps user changes', () => {
  const book = clone(defaults());
  const removed = Merge.bootstrap(book, defaults());
  book.wire['THHN CU'][0].price = '110.00';
  book.wire['THHN CU'][0].edited = true;

  const next = defaults();
  next.wire['THHN CU'][0].price = '99.00'; // upstream change to the edited row — user wins
  next.wire['THHN CU'][1].price = '230.00'; // upstream change to untouched row — applies
  next.wire['THHN CU'].push({ name: '10', labor: 0.006, price: '331.00' }); // new default row
  next.gear = { Panels: [{ name: '100A', labor: 2, price: '400.00' }] }; // new tab

  const changed = Merge.mergeDefaults(book, next, removed);
  assert.ok(changed >= 3);
  assert.equal(book.wire['THHN CU'][0].price, '110.00'); // edited kept
  assert.equal(book.wire['THHN CU'][1].price, '230.00'); // untouched upgraded
  assert.ok(book.wire['THHN CU'].some((r) => r.name === '10')); // new default added
  assert.equal(book.gear.Panels.length, 1); // new tab added
});

test('mergeDefaults does not resurrect removed defaults, drops upstream-deleted untouched rows', () => {
  const book = clone(defaults());
  book.wire['THHN CU'].splice(1, 1); // user deleted "12"
  const removed = Merge.bootstrap(book, defaults());

  const next = defaults(); // still contains "12"; also drop "# 22-6" upstream
  next.wire.Terminations = [];

  Merge.mergeDefaults(book, next, removed);
  assert.ok(!book.wire['THHN CU'].some((r) => r.name === '12')); // stays removed
  assert.equal(book.wire.Terminations.length, 0); // untouched row dropped with upstream
});

test('computeCorrections yields edit/new/remove and skips reverted edits', () => {
  const book = clone(defaults());
  const removed = Merge.bootstrap(book, defaults());
  book.wire['THHN CU'][0].price = '110.00';
  book.wire['THHN CU'][0].edited = true;
  book.wire['THHN CU'][1].edited = true; // flagged but values still match defaults → skipped
  book.wire.Terminations.push({ name: 'Polaris tap', labor: 0.4, price: '12.00', userAdded: true });
  removed.wire = { Terminations: ['# 22-6'] };
  book.wire.Terminations = book.wire.Terminations.filter((r) => r.name !== '# 22-6');

  const list = Merge.computeCorrections(book, defaults(), removed);
  const kinds = list.map((c) => `${c.kind}:${c.name}`).sort();
  assert.deepEqual(kinds, ['edit:14', 'new:Polaris tap', 'remove:# 22-6']);
  const edit = list.find((c) => c.kind === 'edit');
  assert.equal(edit.old.price, '95.00');
  assert.equal(edit.new.price, '110.00');
});

test('fresh book against same defaults produces no corrections', () => {
  const book = clone(defaults());
  const removed = Merge.bootstrap(book, defaults());
  assert.deepEqual(Merge.computeCorrections(book, defaults(), removed), []);
});
