import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ingest } from '../eval/chain.mjs';
import { fuzzCases } from '../eval/fuzz.mjs';
import { buildDashboard } from '../lib/engine/planner.js';
import { allowedViz, computeTile } from '../lib/engine/tiles.js';
import { readDataset } from '../lib/engine/fields.js';
import { buildMeasures } from '../lib/engine/measures.js';

/* Every table in the corpus, and the fuzz tables, get a dashboard that keeps
   the engine's rules. Each rule here is a mistake a dashboard once made. */

const CORPUS = path.join(import.meta.dirname, 'corpus');
const tables = [
  ...fs
    .readdirSync(CORPUS)
    .filter((f) => f.endsWith('.csv'))
    .map((f) => ({ name: f, rows: ingest(fs.readFileSync(path.join(CORPUS, f), 'utf8')).rows })),
  ...fuzzCases()
    .slice(0, 20)
    .map((c) => ({ name: `fuzz:${c.name}`, rows: c.rows })),
];

const BAD_TEXT = /\b(NaN|undefined|null|Infinity)\b|\[object/;

for (const { name, rows } of tables) {
  test(`${name}: a dashboard that keeps the rules`, () => {
    const board = buildDashboard(rows, { name });
    const ds = readDataset(rows, { name });
    const measures = buildMeasures(rows, ds);
    const byId = new Map(board.measures.map((m) => [m.id, m]));
    const tiles = board.sections.flatMap((s) => s.tiles);

    // Something to look at, but not a wall of it.
    assert.ok(tiles.length >= 1, 'no charts');
    assert.ok(tiles.length <= 10, `${tiles.length} charts`);
    assert.ok(board.kpis.length <= 5, `${board.kpis.length} KPIs`);

    for (const t of tiles) {
      // Only chart types the data can be drawn as.
      assert.ok(allowedViz(t, ds, board.measures).includes(t.viz), `${t.title}: ${t.viz} is not allowed`);
      // Every chart has data.
      const c = computeTile(rows, t, ds, board.measures);
      assert.ok(c && (c.data?.length || c.value !== undefined), `${t.title}: no data`);
      // Captions are sentences, not template leftovers.
      assert.ok(!BAD_TEXT.test(t.insight || ''), `${t.title}: "${t.insight}"`);
      assert.ok(!BAD_TEXT.test(t.title), `title "${t.title}"`);
      for (const id of t.measures || []) {
        const m = byId.get(id);
        assert.ok(m, `${t.title}: unknown measure ${id}`);
        // A price in each row's own currency is never compared across rows.
        if (t.kind !== 'trend') assert.ok(!m.local, `${t.title} compares a local-currency measure`);
      }
      // A split never restates the measure's own bands or the outcome itself.
      if (t.kind === 'breakdown' && t.dim) {
        const m = byId.get(t.measures[0]);
        if (m?.type === 'rate') assert.notEqual(m.event.field, t.dim, `${t.title} splits an outcome by itself`);
        if (m?.type === 'agg') assert.notEqual(m.field, t.dim, `${t.title} splits a measure by itself`);
      }
      // A donut is only for a few parts of a whole.
      if (t.viz === 'donut') {
        assert.ok(byId.get(t.measures[0])?.additive, `${t.title}: donut of a non-additive measure`);
        assert.ok((c.data?.length || 0) <= 6, `${t.title}: donut of ${c.data?.length} parts`);
      }
    }
    for (const k of board.kpis) {
      assert.ok(k.formatted && !BAD_TEXT.test(k.formatted), `KPI ${k.title} = ${k.formatted}`);
      for (const id of k.measures || []) assert.ok(!byId.get(id)?.local, `KPI ${k.title} is a local-currency figure`);
    }
    for (const f of board.findings) assert.ok(!BAD_TEXT.test(f.text), f.text);
    assert.equal(measures.length, board.measures.length);
  });
}

test('the planner is quick on a quarter of a million rows', () => {
  const rows = Array.from({ length: 250000 }, (_, i) => ({
    date: `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    store: `Store ${i % 40}`,
    category: ['A', 'B', 'C', 'D', 'E'][i % 5],
    units: 1 + (i % 9),
    revenue: (1 + (i % 9)) * (5 + (i % 13)),
  }));
  const t0 = Date.now();
  const board = buildDashboard(rows);
  const ms = Date.now() - t0;
  assert.ok(board.sections.length > 0);
  assert.ok(ms < 20000, `${ms} ms`);
});

/* An order log joined to its customers: each order row repeats the customer's
   birth date and lifetime order count. Those describe the customer, not the
   order — the time axis is the order date, and the lifetime count is neither
   summed nor divided by. */
function orderLog({ even = false } = {}) {
  let s = 11;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const customers = Array.from({ length: 600 }, (_, i) => ({ id: `C${1000 + i}`, dob: `${1950 + (i % 50)}-0${1 + (i % 9)}-1${i % 9}`, total: 1 + (i % 30), tier: ['Gold', 'Silver', 'Platinum'][i % 3] }));
  return Array.from({ length: 6000 }, (_, i) => {
    const c = customers[Math.floor(r() * customers.length)];
    const items = 1 + (i % 5);
    return {
      order_id: `O${i}`,
      order_date: `2006-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
      customer_id: c.id,
      date_of_birth: c.dob,
      total_orders: c.total,
      customer_tier: c.tier,
      order_value: even ? 100 + (i % 40) : +(items * Math.exp(2 + r() * 4)).toFixed(2),
      shipping_cost: +(4 + items * 1.5).toFixed(2),
    };
  });
}

test('columns that describe the customer are not read as the order', () => {
  const board = buildDashboard(orderLog());
  assert.equal(board.ds.time, 'order_date');
  const labels = board.measures.map((m) => m.label).join(' | ');
  assert.doesNotMatch(labels, /per total order/i);
  assert.ok(!board.kpis.some((k) => /total orders/i.test(k.title)), board.kpis.map((k) => k.title).join(' | '));
});

test('a spread chart appears only when the spread says something', () => {
  const vizOf = (b) => b.sections.flatMap((x) => x.tiles).map((t) => t.viz);
  assert.ok(vizOf(buildDashboard(orderLog())).includes('histogram'));
  assert.ok(!vizOf(buildDashboard(orderLog({ even: true }))).includes('histogram'));
});
