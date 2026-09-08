'use strict';
/**
 * Unit tests for js/handoff.js — the "Copy for PipeTooling" text. The format
 * is PipeTooling's Counts-import contract (the same text CountTooling emits),
 * so these pin the exact bytes: prefixes, indent, footer.
 * Run: npm run test:unit
 */
const test = require('node:test');
const assert = require('node:assert');
const { buildPipeToolingText } = require('./js/handoff.js');

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
