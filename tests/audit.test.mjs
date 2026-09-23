import test from 'node:test';
import assert from 'node:assert/strict';

import { audit, outlierInfluence, partitioning, readFigure, selected } from '../eval/audit.mjs';
import { answer } from '../eval/answers.mjs';

/* The auditor is the measuring stick for every later phase, so its own
 * readings are pinned here — each case is one it once got wrong. */

test('a rate over COUNT(*) is a ratio, not a count', () => {
  const sql = "SELECT [x], SUM(CASE WHEN [f] = 'Y' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS [Win Rate] FROM T GROUP BY [x]";
  assert.equal(selected(sql, 'Win Rate').fn, null);
  assert.equal(selected('SELECT [x], COUNT(*) AS [Record Count] FROM T GROUP BY [x]', 'Record Count').fn, 'COUNT');
  assert.equal(selected('SELECT AVG([m]) AS [Avg M], SUM([n]) AS [Total N] FROM T', 'Total N').fn, 'SUM');
});

test('a pivot over two levels splits by the column; one level does not', () => {
  const two = "SELECT [m], SUM(CASE WHEN [s] = 'Open' THEN 1 ELSE 0 END) AS [o], SUM(CASE WHEN [s] = 'Closed' THEN 1 ELSE 0 END) AS [c] FROM T GROUP BY [m]";
  const one = "SELECT [m], SUM(CASE WHEN [s] = 'Open' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS [o] FROM T GROUP BY [m]";
  assert.ok(partitioning(two).has('s'));
  assert.ok(!partitioning(one).has('s'));
  assert.ok(!partitioning('SELECT [a] FROM T WHERE [b] IS NOT NULL').has('b'));
});

test('one dominant row is an outlier; a noisy small group is not', () => {
  assert.ok(outlierInfluence([1.2, 0.9, 1.5, 1.1, 0.8, 178]) > 0.25);
  assert.equal(outlierInfluence([12, 40, 3, 88, 61, 117, 25]), 0);
});

test('figures read back with the precision they were printed at', () => {
  assert.deepEqual(readFigure('75.8K'), { value: 75800, step: 100, pct: false });
  assert.equal(readFigure('23.9%').step, 0.1);
});

const rows = [
  { plan: 'A', unit: 'user', price: 10 },
  { plan: 'B', unit: 'user', price: 12 },
  { plan: 'C', unit: 'instance', price: 900 },
];

test('a price compared across buyer units breaks I3; within one it does not', () => {
  const truth = { grain: 'entity', measures: { price: { scope: ['unit'] } } };
  const across = { charts: [{ id: 'c1', chart_type: 'bar', xAxisKey: 'plan', yAxisKey: 'price', sql: 'SELECT [plan], [price] FROM T', resultData: [] }] };
  const within = { charts: [{ id: 'c1', chart_type: 'bar', xAxisKey: 'plan', yAxisKey: 'price', sql: 'SELECT [plan], [unit], [price] FROM T', resultData: [] }] };
  assert.deepEqual(audit(across, rows, truth).map((v) => v.rule), ['I3']);
  assert.deepEqual(audit(within, rows, truth), []);
});

test('a label that is not a value of its column breaks I1', () => {
  const chart = {
    id: 'c1',
    chart_type: 'hbar',
    xAxisKey: 'unit',
    yAxisKey: 'price',
    sql: "SELECT CONCAT([plan], ' · ', [unit]) AS [unit], [price] FROM T",
    resultData: [{ unit: 'C · instance', price: 900 }],
  };
  assert.deepEqual(audit({ charts: [chart] }, rows, {}).map((v) => v.rule), ['I1']);
});

test('a weekly level bucketed to the month is summed across weeks', () => {
  const weekly = [
    { week: '2026-01-05', sku: 'a', stock: 10 },
    { week: '2026-01-12', sku: 'a', stock: 12 },
  ];
  const truth = { measures: { stock: { noSumAcross: ['week'] } } };
  const chart = (sql) => ({ charts: [{ id: 'c', chart_type: 'line', sql, resultData: [] }] });
  const monthly = 'SELECT SUBSTRING([week], 1, 7) AS [Month], SUM([stock]) AS [S] FROM T GROUP BY SUBSTRING([week], 1, 7)';
  const daily = 'SELECT SUBSTRING([week], 1, 10) AS [Day], SUM([stock]) AS [S] FROM T GROUP BY SUBSTRING([week], 1, 10)';
  assert.deepEqual(audit(chart(monthly), weekly, truth).map((v) => v.rule), ['I3']);
  assert.deepEqual(audit(chart(daily), weekly, truth), []);
});

test('a chart that breaks a rule answers nothing; a wrong sentence does not disqualify it', () => {
  const q = { id: 'q', answeredBy: [['price']], by: ['plan'] };
  const chart = { id: 'c1', chart_type: 'bar', title: 't', sql: 'SELECT [plan], [price] FROM T', resultData: [] };
  const result = { charts: [chart] };
  assert.equal(answer(result, rows, q, [{ rule: 'I3', chart: 'c1' }]).answered, false);
  assert.equal(answer(result, rows, q, [{ rule: 'I8', chart: 'c1' }]).answered, true);
});
