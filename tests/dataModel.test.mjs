import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTableName,
  nameAffinity,
  joinKey,
  profileKeys,
  inferRelationships,
  chooseFactTable,
  buildDataModel,
  buildAnalysisView,
} from '../lib/dataModel.js';

const asTable = (name, rows, extra = {}) => ({
  name,
  rows,
  columns: Object.keys(rows[0] || {}),
  ...extra,
});

const orders = asTable('Orders', [
  { order_id: 1, customer_id: 'C1', product_id: 10, revenue: 100, qty: 2 },
  { order_id: 2, customer_id: 'C2', product_id: 11, revenue: 250, qty: 1 },
  { order_id: 3, customer_id: 'C1', product_id: 10, revenue: 75, qty: 3 },
  { order_id: 4, customer_id: 'C3', product_id: 12, revenue: 410, qty: 5 },
]);

const customers = asTable('Customers', [
  { id: 'C1', name: 'Acme', region: 'West' },
  { id: 'C2', name: 'Globex', region: 'East' },
  { id: 'C3', name: 'Initech', region: 'West' },
]);

const products = asTable('Products', [
  { product_id: 10, category: 'Widgets', unit_cost: 12.5 },
  { product_id: 11, category: 'Gadgets', unit_cost: 40 },
  { product_id: 12, category: 'Widgets', unit_cost: 8 },
]);

// ---------------------------------------------------------------------------
// Naming and key canonicalisation
// ---------------------------------------------------------------------------

test('sheet names become unique SQL-safe identifiers', () => {
  const taken = new Set();
  const a = normalizeTableName('Q1 Orders (final).xlsx', taken);
  taken.add(a);
  const b = normalizeTableName('Q1 Orders (final)', taken);
  assert.equal(a, 'Q1_Orders_final');
  assert.equal(b, 'Q1_Orders_final_2', 'a duplicate sheet name must not collide');
  assert.equal(normalizeTableName('2024 Sales'), 'T_2024_Sales', 'must not start with a digit');
  assert.equal(normalizeTableName('   '), 'Sheet');
});

test('ids match across sheets even when Excel typed them differently', () => {
  assert.equal(joinKey(1001), joinKey('1001'));
  assert.equal(joinKey('1001.0'), joinKey(1001));
  assert.equal(joinKey(' Acme '), joinKey('ACME'));
  assert.equal(joinKey(''), null);
  assert.equal(joinKey(null), null);
});

test('name affinity ranks a real foreign key above a coincidence', () => {
  assert.ok(nameAffinity('customer_id', 'Customers', 'id') >= 0.9);
  assert.ok(nameAffinity('customer_id', 'Customers', 'customer_id') === 1);
  assert.equal(nameAffinity('revenue', 'Customers', 'id'), 0);
});

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

test('a float column is never treated as a join key', () => {
  const stats = profileKeys(products.rows, products.columns);
  assert.equal(stats.unit_cost.keyable, false);
  assert.equal(stats.product_id.keyable, true);
  assert.equal(stats.product_id.unique, true);
});

test('foreign keys are found across three sheets', () => {
  const { relationships, warnings } = inferRelationships([orders, customers, products]);
  const ids = relationships.map((r) => `${r.from.table}.${r.from.column}->${r.to.table}.${r.to.column}`);

  assert.ok(ids.includes('Orders.customer_id->Customers.id'), `got ${ids.join(', ')}`);
  assert.ok(ids.includes('Orders.product_id->Products.product_id'), `got ${ids.join(', ')}`);
  assert.equal(warnings.length, 0);
  for (const r of relationships) {
    assert.equal(r.cardinality, 'many-to-one');
    assert.ok(r.confidence >= 0.55);
  }
});

test('a measure is not joined to a lookup just because the numbers overlap', () => {
  // `qty` values (1,2,3,5) sit inside Lookup.code (1..6) with full containment,
  // but nothing about the names says these are related.
  const lookup = asTable('Lookup', [
    { code: 1, label: 'a' },
    { code: 2, label: 'b' },
    { code: 3, label: 'c' },
    { code: 4, label: 'd' },
    { code: 5, label: 'e' },
    { code: 6, label: 'f' },
  ]);
  const { relationships } = inferRelationships([orders, lookup]);
  assert.ok(
    !relationships.some((r) => r.from.column === 'qty'),
    'a plain measure must never become a foreign key'
  );
});

test('many-to-many links are reported, never joined', () => {
  const enrolments = asTable('Enrolments', [
    { student_id: 'S1', course_id: 'X1' },
    { student_id: 'S1', course_id: 'X2' },
    { student_id: 'S2', course_id: 'X1' },
  ]);
  const attendance = asTable('Attendance', [
    { student_id: 'S1', day: '2026-01-01' },
    { student_id: 'S1', day: '2026-01-02' },
    { student_id: 'S2', day: '2026-01-01' },
  ]);
  const { relationships, warnings } = inferRelationships([enrolments, attendance]);

  assert.equal(relationships.length, 0, 'neither side is unique, so there is no usable join');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].kind, 'many-to-many');
  assert.match(warnings[0].message, /multiply every total/);
});

test('the fact table is the one holding the measures and the keys', () => {
  const { relationships } = inferRelationships([customers, products, orders]);
  assert.equal(chooseFactTable([customers, products, orders], relationships), 'Orders');
});

// ---------------------------------------------------------------------------
// The joined view
// ---------------------------------------------------------------------------

test('the joined view widens the fact table without changing its row count', () => {
  const tables = [orders, customers, products];
  const byName = Object.fromEntries(tables.map((t) => [t.name, t]));
  const model = buildDataModel(tables);
  const view = buildAnalysisView(byName, model);

  assert.equal(view.rows.length, orders.rows.length, 'a many-to-one join must never fan out');
  assert.ok(view.columns.includes('region'), 'Customers.region should be analysable');
  assert.ok(view.columns.includes('category'), 'Products.category should be analysable');
  assert.equal(view.rows[0].region, 'West');
  assert.equal(view.rows[1].category, 'Gadgets');
  assert.equal(view.rows[0].revenue, 100, 'fact measures survive untouched');

  // Totals are the point of the fan-out guarantee.
  const total = view.rows.reduce((s, r) => s + r.revenue, 0);
  assert.equal(total, 835);
});

test('colliding column names are disambiguated by table', () => {
  const a = asTable('Sales', [
    { sale_id: 1, rep_id: 'R1', name: 'Deal A', amount: 10 },
    { sale_id: 2, rep_id: 'R2', name: 'Deal B', amount: 20 },
  ]);
  const b = asTable('Reps', [
    { rep_id: 'R1', name: 'Dana', team: 'North' },
    { rep_id: 'R2', name: 'Sam', team: 'South' },
  ]);
  const byName = { Sales: a, Reps: b };
  const model = buildDataModel([a, b], { factTable: 'Sales' });
  const view = buildAnalysisView(byName, model);

  assert.equal(view.rows[0].name, 'Deal A', 'the fact table keeps the plain name');
  assert.equal(view.rows[0]['Reps.name'], 'Dana', 'the joined one is prefixed');
  assert.equal(view.provenance['Reps.name'].table, 'Reps');
});

test('unmatched keys become nulls rather than dropping the row', () => {
  const withOrphan = asTable('Orders', [
    ...orders.rows,
    { order_id: 5, customer_id: 'C9', product_id: 10, revenue: 60, qty: 1 },
  ]);
  const byName = { Orders: withOrphan, Customers: customers };
  const model = buildDataModel([withOrphan, customers], { factTable: 'Orders' });
  const view = buildAnalysisView(byName, model);

  assert.equal(view.rows.length, 5, 'the orphan row is kept');
  assert.equal(view.rows[4].region, null);
  assert.ok(view.joins[0].matchRate < 1 && view.joins[0].matchRate > 0.5);
});

test('a chain of joins is followed from the fact table outward', () => {
  const regions = asTable('Regions', [
    { region: 'West', manager: 'Lee' },
    { region: 'East', manager: 'Kim' },
  ]);
  const tables = [orders, customers, regions];
  const byName = Object.fromEntries(tables.map((t) => [t.name, t]));
  const model = buildDataModel(tables, { factTable: 'Orders' });
  const view = buildAnalysisView(byName, model);

  assert.equal(view.rows.length, orders.rows.length);
  assert.equal(view.rows[0].manager, 'Lee', 'Orders → Customers → Regions');
});

test('a single sheet still produces a usable model', () => {
  const model = buildDataModel([orders]);
  assert.equal(model.factTable, 'Orders');
  assert.equal(model.relationships.length, 0);
  const view = buildAnalysisView({ Orders: orders }, model);
  assert.equal(view.rows.length, orders.rows.length);
  assert.deepEqual(view.columns, orders.columns);
});
