import test from 'node:test';
import assert from 'node:assert/strict';
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
