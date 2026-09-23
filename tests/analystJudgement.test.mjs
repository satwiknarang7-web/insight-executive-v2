import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureDependence } from '../lib/chartSignals.js';

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
