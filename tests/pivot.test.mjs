import test from 'node:test';
import assert from 'node:assert/strict';
import { toPeriods, toMatrix, cellKey } from '../lib/pivot.js';

const rows = [
  { month: '2025-01', region: 'West', revenue: 100 },
  { month: '2025-01', region: 'East', revenue: 250 },
  { month: '2025-02', region: 'West', revenue: 300 },
  { month: '2025-02', region: 'East', revenue: 120 },
];

test('periods keep the order they arrived in', () => {
  const periods = toPeriods(rows, 'month', 'region', 'revenue');
  assert.deepEqual(periods.map((p) => p.period), ['2025-01', '2025-02']);
});

test('within a period, categories are ordered largest first', () => {
  const [jan, feb] = toPeriods(rows, 'month', 'region', 'revenue');
  // This re-ordering is the whole point of a ribbon chart: the leader swaps.
  assert.deepEqual(jan.items.map((i) => i.name), ['East', 'West']);
  assert.deepEqual(feb.items.map((i) => i.name), ['West', 'East']);
});

test('each period stacks without gaps or overlaps', () => {
  for (const period of toPeriods(rows, 'month', 'region', 'revenue')) {
    let expected = 0;
    for (const item of period.items) {
      assert.equal(item.start, expected, 'a band starts where the last one ended');
      assert.equal(item.end, expected + item.value);
      expected = item.end;
    }
    assert.equal(period.total, expected, 'the stack reaches the period total');
  }
});

test('a matrix cross-tabulates and totals', () => {
  const m = toMatrix(rows, 'region', 'month', 'revenue');
  assert.deepEqual(m.rowNames, ['West', 'East']);
  assert.deepEqual(m.colNames, ['2025-01', '2025-02']);
  assert.equal(m.cells.get(cellKey('West', '2025-02')), 300);
  assert.equal(m.max, 300);
});

test('duplicate cells are summed, not overwritten', () => {
  const dupes = [
    { r: 'A', c: 'X', v: 10 },
    { r: 'A', c: 'X', v: 5 },
  ];
  const m = toMatrix(dupes, 'r', 'c', 'v');
  assert.equal(m.cells.get(cellKey('A', 'X')), 15);
});

test('row and column names that would concatenate ambiguously stay distinct', () => {
  // "North America" x "West" and "North" x "America West" both flatten to
  // "North America West" under a space separator, and would share one cell.
  const tricky = [
    { r: 'North America', c: 'West', v: 7 },
    { r: 'North', c: 'America West', v: 11 },
  ];
  const m = toMatrix(tricky, 'r', 'c', 'v');
  assert.equal(m.cells.get(cellKey('North America', 'West')), 7);
  assert.equal(m.cells.get(cellKey('North', 'America West')), 11);
});

test('not enough to pivot returns null rather than a fake matrix', () => {
  assert.equal(toMatrix([], 'r', 'c', 'v'), null);
  assert.equal(toMatrix(rows, 'region', null, 'revenue'), null);
  assert.equal(toMatrix(rows, 'region', 'month', null), null);
});
