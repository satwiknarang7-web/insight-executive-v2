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
