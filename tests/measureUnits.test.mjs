import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDenomination } from '../lib/measureUnits.js';
import { profileColumns } from '../lib/chartResolver.js';
import { classifyColumns } from '../lib/measureSemantics.js';
import { planCharts } from '../lib/analystPlanner.js';

const detect = (rows) => {
  const profile = profileColumns(rows);
  return detectDenomination({ profile, cardinality: profile.cardinality });
};

/**
 * A correctly shaped country-year panel: one row per country per year, nothing
 * repeated. Grain detection has nothing to say about this file, and every LCU
 * column is still a different currency on every country's rows.
 */
function panel() {
  const rows = [];
  const teams = ['Brazil', 'China', 'United States', 'Greece', 'Japan', 'Kenya'];
  for (const team of teams) {
    for (let year = 1996; year <= 2016; year += 4) {
      rows.push({
        team,
        year,
        Tax_revenue_current_LCU_Value: 1e11 + team.length * 3e10 + year * 1e7,
        medals: (year % 7) + team.length,
      });
    }
  }
  return rows;
}

test('a local-currency measure is denominated per row', () => {
  const hits = detect(panel());
  assert.ok(hits.Tax_revenue_current_LCU_Value, 'LCU means whichever currency the row uses');
  assert.match(hits.Tax_revenue_current_LCU_Value.why, /mixes currencies/);
});

test('a measure in the same file with a fixed unit is untouched', () => {
  assert.ok(!detect(panel()).medals, 'a medal is a medal in every country');
});

test('LCU is recognised however the column is spelled', () => {
  const shapes = [
    'GDP_current_LCU',
    'lcu_value',
    'Revenue (local currency)',
    'national currency amount',
  ];
  for (const name of shapes) {
    const rows = Array.from({ length: 40 }, (_, i) => ({ country: `C${i % 5}`, [name]: 1000 + i }));
    assert.ok(detect(rows)[name], `${name} should read as locally denominated`);
  }
});

test('a name that merely contains those letters is not a currency', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ k: `K${i % 4}`, calculated_value: i }));
  assert.ok(!detect(rows).calculated_value, '"calculated" is not "LCU"');
});

test('a unit column that varies denominates the money columns beside it', () => {
  // Long-format exports state the unit in the row. That column is the strongest
  // evidence available that the measure is not homogeneous.
  const rows = Array.from({ length: 60 }, (_, i) => ({
    region: `R${i % 6}`,
    currency: ['USD', 'EUR', 'JPY'][i % 3],
    amount: 100 + i * 7,
    quantity: 1 + (i % 5),
  }));
  const hits = detect(rows);
  assert.ok(hits.amount, 'amount is in whatever currency the row names');
  assert.match(hits.amount.why, /currency column holding 3 different values/);
  assert.ok(!hits.quantity, 'a count is not denominated by a currency column');
});

test('a unit column with one value denominates nothing', () => {
  // Every row is in dollars, so the rows are in a common unit after all.
  const rows = Array.from({ length: 60 }, (_, i) => ({
    region: `R${i % 6}`,
    currency: 'USD',
    amount: 100 + i * 7,
  }));
  assert.deepEqual(detect(rows), {});
});

test('a denominated measure reaches classifyColumns as its own kind', () => {
  const rows = panel();
  const profile = profileColumns(rows);
  const classes = classifyColumns({
    profile,
    cardinality: profile.cardinality,
    rowCount: rows.length,
  });
  assert.ok(classes.denominated.includes('Tax_revenue_current_LCU_Value'));
  assert.ok(!classes.additive.includes('Tax_revenue_current_LCU_Value'));
  assert.match(classes.byColumn.Tax_revenue_current_LCU_Value.why, /not the same unit/);
});

test('no chart sums or averages across currencies', () => {
  // The property that matters, end to end: on a panel where nothing repeats and
  // grain detection is silent, the currency mix is still caught.
  const mixes = /(SUM|AVG)\(\s*\[?Tax_revenue_current_LCU_Value/i;
  for (const chart of planCharts(panel(), { max: 10 })) {
    assert.ok(!mixes.test(String(chart.sql || '')), `chart "${chart.title}" combines currencies`);
  }
});
