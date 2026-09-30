'use strict';
/**
 * Unit tests for js/handoff.js — the "Copy for PipeTooling" text. The format
 * is PipeTooling's Counts-import contract (the same text CountTooling emits),
 * so these pin the exact bytes: prefixes, indent, footer.
 * Run: npm run test:unit
 */
const test = require('node:test');
const assert = require('node:assert');
const { buildPipeToolingText, buildPipeToolingRows, describe } = require('./js/handoff.js');

const item = (over) => ({
  id: 'x', type: null, description: 'item', quantity: 1, unit: 'ea', labor: 0,
  planPage: '', group: null, parentId: null, price: null, children: [], meta: null, ...over,
});

test('rows carry the CountTooling conventions PipeTooling reads', () => {
  const manifest = [
    item({ id: 'a', type: 'devices', description: 'Duplex Receptacle', quantity: 6, group: 'LP-1 / 7', planPage: '1',
      children: [item({ id: 'a1', parentId: 'a', type: 'misc', description: '4" Square Box', quantity: 6 })] }),
    item({ id: 'b', type: 'conduit', description: '1/2" EMT', quantity: 143, unit: 'ft', group: 'LP-1 / 7', planPage: '1' }),
    item({ id: 'c', type: 'conduit', description: 'Feeder to LP-2', quantity: 1840.4, unit: 'px', planPage: '4' }),
    item({ id: 'd', type: 'permits', description: 'City permit', quantity: 1, price: 450 }),
    item({ id: 'e', description: '', quantity: 3 }),
    item({ id: 'f', description: 'Zero qty', quantity: 0 }),
  ];
  const r = buildPipeToolingText(manifest, { plansUrl: 'https://counttooling.com/app/?t=0f4c2a1e-6b7d-4e3a-9c21-8d5f6a7b9c0d' });
  assert.strictEqual(r.text, [
    '[LP-1 / 7] Duplex Receptacle\t6\t1',
    '  [LP-1 / 7] 4" Square Box\t6\t1',
    '[LP-1 / 7] ft of 1/2" EMT\t143.00\t1',
    'px of Feeder to LP-2\t1840\t4',
    '',
    'View link:\thttps://counttooling.com/app/?t=0f4c2a1e-6b7d-4e3a-9c21-8d5f6a7b9c0d',
  ].join('\n'));
  assert.deepStrictEqual({ counts: r.counts, feet: r.feet, unscaled: r.unscaled, rows: r.rows }, { counts: 2, feet: 1, unscaled: 1, rows: 4 });
});

test('no plans link → no footer; empty manifest → empty text', () => {
  assert.strictEqual(buildPipeToolingText([item({ description: 'WC', quantity: 2 })], {}).text, 'WC\t2\t');
  assert.strictEqual(buildPipeToolingText([], { plansUrl: 'https://x/?t=0f4c2a1e-6b7d-4e3a-9c21-8d5f6a7b9c0d' }).text, '');
});

// --- ALTERNATES (2026-09-30): the alternate's rows come last under CountTooling's heading ---

test('an alternate group\'s rows come last under "--- Alternate: <name> ---"; a bid without one keeps the old text', () => {
  const manifest = [
    item({ id: 'a', type: 'devices', description: 'Duplex Receptacle', quantity: 24, group: 'LP-1 / 7', planPage: 'E2.1' }),
    item({ id: 'b', type: 'devices', description: 'Duplex Receptacle', quantity: 6, group: 'break room', planPage: 'E2.2',
      children: [item({ id: 'b1', parentId: 'b', type: 'misc', description: 'Box 4-11/16', quantity: 6 })] }),
    item({ id: 'c', type: 'conduit', description: '3/4" EMT', quantity: 140, unit: 'ft', group: 'Break room', planPage: 'E2.2' }),
    item({ id: 'd', type: 'permits', description: 'City permit', quantity: 1, group: 'Break room', price: 650 }),
  ];
  const r = buildPipeToolingText(manifest, { plansUrl: 'https://counttooling.com/app/?t=0f4c2a1e-6b7d-4e3a-9c21-8d5f6a7b9c0d', alternateGroups: ['Break room'] });
  assert.strictEqual(r.text, [
    '[LP-1 / 7] Duplex Receptacle\t24\tE2.1',
    '',
    '--- Alternate: Break room ---',
    '[break room] Duplex Receptacle\t6\tE2.2',
    '  [break room] Box 4-11/16\t6\tE2.2',
    '[Break room] ft of 3/4" EMT\t140.00\tE2.2',
    '',
    'View link:\thttps://counttooling.com/app/?t=0f4c2a1e-6b7d-4e3a-9c21-8d5f6a7b9c0d',
  ].join('\n'));
  assert.deepStrictEqual({ counts: r.counts, feet: r.feet, rows: r.rows, alternates: r.alternates }, { counts: 3, feet: 1, rows: 4, alternates: ['Break room'] });
  assert.strictEqual(describe(r), '3 counts · 1 line type · 1 alternate: Break room');
  // the same bid with no alternate named: no heading, no blank line, no key
  const plain = buildPipeToolingText(manifest, { alternateGroups: [] });
  assert.strictEqual(plain.text.includes('---'), false);
  assert.deepStrictEqual(plain.alternates, []);
  assert.strictEqual(describe(plain), '3 counts · 1 line type');
  // an alternate with no row is not a heading
  assert.strictEqual(buildPipeToolingText(manifest, { alternateGroups: ['Roof'] }).text.includes('---'), false);
});

test('the priced rows carry alternate: true only on an alternate\'s rows (children with their parent)', () => {
  const manifest = [
    item({ id: 'a', type: 'devices', description: 'Duplex Receptacle', quantity: 24, group: 'LP-1 / 7', price: 18.4, labor: 0.5 }),
    item({ id: 'b', type: 'devices', description: 'Duplex Receptacle', quantity: 6, group: 'Break room', price: 18.4, labor: 0.5,
      children: [item({ id: 'b1', parentId: 'b', type: 'misc', description: 'Box', quantity: 6, price: 1 })] }),
  ];
  const rows = buildPipeToolingRows(manifest, { alternateGroups: ['break room'] });
  assert.deepStrictEqual(rows.map((r) => [r.fixture, r.alternate]), [['[LP-1 / 7] Duplex Receptacle', undefined], ['[Break room] Duplex Receptacle', true], ['[Break room] Box', true]]);
  assert.strictEqual('alternate' in buildPipeToolingRows(manifest, {})[1], false);
});
