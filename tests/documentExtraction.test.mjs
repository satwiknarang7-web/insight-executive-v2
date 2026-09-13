/**
 * Reading a table out of a document.
 *
 * The model's part cannot be tested here — no key, no image, and its answer is
 * not deterministic. What can, and what carries the risk, is everything that
 * happens to that answer afterwards: the folding of columns that are secretly
 * the same column, and the conversion into rows whose positions the confidence
 * store will later point at. A mistake in the second one marks innocent cells.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractionToTable,
  isExtractable,
  normalizeExtraction,
} from '../lib/documentExtraction.js';

test('two columns under one header fold together when they never disagree', () => {
  const { columns, rows, mergedIds } = normalizeExtraction(
    [
      { id: 'rate', name: 'Rate', type: 'currency' },
      { id: 'rate_2', name: 'Rate', type: 'currency' },
    ],
    [
      { values: { rate: '10', rate_2: null }, confidence: { rate: 'verified' } },
      { values: { rate: null, rate_2: '20' }, confidence: { rate_2: 'uncertain' } },
    ]
  );

  assert.equal(columns.length, 1, 'one physical column, one column def');
  assert.deepEqual(mergedIds, ['rate_2']);
  assert.equal(rows[0].values.rate, '10');
  assert.equal(rows[1].values.rate, '20', 'the survivor takes the value from either twin');
  assert.equal(rows[1].confidence.rate, 'uncertain', 'and its doubt travels with it');
});

test('columns that disagree are kept apart and renamed', () => {
  // Merging these would destroy data. Renaming them only looks untidy.
  const { columns, mergedIds } = normalizeExtraction(
    [
      { id: 'amount', name: 'Amount', type: 'number' },
      { id: 'amount_2', name: 'Amount', type: 'number' },
    ],
    [{ values: { amount: '10', amount_2: '99' }, confidence: {} }]
  );

  assert.equal(columns.length, 2);
  assert.deepEqual(mergedIds, []);
  assert.equal(columns[1].name, 'Amount (2)');
});

test('rows are keyed by header, and empty ones are dropped before indices matter', () => {
  const table = extractionToTable({
    title: 'March ledger',
    columns: [
      { id: 'd', name: 'Date', type: 'date' },
      { id: 'a', name: 'Amount', type: 'currency' },
    ],
    rows: [
      { values: { d: '03/04/2024', a: '1,200' }, confidence: { d: 'verified', a: 'uncertain' } },
      { values: { d: null, a: null }, confidence: {} },
      { values: { d: '05/04/2024', a: '900' }, confidence: { d: 'uncertain' } },
    ],
  });

  assert.equal(table.label, 'March ledger');
  assert.deepEqual(table.columns, ['Date', 'Amount']);
  assert.equal(table.rows.length, 2, 'the empty row is gone');
  assert.deepEqual(table.rows[0], { Date: '03/04/2024', Amount: '1,200' });

  // The indices must address the rows that survived, not the ones handed in.
  assert.deepEqual(table.uncertain, [
    { row: 0, column: 'Amount' },
    { row: 1, column: 'Date' },
  ]);
  assert.equal(table.rows[1].Date, '05/04/2024', 'and row 1 really is that row');
});

test('a cell marked uncertain but empty is not recorded', () => {
  // There is no value to doubt. Recording it would put a warning on a blank.
  const table = extractionToTable({
    columns: [{ id: 'a', name: 'Amount', type: 'number' }],
    rows: [{ values: { a: '5' }, confidence: { a: 'verified' } }, { values: { a: null }, confidence: { a: 'uncertain' } }],
  });
  assert.equal(table.rows.length, 1);
  assert.deepEqual(table.uncertain, []);
});

test('values are handed on exactly as the document had them', () => {
  // The cleaner decides what "1,200" and "03/04/2024" mean, and it can only do
  // that correctly if it sees what was actually written.
  const table = extractionToTable({
    columns: [{ id: 'a', name: 'Amount', type: 'currency' }],
    rows: [{ values: { a: '1,200' }, confidence: {} }],
  });
  assert.equal(table.rows[0].Amount, '1,200', 'not 1200, and not 1.2');
});

test('headers that collide after folding are still unique', () => {
  // Rows are keyed by header; two columns sharing one would overwrite a value.
  const table = extractionToTable({
    columns: [
      { id: 'a', name: 'Amount', type: 'number' },
      { id: 'b', name: 'Amount', type: 'number' },
    ],
    rows: [{ values: { a: '1', b: '2' }, confidence: {} }],
  });
  assert.equal(new Set(table.columns).size, table.columns.length);
  assert.equal(table.rows[0][table.columns[0]], '1');
  assert.equal(table.rows[0][table.columns[1]], '2');
});

test('only things a model can actually look at are offered to it', () => {
  assert.equal(isExtractable({ type: 'image/png', name: 'ledger.png' }), true);
  assert.equal(isExtractable({ type: 'application/pdf', name: 'invoice.pdf' }), true);
  assert.equal(isExtractable({ type: '', name: 'scan.JPEG' }), true, 'by extension when the type is missing');
  assert.equal(isExtractable({ type: 'text/csv', name: 'sales.csv' }), false, 'a CSV needs no model');
  assert.equal(isExtractable({ type: '', name: 'book.xlsx' }), false);
});
