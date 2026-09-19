import test from 'node:test';
import assert from 'node:assert/strict';
import { profileColumns } from '../lib/chartResolver.js';

/* A column is an identifier when it identifies, not when it is called Index.

   The identifier pattern held an unanchored `index`, so every column whose name
   ended in "Index" was struck out of the profile before any analysis began. On
   a comparison of AI subscription plans the column it struck out was
   `Intelligence Index` — the benchmark score the file exists to weigh against
   price. The report that came back never mentioned how good any of the models
   were, and nothing in it said a column had been dropped.

   `key$` was unanchored too, which quietly removed a column called Turkey.

   "Row Index" is an identifier and "Intelligence Index" is a measure. The name
   cannot tell them apart; the values can, because identifying is what an
   identifier does. */

const rowsOf = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const kept = (rows) => {
  const p = profileColumns(rows);
  return [...p.measures, ...p.dimensions];
};

test('a score called an index is a measure', () => {
  // The real column: ten distinct values across forty-four rows. It identifies
  // nothing, so it cannot be an identifier.
  const rows = rowsOf(44, (i) => ({
    'Intelligence Index': [38, 53, 51, 30, 44, 18, 15, 14, 49, 55][i % 10],
  }));
  assert.deepEqual(kept(rows), ['Intelligence Index']);
});

test('a row number called an index is still an identifier', () => {
  // What the pattern was there for, and what the data test keeps catching:
  // whole, unique, and running through a dense range.
  assert.deepEqual(kept(rowsOf(44, (i) => ({ index: i }))), []);
  assert.deepEqual(kept(rowsOf(44, (i) => ({ 'Row Index': i + 1 }))), []);
  assert.deepEqual(kept(rowsOf(44, (i) => ({ row_index: i }))), []);
});

test('a price index over time is a measure, however unique its values', () => {
  // Near-unique, which is half the identifier test — and decimal, running over
  // a range far wider than its own count, which is the other half.
  const rows = rowsOf(120, (i) => ({ 'Price Index': 100 + i * 0.37 }));
  assert.deepEqual(kept(rows), ['Price Index']);
});

test('a key that is a key is an identifier; a country called Turkey is not', () => {
  assert.deepEqual(kept(rowsOf(44, (i) => ({ 'Product Key': `K-${i}` }))), []);
  assert.deepEqual(kept(rowsOf(44, () => ({ key: Math.random().toString(36) }))), []);

  // `key$` matched this, so a wide country-per-column export lost Turkey and
  // kept its neighbours.
  const wide = rowsOf(44, (i) => ({ Turkey: 1000 + (i % 7) * 13, Greece: 900 + i }));
  assert.deepEqual(kept(wide).sort(), ['Greece', 'Turkey']);
});

test('the unambiguous identifier names are untouched', () => {
  // These never needed the data, and still do not.
  const rows = rowsOf(44, (i) => ({
    order_id: `O${i}`,
    customerID: `C${i}`,
    uuid: `u${i}`,
    'Serial Number': `S${i}`,
    'Post Code': `PC${i}`,
    Revenue: 100 + i,
  }));
  assert.deepEqual(kept(rows), ['Revenue']);
});

test('a short file is not judged on uniqueness it cannot have', () => {
  // With four rows every column is near-unique by accident, so the data test
  // abstains and the ambiguous name is kept as a measure.
  const rows = rowsOf(4, (i) => ({ 'Quality Index': i * 7 }));
  assert.deepEqual(kept(rows), ['Quality Index']);
});
