/**
 * Cells the cleaner had to guess at.
 *
 * Two things are tested separately and both matter: the store itself, and what
 * the cleaner actually puts in it. The store could be perfect while the cleaner
 * marks every cleaned cell — which would be worse than marking none, because a
 * warning on everything is a warning on nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_RECORDED_CELLS,
  REASON_TEXT,
  REASONS,
  UNCERTAIN,
  cellReason,
  columnTally,
  columnUncertainCount,
  columnUncertainShare,
  createConfidence,
  noteUncertain,
  summarizeConfidence,
  worstUncertainColumn,
  worstUncertainShare,
} from '../lib/cellConfidence.js';

import { dateOrderIsAmbiguous, sanitizeDataset } from '../lib/dataCleaner.js';

/* -- the store ----------------------------------------------------------- */

test('a recorded cell is counted and addressable', () => {
  const store = createConfidence();
  noteUncertain(store, 'ordered_on', 4, UNCERTAIN.DATE_ORDER);

  assert.equal(store.total, 1);
  assert.equal(cellReason(store, 'ordered_on', 4), UNCERTAIN.DATE_ORDER);
  assert.equal(cellReason(store, 'ordered_on', 5), null);
  assert.equal(columnUncertainCount(store, 'ordered_on'), 1);
});

test('an unknown reason is dropped rather than invented', () => {
  const store = createConfidence();
  noteUncertain(store, 'amount', 0, 'probably_fine');
  assert.equal(store.total, 0);
  assert.deepEqual(columnTally(store, 'amount'), {});
});

test('a cell keeps the first doubt raised about it', () => {
  const store = createConfidence();
  noteUncertain(store, 'amount', 0, UNCERTAIN.COERCED_NULL);
  noteUncertain(store, 'amount', 0, UNCERTAIN.DECIMAL_COMMA);
  // Both are counted — they are both true of the column — but the cell shows
  // the doubt that came first in the pipeline.
  assert.equal(cellReason(store, 'amount', 0), UNCERTAIN.COERCED_NULL);
  assert.equal(columnUncertainCount(store, 'amount'), 2);
});

test('counts stay exact after positions stop being recorded', () => {
  const store = createConfidence();
  for (let i = 0; i < MAX_RECORDED_CELLS + 500; i++) {
    noteUncertain(store, 'ordered_on', i, UNCERTAIN.DATE_ORDER);
  }
  assert.equal(store.total, MAX_RECORDED_CELLS + 500, 'the count must not be capped');
  assert.equal(store.recorded, MAX_RECORDED_CELLS);
  assert.equal(store.truncated, true);
  // Past the cap a cell reads as null, which is why null is not "certain".
  assert.equal(cellReason(store, 'ordered_on', MAX_RECORDED_CELLS + 10), null);
});

test('every reason has a sentence to show a reader', () => {
  for (const reason of REASONS) {
    assert.equal(typeof REASON_TEXT[reason], 'string', `no text for ${reason}`);
    assert.ok(REASON_TEXT[reason].length > 10);
  }
});

test('a share needs rows, and no rows is zero rather than NaN', () => {
  const store = createConfidence();
  noteUncertain(store, 'amount', 0, UNCERTAIN.COERCED_NULL);
  assert.equal(columnUncertainShare(store, 'amount', 4), 0.25);
  assert.equal(columnUncertainShare(store, 'amount', 0), 0);
  assert.equal(columnUncertainShare(store, 'missing', 10), 0);
});

test('the worst column wins, not the average', () => {
  const store = createConfidence();
  noteUncertain(store, 'ordered_on', 0, UNCERTAIN.DATE_ORDER);
  noteUncertain(store, 'ordered_on', 1, UNCERTAIN.DATE_ORDER);
  noteUncertain(store, 'amount', 0, UNCERTAIN.COERCED_NULL);

  // Four rows: dates are half doubtful, amount a quarter. Averaging would say
  // 12.5% across four clean columns and bury the date column entirely.
  const columns = ['ordered_on', 'amount', 'region', 'channel'];
  assert.equal(worstUncertainShare(store, columns, 4), 0.5);

  const worst = worstUncertainColumn(store, columns, 4);
  assert.equal(worst.column, 'ordered_on');
  assert.equal(worst.reason, UNCERTAIN.DATE_ORDER);
  assert.equal(worst.count, 2);
});

test('nothing uncertain has no worst column', () => {
  const store = createConfidence();
  assert.equal(worstUncertainShare(store, ['a', 'b'], 10), 0);
  assert.equal(worstUncertainColumn(store, ['a', 'b'], 10), null);
});

test('the summary leads with the column most in doubt', () => {
  const store = createConfidence();
  noteUncertain(store, 'amount', 0, UNCERTAIN.COERCED_NULL);
  for (let i = 0; i < 5; i++) noteUncertain(store, 'ordered_on', i, UNCERTAIN.DATE_ORDER);

  const summary = summarizeConfidence(store, 10);
  assert.equal(summary.total, 6);
  assert.equal(summary.columns[0].column, 'ordered_on');
  assert.equal(summary.columns[0].share, 0.5);
  assert.equal(summary.columns[1].column, 'amount');
});

/* -- which dates are genuinely a coin toss -------------------------------- */

test('a date is ambiguous only when both readings are possible and differ', () => {
  assert.equal(dateOrderIsAmbiguous('03/04/2024'), true, 'March 4th or April 3rd');
  assert.equal(dateOrderIsAmbiguous('3-4-24'), true);

  assert.equal(dateOrderIsAmbiguous('13/04/2024'), false, 'no thirteenth month');
  assert.equal(dateOrderIsAmbiguous('04/13/2024'), false, 'no thirteenth month');
  assert.equal(dateOrderIsAmbiguous('05/05/2024'), false, 'both readings are the same day');
  assert.equal(dateOrderIsAmbiguous('2024-03-04'), false, 'year first settles it');
  assert.equal(dateOrderIsAmbiguous('not a date'), false);
  assert.equal(dateOrderIsAmbiguous(null), false);
});

/* -- what the cleaner actually records ------------------------------------ */

const clean = (rows) => sanitizeDataset(rows);

test('an ambiguous date is marked and an unambiguous one is not', () => {
  const { metrics } = clean([
    { ordered_on: '03/04/2024', clear_date: '25/12/2024' },
    { ordered_on: '2024-06-01', clear_date: '13/01/2024' },
  ]);

  assert.equal(columnUncertainCount(metrics.confidence, 'ordered_on'), 1);
  assert.equal(cellReason(metrics.confidence, 'ordered_on', 0), UNCERTAIN.DATE_ORDER);
  assert.equal(cellReason(metrics.confidence, 'ordered_on', 1), null, 'ISO is not in doubt');
  assert.equal(columnUncertainCount(metrics.confidence, 'clear_date'), 0, 'day > 12 settles it');
});

test('a plain number is cleaned without being called uncertain', () => {
  // The whole point of the signal: a cell that was changed is not a cell that
  // was guessed at, and marking every coercion would mark almost everything.
  const { metrics } = clean([
    { amount: '1234', region: ' North ' },
    { amount: '5678', region: 'South' },
  ]);
  assert.equal(metrics.typesCoerced > 0, true, 'these were coerced');
  assert.equal(metrics.confidence.total, 0, 'and none of it was a judgement call');
});

test('a number-shaped value that could not be read is marked, not silently dropped', () => {
  // `1e999999` is numeric by shape and overflows to something unusable, so the
  // cell becomes null. The second column keeps the row alive — a row whose only
  // value nullifies is dropped whole, and takes its doubts with it.
  const { metrics, cleanedData } = clean([
    { amount: '12', region: 'North' },
    { amount: '1e999999', region: 'South' },
    { amount: '99', region: 'East' },
  ]);

  assert.equal(cleanedData.length, 3);
  assert.equal(cleanedData[1].amount, null, 'the value is gone');
  assert.equal(cellReason(metrics.confidence, 'amount', 1), UNCERTAIN.COERCED_NULL);
});

test('a row dropped for being empty takes its doubts with it', () => {
  // Otherwise the store would describe cells that are not in the data at all.
  const { cleanedData, metrics } = clean([{ amount: '10' }, { amount: '1e999999' }, { amount: '20' }]);
  assert.equal(cleanedData.length, 2);
  assert.equal(metrics.confidence.total, 0);
});

test('a cell blank because the row ended early is told apart from an empty one', () => {
  // Papa omits the key entirely for a short row; an empty cell arrives as ''.
  const { metrics } = clean([
    { a: '1', b: '2' },
    { a: '3' },
    { a: '5', b: '' },
  ]);

  assert.equal(columnTally(metrics.confidence, 'b')[UNCERTAIN.SHORT_ROW], 1);
  assert.equal(columnUncertainCount(metrics.confidence, 'b'), 1, 'the genuinely empty cell is fine');
});

test('a comma column nothing proves is marked; one with evidence is not', () => {
  const guessed = clean([{ amount: '1,234' }, { amount: '5,678' }, { amount: '9,012' }]);
  assert.equal(
    columnTally(guessed.metrics.confidence, 'amount')[UNCERTAIN.DECIMAL_COMMA],
    3,
    'nothing in the column says which side of the comma is which'
  );

  const proven = clean([{ amount: '1,234.56' }, { amount: '5,678' }, { amount: '9,012' }]);
  assert.equal(
    columnUncertainCount(proven.metrics.confidence, 'amount'),
    0,
    'one value with a dot after the comma settles the whole column'
  );
});

test('a clean file records nothing at all', () => {
  const { metrics, cleanedData } = clean([
    { region: 'North', units: '10', ordered_on: '2024-01-05' },
    { region: 'South', units: '20', ordered_on: '2024-02-06' },
  ]);
  assert.equal(cleanedData.length, 2);
  assert.equal(metrics.confidence.total, 0);
  assert.deepEqual(summarizeConfidence(metrics.confidence, 2).columns, []);
});

test('a dropped row does not shift the index of the rows that survive', () => {
  // An all-blank row is discarded by the cleaner. If doubts were recorded
  // against the raw position, every mark after it would point one row too far.
  const { cleanedData, metrics } = clean([
    { ordered_on: '2024-01-01', note: 'first' },
    { ordered_on: '', note: '' },
    { ordered_on: '03/04/2024', note: 'third' },
  ]);

  assert.equal(cleanedData.length, 2, 'the blank row is gone');
  assert.equal(cellReason(metrics.confidence, 'ordered_on', 1), UNCERTAIN.DATE_ORDER);
  assert.equal(cleanedData[1].note, 'third', 'and index 1 really is that row');
});

/* -- what a guessed column does to a finding ------------------------------ */

test('the cap ladder only fires where it should', async () => {
  const { uncertaintyCap } = await import('../lib/cellConfidence.js');
  assert.equal(uncertaintyCap(0), null, 'nothing guessed caps nothing');
  assert.equal(uncertaintyCap(0.04), null, 'a rounding error is not a doubt');
  assert.equal(uncertaintyCap(0.05), 'moderate');
  assert.equal(uncertaintyCap(0.19), 'moderate');
  assert.equal(uncertaintyCap(0.2), 'indicative');
  assert.equal(uncertaintyCap(0.49), 'indicative');
  assert.equal(uncertaintyCap(0.5), 'thin', 'half a column of guesses is not evidence');
  assert.equal(uncertaintyCap(1), 'thin');
});

test('a chart is matched to the uncertain columns it actually queries', async () => {
  const { chartRestsOn, createConfidence, noteUncertain, UNCERTAIN } = await import(
    '../lib/cellConfidence.js'
  );
  const store = createConfidence();
  noteUncertain(store, 'amount', 0, UNCERTAIN.DECIMAL_COMMA);
  noteUncertain(store, 'ordered_on', 0, UNCERTAIN.DATE_ORDER);

  const trend = {
    dimension: 'ordered_on',
    sql: 'SELECT [ordered_on] AS [Month], SUM([amount]) AS [Total] FROM [d] GROUP BY [ordered_on]',
  };
  assert.deepEqual(chartRestsOn(store, trend).sort(), ['amount', 'ordered_on']);

  // A chart over neither column rests on neither.
  const other = { dimension: 'region', sql: 'SELECT [region], COUNT(*) AS [n] FROM [d] GROUP BY [region]' };
  assert.deepEqual(chartRestsOn(store, other), []);

  // The bracketed form is what keeps a prefix from matching.
  const lookalike = { sql: 'SELECT SUM([amount_paid]) AS [Total] FROM [d]' };
  assert.deepEqual(chartRestsOn(store, lookalike), []);
});

test('merging sheets keeps each column measured against its own table', async () => {
  const { mergeConfidence, createConfidence, noteUncertain, columnUncertainShare, UNCERTAIN } =
    await import('../lib/cellConfidence.js');

  const lookup = createConfidence();
  for (let i = 0; i < 3; i++) noteUncertain(lookup, 'opened_on', i, UNCERTAIN.DATE_ORDER);

  const merged = mergeConfidence([
    { confidence: lookup, rowCount: 10 },
    { confidence: createConfidence(), rowCount: 5000 },
  ]);

  // Three of ten, not three of the joined five thousand.
  assert.equal(columnUncertainShare(merged, 'opened_on', 5000), 0.3);
  assert.equal(merged.total, 3);
});
