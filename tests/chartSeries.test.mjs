import test from 'node:test';
import assert from 'node:assert/strict';
import { pivotSeries } from '../lib/chartSeries.js';

const rows = [
  { Category: 'Books', Region: 'North', Revenue: 40 },
  { Category: 'Books', Region: 'South', Revenue: 10 },
  { Category: 'Toys', Region: 'North', Revenue: 30 },
  { Category: 'Toys', Region: 'South', Revenue: 60 },
];
const opts = { xKey: 'Category', seriesKey: 'Region', yKey: 'Revenue' };

test('one row per category, one key per series', () => {
  const { data, keys } = pivotSeries(rows, opts);
  assert.deepEqual(keys, ['North', 'South']);
  assert.equal(data.length, 2);
  assert.deepEqual(data[0], { Category: 'Toys', North: 30, South: 60 });
});

test('categories are ordered by their total, not by one series', () => {
  // Books leads on North (40 v 30) but Toys is the bigger category (90 v 50).
  const { data } = pivotSeries(rows, opts);
  assert.equal(data[0].Category, 'Toys');
  assert.equal(pivotSeries(rows, { ...opts, sort: 'value-asc' }).data[0].Category, 'Books');
  assert.equal(pivotSeries(rows, { ...opts, sort: 'category-asc' }).data[0].Category, 'Books');
  assert.equal(pivotSeries(rows, { ...opts, sort: 'category-desc' }).data[0].Category, 'Toys');
});

test('a series a category has no row for is absent, not zero', () => {
  const sparse = [
    { Category: 'Books', Region: 'North', Revenue: 40 },
    { Category: 'Toys', Region: 'South', Revenue: 60 },
  ];
  const { data } = pivotSeries(sparse, opts);
  const books = data.find((r) => r.Category === 'Books');
  assert.equal(books.North, 40);
  assert.ok(!('South' in books), 'no row means no bar, not a bar of height zero');
});

test('rows are handed back untouched when there is nothing to fold', () => {
  assert.deepEqual(pivotSeries(rows, { xKey: 'Category', yKey: 'Revenue' }).data, rows);
  assert.deepEqual(pivotSeries([], opts), { data: [], keys: [] });
  assert.deepEqual(pivotSeries(null, opts), { data: [], keys: [] });
});

test('a non-numeric measure does not become NaN in the total', () => {
  const dirty = [...rows, { Category: 'Books', Region: 'East', Revenue: 'n/a' }];
  const { data } = pivotSeries(dirty, opts);
  const books = data.find((r) => r.Category === 'Books');
  assert.ok(!('East' in books));
  assert.equal(books.North, 40);
});
