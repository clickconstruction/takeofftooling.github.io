'use strict';
// Unit tests for the review panel's aggregation guards (js/suggestionsReview.js).
// The panel is admin-only and the cloud is production, so these rules are only
// ever exercised here (node:test; *.test.js = units, *.spec.js = Playwright).
const test = require('node:test');
const assert = require('node:assert/strict');
const Review = require('./js/suggestionsReview.js');

let nextId = 1;
function row(userId, kind, labor, price, old, extra) {
  return Object.assign(
    {
      id: `s${nextId++}`,
      user_id: userId,
      email: `${userId}@example.com`,
      tab: 'wire',
      section: 'THHN CU',
      part_name: '12',
      kind,
      old_value: old || null,
      new_value: { labor, price: price == null ? '' : String(price) },
      status: 'pending',
    },
    extra || {}
  );
}

const shipped = { labor: 8, price: '215.00' };

test('median is the middle value, and ignores what is not a number', () => {
  assert.equal(Review.median([3, 1, 2]), 2);
  assert.equal(Review.median([1, 2, 3, 4]), 2.5);
  assert.equal(Review.median([NaN, 'x', 5]), 5);
  assert.equal(Review.median([]), null);
});

test('a price 20x off the shipped number is flagged', () => {
  const g = Review.aggregate([row('u1', 'edit', 8, 5000, shipped)])[0];
  assert.equal(g.outlier, true);
  assert.equal(g.blocked, true);
});

test('a fat-fingered labor value is flagged too — the old guard saw only price', () => {
  // 8 hrs → 800 hrs at the shipped price: price alone says nothing is wrong
  const g = Review.aggregate([row('u1', 'edit', 800, 215, shipped)])[0];
  assert.equal(g.outlier, true, '800 hrs against a shipped 8 is 100x');
});

test('a plausible correction is not flagged', () => {
  const g = Review.aggregate([row('u1', 'edit', 9.5, 240, shipped)])[0];
  assert.equal(g.outlier, false);
  assert.equal(g.blocked, false);
});

test('a brand-new part at 800 hrs is flagged, where kind:new used to skip the test', () => {
  const g = Review.aggregate([row('u1', 'new', 800, 12, null)])[0];
  assert.equal(g.outlier, true);
  const ok = Review.aggregate([row('u1', 'new', 0.4, 12, null)])[0];
  assert.equal(ok.outlier, false);
});

test('two users whose medians cross is a chimera nobody proposed', () => {
  // A: 9 hrs / $300 · B: 11 hrs / $200 → medians 10 hrs / $250, which is
  // neither person's proposal
  const g = Review.aggregate([row('uA', 'edit', 9, 300, shipped), row('uB', 'edit', 11, 200, shipped)])[0];
  assert.equal(g.users, 2);
  assert.equal(g.chimera, true);
  assert.equal(g.blocked, true);
});

test('two users who agree on one row are not a chimera', () => {
  const g = Review.aggregate([row('uA', 'edit', 9, 300, shipped), row('uB', 'edit', 9, 300, shipped)])[0];
  assert.equal(g.chimera, false);
  assert.equal(g.users, 2);
});

test('three or more users is a consensus, mixed medians and all', () => {
  const g = Review.aggregate([
    row('uA', 'edit', 9, 300, shipped),
    row('uB', 'edit', 10, 200, shipped),
    row('uC', 'edit', 11, 250, shipped),
  ])[0];
  assert.equal(g.users, 3);
  assert.equal(g.chimera, false);
});

test('a new part carries its part number through to the patch', () => {
  const r = row('u1', 'new', 0.4, 12, null);
  r.new_value.partNumber = 'IPL-350';
  assert.equal(Review.aggregate([r])[0].partNumber, 'IPL-350');
  assert.equal(Review.aggregate([row('u1', 'new', 0.4, 12, null)])[0].partNumber, '');
});

test('rows for different parts stay in different groups, most-agreed first', () => {
  const other = row('uB', 'edit', 9, 300, shipped);
  other.part_name = '14';
  const groups = Review.aggregate([row('uA', 'edit', 9, 300, shipped), row('uC', 'edit', 9, 300, shipped), other]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, '12');
  assert.equal(groups[0].users, 2);
});
