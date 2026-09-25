import test from 'node:test';
import assert from 'node:assert/strict';
import { readDataset, labelOf, positiveLevel } from '../lib/engine/fields.js';
import { buildMeasures, rateNoun, singular } from '../lib/engine/measures.js';

const role = (ds, name) => ds.byName[name];

function orders(n = 300) {
  return Array.from({ length: n }, (_, i) => ({
    order_id: `O-${1000 + i}`,
    order_date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    region: ['North', 'South', 'East', 'West'][i % 4],
    customer_id: `C-${i % 60}`,
    units: 1 + (i % 7),
    unit_price: [10, 25, 40][i % 3],
    revenue: (1 + (i % 7)) * [10, 25, 40][i % 3],
    discount_pct: (i % 10) / 100,
  }));
}

test('an order log: dates, ids, categories, totals and averages', () => {
  const ds = readDataset(orders());
  assert.equal(ds.shape, 'events');
  assert.equal(ds.time, 'order_date');
  assert.deepEqual(ds.key, ['order_id']);
  assert.equal(ds.noun.many, 'orders');
  assert.equal(role(ds, 'order_id').role, 'id');
  assert.equal(role(ds, 'region').role, 'dimension');
  assert.equal(role(ds, 'revenue').agg, 'sum');
  assert.equal(role(ds, 'revenue').format, 'currency');
  assert.equal(role(ds, 'unit_price').agg, 'avg');
  assert.equal(role(ds, 'discount_pct').format, 'percent');
  assert.equal(role(ds, 'discount_pct').scale, 1);
  assert.deepEqual(ds.entityIds, ['customer_id']);
});

test('measures an analyst would derive: revenue per order, per unit, distinct customers', () => {
  const rows = orders();
  const ms = buildMeasures(rows, readDataset(rows));
  const labels = ms.map((m) => m.label);
  assert.equal(ms[0].label, 'Revenue');
  assert.ok(labels.includes('Revenue per order'), labels.join(', '));
  assert.ok(labels.includes('Revenue per unit'), labels.join(', '));
  assert.ok(labels.includes('Customers'), labels.join(', '));
});

test('a table of customers with a churn flag: entities, and the flag as an outcome', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    customer_id: `C${i}`,
    plan: ['Basic', 'Pro'][i % 2],
    tenure_months: i % 60,
    monthly_charge: 20 + (i % 50),
    churned: i % 5 === 0 ? 'Yes' : 'No',
  }));
  const ds = readDataset(rows);
  assert.equal(ds.shape, 'entities');
  assert.deepEqual(ds.outcomes, ['churned']);
  const rate = buildMeasures(rows, ds)[0];
  assert.equal(rate.type, 'rate');
  assert.equal(rate.label, 'Churn rate');
  assert.equal(rate.event.value, 'Yes');
});

test('a status whose rare level is a problem is an outcome named for the level', () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({ ts: `2026-01-01T${String(i % 24).padStart(2, '0')}:00:00Z`, sensor: `S${i % 5}`, status: i % 25 === 0 ? 'FAULT' : 'OK', temp: 20 + (i % 7) }));
  const ds = readDataset(rows);
  assert.deepEqual(ds.outcomes, ['status']);
  assert.equal(buildMeasures(rows, ds).find((m) => m.type === 'rate').label, 'Fault rate');
});

test('many yes/no columns in a table of priced offers are features, not outcomes', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ plan: `P${i}`, price_usd: 10 + i * 5, sso: i % 2 ? 'Yes' : 'No', api: i % 3 ? 'Yes' : 'No', audit_logs: i % 4 ? 'Yes' : 'No' }));
  assert.deepEqual(readDataset(rows).outcomes, []);
});

test('a rank column orders things; it is not a measure', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ plan: `P${i}`, plan_rank: 1 + (i % 5), price: 10 + i }));
  const f = readDataset(rows).byName.plan_rank;
  assert.equal(f.role, 'dimension');
  assert.equal(f.ordinal, true);
});

test('prices beside a currency column are local and never compared across rows', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ sku: `S${i}`, currency: ['USD', 'INR', 'EUR'][i % 3], price_local: [10, 830, 9][i % 3] * (1 + i / 10), price_usd: 10 * (1 + i / 10) }));
  const ds = readDataset(rows);
  assert.equal(ds.byName.price_local.local, true);
  assert.ok(!ds.byName.price_usd.local);
});

test('a long table: one value column holding several quantities', () => {
  const rows = [];
  for (const c of ['A', 'B', 'C']) for (let y = 2015; y <= 2024; y++) {
    rows.push({ country: c, year: y, indicator: 'GDP (current LCU)', value: 1e12 * (1 + (y - 2015) / 10) });
    rows.push({ country: c, year: y, indicator: 'Population, total', value: 5e7 + y });
  }
  const ds = readDataset(rows);
  assert.equal(ds.shape, 'long');
  assert.equal(ds.long.by, 'indicator');
  assert.equal(ds.long.shared, false);
  assert.equal(ds.time, 'year');
  const levels = buildMeasures(rows, ds).filter((m) => m.origin === 'long');
  assert.equal(levels.find((m) => /LCU/.test(m.label)).local, true);
});

test('a survey: several columns on one small scale', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ respondent_id: `R${i}`, team: ['A', 'B'][i % 2], q1_ease: 1 + (i % 5), q2_speed: 1 + ((i * 3) % 5), q3_support: 1 + ((i * 7) % 5), q4_value: 1 + ((i * 2) % 5) }));
  const ds = readDataset(rows);
  assert.equal(ds.shape, 'survey');
  assert.equal(ds.byName.q4_value.format, 'number');
  assert.equal(ds.byName.q4_value.agg, 'avg');
});

test('the reader can correct a reading', () => {
  const ds = readDataset(orders(), { overrides: { units: { role: 'dimension' } } });
  assert.equal(ds.byName.units.role, 'dimension');
  assert.equal(ds.byName.units.overridden, true);
});

test('names read as a person writes them', () => {
  assert.equal(labelOf('units_sold'), 'Units sold');
  assert.equal(labelOf('monthly_price_usd'), 'Monthly price USD');
  assert.equal(labelOf('AI_Exposure_Index'), 'AI exposure index');
  assert.equal(rateNoun('Converted'), 'conversion');
  assert.equal(singular('Units sold'), 'unit');
  assert.equal(positiveLevel(['M', 'F'], 'sex'), null);
  assert.equal(positiveLevel(['N', 'Y'], 'improved'), 'Y');
});
