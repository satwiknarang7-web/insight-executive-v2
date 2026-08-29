import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureDependence } from '../lib/chartSignals.js';
import { planCharts } from '../lib/analystPlanner.js';

/* What the deck refuses to say.

   Written from a real report: it recommended testing whether moving average
   revenue shifts average unit price, on the strength of r = 0.79 between them.
   Revenue is unit price times quantity, so that correlation is arithmetic and
   the recommendation is an experiment on a multiplication. */

/** Sales rows where Revenue really is Unit_Price x Quantity. */
function sales(n = 400) {
  const cats = ['Electronics', 'Sports', 'Fashion', 'Books', 'Home'];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const price = 10 + ((i * 37) % 90);
    const qty = 1 + ((i * 13) % 9);
    rows.push({
      Product_Category: cats[i % cats.length],
      Region: ['North', 'South', 'East', 'West'][i % 4],
      Unit_Price: price,
      Quantity: qty,
      Revenue: price * qty,
      Satisfaction: 1 + ((i * 7) % 5),
    });
  }
  return rows;
}

const columns = ['Unit_Price', 'Quantity', 'Revenue', 'Satisfaction'];

test('a total against one of its own factors is dependence, not correlation', () => {
  const rows = sales();
  const both = measureDependence(rows, 'Revenue', 'Unit_Price', columns);
  assert.equal(both.dependent, true);
  assert.equal(both.kind, 'product');
  assert.equal(both.via, 'Quantity', 'and it names the third column');

  // The same holds the other way round and for the other factor.
  assert.equal(measureDependence(rows, 'Unit_Price', 'Revenue', columns).dependent, true);
  assert.equal(measureDependence(rows, 'Revenue', 'Quantity', columns).dependent, true);
});

test('a column that is a rescaling of another is dependence too', () => {
  const rows = sales().map((r) => ({ ...r, Revenue_K: r.Revenue / 1000 }));
  const found = measureDependence(rows, 'Revenue', 'Revenue_K', [...columns, 'Revenue_K']);
  assert.equal(found.dependent, true);
  assert.equal(found.kind, 'scale');
});

test('genuinely independent measures are left alone', () => {
  const rows = sales();
  for (const [a, b] of [
    ['Unit_Price', 'Quantity'],
    ['Unit_Price', 'Satisfaction'],
    ['Quantity', 'Satisfaction'],
  ]) {
    assert.equal(measureDependence(rows, a, b, columns).dependent, false, `${a} vs ${b}`);
  }
});

test('too few rows to judge is not a finding of dependence', () => {
  assert.equal(measureDependence(sales(4), 'Revenue', 'Unit_Price', columns).dependent, false);
  assert.equal(measureDependence([], 'Revenue', 'Unit_Price', columns).dependent, false);
});

test('the planner will not put a dependent pair on a slide', () => {
  const charts = planCharts(sales(600), { max: 9 });
  for (const c of charts) {
    const axes = `${c.xAxisKey} ${c.yAxisKey}`;
    const pairsRevenueWithFactor =
      /Revenue/i.test(axes) && (/Unit.?Price/i.test(axes) || /Quantity/i.test(axes));
    assert.ok(
      !(c.chart_type === 'scatter' && pairsRevenueWithFactor),
      `a scatter of a total against its own factor survived: ${c.title}`
    );
  }
});

test('a deck of flat data is short, not padded', () => {
  // Every group identical, every measure a plain sequence: there is nothing
  // here a chart could tell anybody.
  const flat = Array.from({ length: 200 }, (_, i) => ({
    segment: `g${i % 4}`,
    other: `h${i % 5}`,
    amount: (i % 50) + 1,
    score: ((i * 7) % 50) + 1,
  }));
  const charts = planCharts(flat, { max: 9 });
  assert.ok(charts.length <= 5, `expected a short deck, got ${charts.length}`);
});

test('a deck never empties itself, however little the data says', () => {
  const nothing = Array.from({ length: 60 }, (_, i) => ({
    segment: `g${i % 3}`,
    amount: 100,
    other: 5,
  }));
  const charts = planCharts(nothing, { max: 9 });
  assert.ok(charts.length >= 1, 'something is still offered');
});

test('one distribution per deck', () => {
  // Three measures whose distributions are all strongly shaped: without the
  // rule this deck would spend three slides saying "most values are small".
  const skewed = Array.from({ length: 400 }, (_, i) => {
    const tail = i > 360 ? 40 : 1;
    return {
      segment: `g${i % 6}`,
      alpha: (i % 30) * tail,
      beta: (i % 25) * tail,
      gamma: (i % 20) * tail,
    };
  });
  const charts = planCharts(skewed, { max: 9 });
  const histograms = charts.filter((c) => /^Distribution of /.test(c.title));
  assert.ok(histograms.length <= 1, `${histograms.length} histograms in one deck`);
});

/* Which chart, and how many — the shape of the deck itself. */

/** A joined view: a real decline, and an interaction between two dimensions. */
function joined(n = 8000) {
  let seed = 21;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const CATS = ['Electronics', 'Home', 'Sports', 'Fashion', 'Grocery', 'Beauty', 'Books'];
  const W = { Electronics: 14, Home: 1.4, Sports: 1.2, Fashion: 1.1, Grocery: 0.5, Beauty: 0.4, Books: 0.3 };
  const rows = [];
  for (let i = 0; i < n; i++) {
    const cat = pick(CATS);
    const age = pick(['18-25', '26-35', '36-45', '46-55', '56-65', '65+']);
    const reg = pick(['North', 'South', 'East', 'West']);
    const month = 1 + Math.floor((i / n) * 12);
    const qty = 1 + Math.floor(rnd() * 5);
    const amount = Math.round(
      2000 * W[cat] * (0.7 + rnd() * 0.6) * qty * (1 - (month / 12) * 0.4) *
        (cat === 'Electronics' && reg === 'North' ? 0.25 : 1)
    );
    rows.push({
      Order_ID: `O${i}`, Order_Date: `2025-${String(month).padStart(2, '0')}-15`,
      Category: cat, Region: reg,
      // The same fact from two sheets, which is what a three-file join produces.
      Age_Group: age, Customer_Age_Group: age,
      Quantity: qty, Total_Amount: amount,
    });
  }
  return rows;
}

test('a cross-tab is offered for the pair that actually interacts', () => {
  // Revenue is driven by Category, and separately collapses for Electronics in
  // the North. The pair worth a grid is Category and Region — the first two
  // dimensions in the list are Category and Age Group, and a planner that took
  // those would draw a grid with nothing in it.
  const charts = planCharts(joined(), { max: 9 });
  const matrix = charts.find((c) => c.chart_type === 'matrix');
  assert.ok(matrix, `no cross-tab: ${charts.map((c) => c.chart_type).join(', ')}`);
  const dims = `${matrix.xAxisKey} ${matrix.secondaryYAxisKey}`;
  assert.match(dims, /Category/);
  assert.match(dims, /Region/, `grid was over ${dims}`);
});

test('only one cross-tab, however many pairs are offered', () => {
  const charts = planCharts(joined(), { max: 9 });
  assert.ok(charts.filter((c) => c.chart_type === 'matrix').length <= 1);
});

test('the same column arriving from two sheets is charted once', () => {
  const charts = planCharts(joined(), { max: 9 });
  const ageCharts = charts.filter((c) => /age group/i.test(String(c.dimension || c.xAxisKey)));
  assert.ok(ageCharts.length <= 1, ageCharts.map((c) => c.title).join(' | '));
});

test('a date column always earns one chart, even when the line is flat', () => {
  // "Revenue held steady all year" is a finding. Scored on direction alone a
  // flat series is worth nothing, and the deck then says nothing about when
  // anything happened — the first question anybody asks.
  let seed = 4;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const flat = Array.from({ length: 3000 }, (_, i) => ({
    Order_Date: `2025-${String(1 + Math.floor((i / 3000) * 12)).padStart(2, '0')}-15`,
    Category: ['A', 'B', 'C'][i % 3],
    Revenue: 900 + Math.round(rnd() * 200),
  }));
  const charts = planCharts(flat, { max: 7 });
  assert.ok(
    charts.some((c) => ['line', 'area'].includes(c.chart_type)),
    `no time axis: ${charts.map((c) => `${c.chart_type} ${c.title}`).join(' | ')}`
  );
});

test('a deck of a rich dataset uses more than one shape', () => {
  const charts = planCharts(joined(), { max: 9 });
  const types = new Set(charts.map((c) => c.chart_type));
  assert.ok(types.size >= 4, `only ${types.size} shapes: ${[...types].join(', ')}`);
  assert.ok(charts.length >= 5, `only ${charts.length} charts`);
});
