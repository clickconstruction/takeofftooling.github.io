'use strict';
/**
 * Unit tests for js/elliotPriceCore.js (pure logic, dual browser/Node).
 * Run: npm run test:unit
 */
const test = require('node:test');
const assert = require('node:assert');
const core = require('./js/elliotPriceCore.js');

const HEADER = 'Category,Name,Description,Part Number,Price,Cost,Unit of Measure';

test('parseVendorCsv normalizes prices to per-EACH by unit divisor', () => {
  const csv = [
    HEADER,
    'Wire,THHN 12,#12 THHN Stranded,W123,150,120,THOUSAND',
    'Fittings,EMT Conn,3/4 EMT Connector,F456,250,200,HUNDRED',
    'Fittings,Strap,1/2 EMT Strap,S789,0.35,0.30,EACH',
  ].join('\n');
  const { rows, errors } = core.parseElliotCsvNormalized(csv);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].perEach, 0.15);
  assert.strictEqual(rows[1].perEach, 2.5);
  assert.strictEqual(rows[2].perEach, 0.35);
  assert.strictEqual(rows[0].partNumber, 'W123');
});

test('parseVendorCsv rejects files without the expected header', () => {
  const { rows, errors } = core.parseElliotCsvNormalized('Foo,Bar\n1,2');
  assert.strictEqual(rows.length, 0);
  assert.strictEqual(errors.length, 1);
});

test('parseVendorCsv skips rows without a part number', () => {
  const csv = [HEADER, 'Wire,THHN,desc,,150,120,EACH', 'Wire,THHN,desc,PN1,150,120,EACH'].join('\n');
  const { rows } = core.parseElliotCsvNormalized(csv);
  assert.strictEqual(rows.length, 1);
});

test('dedupeElliotRows keeps the lowest price and warns on >1% disagreement', () => {
  const rows = [
    { partNumber: 'A', category: 'Wire', perEach: 1.0 },
    { partNumber: 'A', category: 'Wire', perEach: 0.8 },
    { partNumber: 'B', category: 'Wire', perEach: 2.0 },
  ];
  const { rows: out, duplicateWarnings } = core.dedupeElliotRows(rows, { Wire: 'wire' });
  const a = out.find((r) => r.partNumber === 'A');
  assert.strictEqual(a.perEach, 0.8);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(duplicateWarnings.length, 1);
  assert.strictEqual(duplicateWarnings[0].partNumber, 'A');
});

test('dedupeElliotRows prefers rows whose category maps to a tab', () => {
  const rows = [
    { partNumber: 'A', category: 'N/A', perEach: 0.5 },
    { partNumber: 'A', category: 'Wire', perEach: 0.9 },
  ];
  const { rows: out } = core.dedupeElliotRows(rows, { Wire: 'wire', 'N/A': null });
  assert.strictEqual(out[0].perEach, 0.9);
});

test('normalizeTokens canonicalizes wire sizes, synonyms, and drops noise', () => {
  const tokens = core.normalizeTokens('#12 THHN Str RED 500\' spool');
  assert.ok(tokens.has('awg12'));
  assert.ok(tokens.has('thhn'));
  assert.ok(tokens.has('stranded'));
  assert.ok(!tokens.has('red'));
  assert.ok(!tokens.has('spool'));
  const conn = core.normalizeTokens('3/4" EMT conn');
  assert.ok(conn.has('connector'));
  assert.ok(conn.has('3/4'));
});

test('extractTradeSize finds compound sizes before their prefixes', () => {
  assert.strictEqual(core.extractTradeSize('1-1/2" EMT coupling'), '1-1/2');
  assert.strictEqual(core.extractTradeSize('3/4 in EMT'), '3/4');
  assert.strictEqual(core.extractTradeSize('no size here'), null);
});

test('scoreMatch boosts agreeing trade sizes and punishes mismatches', () => {
  const mc = core.metaFor('3/4 EMT connector');
  const same = core.metaFor('3/4" EMT Set Screw Connector');
  const wrongSize = core.metaFor('2" EMT Set Screw Connector');
  const sSame = core.scoreMatch(mc, same);
  const sWrong = core.scoreMatch(mc, wrongSize);
  assert.ok(sSame > 0.7, `expected strong match, got ${sSame}`);
  assert.ok(sWrong < sSame * 0.25, `size mismatch should crater the score (${sWrong} vs ${sSame})`);
});

test('scoreMatch punishes conflicting systems (EMT vs PVC)', () => {
  const mc = core.metaFor('3/4 EMT coupling');
  const pvc = core.metaFor('3/4 PVC coupling');
  const emt = core.metaFor('3/4 EMT coupling');
  assert.ok(core.scoreMatch(mc, pvc) < core.scoreMatch(mc, emt) * 0.3);
});

test('classifyMatches: clear high score with sane price → auto', () => {
  const cands = [
    { row: { partNumber: 'A', perEach: 1.0 }, score: 0.9 },
    { row: { partNumber: 'B', perEach: 3.0 }, score: 0.5 },
  ];
  const cls = core.classifyMatches(cands, 1.1);
  assert.strictEqual(cls.kind, 'auto');
  assert.strictEqual(cls.best.row.partNumber, 'A');
});

test('classifyMatches: near-tied candidates with the same price still auto', () => {
  const cands = [
    { row: { partNumber: 'A', perEach: 1.0 }, score: 0.9 },
    { row: { partNumber: 'B', perEach: 1.0 }, score: 0.85 },
  ];
  assert.strictEqual(core.classifyMatches(cands, 1.0).kind, 'auto');
});

test('classifyMatches: near-tied candidates with different prices → review', () => {
  const cands = [
    { row: { partNumber: 'A', perEach: 1.0 }, score: 0.9 },
    { row: { partNumber: 'B', perEach: 2.0 }, score: 0.85 },
  ];
  assert.strictEqual(core.classifyMatches(cands, 1.0).kind, 'review');
});

test('classifyMatches: insane price ratio blocks auto', () => {
  const cands = [{ row: { partNumber: 'A', perEach: 100 }, score: 0.95 }];
  const cls = core.classifyMatches(cands, 1.0); // 100x jump
  assert.notStrictEqual(cls.kind, 'auto');
});

test('classifyMatches: no old price demands near-certainty (0.92 bar)', () => {
  const cands = [{ row: { partNumber: 'A', perEach: 1 }, score: 0.85 }];
  assert.strictEqual(core.classifyMatches(cands, 0).kind, 'review');
  const sure = [{ row: { partNumber: 'A', perEach: 1 }, score: 0.95 }];
  assert.strictEqual(core.classifyMatches(sure, 0).kind, 'auto');
});

test('classifyMatches: weak best score → none', () => {
  const cands = [{ row: { partNumber: 'A', perEach: 1 }, score: 0.3 }];
  assert.strictEqual(core.classifyMatches(cands, 1).kind, 'none');
});

const MODEL = {
  items: { 1: { n: 'item one', p: 1 }, 2: { n: 'item two', p: 2 } },
  assemblies: {
    100: { m: 10, u1: 20, c: [[1, 10]], cm: 10, v: 1 }, // verified
    200: { m: 10, u1: 20, c: [[1, 5]], cm: 3, v: 0 },   // unverified
    300: { m: 4, u1: 8, c: [[2, 2]], cm: 4, v: 1 },     // untouched
  },
};

test('recomputeAssemblies scales verified assemblies by material ratio', () => {
  const { assemblyPrices, stats } = core.recomputeAssemblies(MODEL, { 1: 2 });
  // newComputed = 2*10 = 20; newMaterial = 10*(20/10) = 20; newPrice = 20*(20/10) = 40
  assert.strictEqual(assemblyPrices[100].price, 40);
  assert.strictEqual(assemblyPrices[200].flag, 'unverified');
  assert.strictEqual(assemblyPrices[300], undefined);
  assert.strictEqual(stats.updated, 1);
  assert.strictEqual(stats.flagged, 1);
  assert.strictEqual(stats.unchanged, 1);
});

test('patchLaborBook patches prices, appends supplier sections, is idempotent', () => {
  const book = {
    meta: {},
    tabs: {
      conduit: [{ level1: 'X', section: 'S', name: 'S', entries: [{ name: 'e1', labor: 1, price: 5, assmNum: 100 }] }],
    },
  };
  const recompute = core.recomputeAssemblies(MODEL, { 1: 2 });
  const overlay = {
    sourceFile: 'f.csv',
    importedAt: 'T',
    enabledCategories: ['Fittings'],
    itemPrices: { 1: 2 },
    newItems: [['Fittings', 'New Part', 'PN9', 0.5]],
  };
  const patched = core.patchLaborBook(book, recompute, overlay, { Fittings: 'conduit' });
  assert.strictEqual(patched.tabs.conduit[0].entries[0].price, 40);
  const supplier = patched.tabs.conduit.filter((s) => s.supplier);
  assert.strictEqual(supplier.length, 1);
  assert.strictEqual(supplier[0].entries[0].partNumber, 'PN9');
  assert.strictEqual(patched.meta.elliot.newItems, 1);
  // re-patch: supplier sections don't duplicate
  const again = core.patchLaborBook(patched, recompute, overlay, { Fittings: 'conduit' });
  assert.strictEqual(again.tabs.conduit.filter((s) => s.supplier).length, 1);
  // original untouched (deep copy)
  assert.strictEqual(book.tabs.conduit[0].entries[0].price, 5);
});

// A book that already carries a committed supplier catalog, on two tabs.
function bookWithCatalog() {
  return {
    meta: { elliot: { sourceFile: 'committed.csv', importedAt: '2026-07-18T00:00:00.000Z', newItems: 3 } },
    tabs: {
      conduit: [
        { level1: 'X', section: 'S', name: 'S', entries: [{ name: 'e1', labor: 1, price: 5, assmNum: 100 }] },
        { level1: 'Elliot', section: 'Fittings', name: 'Fittings', supplier: true, entries: [{ name: 'Old part', price: 1, partNumber: 'PN1' }, { name: 'Other', price: 2, partNumber: 'PN2' }] },
      ],
      wire: [{ level1: 'Elliot', section: 'Wire', name: 'Wire', supplier: true, entries: [{ name: 'Old wire', price: 0.1, partNumber: 'PN3' }] }],
    },
  };
}

test('countSupplierEntries counts supply-house parts across every tab', () => {
  assert.strictEqual(core.countSupplierEntries(bookWithCatalog()), 3);
  assert.strictEqual(core.countSupplierEntries({ tabs: {} }), 0);
});

test('patchLaborBook keeps the committed catalog when the overlay has no parts list', () => {
  const overlay = { sourceFile: 'new.csv', importedAt: '2026-09-07T00:00:00.000Z', itemPrices: { 1: 2 }, newItems: [] };
  const recompute = core.recomputeAssemblies(MODEL, { 1: 2 });
  for (const variant of [overlay, { ...overlay, newItems: undefined }, { ...overlay, newItems: [['Fittings', 'x', 'PN9', 1]], newItemsTruncated: true }, { ...overlay, newItems: [['Fittings', 'x', 'PN9', 1]], newItemsIncomplete: true }]) {
    const patched = core.patchLaborBook(bookWithCatalog(), recompute, variant, { Fittings: 'conduit' });
    assert.strictEqual(core.countSupplierEntries(patched), 3, `catalog lost for ${JSON.stringify(Object.keys(variant))}`);
    assert.strictEqual(patched.tabs.conduit.filter((s) => s.supplier).length, 1);
    assert.strictEqual(patched.tabs.wire.filter((s) => s.supplier).length, 1);
    // prices still applied, and the catalog is still dated by the committed file
    assert.strictEqual(patched.tabs.conduit[0].entries[0].price, 40);
    assert.strictEqual(patched.meta.elliot.newItems, 3);
    assert.strictEqual(patched.meta.elliot.catalogSource, 'published');
    assert.strictEqual(patched.meta.elliot.importedAt, '2026-07-18T00:00:00.000Z');
    assert.strictEqual(patched.meta.elliot.pricesImportedAt, '2026-09-07T00:00:00.000Z');
  }
});

test('patchLaborBook replaces the whole catalog when the overlay carries one', () => {
  const overlay = {
    sourceFile: 'new.csv',
    importedAt: '2026-09-07T00:00:00.000Z',
    enabledCategories: ['Fittings'],
    itemPrices: {},
    newItems: [['Fittings', 'Fresh part', 'PN9', 0.5]],
  };
  const patched = core.patchLaborBook(bookWithCatalog(), null, overlay, { Fittings: 'conduit' });
  assert.strictEqual(core.countSupplierEntries(patched), 1);
  // the stale wire section goes too — the overlay's catalog is the whole catalog
  assert.strictEqual(patched.tabs.wire.filter((s) => s.supplier).length, 0);
  assert.strictEqual(patched.meta.elliot.catalogSource, 'import');
  assert.strictEqual(patched.meta.elliot.importedAt, '2026-09-07T00:00:00.000Z');
});

test('overlayReplacesCatalog is false for empty, truncated or incomplete parts lists', () => {
  const items = [['Fittings', 'x', 'PN9', 1]];
  assert.strictEqual(core.overlayReplacesCatalog({ newItems: items }), true);
  assert.strictEqual(core.overlayReplacesCatalog({ newItems: [] }), false);
  assert.strictEqual(core.overlayReplacesCatalog({}), false);
  assert.strictEqual(core.overlayReplacesCatalog(null), false);
  assert.strictEqual(core.overlayReplacesCatalog({ newItems: items, newItemsTruncated: true }), false);
  assert.strictEqual(core.overlayReplacesCatalog({ newItems: items, newItemsIncomplete: true }), false);
});

const COLLIDE_ITEMS = {
  8706: { n: '3/4 FLEX SQZ CONN DIE', p: 6.94 },
  8732: { n: '3/4 FLEX SQZ CONN', p: 6.52 },
  9000: { n: '2 EMT COUPLING', p: 3.0 },
};
const COLLIDE_ROWS = [{ partNumber: '1709', description: '3/4 SQUEEZE CONNECTOR', name: '', perEach: 4.3233 }];

test('resolveMatchCollisions sends a guess at a saved part number to review, not to the mapping', () => {
  const result = core.resolveMatchCollisions(
    {
      auto: {
        8706: { partNumber: '1709', perEach: 4.3233, via: 'saved' },
        8732: { partNumber: '1709', perEach: 4.3233, via: 'auto', score: 0.86 },
      },
      review: [],
      mappedApplied: 1,
    },
    COLLIDE_ITEMS,
    COLLIDE_ROWS
  );
  assert.strictEqual(result.heldBack, 1);
  assert.deepStrictEqual(Object.keys(result.auto), ['8706']);
  assert.strictEqual(result.auto[8706].via, 'saved');
  assert.strictEqual(result.review.length, 1);
  const row = result.review[0];
  assert.strictEqual(row.itemNum, 8732);
  assert.strictEqual(row.heldPartNumber, '1709');
  assert.strictEqual(row.heldByItemNum, 8706);
  assert.strictEqual(row.heldByItemName, '3/4 FLEX SQZ CONN DIE');
  assert.strictEqual(row.candidates[0].pn, '1709');
  assert.strictEqual(row.candidates[0].desc, '3/4 SQUEEZE CONNECTOR');
});

test('resolveMatchCollisions: one part number prices one MC item, best guess keeps it', () => {
  const result = core.resolveMatchCollisions(
    {
      auto: {
        8732: { partNumber: '1709', perEach: 4.3233, via: 'auto', score: 0.81 },
        9000: { partNumber: '1709', perEach: 4.3233, via: 'auto', score: 0.93 },
      },
      review: [],
      mappedApplied: 0,
    },
    COLLIDE_ITEMS,
    COLLIDE_ROWS
  );
  assert.deepStrictEqual(Object.keys(result.auto), ['9000']);
  assert.strictEqual(result.heldBack, 1);
  assert.strictEqual(result.review[0].itemNum, 8732);
  const pns = Object.values(result.auto).map((m) => m.partNumber);
  assert.strictEqual(new Set(pns).size, pns.length);
});

test('resolveMatchCollisions puts held-back rows at the top of the review queue', () => {
  const existing = [{ itemNum: 5, itemName: 'first in queue', oldPerEach: 1, candidates: [] }];
  const result = core.resolveMatchCollisions(
    {
      auto: {
        8706: { partNumber: '1709', perEach: 4.3233, via: 'saved' },
        8732: { partNumber: '1709', perEach: 4.3233, via: 'auto', score: 0.86 },
      },
      review: existing,
      mappedApplied: 1,
    },
    COLLIDE_ITEMS,
    COLLIDE_ROWS
  );
  assert.strictEqual(result.review.length, 2);
  assert.strictEqual(result.review[0].itemNum, 8732, 'the held-back row is not buried behind 2,500 others');
  assert.strictEqual(result.review[1].itemNum, 5);
});

test('resolveMatchCollisions leaves non-colliding matches and the existing queue alone', () => {
  const existing = [{ itemNum: 5, itemName: 'x', oldPerEach: 1, candidates: [] }];
  const result = core.resolveMatchCollisions(
    {
      auto: {
        8706: { partNumber: '1709', perEach: 4.32, via: 'saved' },
        9000: { partNumber: '2200', perEach: 3.1, via: 'auto', score: 0.9 },
      },
      review: existing,
      mappedApplied: 1,
    },
    COLLIDE_ITEMS,
    COLLIDE_ROWS
  );
  assert.strictEqual(result.heldBack, 0);
  assert.strictEqual(result.review.length, 1);
  assert.deepStrictEqual(Object.keys(result.auto).sort(), ['8706', '9000']);
  assert.strictEqual(existing.length, 1);
});

test('stampNewItemDates keeps prior dates for unchanged prices, restamps moved ones', () => {
  const prior = {
    importedAt: '2026-07-18T05:20:54.240Z',
    newItems: [
      ['Fuses', 'Old fuse', 'PN1', 1.5],            // 4-tuple: date falls back to import day
      ['Fuses', 'Dated fuse', 'PN2', 2.0, '2026-06-01'],
    ],
  };
  const fresh = [
    ['Fuses', 'Old fuse', 'PN1', 1.5],   // unchanged → keeps 2026-07-18
    ['Fuses', 'Dated fuse', 'PN2', 2.5], // moved → today
    ['Fuses', 'Brand new', 'PN3', 9.99], // new → today
  ];
  const out = core.stampNewItemDates(fresh, prior, '2026-08-17');
  assert.deepStrictEqual(out.map((r) => r[4]), ['2026-07-18', '2026-08-17', '2026-08-17']);
  // no prior overlay: everything gets today
  const out2 = core.stampNewItemDates(fresh, null, '2026-08-17');
  assert.deepStrictEqual(out2.map((r) => r[4]), ['2026-08-17', '2026-08-17', '2026-08-17']);
});

test('patchLaborBook carries per-part pricedAt onto supplier entries', () => {
  const book = { meta: {}, tabs: { conduit: [] } };
  const overlay = {
    sourceFile: 'f.csv',
    importedAt: 'T',
    enabledCategories: ['Fittings'],
    itemPrices: {},
    newItems: [
      ['Fittings', 'Dated part', 'PN1', 0.5, '2026-07-18'],
      ['Fittings', 'Undated part', 'PN2', 0.7],
    ],
  };
  const patched = core.patchLaborBook(book, null, overlay, { Fittings: 'conduit' });
  const entries = patched.tabs.conduit.find((s) => s.supplier).entries;
  assert.strictEqual(entries[0].pricedAt, '2026-07-18');
  assert.strictEqual(entries[1].pricedAt, undefined);
});

// ---------- why a row is on the review list ----------

const tie = (price, desc, score) => ({ row: { perEach: price, description: desc, name: desc, partNumber: desc }, score });

test('a 100% tie at one price never reaches the review list — the matcher already takes it', () => {
  // Ties that agree on price are the auto-accept case (classifyMatches lifts
  // the margin to 1), so they are never up for review.
  const cls = core.classifyMatches([tie(0.1334, 'THHN 14 SOL ORANGE', 1), tie(0.1334, 'THHN 14 SOL BLACK', 1)], 0.5767);
  assert.strictEqual(cls.kind, 'auto');
});

test('one near-tied rival at a different price sends the row to review', () => {
  const cls = core.classifyMatches(
    [tie(0.1334, 'THHN 14 SOL ORANGE', 1), tie(0.1334, 'THHN 14 SOL BLACK', 1), tie(0.1541, 'THHN 14 STR ORANGE', 0.95)],
    0.5767
  );
  assert.strictEqual(cls.kind, 'review');
    assert.strictEqual(cls.reason.code, 'near-tie');
  // the rival that kept it out is named even though the row only shows three candidates
  assert.match(cls.reason.text, /THHN 14 STR ORANGE at \$0\.1541/);
  assert.strictEqual(cls.candidates.length, 3);
});

test('the disagreeing rival is named even when it is past the three candidates a row shows', () => {
  const cands = [
    tie(0.1334, 'A', 1), tie(0.1334, 'B', 1), tie(0.1334, 'C', 1), tie(0.1334, 'D', 1), tie(0.9, 'ODD ONE OUT', 0.97),
  ];
  const cls = core.classifyMatches(cands, 0.5);
  assert.strictEqual(cls.kind, 'review');
  assert.match(cls.reason.text, /ODD ONE OUT/);
  assert.deepStrictEqual(cls.candidates.map((c) => c.row.description), ['A', 'B', 'C', 'D'].slice(0, 3));
});

test('review reasons: a price too far from the book, and a name that only half matches', () => {
  const jump = core.classifyMatches([tie(10, 'X', 1)], 0.5);
  assert.strictEqual(jump.reason.code, 'price-jump');
  assert.match(jump.reason.text, /20\.0× higher/);
  const cheap = core.classifyMatches([tie(0.5, 'X', 1)], 10);
  assert.match(cheap.reason.text, /20\.0× lower/);
  const weak = core.classifyMatches([tie(1, 'Y', 0.6)], 1);
  assert.strictEqual(weak.reason.code, 'partial-name');
  assert.match(weak.reason.text, /60%/);
});


test('withoutSkipped drops the rows the maintainer already passed on', () => {
  const review = [{ itemNum: 5 }, { itemNum: 8 }, { itemNum: 13 }];
  assert.deepStrictEqual(core.withoutSkipped(review, new Set([8])).map((q) => q.itemNum), [5, 13]);
  assert.deepStrictEqual(core.withoutSkipped(review, [5, 13]).map((q) => q.itemNum), [8]);
  assert.deepStrictEqual(core.withoutSkipped(review, { 5: 1, 8: 1 }).map((q) => q.itemNum), [13]);
  assert.strictEqual(core.withoutSkipped(review, null), review);
  assert.strictEqual(core.withoutSkipped(review, new Set()), review);
});

test('formatUnitPrice: cents above a dollar, four places below', () => {
  assert.strictEqual(core.formatUnitPrice(1.5), '1.50');
  assert.strictEqual(core.formatUnitPrice(0.13341999), '0.1334');
  assert.strictEqual(core.formatUnitPrice(null), '0.0000');
});

// ---------- provenance dates survive a re-import (J13 finding 9) ----------

test('re-loading a file that moved no prices leaves every part date and the book date alone', () => {
  const published = {
    importedAt: '2026-07-18T05:20:54.240Z',
    newItems: [
      ['Wire', "TFFN 16 STR BLACK 2500'", 'TFFN16STBK2500', 0.1267], // 4-tuple, as committed
      ['Fittings', 'ALF 3/4 CONN', 'ALF34500', 1.2172],
    ],
  };
  const reimported = [
    ['Wire', "TFFN 16 STR BLACK 2500'", 'TFFN16STBK2500', 0.1267],
    ['Fittings', 'ALF 3/4 CONN', 'ALF34500', 1.2172],
  ];
  const stamped = core.stampNewItemDates(reimported, published, '2026-09-07');
  assert.deepStrictEqual(stamped.map((r) => r[4]), ['2026-07-18', '2026-07-18']);
  assert.strictEqual(core.newestPartDate(stamped), '2026-07-18');

  const patched = core.patchLaborBook(
    { meta: {}, tabs: { wire: [], conduit: [] } },
    null,
    { sourceFile: 'HCP_1272501.csv', importedAt: '2026-09-07T00:00:00.000Z', enabledCategories: [], itemPrices: {}, newItems: stamped },
    { Wire: 'wire', Fittings: 'conduit' }
  );
  // the book's date is when the catalog was last priced, not when the file was re-read
  assert.strictEqual(patched.meta.elliot.importedAt, '2026-07-18');
  assert.strictEqual(patched.meta.elliot.pricesImportedAt, '2026-09-07T00:00:00.000Z');
  assert.strictEqual(patched.tabs.wire.find((s) => s.supplier).entries[0].pricedAt, '2026-07-18');
});

test('a price that actually moved carries today, and moves the book date with it', () => {
  const published = { importedAt: '2026-07-18T05:20:54.240Z', newItems: [['Wire', 'W', 'PN1', 1.0]] };
  const stamped = core.stampNewItemDates([['Wire', 'W', 'PN1', 1.25]], published, '2026-09-07');
  assert.strictEqual(stamped[0][4], '2026-09-07');
  const patched = core.patchLaborBook(
    { meta: {}, tabs: { wire: [] } },
    null,
    { sourceFile: 'f.csv', importedAt: '2026-09-07T00:00:00.000Z', enabledCategories: [], itemPrices: {}, newItems: stamped },
    { Wire: 'wire' }
  );
  assert.strictEqual(patched.meta.elliot.importedAt, '2026-09-07');
});

test('newestPartDate ignores parts with no date and reports null when none have one', () => {
  assert.strictEqual(core.newestPartDate([['a', 'b', 'c', 1], ['a', 'b', 'c', 1, '2026-01-02']]), '2026-01-02');
  assert.strictEqual(core.newestPartDate([['a', 'b', 'c', 1]]), null);
  assert.strictEqual(core.newestPartDate(null), null);
});

// ---------- downloads carry the artifact, not this browser's bookkeeping ----------

test('sanitizeOverlayForDownload strips every local-only field and keeps the rest', () => {
  const out = core.sanitizeOverlayForDownload({
    version: 1,
    sourceFile: 'f.csv',
    itemPrices: { 5: 1 },
    newItems: [['a', 'b', 'c', 1]],
    newItemsCount: 1,
    categoryCounts: { a: 1 },
    newItemsIncomplete: true,
    newItemsTruncated: true,
    allCats: true,
  });
  assert.deepStrictEqual(Object.keys(out).sort(), ['itemPrices', 'newItems', 'sourceFile', 'version']);
  assert.strictEqual(core.sanitizeOverlayForDownload(null).newItems, undefined);
});
