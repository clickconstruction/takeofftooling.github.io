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
