import test from 'node:test';
import assert from 'node:assert/strict';
import { runAnalysis } from '../lib/pipeline.js';
import { profileColumns } from '../lib/chartResolver.js';
import { analyzeChart } from '../lib/insightEngine.js';
import { buildTableModel } from '../lib/tableModel.js';
import { factorOf, suggestQuestions } from '../lib/questionCatalogue.js';
import { headlineFigures } from '../lib/questionCompiler.js';

/* Behaviours fixed before the question-first path replaced the old planner,
   checked again on the path every report is now built by — then five defects
   found testing that path on the ten eval datasets (eval/RESULTS.md). */

const run = (rows, o = {}) => runAnalysis(rows, { maxCharts: 10, ...o });
const titles = (r) => (r.charts || []).filter((c) => c.chart_type !== 'slicer').map((c) => c.title);

/** A seeded generator, so a fixture is the same rows every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/* ── Earlier fixes, on the new path ────────────────────────────────────── */

test('a measure aggregated over bands of itself', () => {
  const rows = Array.from({ length: 300 }, (_, i) => {
    const revenue = 50 + (i % 60) * 900;
    return { region: ['North','South','East','West'][i % 4], revenue, discount_pct: i % 25,
      'Revenue Band': revenue < 10000 ? '< 10000' : revenue < 30000 ? '10000–30000' : '30000+' };
  });
  const r = run(rows);
  const bad = (r.charts || []).filter((c) => /Revenue Band/i.test(String(c.xAxisKey || c.dimension || '')) && /revenue/i.test(String(c.yAxisKey || '')));
  assert.ok(!bad.length, bad.map((c) => c.title).join(' / '));
});

test('a band column read as a date because it says "Monthly"', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ plan: ['Basic','Std'][i % 2], monthly_charge: 20 + (i % 90),
    'Monthly Charge Band': ['< 50','50–100','100+'][i % 3] }));
  const p = profileColumns(rows);
  const t = titles(run(rows)).filter((x) => /over monthly charge band|trend over monthly/i.test(x));
  assert.ok(!p.temporal.length && !t.length, `temporal=${JSON.stringify(p.temporal)} ${t.join('/')}`);
});

test('an hour pulled out of a timestamp is a label', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ reading_ts: `2026-01-01T${String(i % 24).padStart(2,'0')}:30:00Z`,
    'Reading Ts Hour': i % 24, temperature_c: 20 + (i % 9) }));
  const k = (run(rows).kpis || []).map((x) => x.label);
  assert.ok(!k.some((l) => /hour/i.test(l)), JSON.stringify(k));
});

test('sub-month trend grain', () => {
  const start = Date.UTC(2026, 0, 1);
  const rows = Array.from({ length: 3000 }, (_, i) => ({ reading_ts: new Date(start + i * 60000 * 17).toISOString(),
    line: ['A','B'][i % 2], temperature_c: 20 + (i % 9) }));
  const t = titles(run(rows)).filter((x) => /over (month|day|hour)/i.test(x));
  assert.ok(t.length && !t.some((x) => /over month/i.test(x)), JSON.stringify(t));
});

test('refused column charted as neither', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ item: `Item ${i}`, region: ['North','South'][i % 2],
    amount: i % 2 ? `${1 + i},${String(100 + i).slice(0, 3)}.00` : `${1 + i}.${String(200 + i).slice(0, 3)},50`, qty: 1 + (i % 9) }));
  const bad = (run(rows).charts || []).filter((c) => /amount/i.test(String(c.xAxisKey || '')));
  assert.ok(!bad.length, bad.map((c) => c.title).join(' / '));
});

test('a value column meaning something different per key is never pooled across the key', () => {
  const rows = [];
  const inds = [['GDP (current LCU)', 1e12, 5e12], ['Population, total', 8e7, 1.4e9], ['Life expectancy at birth', 55, 84]];
  for (const country of ['Brazil','China','Germany','India']) for (let y = 2014; y <= 2025; y++) for (const [ind, lo, hi] of inds)
    rows.push({ country, year: y, indicator: ind, value: lo + ((y - 2014) / 11) * (hi - lo) });
  const r = run(rows);
  const pooled = (r.charts || []).filter((c) => /value/i.test(String(c.yAxisKey || '')) && !/—|indicator:/i.test(c.title) && !/WHERE[^]*indicator/i.test(c.sql || ''));
  assert.ok(!pooled.length, pooled.map((c) => `${c.title} :: ${c.sql}`).join(' / '));
});

test('a populated measure headlines, not a sparse one', () => {
  const rows = Array.from({ length: 300 }, (_, i) => {
    const row = { site: ['Leeds','Bristol'][i % 2], score: i % 100 };
    for (let f = 1; f <= 20; f++) row[`field_${f}`] = i % 6 === 0 ? (i * f) % 500 : null;
    return row;
  });
  const k = (run(rows).kpis || []).map((x) => x.label);
  assert.ok(k.some((l) => /score/i.test(l)) && !k.some((l) => /field/i.test(l)), JSON.stringify(k));
});

test('a tied top is not reported as a leader', () => {
  const pairs = [['ChatGPT',1e6],['Claude',1e6],['Gemini',1e6],['Copilot',1e6],['Grok',1e6],['Mistral',1e6],['Cohere',1e6],['GitHub',6e5],['xAI',4.3e5],['Le Chat',2.56e5],['Model Vault',1.92e5]];
  const f = analyzeChart({ id: 'c', title: 'Average Context Window by Product', chart_type: 'hbar', xAxisKey: 'Product', yAxisKey: 'Average Context Window',
    dimension: 'Product', measure: 'Context Window', resultData: pairs.map(([p, v]) => ({ Product: p, 'Average Context Window': v })) }, 44);
  assert.ok(!/^ChatGPT leads/.test(f.headline), f.headline);
});

test('thin bars: support counted on the measure', () => {
  const f = analyzeChart({ id: 'c1', title: 'Average Min Seats by Audience', chart_type: 'bar', xAxisKey: 'Audience', yAxisKey: 'Average Min Seats',
    dimension: 'Audience', measure: 'Min Seats', resultData: [{ Audience: 'Enterprise', 'Average Min Seats': 300 },{ Audience: 'Business', 'Average Min Seats': 2 },{ Audience: 'Individual', 'Average Min Seats': 1 }],
    support: { byLabel: { Enterprise: 1, Business: 7, Individual: 31 }, min: 1, max: 31, leader: 1 } }, 44);
  assert.ok(f.metrics.evidence !== 'strong', f.metrics.evidence);
});

/* ── Five defects in the question-first path ───────────────────────────── */

test('a total is not charted against one of its own factors', () => {
  // revenue = units_sold × unit_price: r is high because of the identity.
  const rand = rng(1);
  const rows = Array.from({ length: 400 }, (_, i) => {
    const unit_price = [12, 30, 55, 90][i % 4];
    const units_sold = 1 + Math.floor(rand() * 20);
    return { order_id: `O${i}`, order_date: `2026-0${1 + (i % 9)}-1${i % 10}`, region: ['N', 'S', 'E'][i % 3], unit_price, units_sold, revenue: unit_price * units_sold };
  });
  const model = buildTableModel(rows, { temporal: ['order_date'] });
  const pairs = suggestQuestions(rows, model).filter((q) => q.intent === 'relationship').map((q) => [q.measure, q.other].sort().join('+'));
  assert.ok(!pairs.includes('revenue+units_sold'), JSON.stringify(pairs));
  const scatter = (run(rows).charts || []).filter((c) => c.chart_type === 'scatter' && /revenue/i.test(c.title) && /units sold/i.test(c.title));
  assert.equal(scatter.length, 0, scatter.map((c) => c.title).join(' / '));
});

test('a local-currency quantity is never added or ranked across countries', () => {
  const rows = [];
  const scale = { Brazil: 7e12, India: 2e14, Germany: 3e12, Nigeria: 1.5e14, Japan: 5e14, Chile: 2e14 };
  for (const country of Object.keys(scale)) {
    for (let y = 2014; y <= 2025; y++) {
      rows.push({ country, year: y, indicator: 'GDP (current LCU)', value: scale[country] * (1 + (y - 2014) * 0.05) });
      rows.push({ country, year: y, indicator: 'Population, total', value: 5e7 + (y - 2014) * 1e6 + country.length * 1e7 });
      rows.push({ country, year: y, indicator: 'Life expectancy at birth', value: 60 + country.length + (y - 2014) * 0.2 });
    }
  }
  const r = run(rows);
  for (const c of r.charts || []) {
    if (!/LCU/.test(c.sql || '')) continue;
    // Either one line per country, or not drawn at all.
    assert.ok(/GROUP BY[^]*\[country\]/.test(c.sql) && c.seriesKey === 'country' && c.xAxisKey === 'Year', `${c.title} :: ${c.sql}`);
    const f = (r.perChart || []).find((x) => x.id === c.id);
    assert.ok(!/of the total|leads countries/i.test(f?.headline || ''), f?.headline);
  }
});

test('the best of a thousand pairs of noise is not a relationship', () => {
  const rand = rng(8);
  const rows = Array.from({ length: 300 }, (_, i) => {
    const row = { record_id: `R${i}`, site: ['Leeds', 'Bristol', 'Cardiff', 'York'][i % 4], status: ['Open', 'Closed', 'Pending'][i % 3] };
    for (let f = 1; f <= 50; f++) row[`field_${String(f).padStart(2, '0')}`] = rand() < 0.18 ? Math.round(rand() * 500) : null;
    return row;
  });
  const model = buildTableModel(rows);
  const related = suggestQuestions(rows, model).filter((q) => q.intent === 'relationship' || q.intent === 'ratio');
  assert.deepEqual(related.map((q) => q.text), []);
});

test('a column most rows leave blank does not headline the total cards', () => {
  const rand = rng(3);
  const rows = Array.from({ length: 300 }, (_, i) => ({
    opened_on: `2026-0${1 + (i % 9)}-1${i % 10}`,
    site: ['Leeds', 'Bristol'][i % 2],
    field_01: rand() < 0.17 ? Math.round(rand() * 500) : null,
    units: 1 + (i % 40),
  }));
  const model = buildTableModel(rows, { temporal: ['opened_on'] });
  const questions = [
    { intent: 'trend', measure: 'field_01', over: 'opened_on' },
    { intent: 'trend', measure: 'units', over: 'opened_on' },
  ];
  const labels = headlineFigures(questions, rows, model).map((k) => k.label);
  assert.ok(!labels.some((l) => /field/i.test(l)), JSON.stringify(labels));
  assert.ok(labels.includes('Total Units'), JSON.stringify(labels));
});

test('a total is not split by one of its own factors', () => {
  const rand = rng(7);
  const rows = Array.from({ length: 900 }, (_, i) => {
    const qty = 1 + (i % 6);
    return { order_id: `O${i}`, category: ['Home', 'Toys', 'Garden', 'Books'][i % 4], order_date: `2026-0${1 + (i % 9)}-1${i % 10}`, qty, amount: Math.round(qty * (100 + rand() * 200)) };
  });
  assert.equal(factorOf(rows, 'amount', 'qty'), true);
  assert.equal(factorOf(rows, 'amount', 'category'), false);
  const model = buildTableModel(rows, { temporal: ['order_date'] });
  const bad = suggestQuestions(rows, model).filter((q) => q.intent === 'composition' && q.measure === 'amount' && q.by === 'qty');
  assert.deepEqual(bad.map((q) => q.text), []);
});
