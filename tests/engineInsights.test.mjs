import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard } from '../lib/engine/planner.js';
import { breakdownInsight, trendInsight } from '../lib/engine/insights.js';
import { interpretQuestion } from '../lib/engine/ask.js';
import { readDataset } from '../lib/engine/fields.js';
import { buildMeasures } from '../lib/engine/measures.js';
import { acceptReading, acceptWriting, numbersIn } from '../lib/engine/ai.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const tiles = (board) => board.sections.flatMap((s) => s.tiles);

test('a churn table leads with what drives churn, sized and compared', () => {
  const rand = rng(1);
  const rows = Array.from({ length: 900 }, (_, i) => {
    const contract = ['Month-to-month', 'One year', 'Two year'][i % 3];
    const p = contract === 'Month-to-month' ? 0.4 : contract === 'One year' ? 0.15 : 0.05;
    return { customer_id: `C${i}`, contract_type: contract, plan: ['Basic', 'Pro'][i % 2], tenure_months: Math.floor(rand() * 60), churned: rand() < p ? 'Yes' : 'No' };
  });
  const board = buildDashboard(rows);
  assert.equal(board.kpis[0].title, 'Churn rate');
  const lead = tiles(board).find((t) => t.title === 'Churn rate by contract type');
  assert.ok(lead, tiles(board).map((t) => t.title).join(' | '));
  assert.match(lead.insight, /Month-to-month has the highest churn rate at \d+%, [\d.]+ pts above Two year/);
  assert.match(board.findings[0].text, /Month-to-month/);
});

test('"no difference" is said plainly, and such a chart is not a key finding', () => {
  const rand = rng(2);
  const rows = Array.from({ length: 800 }, (_, i) => ({ region: ['N', 'S', 'E', 'W'][i % 4], price: 100 + rand() * 10 }));
  const m = { id: 'avg:price', label: 'Avg price', type: 'agg', field: 'price', agg: 'avg', format: 'number', additive: false };
  const data = ['N', 'S', 'E', 'W'].map((r) => ({ region: r, 'avg:price': rows.filter((x) => x.region === r).reduce((s, x) => s + x.price, 0) / 200 }));
  const ins = breakdownInsight({ data, x: 'region', ys: ['avg:price'], support: [200, 200, 200, 200], totals: { 'avg:price': 105 } }, m, { rows, dimLabel: 'Region' });
  assert.match(ins.text, /barely differs by region/);
  assert.ok(ins.score < 0.1);
});

test('refunds against sales are not shares of a whole', () => {
  const m = { id: 'sum:amount', label: 'Amount', type: 'agg', field: 'amount', agg: 'sum', format: 'number', additive: true };
  const ins = breakdownInsight({ data: [{ t: 'Sale', 'sum:amount': 750 }, { t: 'Refund', 'sum:amount': -57 }], x: 't', ys: ['sum:amount'], totals: { 'sum:amount': 693 } }, m, { dimLabel: 'Type' });
  assert.match(ins.text, /Refund takes 57 off 750 from Sale/);
  assert.doesNotMatch(ins.text, /108%/);
});

test('a trend says how much it moved, and leaves out an incomplete last period', () => {
  const m = { id: 'rev', label: 'Revenue', format: 'number', importance: 95 };
  const data = Array.from({ length: 12 }, (_, i) => ({ month: `2025-${String(i + 1).padStart(2, '0')}`, rev: 100 + i * 10 }));
  data.push({ month: '2026-01', rev: 20 });
  const ins = trendInsight({ data, x: 'month', ys: ['rev'], support: [...Array(12).fill(100), 10] }, m, { grain: 'month' });
  assert.match(ins.text, /Revenue rose \d+% from Jan 2025 to Dec 2025/);
  assert.match(ins.text, /Jan 2026 is incomplete and left out/);
});

test('questions in plain words become the right chart', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ order_date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-10`, region: ['North', 'South'][i % 2], product: `P${i % 30}`, revenue: 10 + i, units: 1 + (i % 5) }));
  const ds = readDataset(rows);
  const ms = buildMeasures(rows, ds);
  const values = (f) => [...new Set(rows.map((r) => String(r[f])))];
  const ask = (q) => interpretQuestion(q, ds, ms, values);
  assert.equal(ask('revenue by region').tile.kind, 'breakdown');
  assert.equal(ask('revenue by region').tile.dim, 'region');
  assert.equal(ask('how has revenue changed over time').tile.kind, 'trend');
  assert.equal(ask('monthly revenue').tile.grain, 'month');
  const top = ask('top 5 products by revenue').tile;
  assert.equal(top.kind, 'table');
  assert.equal(top.limit, 5);
  assert.equal(ask('revenue vs units').tile.kind, 'relationship');
  assert.equal(ask('distribution of revenue').tile.kind, 'distribution');
  assert.deepEqual(ask('revenue by product in North').tile.filters, [{ field: 'region', values: ['North'] }]);
  assert.equal(ask('average revenue by region').tile.measures[0], 'avg:revenue');
  assert.ok(ask('profit by region').error);
});

test('a model reading is kept only where the table supports it', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ region: ['N', 'S'][i % 2], sales: i, cost: i / 2, note: `x${i}` }));
  const ds = readDataset(rows);
  const r = acceptReading(
    {
      subject: 'Sales by region',
      primary: 'sales',
      dimensions: ['region', 'nonexistent'],
      fixes: [{ column: 'note', role: 'measure' }, { column: 'cost', role: 'measure', agg: 'avg' }],
      measures: [{ label: 'Margin ratio', numerator: 'cost', denominator: 'sales', format: 'percent' }, { label: 'Bad', numerator: 'ghost', denominator: 'sales' }],
    },
    ds
  );
  assert.equal(r.hints.primary, 'sales');
  assert.deepEqual(r.hints.dimensions, ['region']);
  assert.equal(r.overrides.note, undefined);
  assert.deepEqual(r.overrides.cost, { role: 'measure', agg: 'avg' });
  assert.deepEqual(r.custom.map((m) => m.label), ['Margin ratio']);
});

test('a model may only write numbers the engine computed', () => {
  const briefing = { subject: '900 orders', kpis: [{ label: 'Revenue', value: '22.4M', change: '+2.7%', vs: 'vs Nov 2026' }], tiles: [{ id: 't1', title: 'Revenue by region', draft: 'East leads with 26% of revenue (5.8M).' }] };
  const out = acceptWriting(
    { headline: 'Revenue reached 22.4M, up 2.7%.', summary: ['East leads with 26% of revenue.', 'Revenue will grow 40% next year.'], captions: { t1: 'East holds 26% (5.8M).', t2: 'x' } },
    briefing
  );
  assert.equal(out.headline, 'Revenue reached 22.4M, up 2.7%.');
  assert.deepEqual(out.summary, ['East leads with 26% of revenue.']);
  assert.deepEqual(Object.keys(out.captions), ['t1']);
  assert.deepEqual(numbersIn('$1,240 and 3.8× and 12 pts'), ['1240', '3.8×', '12']);
});
