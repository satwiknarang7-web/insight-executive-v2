/**
 * A malformed CSV must reach the user as a malformed CSV.
 *
 * Papa Parse reports every row it could not fit to the header, and the worker
 * used to discard that channel entirely: a stray unquoted comma on line 41
 * surfaced only as a slightly higher "Blanks found" count. These tests cover
 * the path from Papa's error list to the metrics object the UI is handed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// The worker is a module, but it installs a message handler on `self` at import
// time. A minimal stub is enough to import it and call its parsing helpers.
globalThis.self = globalThis.self || { postMessage: () => {} };

const { parseDelimited, rollUpMetrics, parseFailureMessage } = await import(
  '../app/workers/engine.worker.js'
);

/** A CSV whose data rows are numbered, with faults injected at given rows. */
function csvWithFaults({ rows = 12, tooMany = [], tooFew = [] } = {}) {
  let csv = 'a,b,c\n';
  for (let i = 1; i <= rows; i++) {
    if (tooMany.includes(i)) csv += `${i},b${i},c${i},SPILLED\n`;
    else if (tooFew.includes(i)) csv += `${i},b${i}\n`;
    else csv += `${i},b${i},c${i}\n`;
  }
  return csv;
}

const parse = (csv, opts = {}) =>
  parseDelimited(csv, { fileName: 'orders.csv', totalBytes: csv.length, ...opts });

test('a row with more fields than the header is counted and located', async () => {
  const { metrics } = await parse(csvWithFaults({ tooMany: [4] }));
  assert.equal(metrics.malformedRows, 1);
  assert.deepEqual(metrics.malformedSamples, [{ row: 4, kind: 'TooManyFields' }]);
});

test('a row with fewer fields than the header is counted and located', async () => {
  const { metrics } = await parse(csvWithFaults({ tooFew: [7] }));
  assert.equal(metrics.malformedRows, 1);
  assert.deepEqual(metrics.malformedSamples, [{ row: 7, kind: 'TooFewFields' }]);
  // And its missing cells are attributed to the short row, not to a blank cell.
  assert.equal(metrics.nullsFromShortRows, 1);
});

test('the recorded row number is absolute, not relative to the chunk it arrived in', async () => {
  // A row number that is wrong is worse than none. Papa's counter lives on the
  // per-stream handle, so `err.row` is already absolute — this test is what
  // catches a version of Papa where that stops being true.
  const csv = csvWithFaults({ rows: 400, tooMany: [377] });
  const { metrics } = await parse(csv, { chunkSize: 512 });
  assert.equal(metrics.malformedRows, 1);
  assert.deepEqual(metrics.malformedSamples, [{ row: 377, kind: 'TooManyFields' }]);
});

test('the kept samples are capped but the count is not', async () => {
  const tooMany = Array.from({ length: 40 }, (_, i) => i + 1);
  const { metrics } = await parse(csvWithFaults({ rows: 60, tooMany }), { chunkSize: 256 });
  assert.equal(metrics.malformedRows, 40);
  assert.equal(metrics.malformedSamples.length, 10);
  assert.equal(metrics.malformedSamples[0].row, 1);
});

test('a clean file reports nothing malformed', async () => {
  const { metrics } = await parse(csvWithFaults({}));
  assert.equal(metrics.malformedRows, 0);
  assert.deepEqual(metrics.malformedSamples, []);
  assert.equal(metrics.nullsFromShortRows, 0);
});

test('the overflow values never become a column of their own', async () => {
  const { columns, rows } = await parse(csvWithFaults({ tooMany: [4] }));
  assert.deepEqual(columns, ['a', 'b', 'c']);
  for (const row of rows) assert.ok(!('__parsed_extra' in row));
});

test('the malformed count survives the roll-up the UI is handed', async () => {
  // rollUpMetrics builds a fresh object per ingest; a field it forgets to carry
  // is a field the user never sees, however carefully it was counted.
  const { columns, rows, metrics } = await parse(csvWithFaults({ tooMany: [4], tooFew: [9] }));
  const tables = { Orders: { metrics, rows, columns } };
  const view = { rows, columns, provenance: {} };
  const rolled = rollUpMetrics(tables, view);

  assert.equal(rolled.malformedRows, 2);
  assert.equal(rolled.nullsFromShortRows, 1);
  assert.equal(rolled.malformedSamples.length, 2);
  assert.deepEqual(rolled.malformedSamples[0], { row: 4, kind: 'TooManyFields', table: 'Orders' });
});

test('outlier rows are carried up alongside outlier cells', async () => {
  let csv = 'x,y\n';
  for (let i = 0; i < 40; i++) csv += `${10 + (i % 3)},${20 + (i % 3)}\n`;
  csv += '5000,9000\n';
  const { columns, rows, metrics } = await parse(csv);
  const rolled = rollUpMetrics({ T: { metrics, rows, columns } }, { rows, columns, provenance: {} });
  assert.equal(rolled.outliersCount, 2);
  assert.equal(rolled.outlierRows, 1);
});

test('a parse failure names the file before it quotes the library', () => {
  const message = parseFailureMessage('orders.csv', { message: 'Unable to auto-detect delimiting character' });
  assert.match(message, /orders\.csv/);
  assert.match(message, /\(Unable to auto-detect delimiting character\)/);
  // The library text alone told the user nothing about which file failed.
  assert.notEqual(message, 'Unable to auto-detect delimiting character');
  // And it still says something useful when the library says nothing at all.
  assert.match(parseFailureMessage('orders.csv', {}), /orders\.csv/);
});
