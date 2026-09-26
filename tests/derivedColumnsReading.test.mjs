import test from 'node:test';
import assert from 'node:assert/strict';
import { readDataset } from '../lib/engine/fields.js';

/* Columns the preparation pass adds, read back by the engine.

   A month taken out of a date restates the date axis, and an hour taken out
   of a timestamp is when, not how much. Read naively, the first became a bar
   chart repeating the trend and the second a measure whose total meant
   nothing. */

const rows = Array.from({ length: 300 }, (_, i) => {
  const d = new Date(Date.UTC(2024, 0, 1 + ((i * 7) % 400), (i * 5) % 24));
  return { ts: d.toISOString(), 'Ts Month': d.toISOString().slice(0, 7), 'Ts Hour': d.getUTCHours(), units: ((i * 13) % 50) + 1 };
});

test('a month column beside a date is read as restating it', () => {
  const f = readDataset(rows).byName['Ts Month'];
  assert.equal(f.role, 'dimension');
  assert.equal(f.alias, 'ts');
});

test('an hour of the day is a dimension, not a number to add up', () => {
  const f = readDataset(rows).byName['Ts Hour'];
  assert.equal(f.role, 'dimension');
  assert.equal(f.ordinal, true);
});

test('a period-shaped column with no date beside it is left alone', () => {
  const f = readDataset(rows.map(({ ts, ...r }) => r)).byName['Ts Month'];
  assert.equal(f.role, 'dimension');
  assert.equal(f.alias, undefined, 'with no date to restate, the months are the time split');
});
