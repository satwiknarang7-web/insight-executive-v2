import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeValue,
  normalizeRows,
  numericColumnsFrom,
} from '../lib/connectors/normalize.js';

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

test('dates become ISO strings, matching the CSV and workbook paths', () => {
  const d = new Date(Date.UTC(2026, 0, 15, 9, 30));
  assert.equal(normalizeValue(d), '2026-01-15T09:30:00.000Z');
  assert.equal(typeof normalizeValue(d), 'string');
});

test('an invalid date becomes null rather than "Invalid Date"', () => {
  assert.equal(normalizeValue(new Date('nonsense')), null);
});

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

test('bigints become numbers so they profile as measures', () => {
  // Left as a BigInt, `typeof v === 'number'` fails and the engine treats the
  // column as a category — it would never be charted as a measure.
  assert.equal(normalizeValue(10n), 10);
  assert.equal(typeof normalizeValue(10n), 'number');
});

test('numeric-looking strings are NOT converted blindly', () => {
  // The whole reason conversion is driven by declared type: "007" and "01234"
  // are identifiers, and losing the leading zero breaks joins across tables.
  assert.equal(normalizeValue('007'), '007');
  assert.equal(normalizeValue('01234'), '01234');
});

test('a declared numeric column IS converted', () => {
  const rows = normalizeRows(
    [{ id: '007', revenue: '1234.50', label: '42' }],
    { numericColumns: ['revenue'] }
  );
  assert.equal(rows[0].revenue, 1234.5);
  assert.equal(typeof rows[0].revenue, 'number');
  assert.equal(rows[0].id, '007', 'a text column keeps its leading zeros');
  assert.equal(rows[0].label, '42', 'an undeclared column is left alone');
});

test('an empty string in a numeric column does not become zero', () => {
  // Number('') is 0, which would invent revenue that does not exist.
  const rows = normalizeRows([{ revenue: '' }], { numericColumns: ['revenue'] });
  assert.equal(rows[0].revenue, '');
});

test('unparseable text in a numeric column is left visible, not turned into NaN', () => {
  const rows = normalizeRows([{ revenue: 'n/a' }], { numericColumns: ['revenue'] });
  assert.equal(rows[0].revenue, 'n/a');
});

// ---------------------------------------------------------------------------
// Binary and nulls
// ---------------------------------------------------------------------------

test('binary columns are dropped rather than shipped to the browser', () => {
  assert.equal(normalizeValue(Buffer.from('binary payload')), null);
  assert.equal(normalizeValue(new Uint8Array([1, 2, 3])), null);
});

test('null and undefined both settle on null', () => {
  assert.equal(normalizeValue(null), null);
  assert.equal(normalizeValue(undefined), null);
});

test('ordinary values pass through untouched', () => {
  assert.equal(normalizeValue('West'), 'West');
  assert.equal(normalizeValue(42), 42);
  assert.equal(normalizeValue(true), true);
  assert.equal(normalizeValue(0), 0);
  assert.equal(normalizeValue(false), false);
});

// ---------------------------------------------------------------------------
// Whole result sets
// ---------------------------------------------------------------------------

test('a result set is normalised row by row and column by column', () => {
  const rows = normalizeRows(
    [
      { day: new Date(Date.UTC(2026, 0, 15)), qty: 3n, blob: Buffer.from('x'), region: 'West' },
      { day: new Date(Date.UTC(2026, 0, 16)), qty: 5n, blob: null, region: 'East' },
    ]
  );
  assert.equal(rows.length, 2);
  assert.match(rows[0].day, /^2026-01-15T/);
  assert.equal(rows[0].qty, 3);
  assert.equal(rows[0].blob, null);
  assert.equal(rows[1].region, 'East');
});

test('an empty result set is survivable', () => {
  assert.deepEqual(normalizeRows([]), []);
  assert.deepEqual(normalizeRows(null), []);
});

// ---------------------------------------------------------------------------
// Column metadata
// ---------------------------------------------------------------------------

test('numeric columns are recognised across the shapes drivers use', () => {
  // mssql: an object keyed by name, with a type object.
  const mssqlish = { revenue: { name: 'Decimal' }, region: { name: 'NVarChar' } };
  const a = numericColumnsFrom(Object.entries(mssqlish).map(([name, type]) => ({ name, type })));
  assert.ok(a.has('revenue'));
  assert.ok(!a.has('region'));

  // mysql2: a flat list with string types.
  const b = numericColumnsFrom([
    { name: 'total', type: 'DECIMAL' },
    { name: 'count', type: 'BIGINT' },
    { name: 'name', type: 'VARCHAR' },
  ]);
  assert.ok(b.has('total') && b.has('count'));
  assert.ok(!b.has('name'));
});

test('money and float variants count as numeric', () => {
  const cols = numericColumnsFrom([
    { name: 'a', type: 'Money' },
    { name: 'b', type: 'Float' },
    { name: 'c', type: 'Real' },
    { name: 'd', type: 'SmallMoney' },
    { name: 'e', type: 'Double' },
    { name: 'f', type: 'Date' },
  ]);
  for (const n of ['a', 'b', 'c', 'd', 'e']) assert.ok(cols.has(n), n);
  assert.ok(!cols.has('f'), 'a date is not a measure');
});

test('missing metadata does not throw', () => {
  assert.equal(numericColumnsFrom(null).size, 0);
  assert.equal(numericColumnsFrom([]).size, 0);
  assert.equal(numericColumnsFrom([{ type: 'Int' }]).size, 0, 'a column with no name is skipped');
});
