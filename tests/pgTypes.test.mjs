import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configureTypeParsers,
  parseNumeric,
  parseTemporal,
  NUMERIC_OIDS,
  TEMPORAL_OIDS,
  OID,
} from '../lib/connectors/pgTypes.js';

test('wide numerics become numbers so they profile as measures', () => {
  // Postgres hands these back as strings; a string column is profiled as a
  // category and never charted as a measure.
  assert.equal(parseNumeric('12.5'), 12.5);
  assert.equal(typeof parseNumeric('9007199254740'), 'number');
  assert.equal(parseNumeric('-3'), -3);
  assert.equal(parseNumeric(null), null);
  assert.equal(parseNumeric(undefined), null);
});

test('an unparseable numeric is passed through rather than becoming NaN', () => {
  // NaN would poison every aggregate silently; the original value at least
  // shows up as a category.
  assert.equal(parseNumeric('not-a-number'), 'not-a-number');
});

test('dates stay strings, so they never shift a day', () => {
  // The pg default builds a Date at LOCAL midnight: west of UTC, 2026-01-15
  // becomes 2026-01-14T18:30:00Z and every date in the dataset is off by one.
  assert.equal(parseTemporal('2026-01-15'), '2026-01-15');
  assert.equal(typeof parseTemporal('2026-01-15'), 'string');
  assert.equal(parseTemporal('2026-01-15T09:30:00Z'), '2026-01-15T09:30:00Z');
  assert.equal(parseTemporal(null), null);
});

test('every numeric and temporal type is registered', () => {
  const registered = new Map();
  configureTypeParsers({ setTypeParser: (oid, fn) => registered.set(oid, fn) });

  for (const oid of NUMERIC_OIDS) {
    assert.ok(registered.has(oid), `numeric OID ${oid} was not registered`);
    assert.equal(registered.get(oid)('42'), 42);
  }
  for (const oid of TEMPORAL_OIDS) {
    assert.ok(registered.has(oid), `temporal OID ${oid} was not registered`);
    assert.equal(registered.get(oid)('2026-01-15'), '2026-01-15');
  }
});

test('the OIDs are the real Postgres ones', () => {
  // Getting one wrong would silently leave that type on its default parser.
  assert.equal(OID.INT8, 20);
  assert.equal(OID.NUMERIC, 1700);
  assert.equal(OID.DATE, 1082);
  assert.equal(OID.TIMESTAMPTZ, 1184);
});
