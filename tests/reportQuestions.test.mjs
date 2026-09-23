import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTableModel } from '../lib/tableModel.js';
import { suggestQuestions, bandingOf } from '../lib/questionCatalogue.js';
import { compileQuestion, headlineFigures } from '../lib/questionCompiler.js';
import { runAnalysis } from '../lib/pipeline.js';

/* The question planner: lib/questionCatalogue.js proposes questions from the
 * table model, lib/questionCompiler.js turns each into charts that cannot
 * break the rules in docs/design/question-first-reports.md. eval/scorecard.mjs
 * scores both end to end; these pin each rule on a table small enough to see
 * why, and several are readings the planner once got wrong. */

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const day = (i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
const plan = (rows, options = {}) => {
  const model = buildTableModel(rows, { temporal: options.temporal || [] });
  return { model, questions: suggestQuestions(rows, model, options) };
};
const specsFor = (rows, model, q) => compileQuestion(q, rows, model);

/* ── The catalogue ─────────────────────────────────────────────────────── */

test('an unnamed yes/no column that other columns move is an outcome, by its strongest driver', () => {
  const rows = range(400, (i) => {
    const variant = i % 2 ? 'B' : 'A';
    const device = ['Desktop', 'Mobile', 'Tablet'][i % 3];
    const converted = variant === 'B' ? i % 5 === 0 : i % 13 === 0;
    return { visitor: `V${i}`, variant, device, converted: converted ? 'true' : 'false' };
  });
  const { questions } = plan(rows);
  const rates = questions.filter((q) => q.intent === 'outcome-rate' && q.by);
  assert.equal(rates[0]?.outcome.column, 'converted');
  assert.equal(rates[0]?.by, 'variant');
});

test('a driver that is the outcome restated is not a driver', () => {
  // Revenue is non-zero exactly when the visitor converted: it separates the
  // outcome perfectly, and a chart of one against the other is a definition.
  const rows = range(400, (i) => {
    const converted = i % 4 === 0;
    return { visitor: `V${i}`, variant: i % 2 ? 'B' : 'A', converted: converted ? 'Y' : 'N', revenue: converted ? 20 + (i % 50) : 0 };
  });
  const { questions } = plan(rows);
  assert.ok(!questions.some((q) => q.intent === 'outcome-rate' && q.by === 'revenue'));
});

test('yes/no columns of a priced table are what it includes, not outcomes', () => {
  // SSO follows the tier exactly as an outcome would follow its driver — and
  // is still a feature, because the table is a price list.
  const rows = range(30, (i) => ({
    vendor: `V${i % 5}`,
    plan: `P${Math.floor(i / 5)}`,
    tier: ['Starter', 'Team', 'Business'][Math.floor(i / 10)],
    price: 10 + i * 7,
    storage: 100 + i * 3,
    sso: i >= 10 && (i % 4 || i >= 20) ? 'Yes' : 'No',
  }));
  const { questions } = plan(rows);
  assert.ok(!questions.some((q) => q.intent === 'outcome-rate'));
  assert.ok(questions.some((q) => q.intent === 'tradeoff' && q.cost === 'price'));
});

test('a charge per customer is a flow, and gets no "most for the money" question', () => {
  const rows = range(60, (i) => ({ customer: `C${i}`, region: `R${i % 3}`, monthly_charge: 40 + (i % 9) * 5, tenure_months: 1 + (i % 30) }));
  assert.ok(!plan(rows).questions.some((q) => q.intent === 'tradeoff'));
});

test('a category cut from the measure itself is not a split of it', () => {
  const rows = range(90, (i) => {
    const p = (i % 90) / 100;
    return { job: `J${i % 9}`, risk: p < 0.3 ? 'Low' : p < 0.6 ? 'Medium' : 'High', probability: p };
  });
  assert.equal(bandingOf(rows, 'probability', 'risk'), true);
  assert.equal(bandingOf(rows, 'probability', 'job'), false);
});

test('the coarser split wins when it explains nearly as much', () => {
  // Price per square foot is set by city; neighbourhoods sit inside cities and
  // add only noise.
  const rows = range(200, (i) => {
    const city = ['Austin', 'Denver', 'Seattle', 'Phoenix'][i % 4];
    const base = { Austin: 420, Denver: 510, Seattle: 690, Phoenix: 330 }[city];
    return { listing: `L${i}`, city, neighbourhood: `${city} ${i % 5}`, price_per_sqft: base + ((i * 37) % 21) - 10 };
  });
  const compare = plan(rows).questions.find((q) => q.intent === 'compare' && q.measure === 'price_per_sqft');
  assert.equal(compare?.by, 'city');
});

/* ── The compiler ──────────────────────────────────────────────────────── */

test('a scoped price is compared within one level of its scope, and the heading says which', () => {
  const rows = range(24, (i) => ({
    provider: `P${i % 4}`,
    plan: `T${Math.floor(i / 4)}`,
    buyer_unit: i % 3 ? 'user' : 'instance',
    price_usd: i % 3 ? 20 + i : 2500 + i,
  }));
  const { model } = plan(rows);
  const [spec] = specsFor(rows, model, { id: 'q', intent: 'compare', measure: 'price_usd', by: 'provider', mean: true });
  assert.match(spec.sql, /WHERE \[buyer_unit\] = 'user'/);
  assert.match(spec.title, / — Buyer Unit: user$/);
});

test('a split the scope leaves with one group is not drawn', () => {
  const rows = range(24, (i) => ({
    provider: `P${i % 4}`,
    plan: `T${Math.floor(i / 4)}`,
    audience: i % 3 ? 'Individual' : 'Business',
    buyer_unit: i % 3 ? 'user' : 'instance',
    price_usd: i % 3 ? 20 + i : 2500 + i,
  }));
  const { model } = plan(rows);
  assert.deepEqual(specsFor(rows, model, { id: 'q', intent: 'compare', measure: 'price_usd', by: 'audience', mean: true }), []);
});

test('a level is split at the latest period and trended by the period it was recorded at', () => {
  const rows = [];
  const stock = { A: 300, B: 500, C: 200 };
  // Twenty weeks: long enough that a month axis has points to draw, which is
  // exactly what makes bucketing a level by month tempting.
  for (let w = 0; w < 20; w++) for (const sku of ['A', 'B', 'C']) {
    stock[sku] += ((w * 7 + sku.charCodeAt(0)) % 41) - 20;
    rows.push({ week: day(w * 7), sku, warehouse: sku === 'C' ? 'Reno' : 'Leeds', stock_on_hand: stock[sku] });
  }
  const { model } = plan(rows, { temporal: ['week'] });
  const [split] = specsFor(rows, model, { id: 'q', intent: 'composition', measure: 'stock_on_hand', by: 'warehouse' });
  assert.match(split.sql, /WHERE \[week\] = '2026-05-14/);
  const [trend] = specsFor(rows, model, { id: 't', intent: 'trend', measure: 'stock_on_hand', over: 'week' });
  assert.match(trend.sql, /SUBSTRING\(\[week\], 1, 10\)/, 'weekly stock bucketed by month adds four weeks of the same units');
});

test('a median wherever one row would decide the average', () => {
  const rows = range(40, (i) => ({ id: `R${i}`, city: i % 2 ? 'Austin' : 'Denver', price: i === 7 ? 45_000_000 : 400_000 + i * 1000 }));
  const { model } = plan(rows);
  const [spec] = specsFor(rows, model, { id: 'q', intent: 'compare', measure: 'price', by: 'city', mean: true });
  assert.match(spec.sql, /MEDIAN\(\[price\]\)/);
  assert.equal(spec.baselineWord, 'median');
});

test('budget and actual are split, as series when they share a scale and apart when not', () => {
  const shared = [];
  for (const dept of ['Ops', 'Sales', 'HR']) for (const m of [1, 2, 3, 4]) {
    shared.push({ dept, month: `2026-0${m}`, scenario: 'Budget', amount: 1000 });
    shared.push({ dept, month: `2026-0${m}`, scenario: 'Actual', amount: 950 + m * 10 });
  }
  let { model } = plan(shared);
  const [series] = specsFor(shared, model, { id: 'q', intent: 'compare', measure: 'amount', by: 'dept' });
  assert.equal(series.seriesKey, 'scenario');

  const apart = [];
  for (const country of ['A', 'B', 'C']) for (const year of [2020, 2021, 2022]) {
    apart.push({ country, year, indicator: 'GDP', value: 1e9 * (1 + year - 2020) });
    apart.push({ country, year, indicator: 'Life expectancy', value: 70 + year - 2020 });
  }
  ({ model } = plan(apart));
  const charts = specsFor(apart, model, { id: 'q', intent: 'compare', measure: 'value', by: 'country' });
  assert.equal(charts.length, 2);
  for (const c of charts) assert.match(c.sql, /WHERE \[indicator\] = /);
});

test('a numeric split keeps its order', () => {
  const rows = range(300, (i) => ({ customer: `C${i}`, support_calls: i % 6, churned: i % 6 >= 4 || i % 11 === 0 ? 'Yes' : 'No' }));
  const { model } = plan(rows);
  const outcome = { column: 'churned', event: 'Yes', kind: 'binary', highIsGood: false };
  const [spec] = specsFor(rows, model, { id: 'q', intent: 'outcome-rate', outcome, by: 'support_calls' });
  assert.equal(spec.ordered, true);
  assert.deepEqual(spec.sortLabels, ['0', '1', '2', '3', '4', '5']);
  assert.match(spec.sql, /ORDER BY \[support_calls\] ASC/);
});

test('a scatter names its points, so it is read as a relationship', () => {
  const rows = range(40, (i) => ({ student: `S${i}`, attendance: 80 + (i % 20), math: 50 + i }));
  const { model } = plan(rows);
  const [spec] = specsFor(rows, model, { id: 'q', intent: 'relationship', measure: 'math', other: 'attendance' });
  assert.match(spec.sql, /^SELECT \[student\] AS \[student\], \[attendance\], \[math\]/);
});

test('headline figures: none for a scoped measure, a median where one row decides', () => {
  const rows = range(40, (i) => ({
    id: `R${i}`,
    city: i % 2 ? 'Austin' : 'Denver',
    buyer_unit: i % 3 ? 'user' : 'org',
    fee: i % 3 ? 20 + i : 2000 + i,
    price: i === 7 ? 45_000_000 : 400_000 + i * 1000,
  }));
  const { model } = plan(rows);
  const kpis = headlineFigures(
    [
      { intent: 'compare', measure: 'fee', by: 'city', mean: true },
      { intent: 'compare', measure: 'price', by: 'city', mean: true },
    ],
    rows,
    model
  );
  const labels = kpis.map((k) => k.label);
  assert.ok(!labels.some((l) => /Fee/.test(l)), `a fee per user beside a fee per org has no single headline: ${labels}`);
  assert.ok(labels.includes('Median Price'));
});

/* ── End to end ────────────────────────────────────────────────────────── */

test('the KPI and every "average over all records" in the deck are one number', () => {
  const rows = range(600, (i) => {
    const contract = ['Month-to-month', 'One year', 'Two year'][i % 3];
    const churned = contract === 'Month-to-month' ? i % 2 === 0 : i % 7 === 0;
    return { customer_id: `C${i}`, contract_type: contract, region: `R${i % 4}`, tenure_months: 1 + (i % 48), churned: churned ? 'Yes' : 'No' };
  });
  const result = runAnalysis(rows);
  const kpi = result.kpis.find((k) => /Churn Rate/.test(k.label));
  assert.ok(kpi, 'a churn rate headline');
  const stated = result.perChart
    .map((f) => /the ([\d.]+)% average over all records/.exec(f.headline || '')?.[1])
    .filter(Boolean);
  assert.ok(stated.length, 'at least one sentence compares with the overall rate');
  for (const s of stated) assert.equal(`${s}%`, kpi.value);
});

/* ── The question card (phase 3) ───────────────────────────────────────── */

const churnTable = () =>
  range(600, (i) => {
    const contract = ['Month-to-month', 'One year', 'Two year'][i % 3];
    const churned = contract === 'Month-to-month' ? i % 2 === 0 : i % 7 === 0;
    return { customer_id: `C${i}`, contract_type: contract, region: `R${i % 4}`, tenure_months: 1 + (i % 48), churned: churned ? 'Yes' : 'No' };
  });

test('a report answers the questions it was given, and says which', () => {
  const rows = churnTable();
  const offered = runAnalysis(rows).questions;
  const picked = offered.filter((q) => q.intent === 'outcome-rate' && q.by === 'region');
  assert.equal(picked.length, 1, 'the catalogue offers churn by region');

  const result = runAnalysis(rows, { questions: picked });
  assert.deepEqual(result.asked.map((q) => q.id), picked.map((q) => q.id));
  const findings = result.charts.filter((c) => c.chart_type !== 'slicer');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].question.id, picked[0].id);
});

test('a question in the reader’s own words is drawn as they asked it', () => {
  const rows = churnTable();
  const spec = {
    title: 'Average tenure by region',
    chart_type: 'bar',
    sql: 'SELECT [region], AVG([tenure_months]) AS [Average Tenure] FROM SalesData GROUP BY [region]',
    xAxisKey: 'region',
    yAxisKey: 'Average Tenure',
  };
  const result = runAnalysis(rows, { questions: [{ id: 'custom|x', intent: 'custom', text: 'average tenure by region', spec }] });
  const [chart] = result.charts.filter((c) => c.chart_type !== 'slicer');
  assert.equal(chart.question.text, 'average tenure by region');
  assert.equal(chart.resultData.length, 4);
});

test('the card offers more than it recommends, and never pre-ticks the tail', () => {
  const { questions } = plan(churnTable());
  const recommended = questions.filter((q) => q.recommended);
  assert.ok(recommended.length > 0 && recommended.length <= 8);
  assert.ok(questions.length > recommended.length, 'nothing offered beyond the recommended set');
  // Recommended first: a reader sees the pre-ticked ones before the tail.
  const firstTail = questions.findIndex((q) => !q.recommended);
  assert.ok(questions.slice(firstTail).every((q) => !q.recommended));
});

test('every question is phrased for any outcome, not one domain', () => {
  const { questions } = plan(churnTable());
  const headline = questions.find((q) => q.intent === 'outcome-rate' && !q.by);
  assert.equal(headline.text, 'How often is Churned “Yes”?');
});
