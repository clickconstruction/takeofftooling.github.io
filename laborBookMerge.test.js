'use strict';
// Unit tests for js/laborBookMerge.js (node:test; *.test.js = units, *.spec.js = Playwright).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Merge = require('./js/laborBookMerge.js');
const Utils = require('./js/utils.js');

// js/data/laborBookDefaults.js is browser data (no module.exports) — evaluate
// it so the assertions below run against the real shipped book.
const realDefaults = (() => {
  const ctx = { console };
  vm.createContext(ctx);
  const src = fs.readFileSync(require.resolve('./js/data/laborBookDefaults.js'), 'utf8');
  // top-level `const` stays lexical in the vm context, so hand it out explicitly
  vm.runInContext(`${src}\n;globalThis.__out = { defaults: LABOR_BOOK_DEFAULTS, version: LABOR_BOOK_DEFAULTS_VERSION };`, ctx);
  const out = ctx.__out;
  assert.ok(out.defaults && out.defaults.conduit, 'labor book defaults did not evaluate');
  return out;
})();

// js/data/laborBookDefaults.js is a browser <script> global (no exports);
// evaluate it in a sandbox to read LABOR_BOOK_DEFAULTS here.
function loadShippedDefaults() {
  const file = path.join(__dirname, 'js', 'data', 'laborBookDefaults.js');
  const src = fs.readFileSync(file, 'utf8');
  // top-level const doesn't become a context property; evaluate to the value
  return vm.runInNewContext(`${src};LABOR_BOOK_DEFAULTS`, {});
}

// LABOR_BOOK_RETIRED: the old names/sections the merge must recognise.
const RETIRED = (() => {
  const src = fs.readFileSync(require.resolve('./js/data/laborBookDefaults.js'), 'utf8');
  return vm.runInNewContext(`${src};LABOR_BOOK_RETIRED`, {});
})();

// The defaults as they shipped at each earlier version (test-fixtures/
// labor-book-defaults/README.md). A book saved at any of them must converge
// on the current defaults.
function loadHistoricalDefaults(file) {
  const src = fs.readFileSync(path.join(__dirname, 'test-fixtures', 'labor-book-defaults', file), 'utf8');
  return vm.runInNewContext(`${src};({ defaults: LABOR_BOOK_DEFAULTS, version: LABOR_BOOK_DEFAULTS_VERSION })`, {});
}

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

test('bootstrap flags edited and user-added rows and records no removals', () => {
  const book = clone(defaults());
  book.wire['THHN CU'][0].price = '110.00'; // user changed a price
  book.wire['THHN CU'].splice(1, 1); // "12" is not in this book
  book.wire['THHN CU'].push({ name: 'XHHW 10', labor: 0.005, price: '300.00' }); // user part
  book.wire['My Section'] = [{ name: 'Custom', labor: 1, price: '5.00' }]; // user section

  const res = Merge.bootstrap(book, defaults());
  assert.equal(book.wire['THHN CU'][0].edited, true);
  assert.equal(book.wire['THHN CU'][1].userAdded, true);
  assert.equal(book.wire['My Section'][0].userAdded, true);
  // the missing default is reported as an inferred gap, never as a removal:
  // a pre-provenance book cannot record a delete (J12-NEW-2)
  assert.deepEqual(res.missing, [{ tab: 'wire', section: 'THHN CU', name: '12' }]);
  // untouched row in another section gets no flags
  assert.equal(book.wire.Terminations[0].edited, undefined);
});

test('a default missing from an older book is healed by the merge, not blacklisted', () => {
  const book = clone(defaults());
  book.wire['THHN CU'].splice(1, 1); // this book predates "12"
  const removed = {};
  Merge.bootstrap(book, defaults());
  const res = Merge.mergeDefaults(book, defaults(), removed, {});
  assert.ok(book.wire['THHN CU'].some((r) => r.name === '12'), '"12" comes back');
  assert.deepEqual(res.added, [{ tab: 'wire', section: 'THHN CU', name: '12' }]);
  // and nothing is proposed to the maintainer
  assert.deepEqual(Merge.computeCorrections(book, defaults(), removed), []);
});

test('mergeDefaults upgrades untouched rows and keeps user changes', () => {
  const book = clone(defaults());
  const removed = {};
  Merge.bootstrap(book, defaults());
  book.wire['THHN CU'][0].price = '110.00';
  book.wire['THHN CU'][0].edited = true;

  const next = defaults();
  next.wire['THHN CU'][0].price = '99.00'; // upstream change to the edited row — user wins
  next.wire['THHN CU'][1].price = '230.00'; // upstream change to untouched row — applies
  next.wire['THHN CU'].push({ name: '10', labor: 0.006, price: '331.00' }); // new default row
  next.gear = { Panels: [{ name: '100A', labor: 2, price: '400.00' }] }; // new tab

  const res = Merge.mergeDefaults(book, next, removed);
  assert.ok(res.changed >= 3);
  assert.equal(book.wire['THHN CU'][0].price, '110.00'); // edited kept
  assert.equal(book.wire['THHN CU'][1].price, '230.00'); // untouched upgraded
  assert.ok(book.wire['THHN CU'].some((r) => r.name === '10')); // new default added
  assert.equal(book.gear.Panels.length, 1); // new tab added
  // only the row whose numbers moved under the user is "updated" — the new
  // row and the whole new tab are not (T2-11: the notice names real changes)
  assert.deepEqual(res.updated, [{ tab: 'wire', section: 'THHN CU', name: '12' }]);
});

test('mergeDefaults does not resurrect removed defaults, drops upstream-deleted untouched rows', () => {
  const book = clone(defaults());
  book.wire['THHN CU'].splice(1, 1); // user deleted "12"
  const removed = { wire: { 'THHN CU': ['12'] } };

  const next = defaults(); // still contains "12"; also drop "# 22-6" upstream
  next.wire.Terminations = [];

  Merge.mergeDefaults(book, next, removed);
  assert.ok(!book.wire['THHN CU'].some((r) => r.name === '12')); // stays removed
  assert.equal(book.wire.Terminations.length, 0); // untouched row dropped with upstream
});

test('a migrated legacy removal still blocks the row but is never shared', () => {
  const meta = { defaultsVersion: 1, removed: { wire: { 'THHN CU': ['12'] } } };
  const maps = Merge.migrateRemovedMeta(meta);
  assert.deepEqual(maps.removed, {});
  assert.deepEqual(maps.removedLegacy, { wire: { 'THHN CU': ['12'] } });

  const book = clone(defaults());
  book.wire['THHN CU'].splice(1, 1);
  Merge.mergeDefaults(book, defaults(), maps.removed, maps.removedLegacy);
  assert.ok(!book.wire['THHN CU'].some((r) => r.name === '12'), 'a real delete is not resurrected');
  assert.deepEqual(Merge.computeCorrections(book, defaults(), maps.removed), [], 'no phantom remove');
});

test('migrateRemovedMeta keeps both maps once the split has been recorded', () => {
  const meta = { removedV: 2, removed: { wire: { 'THHN CU': ['14'] } }, removedLegacy: { wire: { 'THHN CU': ['12'] } } };
  assert.deepEqual(Merge.migrateRemovedMeta(meta), {
    removed: { wire: { 'THHN CU': ['14'] } },
    removedLegacy: { wire: { 'THHN CU': ['12'] } },
    relocated: {},
  });
});

test('unrecordRemoved takes a name back out and prunes empty levels', () => {
  const removed = { wire: { 'THHN CU': ['12', '14'] } };
  assert.equal(Merge.unrecordRemoved(removed, 'wire', 'THHN CU', '12'), true);
  assert.deepEqual(removed, { wire: { 'THHN CU': ['14'] } });
  assert.equal(Merge.unrecordRemoved(removed, 'wire', 'THHN CU', '14'), true);
  assert.deepEqual(removed, {});
  assert.equal(Merge.unrecordRemoved(removed, 'wire', 'THHN CU', '14'), false);
});

test('computeCorrections yields edit/new/remove and skips reverted edits', () => {
  const book = clone(defaults());
  const removed = {};
  Merge.bootstrap(book, defaults());
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

test('a removal whose row is back in the book is not proposed', () => {
  const book = clone(defaults()); // "12" sits in the book at its default values
  const removed = { wire: { 'THHN CU': ['12'] } }; // stale entry from a rename away and back
  assert.deepEqual(Merge.computeCorrections(book, defaults(), removed), []);
});

test('a new part carries its part number to the maintainer', () => {
  const book = clone(defaults());
  book.wire.Terminations.push({ name: 'Polaris tap', labor: 0.4, price: '12.00', partNumber: 'IPL-350', userAdded: true });
  const c = Merge.computeCorrections(book, defaults(), {}).find((x) => x.kind === 'new');
  assert.equal(c.new.partNumber, 'IPL-350');
  // an edit is a change to a shipped row — no part number rides with it
  book.wire['THHN CU'][0].price = '110.00';
  book.wire['THHN CU'][0].edited = true;
  const e = Merge.computeCorrections(book, defaults(), {}).find((x) => x.kind === 'edit');
  assert.equal('partNumber' in e.new, false);
});

test('fresh book against same defaults produces no corrections', () => {
  const book = clone(defaults());
  const removed = {};
  Merge.bootstrap(book, defaults());
  assert.deepEqual(Merge.computeCorrections(book, defaults(), removed), []);
});

// --- the shipped defaults themselves (js/data/laborBookDefaults.js) ---

test('shipped defaults carry no duplicate part name in any section', () => {
  assert.deepEqual(Merge.duplicateDefaultSections(realDefaults.defaults), []);
});

test('shipped defaults merge into a pristine book with zero changes, and settle', () => {
  const book = clone(realDefaults.defaults);
  assert.equal(Merge.mergeDefaults(book, realDefaults.defaults, {}).changed, 0);
  assert.equal(Merge.mergeDefaults(book, realDefaults.defaults, {}).changed, 0);
  assert.deepEqual(book, clone(realDefaults.defaults)); // no row rewritten
});

test('a pristine book of the shipped defaults yields no corrections', () => {
  const book = clone(realDefaults.defaults);
  Merge.bootstrap(book, realDefaults.defaults);
  assert.deepEqual(Merge.computeCorrections(book, realDefaults.defaults, {}), []);
});

test('a partial legacy book self-heals to the full shipped defaults', () => {
  // J11-F12: a book carrying one conduit section used to blacklist every
  // other conduit default forever. It now fills back in.
  const book = { conduit: {} };
  const firstSection = Object.keys(realDefaults.defaults.conduit)[0];
  book.conduit[firstSection] = clone(realDefaults.defaults.conduit[firstSection]);
  const removed = {};
  Merge.bootstrap(book, realDefaults.defaults);
  Merge.mergeDefaults(book, realDefaults.defaults, removed, {});
  assert.equal(
    Object.keys(book.conduit).length,
    Object.keys(realDefaults.defaults.conduit).length,
    'every conduit section is present'
  );
  assert.deepEqual(Merge.computeCorrections(book, realDefaults.defaults, removed), []);
});

test('an older book carrying the two same-named PVC GLUE rows converges on QUART / PINT', () => {
  // the v2 shape: conduit/PVC GLUE held two rows both named "PVC GLUE"
  const book = clone(realDefaults.defaults);
  book.conduit['PVC GLUE'] = [
    { name: 'PVC GLUE', labor: 15, price: '' },
    { name: 'PVC GLUE', labor: 5, price: '' },
  ];
  const res = Merge.mergeDefaults(book, realDefaults.defaults, {});
  assert.deepEqual(book.conduit['PVC GLUE'], [
    { name: 'PVC GLUE QUART', labor: 15, price: '' },
    { name: 'PVC GLUE PINT', labor: 5, price: '' },
  ]);
  assert.equal(res.changed, 4); // two stale rows dropped, two renamed rows adopted
  assert.equal(Merge.mergeDefaults(book, realDefaults.defaults, {}).changed, 0); // settled
});

test('bootstrap leaves a retired default name unflagged (no phantom "new" correction)', () => {
  // a pre-provenance book (never versioned) still carrying the old name:
  // without LABOR_BOOK_RETIRED both rows would read as the user's own parts
  const book = clone(realDefaults.defaults);
  book.conduit['PVC GLUE'] = [
    { name: 'PVC GLUE', labor: 15, price: '' },
    { name: 'PVC GLUE', labor: 5, price: '' },
  ];
  const removed = {};
  Merge.bootstrap(book, realDefaults.defaults, RETIRED);
  assert.deepEqual(Merge.computeCorrections(book, realDefaults.defaults, removed), []);
  Merge.mergeDefaults(book, realDefaults.defaults, removed, {}, {}, RETIRED);
  assert.deepEqual(book.conduit['PVC GLUE'].map((r) => r.name), ['PVC GLUE QUART', 'PVC GLUE PINT']);
  // ...while a genuinely user-added part under the same section is kept and shared
  book.conduit['PVC GLUE'].push({ name: 'PVC primer', labor: 2, price: '' });
  Merge.bootstrap(book, realDefaults.defaults, RETIRED);
  assert.equal(book.conduit['PVC GLUE'][2].userAdded, true);
});

test('mergeDefaults refuses a defaults section with duplicate names', () => {
  const next = defaults();
  next.wire['THHN CU'].push({ name: '14', labor: 9, price: '9.00' }); // ambiguous
  const book = clone(defaults());
  const warn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(m);
  try {
    assert.equal(Merge.mergeDefaults(book, next, {}).changed, 0);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(book.wire['THHN CU'], defaults().wire['THHN CU']); // untouched
  assert.equal(warnings.length, 1);
});

// --- the zones the book used to be silent on (X6) ---

// The search haystack the book itself builds for a curated row: the part name
// plus the section it sits in (js/views/laborBookSearch.js renderResults, and
// the per-tab filter in js/views/laborBook.js applyTabFilter).
function curatedHits(query) {
  const matches = Utils.makeTokenMatcher(query);
  const hits = [];
  for (const tab of Object.keys(realDefaults.defaults)) {
    for (const [section, rows] of Object.entries(realDefaults.defaults[tab])) {
      for (const row of rows) if (matches(`${row.name} ${section}`)) hits.push(`${tab}/${section}/${row.name}`);
    }
  }
  return hits;
}

test('every device/MC query the walks measured at zero now reaches a curated row', () => {
  // J5/J6 measured each of these returning nothing from the estimator's own
  // book: the vocabulary (T2-09) was there, the content was not.
  const zeroBefore = [
    '1900 box',
    '4 square box',
    'single pole switch',
    'sp switch',
    '3 way switch',
    'toggle switch',
    'dimmer switch',
    'occ sensor',
    'occupancy sensor',
    'photocell',
    'disconnect 60a',
    'romex',
    'pull string',
    'mac adapter',
    'mc connector',
  ];
  const empty = zeroBefore.filter((q) => curatedHits(q).length === 0);
  assert.deepEqual(empty, [], 'these queries still find nothing in the shipped book');
});

test('the MAC-adapter query lands on MC connectors, not on any row that says cable', () => {
  // The catalog's 15 "MC CONN" rows carry a price and zero hours; the point of
  // the curated section is the hours, so the query must reach it.
  const hits = curatedHits('mac adapter');
  assert.ok(hits.some((h) => h.includes('MC and NM Connectors/MC connector')), hits.join(' | '));
});

test('the curated sections carry hours on every row', () => {
  // X6 (v4) sections live under v3's names where the two overlapped
  const added = [
    ['gear', 'Disconnects'],
    ['lighting', 'Photocells'],
    ['devices', 'Receptacles'],
    ['devices', 'Switches'],
    ['devices', 'Occupancy Sensors'],
    ['devices', 'Boxes & Rings'],
    ['devices', 'Covers & Plates'],
    ['devices', 'MC and NM Connectors'],
    ['wire', 'NM-B (Romex)'],
    ['wire', 'MC Cable'],
    ['conduit', 'Pull String and Rope'],
  ];
  for (const [tab, section] of added) {
    const rows = realDefaults.defaults[tab][section];
    assert.ok(rows && rows.length, `${tab}/${section} is missing`);
    for (const r of rows) {
      assert.ok(Number(r.labor) > 0, `${tab}/${section}/${r.name} has no hours`);
      // X6 rows leave the price blank on purpose (the supply house owns today's
      // price); v3's curated starters carry an MC-book price and say so
      if (r.price !== '') assert.equal(r.priceSource, 'MC book', `${tab}/${section}/${r.name} is priced without provenance`);
    }
  }
});

test('a book at the previous defaults version takes the new sections on merge', () => {
  const v3 = clone(realDefaults.defaults);
  delete v3.devices['Boxes & Rings'];
  delete v3.conduit['Pull String and Rope'];
  const removed = {};
  Merge.bootstrap(v3, realDefaults.defaults);
  const res = Merge.mergeDefaults(v3, realDefaults.defaults, removed, {});
  assert.ok(v3.devices['Boxes & Rings'].some((r) => r.name.startsWith('1900 box')), 'the boxes come back');
  assert.ok(v3.conduit['Pull String and Rope'].length === 3);
  // a wholesale new section is not "your book changed" — nothing to announce
  assert.deepEqual(res.updated, []);
  assert.deepEqual(Merge.computeCorrections(v3, realDefaults.defaults, removed), []);
});

test('computeCorrections never emits one tab/section/name twice', () => {
  const book = clone(defaults());
  book.wire['THHN CU'] = [
    { name: '14', labor: 0.003, price: '110.00', edited: true },
    { name: '14', labor: 0.003, price: '120.00', edited: true },
  ];
  const list = Merge.computeCorrections(book, defaults(), {});
  assert.equal(list.filter((c) => c.name === '14').length, 1);
});

// --- every shape a stored book can be in converges on the current defaults ---

// The same rows, whatever order the merge appended them in: a section that
// arrived through two branches lists one branch's rows first.
function normalized(book) {
  const out = {};
  for (const tab of Object.keys(book)) {
    out[tab] = {};
    for (const section of Object.keys(book[tab] || {})) {
      out[tab][section] = book[tab][section]
        .map((r) => ({ name: r.name, labor: Number(r.labor) || 0, price: String(r.price ?? '') }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  }
  // the shipped defaults are evaluated in a vm context, whose Array prototype
  // deepStrictEqual would otherwise refuse to match — round-trip to plain data
  return clone(out);
}

function historicalShapes() {
  const v2 = loadHistoricalDefaults('v2.js');
  const v3main = loadHistoricalDefaults('v3-main.js');
  const v4ours = loadHistoricalDefaults('v4-ours.js');
  // v3 on the journey-map branch: the PVC GLUE collapse before the X6 rows
  const v3ours = { version: 3, defaults: clone(v4ours.defaults) };
  delete v3ours.defaults.gear.Disconnects;
  v3ours.defaults.lighting = {};
  v3ours.defaults.devices = {};
  delete v3ours.defaults.wire['NM-B (Romex)'];
  delete v3ours.defaults.wire['MC Cable'];
  delete v3ours.defaults.conduit['Pull String and Rope'];
  return { v2, 'v3-main': v3main, 'v3-ours': v3ours, 'v4-ours': v4ours };
}

for (const [label, shape] of Object.entries(historicalShapes())) {
  test(`a book saved at ${label} converges on the current defaults with no phantom corrections`, () => {
    assert.ok(shape.version < realDefaults.version, `${label} predates the current version`);
    // an untouched book at that version, as TakeoffState.upgradeLaborBook sees
    // it: defaultsVersion > 0, so no bootstrap — straight to the merge
    const book = clone(shape.defaults);
    const removed = {};
    const res = Merge.mergeDefaults(book, realDefaults.defaults, removed, {}, {}, RETIRED);
    assert.deepEqual(normalized(book), normalized(realDefaults.defaults), `${label} did not converge`);
    assert.deepEqual(Merge.computeCorrections(book, realDefaults.defaults, removed), []);
    // a wholesale upgrade is announced only for rows whose numbers moved
    assert.deepEqual(res.updated, []);
    assert.equal(Merge.mergeDefaults(book, realDefaults.defaults, removed, {}, {}, RETIRED).changed, 0, 'settled');
  });

  test(`a pre-provenance book holding the ${label} data converges too`, () => {
    // the same rows with no laborBookMeta at all: bootstrap runs first
    const book = clone(shape.defaults);
    const removed = {};
    Merge.bootstrap(book, realDefaults.defaults, RETIRED);
    Merge.mergeDefaults(book, realDefaults.defaults, removed, {}, {}, RETIRED);
    assert.deepEqual(normalized(book), normalized(realDefaults.defaults), `${label} did not converge`);
    assert.deepEqual(Merge.computeCorrections(book, realDefaults.defaults, removed), []);
  });
}

test('a v4-ours book keeps the rows the user edited or added in a retired section', () => {
  const v4 = loadHistoricalDefaults('v4-ours.js');
  const book = clone(v4.defaults);
  book.devices.Boxes[0].labor = 0.5;
  book.devices.Boxes[0].edited = true;
  book.devices['Wall Plates'].push({ name: 'Jumbo plate 1 gang', labor: 0.05, price: '', userAdded: true });
  const removed = {};
  Merge.mergeDefaults(book, realDefaults.defaults, removed, {}, {}, RETIRED);
  assert.equal(book.devices.Boxes, undefined, 'the retired section is gone');
  const moved = book.devices['Boxes & Rings'].find((r) => r.name === v4.defaults.devices.Boxes[0].name);
  assert.equal(moved.labor, 0.5);
  assert.equal(moved.edited, true);
  assert.ok(book.devices['Covers & Plates'].some((r) => r.name === 'Jumbo plate 1 gang' && r.userAdded));
  // and the edit is the only correction proposed
  const corrections = Merge.computeCorrections(book, realDefaults.defaults, removed);
  assert.deepEqual(corrections.map((c) => [c.kind, c.name]), [['edit', v4.defaults.devices.Boxes[0].name], ['new', 'Jumbo plate 1 gang']]);
});

test('migrateRemovedMeta carries the relocated map, and it blocks the merge without being shared', () => {
  const maps = Merge.migrateRemovedMeta({ defaultsVersion: 3, removed: { wire: { 'THHN CU': ['12'] } }, relocated: { wire: { Terminations: ['# 22-6'] } } });
  assert.deepEqual(maps.removedLegacy, { wire: { 'THHN CU': ['12'] } }); // pre-split → legacy
  assert.deepEqual(maps.removed, {});
  assert.deepEqual(maps.relocated, { wire: { Terminations: ['# 22-6'] } });
  const book = clone(defaults());
  delete book.wire.Terminations; // moved to another tab via Organize Categories
  Merge.mergeDefaults(book, defaults(), maps.removed, maps.removedLegacy, maps.relocated);
  assert.equal(book.wire.Terminations, undefined, 'not resurrected at the old spot');
  assert.deepEqual(Merge.computeCorrections(book, defaults(), maps.removed), [], 'a move is not a removal suggestion');
});

test('computeRemoved skips missing sections by default, includes them when asked', () => {
  const book = clone(defaults());
  delete book.wire.Terminations; // whole section gone (moved or deleted)
  book.wire['THHN CU'].splice(1, 1); // one row gone from a surviving section

  assert.deepEqual(Merge.computeRemoved(book, defaults()), { wire: { 'THHN CU': ['12'] } });
  assert.deepEqual(Merge.computeRemoved(book, defaults(), true), {
    wire: { 'THHN CU': ['12'], Terminations: ['# 22-6'] },
  });
});

test('shipped defaults have unique row names within every section', () => {
  // bootstrap/mergeDefaults/computeCorrections all match rows by name within
  // a section, so duplicate names break provenance (see the tests below).
  const shipped = loadShippedDefaults();
  for (const [tab, sections] of Object.entries(shipped)) {
    for (const [section, rows] of Object.entries(sections)) {
      const seen = new Set();
      for (const row of rows) {
        assert.ok(!seen.has(row.name), `duplicate row name "${row.name}" in ${tab} / ${section}`);
        seen.add(row.name);
      }
    }
  }
});

test('bootstrap matches each default row once, so two same-named rows raise no bogus edit', () => {
  // Why default row names must be unique per section: a name-keyed merge is
  // ambiguous over duplicates. bootstrap used to compare the second row
  // against the first's values and flag it edited (computeCorrections then
  // reported an edit the user never made); it now claims each default once.
  // The uniqueness test above keeps the shipped data out of this situation.
  const defs = { conduit: { GLUE: [
    { name: 'GLUE', labor: 15, price: '' },
    { name: 'GLUE', labor: 5, price: '' },
  ] } };
  const book = clone(defs);
  Merge.bootstrap(book, clone(defs));
  assert.equal(book.conduit.GLUE[0].edited, undefined);
  assert.equal(book.conduit.GLUE[1].edited, undefined); // untouched, and not flagged
  assert.deepEqual(Merge.computeCorrections(book, clone(defs), {}), []);
});

test('renaming default rows migrates untouched books to the new names', () => {
  // The v3 PVC GLUE fix: two same-named untouched rows are dropped (no default
  // carries the old name anymore) and the renamed defaults are adopted.
  const book = { conduit: { 'PVC GLUE': [
    { name: 'PVC GLUE', labor: 15, price: '' },
    { name: 'PVC GLUE', labor: 5, price: '' },
  ] } };
  const next = { conduit: { 'PVC GLUE': [
    { name: 'PVC GLUE QUART', labor: 15, price: '' },
    { name: 'PVC GLUE PINT', labor: 5, price: '' },
  ] } };
  Merge.mergeDefaults(book, next, {});
  assert.deepEqual(
    book.conduit['PVC GLUE'].map((r) => r.name).sort(),
    ['PVC GLUE PINT', 'PVC GLUE QUART']
  );
});

test('mergeDefaults does not resurrect a fully removed/relocated section', () => {
  const book = clone(defaults());
  delete book.wire.Terminations; // e.g. moved to another tab via Organize Categories
  const removed = { wire: { Terminations: ['# 22-6'] } };

  Merge.mergeDefaults(book, defaults(), removed);
  assert.equal(book.wire.Terminations, undefined);

  // ...but a genuinely new default row in that section is still adopted
  const next = defaults();
  next.wire.Terminations.push({ name: '# 4-1', labor: 0.3, price: '' });
  Merge.mergeDefaults(book, next, removed);
  assert.deepEqual(book.wire.Terminations, [{ name: '# 4-1', labor: 0.3, price: '' }]);
});

test('a price reverted to the default prunes the correction, whatever it is spelled like', () => {
  // parseMoney stores a typed price as its numeric string ("95"), while the
  // shipped defaults carry "95.00" — the same price, so no correction.
  const book = clone(defaults());
  const removed = Merge.bootstrap(book, defaults());
  const row = book.wire['THHN CU'][0];
  row.price = '111.11';
  row.edited = true;
  assert.equal(Merge.computeCorrections(book, defaults(), removed).length, 1);

  row.price = '95'; // reverted — default is "95.00"
  assert.deepEqual(Merge.computeCorrections(book, defaults(), removed), []);
  assert.equal(Merge.rowsEqual({ name: '14', labor: 0.003, price: '95' }, { name: '14', labor: 0.003, price: '95.00' }), true);
});

test('an unpriced row is never equal to a priced one', () => {
  assert.equal(Merge.rowsEqual({ name: 'x', labor: 0, price: '' }, { name: 'x', labor: 0, price: '0' }), false);
  assert.equal(Merge.rowsEqual({ name: 'x', labor: 0, price: '' }, { name: 'x', labor: 0, price: '' }), true);
});
