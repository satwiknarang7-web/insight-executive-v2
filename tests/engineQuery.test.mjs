import test from 'node:test';
import assert from 'node:assert/strict';
import { runQuery, bucketTime, rowFilter } from '../lib/engine/query.js';

const rows = [
  { d: '2026-01-05', region: 'North', status: 'Paid', revenue: 100, units: 2 },
  { d: '2026-01-20', region: 'North', status: 'Refund', revenue: -40, units: 1 },
  { d: '2026-02-03', region: 'South', status: 'Paid', revenue: 300, units: 3 },
  { d: '2026-02-14', region: 'East', status: 'Paid', revenue: 50, units: 1 },
  { d: '2026-03-01', region: 'West', status: 'Paid', revenue: 10, units: 1 },
  { d: '2026-03-02', region: 'West', status: 'Paid', revenue: null, units: 1 },
];
const sum = { id: 'rev', type: 'agg', field: 'revenue', agg: 'sum' };
const avg = { id: 'avg', type: 'agg', field: 'revenue', agg: 'avg' };
const count = { id: 'n', type: 'count' };

test('sums, averages and counts by a category', () => {
  const q = runQuery(rows, { measures: [sum, avg, count], by: [{ field: 'region' }] });
  const north = q.rows.find((r) => r.region === 'North');
  assert.equal(north.rev, 60);
  assert.equal(north.avg, 30);
  assert.equal(north.n, 2);
  // Ordered by the first measure, largest first.
  assert.equal(q.rows[0].region, 'South');
  // A blank value is not a zero in an average.
  assert.equal(q.rows.find((r) => r.region === 'West').avg, 10);
});

test('top N folds the rest into Other, recomputed from its parts', () => {
  const q = runQuery(rows, { measures: [sum], by: [{ field: 'region' }], limit: 2, other: true });
  assert.equal(q.rows.length, 2);
  assert.equal(q.rows[1].region, 'Other');
  assert.equal(q.rows[1].rev, 60 + 50 + 10);
});

test('a ratio is the ratio of the sums, not the mean of per-row ratios', () => {
  const perUnit = { id: 'pu', type: 'ratio', num: sum, den: { id: 'u', type: 'agg', field: 'units', agg: 'sum' } };
  const q = runQuery(rows, { measures: [perUnit], by: [] });
  assert.equal(q.rows[0].pu, 420 / 9);
});

test('a rate is the share of rows at one level', () => {
  const rate = { id: 'r', type: 'rate', event: { field: 'status', value: 'Refund' } };
  assert.equal(runQuery(rows, { measures: [rate], by: [] }).rows[0].r, 1 / 6);
});

test('a filtered measure counts only its rows', () => {
  const paid = { id: 'paid', type: 'agg', field: 'revenue', agg: 'sum', where: [{ field: 'status', values: ['Paid'] }] };
  assert.equal(runQuery(rows, { measures: [paid], by: [] }).rows[0].paid, 460);
});

test('time buckets: month, week (Monday), quarter, year, weekday', () => {
  assert.equal(bucketTime('2026-02-14', 'month'), '2026-02');
  assert.equal(bucketTime('2026-02-14', 'week'), '2026-02-09');
  assert.equal(bucketTime('2026-02-14', 'quarter'), '2026-Q1');
  assert.equal(bucketTime('2026-02-14', 'year'), '2026');
  assert.equal(bucketTime('2026-02-14', 'weekday'), 'Sat');
  const q = runQuery(rows, { measures: [sum], by: [{ field: 'd', grain: 'month' }] });
  assert.deepEqual(q.rows.map((r) => r.d), ['2026-01', '2026-02', '2026-03']);
});

test('filters: values, exclusions and date ranges', () => {
  assert.equal(rows.filter(rowFilter([{ field: 'region', values: ['North', 'East'] }])).length, 3);
  assert.equal(rows.filter(rowFilter([{ field: 'region', not: ['North'] }])).length, 4);
  assert.equal(rows.filter(rowFilter([{ field: 'd', from: '2026-02-01', to: '2026-02-28' }])).length, 2);
  assert.equal(rows.filter(rowFilter([{ field: 'd', grain: 'month', values: ['2026-03'] }])).length, 2);
});

test('support is how many rows stand behind each group', () => {
  const q = runQuery(rows, { measures: [avg], by: [{ field: 'region' }], sort: { by: 'label', dir: 'asc' } });
  assert.deepEqual(q.support, [1, 2, 1, 1]);
});
