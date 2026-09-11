import test from 'node:test';
import assert from 'node:assert/strict';
import { planCharts } from '../lib/analystPlanner.js';
import { analyzeChart } from '../lib/insightEngine.js';
import { allowsPortfolioFraming, shareConsequence } from '../lib/dimensionRoles.js';

/**
 * A 250,000-row order export, reduced to the shape that mattered: a status
 * column whose failure levels are spread evenly across every dimension, and a
 * component rate whose base is almost zero.
 */
function orders({ rows = 4000, cancelRate = 0.1, vary = false } = {}) {
  const out = [];
  const cats = ['Electronics', 'Home', 'Sports', 'Fashion'];
  for (let i = 0; i < rows; i++) {
    const cat = cats[i % cats.length];
    // Either uniform across categories, or genuinely different.
    const p = vary ? (i % cats.length === 0 ? 0.35 : 0.03) : cancelRate;
    out.push({
      Order_ID: `O${i}`,
      Category: cat,
      Payment_Mode: ['Card', 'UPI', 'COD'][i % 3],
      Order_Status: (i * 9301 + 49297) % 233280 / 233280 < p ? 'Cancelled' : 'Delivered',
      Total_Amount: 1000 + (i % 500),
      // A component that is a rounding error of the whole: 0.1% at most.
      Shipping_Cost: i % cats.length === 0 ? 1 : 0.01,
    });
  }
  return out;
}

test('a rate is scored as a proportion, not as a percentage', () => {
  // outcomeSpread tests a spread against what sampling would produce, and its
  // standard error is sqrt(base * (1 - base) / n) — a standard error only while
  // base is a proportion. Handed percentages, (1 - base) goes negative, the
  // root is NaN and the significance guard is silently inert. A shipping cost
  // rate of 0.105% against 0.001% then scored a perfect 1.0 and led the deck on
  // a spread of one tenth of a percentage point.
  const charts = planCharts(orders(), { max: 8 });
  const shipping = charts.find((c) => /Shipping Cost Rate/.test(c.title));
  if (shipping) {
    assert.ok(
      shipping.signalScore < 0.9,
      `a 0.1pp spread scored ${shipping.signalScore}`
    );
  }
});

test('a measure is never broken down by the column it is made of', () => {
  // "Cancelled Rate by Order Status" is 100% on the level it counts and 0% on
  // the rest: a perfect spread, a top score, and a tautology with a chart
  // around it.
  const charts = planCharts(orders({ vary: true }), { max: 10 });
  for (const c of charts) {
    if (/Cancelled Rate/i.test(c.title)) {
      assert.doesNotMatch(c.title, /by Order Status/i, 'a measure cannot explain itself');
    }
  }
});

test('a derived rate that genuinely varies is charted', () => {
  const charts = planCharts(orders({ vary: true }), { max: 10 });
  const rate = charts.find((c) => /Cancelled Rate by Category/i.test(c.title));
  assert.ok(rate, 'a rate that differs 35% to 3% across the field is a finding');
  assert.ok(rate.signalScore > 0.5, `scored ${rate.signalScore}`);
});

test('a derived rate that is flat everywhere is not charted', () => {
  // The counterpart, and the one that decides whether the scoring is real: on
  // the actual export the returned-or-cancelled rate ran 10.09% to 9.60% across
  // age groups. Refusing it is correct, however consequential 10% sounds.
  const charts = planCharts(orders({ vary: false }), { max: 10 });
  const rate = charts.find((c) => /Cancelled Rate by/i.test(c.title));
  if (rate) assert.ok(rate.signalScore < 0.5, `a flat rate scored ${rate.signalScore}`);
});

test('too few rows to measure is not the same as measured and flat', () => {
  // On a small table outcomeSpread discounts every group and returns zero,
  // which would drop each derived measure rather than report that the question
  // could not be asked.
  const tiny = orders({ rows: 12, vary: true });
  const charts = planCharts(tiny, { max: 10 });
  const derived = charts.filter((c) => c.measure && c.measure.expr);
  assert.ok(derived.length > 0, 'a thin table still gets its derived measures');
});

// ---------------------------------------------------------------------------
// One rule, applied everywhere
// ---------------------------------------------------------------------------

test('a demographic share of money is a concentration, of rows is coverage', () => {
  assert.equal(allowsPortfolioFraming('Customer_Age_Group', 'Total Amount'), true);
  assert.equal(allowsPortfolioFraming('Customer_Age_Group', 'Record Count'), false);
  assert.equal(allowsPortfolioFraming('Sex', 'Record Count'), false);
  assert.equal(allowsPortfolioFraming('Region', 'Record Count'), true, 'geography always carries a position');
  assert.equal(allowsPortfolioFraming('Quarter', 'Total Amount'), false, 'a quarter cannot be rebalanced');
});

test('the slide and the summary cannot give opposite instructions', () => {
  // The reported case. Page 3 said a 43.2% share of revenue was "who the data
  // covers, not a position to rebalance"; page 8 said to "decide whether the
  // reliance is a strength to press or an exposure to hedge" — same dimension,
  // same number, opposite advice. The gate reached the summary bullet and the
  // risk card but never the ranking recommendation.
  const money = analyzeChart({
    title: 'Total Amount by Customer Age Group', chart_type: 'bar',
    xAxisKey: 'Customer_Age_Group', yAxisKey: 'Total Amount',
    resultData: [
      { Customer_Age_Group: '26-35', 'Total Amount': 2.56e9 },
      { Customer_Age_Group: '18-25', 'Total Amount': 1.49e9 },
      { Customer_Age_Group: '36-45', 'Total Amount': 1.1e9 },
      { Customer_Age_Group: '46-55', 'Total Amount': 5.6e8 },
      { Customer_Age_Group: '56-65', 'Total Amount': 1.6e8 },
      { Customer_Age_Group: '65+', 'Total Amount': 3.9e7 },
    ],
  });
  // Money on a demographic: the concentration is real, and both places say so.
  assert.match(money.recommendation, /strength to press|exposure to hedge|pattern to watch/);
  assert.equal(shareConsequence('Customer_Age_Group', '26-35', 'the total', 'Total Amount'), null);

  // Rows on a demographic: coverage, in both places.
  assert.match(
    shareConsequence('Sex', 'M', 'the total', 'Record Count'),
    /not a position to rebalance/
  );
});
