'use strict';
/**
 * Unit tests for js/utils.js — escapeHtml and the token search matcher.
 * Run: npm run test:unit
 */
const test = require('node:test');
const assert = require('node:assert');
const utils = require('./js/utils.js');

test('escapeHtml escapes markup-significant characters', () => {
  assert.strictEqual(utils.escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.strictEqual(utils.escapeHtml(null), '');
});

test('makeTokenMatcher: every token must match, any order, case-insensitive', () => {
  const m = utils.makeTokenMatcher('3/4 EMT coupling');
  assert.strictEqual(m('3/4" MIGHTY-SEAL RAINTIGHT PUSH STEEL EMT COUPLING'), true);
  assert.strictEqual(m('EMT COUPLING 1/2"'), false); // wrong size
  assert.strictEqual(m('3/4" EMT CONNECTOR'), false); // missing token
});

test('makeTokenMatcher normalizes straight and curly inch marks on both sides', () => {
  assert.strictEqual(utils.makeTokenMatcher('3/4"')('3/4 conduit'), true);
  assert.strictEqual(utils.makeTokenMatcher('3/4')('3/4” conduit'), true);
});

test('makeTokenMatcher: empty or blank query matches everything', () => {
  assert.strictEqual(utils.makeTokenMatcher('')('anything'), true);
  assert.strictEqual(utils.makeTokenMatcher('  ')('anything'), true);
});

test('makeTokenMatcher handles null haystacks', () => {
  assert.strictEqual(utils.makeTokenMatcher('emt')(null), false);
});

test('makeTokenMatcher: supply-house abbreviations match the words estimators type', () => {
  assert.strictEqual(utils.makeTokenMatcher('duplex receptacle 20a')('TR DUPLEX RECP 20A 125V SELF GRND W'), true);
  assert.strictEqual(utils.makeTokenMatcher('20a breaker')('TYPE BD DUPLEX BRKR 2-20A/1 POLE'), true);
  assert.strictEqual(utils.makeTokenMatcher('emt coupling')('3/4" EMT CPLG SS'), true);
  // and the other direction: the abbreviation finds the full word
  assert.strictEqual(utils.makeTokenMatcher('recp')('DUPLEX RECEPTACLE 20A'), true);
  // plurals resolve to the group too
  assert.strictEqual(utils.makeTokenMatcher('breakers')('20A BRKR 1P'), true);
});

test('makeTokenMatcher: short abbreviations match whole words only', () => {
  assert.strictEqual(utils.makeTokenMatcher('switch')('SW 20A 1P TOGGLE'), true);
  assert.strictEqual(utils.makeTokenMatcher('switch')('SWEEP ELBOW 90'), false);
  assert.strictEqual(utils.makeTokenMatcher('copper')('#12 THHN CU STR'), true);
  assert.strictEqual(utils.makeTokenMatcher('copper')('CUTTER 12IN'), false);
});

test('makeTokenMatcher: a synonym only matches a whole word, the typed word still matches inside one', () => {
  // 'supp' is how the catalog writes support — but SUPPLY is not a support
  assert.strictEqual(utils.makeTokenMatcher('box support')('CADDY BOX SUPP BRKT 4S'), true);
  assert.strictEqual(utils.makeTokenMatcher('box support')('NURSE CALL POWER SUPPLY BOX'), false);
  // typed spellings are still allowed to match inside a word
  assert.strictEqual(utils.makeTokenMatcher('supp')('NURSE CALL POWER SUPPLY'), true);
});

test('makeTokenMatcher: the words the trade uses find the words the book uses', () => {
  const hits = (q, h) => utils.makeTokenMatcher(q)(h);
  assert.strictEqual(hits('2p 20a breaker', '20A ENCL CB 2P 250V'), true);
  assert.strictEqual(hits('20a circuit breaker', '20A ENCL CB 2P 250V'), true);
  assert.strictEqual(hits('exit sign', 'LED EXIT LIGHT SINGLE FACE'), true);
  assert.strictEqual(hits('4 square box', '4S BOX 1-1/2 DEEP'), true);
  assert.strictEqual(hits('1900 box', '4 SQUARE BOX 2-1/8'), true);
  assert.strictEqual(hits('single pole switch', 'SP STD SWITCH 20A'), true);
  assert.strictEqual(hits('emt 90', '1/2" 90D EMT ELB'), true);
  assert.strictEqual(hits('pull string', 'PULL TAPE 1/4 X 500'), true);
  assert.strictEqual(hits('mac connector', 'MC CONN 3/8 SS'), true);
  assert.strictEqual(hits('mc adapter', 'MAC ADAPTER 1/2'), true);
});

test('makeSearchRanker: the words you typed outrank the ones a synonym reached', () => {
  const rank = utils.makeSearchRanker('2p 20a breaker');
  const literal = rank('20A 2P BREAKER 10KAIC');
  const viaSynonym = rank('20A ENCL CB 2P 250V');
  assert.ok(literal > 0 && viaSynonym > 0);
  assert.ok(literal > viaSynonym, `${literal} should beat ${viaSynonym}`);
  assert.strictEqual(rank('20A GFCI RECEPTACLE'), 0);

  // and the phrase in the order it was typed outranks the same words scattered
  const emt = utils.makeSearchRanker('emt coupling');
  assert.ok(emt('3/4" EMT COUPLING STEEL') > emt('COUPLING FOR 3/4 EMT'));
});

test('rankedByScore sorts best-first and leaves equal hits in book order', () => {
  const out = utils.rankedByScore([
    { name: 'a', score: 1 },
    { name: 'b', score: 3 },
    { name: 'c', score: 1 },
    { name: 'd', score: 3 },
  ]);
  assert.deepStrictEqual(out.map((h) => h.name), ['b', 'd', 'a', 'c']);
});

test('parseMoney reads a price written the way an estimator writes one', () => {
  assert.strictEqual(utils.parseMoney('$21,450.75'), 21450.75);
  assert.strictEqual(utils.parseMoney('1,975'), 1975);
  assert.strictEqual(utils.parseMoney('5,000.00'), 5000);
  assert.strictEqual(utils.parseMoney(' 2400 '), 2400);
  assert.strictEqual(utils.parseMoney('$ 18.40'), 18.4);
  assert.strictEqual(utils.parseMoney('.5'), 0.5);
  assert.strictEqual(utils.parseMoney('12.'), 12);
  assert.strictEqual(utils.parseMoney('-3.25'), -3.25);
  assert.strictEqual(utils.parseMoney('1 200'), 1200); // pasted non-breaking space
});

test('parseMoney passes finite numbers through', () => {
  assert.strictEqual(utils.parseMoney(0), 0);
  assert.strictEqual(utils.parseMoney(17995.5), 17995.5);
  assert.ok(Number.isNaN(utils.parseMoney(Infinity)));
});

test('parseMoney: blank is no price, not a bad price', () => {
  assert.strictEqual(utils.parseMoney(''), null);
  assert.strictEqual(utils.parseMoney('   '), null);
  assert.strictEqual(utils.parseMoney('$'), null);
  assert.strictEqual(utils.parseMoney(null), null);
  assert.strictEqual(utils.parseMoney(undefined), null);
});

test('parseMoney rejects text that is not money', () => {
  for (const bad of ['abc', '12.5.6', '$-', '1e5', '0x10', '12 each', '$12/ft', '--3', 'NaN']) {
    assert.ok(Number.isNaN(utils.parseMoney(bad)), `${bad} should be rejected`);
  }
});

test('formatMoney: thousands separators, 2 decimals at or above $1, 4 below', () => {
  assert.equal(utils.formatMoney(10462.375), '10,462.38');
  assert.equal(utils.formatMoney(0.1334), '0.1334');
  assert.equal(utils.formatMoney(0.1334, { fixed2: true }), '0.13');
  assert.equal(utils.formatMoney(0), '0.00');
  assert.equal(utils.formatMoney('abc'), '0.00');
  assert.equal(utils.formatMoney(-560), '-560.00');
});

test('formatHours: always two decimals', () => {
  assert.equal(utils.formatHours(0.75), '0.75');
  assert.equal(utils.formatHours(86.25), '86.25');
  assert.equal(utils.formatHours(139), '139.00');
});
