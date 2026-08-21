import test from 'node:test';
import assert from 'node:assert/strict';
import { mountTables, unmountTables, runSql, runAnalysis, TABLE } from '../lib/pipeline.js';
import { buildDataModel, buildAnalysisView } from '../lib/dataModel.js';

const t = (name, rows) => ({ name, rows, columns: Object.keys(rows[0] || {}) });

const orders = t(
  'Orders',
  Array.from({ length: 120 }, (_, i) => ({
    order_id: i + 1,
    customer_id: `C${(i % 4) + 1}`,
    revenue: 100 + ((i * 37) % 500),
    month: `2026-0${(i % 6) + 1}`,
  }))
);

const customers = t('Customers', [
  { id: 'C1', region: 'West', tier: 'Enterprise' },
  { id: 'C2', region: 'East', tier: 'SMB' },
  { id: 'C3', region: 'West', tier: 'SMB' },
  { id: 'C4', region: 'North', tier: 'Enterprise' },
]);

test('source sheets stay individually queryable alongside the view', () => {
  const mounted = mountTables({
    tables: { Orders: orders.rows, Customers: customers.rows },
    view: orders.rows,
  });
  try {
    const joined = runSql(
      'SELECT c.[region], SUM(o.[revenue]) AS [Revenue] FROM Orders o LEFT JOIN Customers c ON o.[customer_id] = c.[id] GROUP BY c.[region] ORDER BY [Revenue] DESC'
    );
    assert.equal(joined.length, 3, 'three regions');
    assert.ok(joined[0].Revenue > 0);

    // The old rewrite would have renamed every table reference to SalesData.
    const direct = runSql('SELECT COUNT(*) AS [N] FROM Customers');
    assert.equal(direct[0].N, 4);
  } finally {
    unmountTables(mounted);
  }
});

test('the view name is still matched case-insensitively', () => {
  const mounted = mountTables({ tables: {}, view: orders.rows });
  try {
    const rows = runSql('SELECT COUNT(*) AS [N] FROM salesdata');
    assert.equal(rows[0].N, orders.rows.length);
    assert.equal(TABLE, 'SalesData');
  } finally {
    unmountTables(mounted);
  }
});

test('the full pipeline produces cross-sheet charts from a joined view', () => {
  const byName = { Orders: orders, Customers: customers };
  const model = buildDataModel([orders, customers], { factTable: 'Orders' });
  const view = buildAnalysisView(byName, model);

  assert.ok(view.columns.includes('region'), 'the view must carry the joined dimension');

  const { charts } = runAnalysis(view.rows, {
    tables: { Orders: orders.rows, Customers: customers.rows },
  });

  assert.ok(charts.length > 0);
  const crossSheet = charts.filter((c) =>
    [c.xAxisKey, c.yAxisKey].some((k) => k === 'region' || k === 'tier')
  );
  assert.ok(
    crossSheet.length > 0,
    `expected a chart sliced by a joined column, got: ${charts.map((c) => c.xAxisKey).join(', ')}`
  );

  // Every chart must still total to the fact table's real revenue, not a
  // fanned-out multiple of it.
  const truth = orders.rows.reduce((s, r) => s + r.revenue, 0);
  const byRegion = runSqlOnView(view.rows);
  assert.equal(byRegion, truth, 'joining must not inflate the totals');
});

function runSqlOnView(rows) {
  const mounted = mountTables({ tables: {}, view: rows });
  try {
    return runSql('SELECT SUM([revenue]) AS [Revenue] FROM SalesData')[0].Revenue;
  } finally {
    unmountTables(mounted);
  }
}
