import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchIndex, parseSearch, rowMatches, searchRows } from '../lib/rowSearch.js';

const columns = ['Region', 'Category', 'Year', 'Revenue', 'Customer'];
const rows = [
  { Region: 'West', Category: 'Electronics', Year: 2026, Revenue: 1234, Customer: 'Jane Doe' },
  { Region: 'West', Category: 'Home', Year: 2025, Revenue: 980, Customer: 'Sam Reed' },
  { Region: 'East', Category: 'Electronics', Year: 2026, Revenue: 12, Customer: 'Ana Diaz' },
  { Region: 'North America', Category: 'Toys', Year: 2026, Revenue: 34, Customer: null },
];

const index = buildSearchIndex(rows, columns);
const find = (query) => searchRows(rows, columns, query, index);

test('a single word matches any column', () => {
  assert.equal(find('west').length, 2);
  assert.equal(find('electronics').length, 2);
  assert.equal(find('2025').length, 1);
});

test('two words narrow the result instead of finding nothing', () => {
  // The bug this file exists for. "west electronics" used to look for those
  // characters run together, which no row has, so search appeared dead the
  // moment anyone typed a second word.
  const hits = find('west electronics');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].Customer, 'Jane Doe');

  assert.equal(find('electronics 2026').length, 2);
  assert.equal(find('west toys').length, 0, 'both terms really do have to match');
});

test('order and spacing do not matter', () => {
  assert.deepEqual(find('electronics west'), find('west   electronics'));
});

test('adjacent cells no longer run together into values that do not exist', () => {
  // Revenue 12 beside Revenue 34 in two different rows, and 1234 in a third.
  // Concatenating a row's cells with no separator matched "1234" against the
  // row holding 12 — a number that appears nowhere in it.
  const hits = find('1234');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].Region, 'West');
});

test('a number typed the way the table displays it still matches', () => {
  assert.equal(find('1,234').length, 1, 'the table shows 1,234; the data holds 1234');
});

test('a quoted phrase is kept whole', () => {
  assert.equal(find('"north america"').length, 1);
  assert.equal(find('north america').length, 1, 'unquoted still works — both terms are in the cell');
  assert.equal(find('"america north"').length, 0, 'the phrase is literal');
});

test('case is ignored on both sides', () => {
  assert.equal(find('JANE').length, 1);
  assert.equal(find('jAnE dOe').length, 1);
});

test('an empty or whitespace query selects everything', () => {
  assert.equal(find('').length, rows.length);
  assert.equal(find('   ').length, rows.length);
  assert.deepEqual(parseSearch('  '), []);
});

test('a blank cell is skipped rather than matched as "null"', () => {
  assert.equal(find('null').length, 0);
  assert.equal(find('undefined').length, 0);
});

test('a redundant prefix term does not change the result', () => {
  assert.deepEqual(parseSearch('rev revenue'), ['revenue']);
  assert.deepEqual(find('elect electronics'), find('electronics'));
});

test('scanning directly agrees with scanning the index', () => {
  for (const query of ['west', 'west electronics', '"north america"', '1,234', 'nothing here']) {
    const terms = parseSearch(query);
    const direct = rows.filter((row) => rowMatches(row, columns, terms));
    assert.deepEqual(searchRows(rows, columns, terms, index), direct, query);
  }
});

test('an index that does not line up with the rows is not trusted', () => {
  // What the outlier toggle produces: a subset of the rows, against an index
  // built for all of them. Matching positionally there returns other people's
  // rows, so the mismatch has to fall back to a direct scan.
  const subset = rows.slice(2);
  const hits = searchRows(subset, columns, 'west', index);
  assert.equal(hits.length, 0, 'no row in the subset is in the West');
});
