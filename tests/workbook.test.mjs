import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { findHeaderRow, headerNames, gridToRows, isWorkbookFile, readWorkbook } from '../lib/workbook.js';

test('the header is found under a title and a blank row', () => {
  const grid = [
    ['Q1 Sales Report', null, null],
    [null, null, null],
    ['Generated 12/03/2026', null, null],
    ['Region', 'Rep', 'Revenue'],
    ['West', 'Dana', 100],
    ['East', 'Sam', 200],
  ];
  assert.equal(findHeaderRow(grid), 3);
});

test('a plain sheet with the header at A1 is unchanged', () => {
  const grid = [
    ['Region', 'Revenue'],
    ['West', 100],
  ];
  assert.equal(findHeaderRow(grid), 0);
});

test('a sheet with nothing tabular in it yields no header', () => {
  assert.equal(findHeaderRow([[null], ['Notes'], [null]]), -1);
  assert.equal(findHeaderRow([]), -1);
});

test('blank and duplicate header cells become usable column names', () => {
  const names = headerNames(['Region', null, 'Revenue', 'Revenue']);
  assert.deepEqual(names, ['Region', 'Column_2', 'Revenue', 'Revenue_2']);
});

test('a totals footer is removed, a company called "Total Rewards" is not', () => {
  const grid = [
    ['Customer', 'Revenue'],
    ['Acme', 100],
    ['Total Rewards Ltd', 250],
    ['Globex', 50],
    ['Total', 400],
  ];
  const { rows, totalsRowsRemoved, columns } = gridToRows(grid);
  assert.deepEqual(columns, ['Customer', 'Revenue']);
  assert.equal(totalsRowsRemoved, 1);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].Customer, 'Total Rewards Ltd', 'a mid-sheet row is never treated as a footer');
});

test('blank rows inside the body are dropped and counted', () => {
  const grid = [
    ['A', 'B'],
    [1, 2],
    [null, null],
    [3, 4],
  ];
  const { rows, droppedRows } = gridToRows(grid);
  assert.equal(rows.length, 2);
  assert.equal(droppedRows, 1);
});

test('Excel dates are flattened to ISO strings', () => {
  // SheetJS builds its Date objects from the cell's own calendar reading, in
  // local time — this is the shape `gridToRows` actually receives.
  const grid = [
    ['Day', 'Value'],
    [new Date(2026, 0, 15), 10],
  ];
  const { rows } = gridToRows(grid);
  assert.equal(typeof rows[0].Day, 'string');
  assert.match(rows[0].Day, /^2026-01-15T/);
});

test('an Excel date keeps its calendar day wherever the browser is', () => {
  // The bug: `.toISOString()` on a local-midnight Date shifts the day west, so
  // in India every date in every uploaded workbook came out one day early and
  // every daily and monthly grouping was built on the wrong day.
  const before = process.env.TZ;
  try {
    for (const tz of ['UTC', 'Asia/Kolkata', 'Pacific/Auckland', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      const { rows } = gridToRows([
        ['Day', 'Value'],
        [new Date(2025, 1, 14), 10],
        [new Date(2025, 1, 14, 9, 30), 20],
      ]);
      assert.equal(rows[0].Day, '2025-02-14T00:00:00.000Z', `date wrong in ${tz}`);
      assert.equal(rows[1].Day, '2025-02-14T09:30:00.000Z', `time wrong in ${tz}`);
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test('a real workbook date survives the round trip on the right day', () => {
  const before = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Kolkata';
    const ws = XLSX.utils.aoa_to_sheet([['Day', 'Value'], [null, 10]]);
    ws.A2 = { t: 'n', v: 45702, z: 'yyyy-mm-dd' }; // Excel serial for 2025-02-14
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S');
    const { sheets } = readWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), {
      fileName: 'd.xlsx',
    });
    assert.match(sheets[0].rows[0].Day, /^2025-02-14T/);
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test('a header a query cannot name is renamed to one it can', () => {
  // AlaSQL has no escape for an apostrophe inside an identifier — not [x''y],
  // not `x\'y`, nothing — and a `]` closes a bracketed name early. A column
  // called "Client's Name" or "Price [USD]" therefore made every generated
  // query over it a parse error, and the chart came back silently empty.
  const names = headerNames(["Client's Name", 'Price [USD]', 'a`b', 'Plain (USD)']);
  assert.deepEqual(names, ['Client’s Name', 'Price (USD)', 'a’b', 'Plain (USD)']);
  for (const name of names) assert.ok(!/['`\][]/.test(name), `${name} still breaks alasql`);
});

test('renaming a header still leaves every column name distinct', () => {
  assert.deepEqual(headerNames(["Client's", 'Client’s']), ['Client’s', 'Client’s_2']);
});

test('spillover columns to the right of the header are ignored', () => {
  const grid = [
    ['A', 'B', null, null],
    [1, 2, null, null],
  ];
  const { columns } = gridToRows(grid);
  assert.deepEqual(columns, ['A', 'B']);
});

test('workbook filenames are recognised', () => {
  assert.ok(isWorkbookFile('books.xlsx'));
  assert.ok(isWorkbookFile('OLD.XLS'));
  assert.ok(!isWorkbookFile('data.csv'));
});

test('a real workbook round-trips into one entry per usable sheet', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Q1 Orders', null, null],
      [null, null, null],
      ['order_id', 'customer_id', 'revenue'],
      [1, 'C1', 100],
      [2, 'C2', 250],
      ['Total', null, 350],
    ]),
    'Orders'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['id', 'region'],
      ['C1', 'West'],
      ['C2', 'East'],
    ]),
    'Customers'
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Cover page notes']]), 'Read Me');

  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const { sheets, skipped } = readWorkbook(buffer, { fileName: 'test.xlsx' });

  assert.equal(sheets.length, 2);
  assert.deepEqual(sheets[0].columns, ['order_id', 'customer_id', 'revenue']);
  assert.equal(sheets[0].rows.length, 2, 'the totals footer is not a record');
  assert.equal(sheets[0].totalsRowsRemoved, 1);
  assert.equal(sheets[0].sourceFile, 'test.xlsx');
  assert.equal(sheets[1].sheetName, 'Customers');
  // A prose tab is reported, not silently discarded.
  assert.deepEqual(skipped, [{ sheetName: 'Read Me', reason: 'no table found on this sheet' }]);
});
