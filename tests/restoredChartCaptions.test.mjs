import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tileInsight } from '../lib/engine/caption.js';

/**
 * Captions for the waterfall and the combo.
 *
 * A waterfall shows a running total, so its caption says what the parts add up
 * to — never "revenue fell", which describes a different chart. A combo shows
 * two measures, so its caption covers both.
 */

const revenue = { id: 'sum:revenue', label: 'Revenue', type: 'agg', field: 'revenue', agg: 'sum', additive: true, format: 'number' };
const orders = { id: 'count', label: 'Orders', type: 'count', additive: true, format: 'number' };
const ds = { fields: [{ name: 'quarter', label: 'Quarter', kind: 'date', role: 'time' }, { name: 'region', label: 'Region', kind: 'text', role: 'dimension' }], byName: {} };

test('a waterfall over time says what it builds to, not how it changed', () => {
  const computed = { x: 'quarter', ys: [revenue.id], data: [
    { quarter: '2025-Q1', [revenue.id]: 400 },
    { quarter: '2025-Q2', [revenue.id]: 300 },
    { quarter: '2025-Q3', [revenue.id]: 200 },
    { quarter: '2025-Q4', [revenue.id]: 100 },
  ] };
  const r = tileInsight([], { kind: 'trend', viz: 'waterfall', dim: 'quarter', grain: 'quarter', measures: [revenue.id] }, computed, ds, [revenue]);
  assert.match(r.text, /^Revenue builds to 1,?000 over 4 quarters/);
  assert.match(r.text, /biggest step up is 2025 Q1/);
  assert.doesNotMatch(r.text, /fell|rose/);
});

test('a waterfall across categories names the biggest part and any that take away', () => {
  const computed = { x: 'region', ys: [revenue.id], data: [
    { region: 'West', [revenue.id]: 500 },
    { region: 'East', [revenue.id]: 200 },
    { region: 'Refunds', [revenue.id]: -150 },
  ] };
  const r = tileInsight([], { kind: 'breakdown', viz: 'waterfall', dim: 'region', measures: [revenue.id] }, computed, ds, [revenue]);
  assert.match(r.text, /^The 3 regions add up to 550/);
  assert.match(r.text, /West adds the most \(\+500\)/);
  assert.match(r.text, /Refunds takes away 150/);
});

test('a combo caption covers both of its measures', () => {
  const data = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06'].map((q, i) => ({ quarter: q, [revenue.id]: 100 + i * 20, [orders.id]: 50 - i * 5 }));
  const computed = { x: 'quarter', ys: [revenue.id, orders.id], data };
  const r = tileInsight([], { kind: 'trend', viz: 'combo', dim: 'quarter', grain: 'month', measures: [revenue.id, orders.id] }, computed, ds, [revenue, orders]);
  assert.ok(r, 'a caption is written');
  assert.match(r.text, /Revenue/);
  assert.match(r.text, /Orders/);
});
