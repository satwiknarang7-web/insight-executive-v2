import test from 'node:test';
import assert from 'node:assert/strict';
import { planCharts } from '../lib/analystPlanner.js';

/**
 * How much of a column, against how much per record.
 *
 * Four consecutive reports on a retail export missed the clearest finding in
 * it. Buyers under 45 spent about 29K an order and buyers over 45 about 8K — a
 * cliff, not a taper — and the chart that shows it is "Average Order Value by
 * Customer Age Group". Two charts of that column already existed, both about
 * totals, and the allowance treated all three as the same question.
 *
 * They are not. Total Amount by age group says 26-35 is the biggest group,
 * which is a fact about how many of them there are. Average order value says
 * what one of them is worth when they buy.
 */

const ages = ['18-25', '26-35', '36-45', '46-55', '56-65', '65+'];
const perOrder = { '18-25': 24200, '26-35': 29200, '36-45': 28900, '46-55': 8300, '56-65': 8400, '65+': 8100 };
const cats = ['Electronics', 'Books', 'Home', 'Sports', 'Fashion', 'Grocery', 'Beauty'];

const orders = () => {
  const rows = [];
  for (let i = 0; i < 12000; i++) {
    const group = ages[i % 6];
    rows.push({
      Order_ID: `ORD${i}`,
      Customer_ID: `C${i % 2000}`,
      Order_Date: `2025-${String((i % 12) + 1).padStart(2, '0')}-15`,
      Category: cats[i % 7],
      Payment_Mode: ['UPI', 'Card', 'COD', 'Wallet'][i % 4],
      Customer_Age_Group: group,
      Customer_Tier: ['Gold', 'Silver'][i % 2],
      Quantity: (i % 4) + 1,
      Shipping_Cost: i % 40,
      Total_Amount: Math.round(perOrder[group] * (0.9 + (i % 20) / 100)),
    });
  }
  return rows;
};

test('a per-record measure is not crowded out by totals of the same column', () => {
  const charts = planCharts(orders(), { max: 8 });
  const titles = charts.map((c) => c.title);
  assert.ok(
    titles.some((t) => /Average Order Value by Customer Age Group/i.test(t)),
    `the cliff chart was cut again:\n  ${titles.join('\n  ')}`
  );
});

test('a measure that divides asks the per-record question; a count does not', () => {
  // The distinction is read off the expression, because `parts` only exists for
  // ratios of two summable columns — and average order value, the measure this
  // was drawn for, is SUM(Total_Amount) / COUNT(DISTINCT Order_ID) and has none.
  const charts = planCharts(orders(), { max: 12 });
  const divides = charts.filter((c) => String(c.measure?.expr || '').includes('/'));
  assert.ok(divides.length >= 1, 'no per-record measure reached the deck at all');
  for (const c of divides) {
    assert.ok(/rate|value|per |average/i.test(c.title), `${c.title} does not read as a per-record measure`);
  }
});

test('the allowance still holds: one column does not take the whole deck', () => {
  // The fix widens a slot, it does not remove the limit. A column may answer
  // two questions about totals and two about per-record figures, and a deck
  // that is four charts of one column is the thing this guard exists to stop.
  const charts = planCharts(orders(), { max: 10 });
  const byDim = {};
  for (const c of charts) {
    const d = c.dimension || c.xAxisKey;
    byDim[d] = (byDim[d] || 0) + 1;
  }
  for (const [dim, n] of Object.entries(byDim)) {
    assert.ok(n <= 4, `${dim} took ${n} of ${charts.length} slides`);
  }
});
