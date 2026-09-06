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
