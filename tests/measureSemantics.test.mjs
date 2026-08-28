import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyColumns, deriveMeasures, grainKey } from '../lib/measureSemantics.js';
import { aggregateAlias } from '../lib/aggregateNames.js';
import { planCharts } from '../lib/analystPlanner.js';
import { profileColumns } from '../lib/chartResolver.js';

/**
 * A star schema in miniature, shaped like the store export that motivated all
 * of this: orders as the fact, customers as a dimension carrying its own
 * lifetime total, products as a dimension carrying a price.
 */
const ORDERS = [];
const CUSTOMERS = { C1: { spent: 300, orders: 3 }, C2: { spent: 100, orders: 1 } };
for (const [cid, n] of [['C1', 3], ['C2', 1]]) {
  for (let i = 0; i < n; i++) {
    ORDERS.push({
      Order_ID: `O${ORDERS.length + 1}`,
      Customer_ID: cid,
      Category: i % 2 ? 'Apparel' : 'Electronics',
      Order_Status: i === 2 ? 'Cancelled' : 'Delivered',
      Quantity: i + 1,
      Unit_Price: 50,
      Total_Amount: 100,
      Shipping_Cost: 10,
      // Joined in from customers — repeats on every one of that customer's rows.
      Total_Spent: CUSTOMERS[cid].spent,
      Total_Orders: CUSTOMERS[cid].orders,
    });
  }
}

const PROVENANCE = {
  Order_ID: { table: 'sales' }, Customer_ID: { table: 'sales' }, Category: { table: 'products' },
  Order_Status: { table: 'sales' }, Quantity: { table: 'sales' }, Unit_Price: { table: 'sales' },
  Total_Amount: { table: 'sales' }, Shipping_Cost: { table: 'sales' },
  Total_Spent: { table: 'customers' }, Total_Orders: { table: 'customers' },
};
const ROLES = { sales: 'fact', customers: 'dimension', products: 'dimension' };

const profile = profileColumns(ORDERS);
const ctx = {
  profile,
  provenance: PROVENANCE,
  roles: ROLES,
  cardinality: profile.cardinality,
  rowCount: ORDERS.length,
  columns: Object.keys(ORDERS[0]),
  sample: ORDERS,
};

// ---------------------------------------------------------------------------
// Where a column came from decides what may be done to it
// ---------------------------------------------------------------------------

test('a total arriving from a dimension table is not additive', () => {
  const c = classifyColumns(ctx);
  assert.equal(c.byColumn.Total_Spent.kind, 'preAggregate');
  assert.equal(c.byColumn.Total_Orders.kind, 'preAggregate');
  assert.ok(!c.additive.includes('Total_Spent'));
  assert.match(c.byColumn.Total_Spent.why, /double count/);
});

test('a fact-table total is additive', () => {
  const c = classifyColumns(ctx);
  assert.equal(c.byColumn.Total_Amount.kind, 'additive');
  assert.ok(c.additive.includes('Total_Amount'));
});

test('prices and scores are rates, whatever table they come from', () => {
  const c = classifyColumns(ctx);
  assert.equal(c.byColumn.Unit_Price.kind, 'rate');
});

test('with no data model every column is treated as fact — a single sheet still works', () => {
  const c = classifyColumns({ profile, cardinality: profile.cardinality, rowCount: ORDERS.length });
  assert.ok(c.additive.includes('Total_Amount'));
  assert.ok(c.additive.includes('Total_Spent'), 'nothing says otherwise, so it is summable');
});

test('the transaction key is found in the fact table', () => {
  assert.equal(grainKey(ctx), 'Order_ID');
});

// ---------------------------------------------------------------------------
// Measures the system writes for itself
// ---------------------------------------------------------------------------

test('it derives order value per order, not per row', () => {
  const m = deriveMeasures(ctx).find((x) => x.name === 'Average Order Value');
  assert.ok(m, 'no AOV derived');
  assert.equal(m.expr, 'SUM([Total_Amount]) / COUNT(DISTINCT [Order_ID])');
  assert.equal(m.format, 'currency');
});

test('components become a share of the whole', () => {
  const m = deriveMeasures(ctx).find((x) => x.name === 'Shipping Cost Rate');
  assert.ok(m);
  assert.equal(m.expr, 'SUM([Shipping_Cost]) / SUM([Total_Amount]) * 100');
  assert.equal(m.format, 'percent');
});

test('a status column yields a failure rate named after the levels it counts', () => {
  const m = deriveMeasures(ctx).find((x) => /Cancelled/i.test(x.name));
  assert.ok(m, 'no status rate derived');
  assert.match(m.expr, /CASE WHEN \[Order_Status\] IN \('Cancelled'\)/);
  assert.equal(m.format, 'percent');
});

test('every derived measure aggregates, so it compiles as a measure', async () => {
  const { validateExpression } = await import('../lib/measures.js');
  const columns = Object.keys(ORDERS[0]);
  for (const m of deriveMeasures(ctx)) {
    const v = validateExpression(m.expr, { columns });
    assert.equal(v.ok, true, `${m.name}: ${v.error}`);
  }
});

test('derived measures actually run, and give the per-order answer', async () => {
  const { mountTable, unmountTable, runSql } = await import('../lib/pipeline.js');
  const aov = deriveMeasures(ctx).find((x) => x.name === 'Average Order Value');
  mountTable(ORDERS);
  try {
    const [row] = runSql(`SELECT ${aov.expr} AS v FROM SalesData`);
    // 4 orders of 100 each, over 4 distinct order ids.
    assert.equal(row.v, 100);
  } finally {
    unmountTable();
  }
});

// ---------------------------------------------------------------------------
// What the planner does with it
// ---------------------------------------------------------------------------

test('the planner stops summing the dimension total once it knows the model', () => {
  const blind = planCharts(ORDERS, { max: 8 });
  const aware = planCharts(ORDERS, { max: 8, provenance: PROVENANCE, roles: ROLES });

  const sums = (charts) => charts.filter((c) => /SUM\(\[Total_Spent\]\)/.test(c.sql));
  assert.ok(sums(blind).length > 0, 'the old behaviour should sum it — otherwise this test proves nothing');
  assert.equal(sums(aware).length, 0, 'a dimension pre-aggregate must never be summed');
});

test('the fact measure takes over the headline charts', () => {
  const aware = planCharts(ORDERS, { max: 8, provenance: PROVENANCE, roles: ROLES });
  assert.ok(aware.some((c) => /SUM\(\[Total_Amount\]\)/.test(c.sql)), 'the real revenue column should lead');
});

test('a pre-aggregate is left out of distributions and correlations too', () => {
  const aware = planCharts(ORDERS, { max: 10, provenance: PROVENANCE, roles: ROLES });
  const mentions = aware.filter((c) => /Total_Spent/.test(c.sql));
  assert.equal(mentions.length, 0, 'averaging it over fact rows weights by order count');
});

test('derived measures reach the charts', () => {
  const aware = planCharts(ORDERS, { max: 10, provenance: PROVENANCE, roles: ROLES });
  assert.ok(
    aware.some((c) => /COUNT\(DISTINCT|CASE WHEN/.test(c.sql)),
    'at least one chart should be built on a derived measure'
  );
});

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

test('an aggregate does not repeat a word the column already says', () => {
  assert.equal(aggregateAlias('SUM', 'Total_Amount'), 'Total Amount');
  assert.equal(aggregateAlias('AVG', 'Average_Rating'), 'Average Rating');
  // Only a whole word counts: "Totals" is not "Total".
  assert.equal(aggregateAlias('SUM', 'Totals_Column'), 'Total Totals Column');
  assert.equal(aggregateAlias('SUM', 'Order_Value'), 'Total Order Value');
  assert.equal(aggregateAlias('AVG', 'Total_Spent'), 'Average Total Spent');
});
