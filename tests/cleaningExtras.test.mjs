/**
 * The cleaning that used to be left to the reader.
 *
 * A title above the header, a blank column the export left behind, four
 * spellings of one region, a revenue column written as "1.2M", a date written
 * "5 Jan 2024" or "31.12.2024". None of these is exotic; each of them used to
 * arrive as text, or as the wrong table, and be charted that way.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMetrics,
  dropEmptyColumns,
  finalizeMetrics,
  resolveSuffixNumbers,
  sanitizeChunk,
  unifyCategories,
} from '../lib/dataCleaner.js';
import { skipPreamble, uniqueHeader } from '../lib/ingest/delimited.js';

/** Run rows through the cleaner the way the worker does. */
function clean(rows, columns = Object.keys(rows[0])) {
  const metrics = createMetrics(columns, rows.length);
  const out = [];
  sanitizeChunk(rows, columns, metrics, out);
  metrics.totalRows = rows.length;
  finalizeMetrics(out, columns, metrics);
  return { rows: out, metrics, columns };
}

/* -- dates ---------------------------------------------------------------- */

test('dates written with month names are read, at UTC', () => {
  const { rows } = clean([
    { d: '5 Jan 2024' },
    { d: 'Jan 5, 2024' },
    { d: 'January 5 2024' },
    { d: '05-Jan-24' },
    { d: '5 September, 2024' },
    { d: 'March 2024' },
    { d: '2024-03' },
  ]);
  assert.equal(rows[0].d, '2024-01-05T00:00:00.000Z');
  assert.equal(rows[1].d, '2024-01-05T00:00:00.000Z');
  assert.equal(rows[2].d, '2024-01-05T00:00:00.000Z');
  assert.equal(rows[3].d, '2024-01-05T00:00:00.000Z');
  assert.equal(rows[4].d, '2024-09-05T00:00:00.000Z');
  assert.equal(rows[5].d, '2024-03-01T00:00:00.000Z', 'a month is its first day');
  assert.equal(rows[6].d, '2024-03-01T00:00:00.000Z');
});

test('dotted dates are day-first, unless that cannot be', () => {
  const { rows } = clean([{ d: '31.12.2024' }, { d: '12.31.2024' }, { d: '05.01.2024' }, { d: '2024.01.05' }]);
  assert.equal(rows[0].d, '2024-12-31T00:00:00.000Z');
  assert.equal(rows[1].d, '2024-12-31T00:00:00.000Z');
  assert.equal(rows[2].d, '2024-01-05T00:00:00.000Z', 'ambiguous dotted reads day-first');
  assert.equal(rows[3].d, '2024-01-05T00:00:00.000Z');
});

test('a word that is not a month, or a version number, is left as text', () => {
  const { rows } = clean([{ d: '5 Foo 2024' }, { d: '1.5.22' }, { d: 'Spring 2024' }]);
  assert.equal(rows[0].d, '5 Foo 2024');
  assert.equal(rows[1].d, '1.5.22');
  assert.equal(rows[2].d, 'Spring 2024');
});

/* -- scale letters -------------------------------------------------------- */

test('a column of 1.2K and $3M becomes numbers, counted as coerced', () => {
  const { rows, metrics } = clean([
    { v: '1.2K', k: 'a' },
    { v: '$3M', k: 'b' },
    { v: '2bn', k: 'c' },
    { v: 750, k: 'd' },
    { v: '-0.5m', k: 'e' },
    // A row of nothing but blanks is dropped by the cleaner, so the blank cell
    // has company — which is also the ordinary case.
    { v: null, k: 'f' },
  ]);
  assert.deepEqual(rows.map((r) => r.v), [1200, 3_000_000, 2_000_000_000, 750, -500_000, null]);
  assert.equal(metrics.columnStats.v.suffixConverted, 4);
  assert.equal(metrics.columnStats.v.type, 'number');
  assert.ok(metrics.typesCoerced >= 4);
});

test('a column of sizes is not a column of thousands', () => {
  const { rows, metrics } = clean([{ size: '5M' }, { size: 'XL' }, { size: 'Regular' }, { size: '2K' }]);
  assert.deepEqual(rows.map((r) => r.size), ['5M', 'XL', 'Regular', '2K']);
  assert.equal(metrics.columnStats.size.suffixConverted, 0);
  assert.equal(metrics.columnStats.size.type, 'string');
});

test('resolveSuffixNumbers leaves a column alone unless it was marked', () => {
  const metrics = createMetrics(['v'], 1);
  const rows = [{ v: '1K' }];
  resolveSuffixNumbers(rows, ['v'], metrics);
  assert.equal(rows[0].v, '1K');
});

/* -- spellings ------------------------------------------------------------ */

test('spellings of one category fold into the most frequent one', () => {
  const { rows, metrics } = clean([
    { region: 'North' },
    { region: 'North' },
    { region: 'north' },
    { region: ' NORTH ' },
    { region: 'South' },
    { region: 'south  ' },
    { region: 'East' },
  ]);
  assert.deepEqual(rows.map((r) => r.region), ['North', 'North', 'North', 'North', 'South', 'South', 'East']);
  assert.equal(metrics.valuesUnified, 3);
  assert.equal(metrics.columnStats.region.unifiedCount, 3);
  assert.ok(metrics.columnStats.region.unified.some((u) => u.from === 'north' && u.to === 'North'));
  assert.equal(metrics.columnStats.region.distinctCount, 3, 'the profile sees three regions, not seven');
});

test('a tie between spellings goes to the one without stray spaces', () => {
  const rows = [{ c: 'Ann ' }, { c: 'Ann' }];
  const metrics = createMetrics(['c'], 2);
  unifyCategories(rows, ['c'], metrics);
  assert.deepEqual(rows.map((r) => r.c), ['Ann', 'Ann']);
});

test('names and ids are never folded — a column with hundreds of values is left alone', () => {
  const rows = Array.from({ length: 600 }, (_, i) => ({ name: `Person ${i}` }));
  rows.push({ name: 'person 1' });
  const metrics = createMetrics(['name'], rows.length);
  unifyCategories(rows, ['name'], metrics);
  assert.equal(rows[600].name, 'person 1');
  assert.equal(metrics.valuesUnified, 0);
});

test('numbers and blanks are not spellings', () => {
  const { rows, metrics } = clean([
    { a: 1, k: 'p' },
    { a: 1, k: 'q' },
    { a: null, k: 'r' },
    { a: 'x', k: 's' },
  ]);
  assert.equal(metrics.valuesUnified, 0);
  assert.equal(rows[3].a, 'x');
});

/* -- empty columns -------------------------------------------------------- */

test('a column that is blank in every row is named and can be dropped', () => {
  const { rows, metrics, columns } = clean([
    { a: 1, ghost: '', b: 'x' },
    { a: 2, ghost: null, b: 'y' },
    { a: 3, ghost: 'n/a', b: 'z' },
  ]);
  assert.deepEqual(metrics.emptyColumns, ['ghost']);
  const dropped = dropEmptyColumns(rows, columns, metrics);
  assert.deepEqual(dropped, ['ghost']);
  assert.deepEqual(columns, ['a', 'b'], 'the column list is edited in place');
  assert.ok(!('ghost' in rows[0]));
});

test('a column with one value in it is not empty', () => {
  const { metrics } = clean([{ a: '' }, { a: 'x' }]);
  assert.deepEqual(metrics.emptyColumns, []);
});

/* -- the top of a CSV ----------------------------------------------------- */

test('a title, a stamp and a blank line above the header are cut', () => {
  const text = 'Q1 Sales Report\nGenerated 2024-04-01\n\nregion,revenue,units\nNorth,1200,5\nSouth,850,3\nEast,400,2\n';
  const { text: out, skipped } = skipPreamble(text);
  assert.equal(skipped, 3);
  assert.ok(out.startsWith('region,revenue,units\n'));
});

test('a file that starts with its header is untouched', () => {
  const text = 'region,revenue,units\nNorth,1200,5\nSouth,850,3\nEast,400,2\n';
  assert.deepEqual(skipPreamble(text), { text, skipped: 0 });
});

test('a data row wider than the header is not mistaken for the header', () => {
  let text = 'a,b,c\n';
  for (let i = 1; i <= 40; i++) text += `${i},b${i},c${i},SPILLED\n`;
  assert.equal(skipPreamble(text).skipped, 0);
});

test('a short file, or one whose first lines are as wide as the header, is untouched', () => {
  assert.equal(skipPreamble('a,b\n1,2\n').skipped, 0);
  assert.equal(skipPreamble('x,y,z\n1,2,3\nregion,revenue,units\nNorth,1,2\nSouth,3,4\n').skipped, 0);
});

test('blank and repeated header cells get names of their own, once each', () => {
  const t = uniqueHeader((h) => h.toUpperCase());
  assert.equal(t('amount', 0), 'AMOUNT');
  assert.equal(t('amount', 1), 'AMOUNT_2');
  assert.equal(t('', 2), 'Column_3');
  assert.equal(t('amount', 0), 'AMOUNT', 'a second pass over the same cell gives the same answer');
  assert.equal(t('amount', 1), 'AMOUNT_2');
});
