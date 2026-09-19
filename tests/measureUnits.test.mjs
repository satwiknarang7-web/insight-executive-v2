import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDenomination } from '../lib/measureUnits.js';
import { profileColumns } from '../lib/chartResolver.js';
import { classifyColumns, honestAggregate } from '../lib/measureSemantics.js';
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

test('the only honest aggregate for a column is readable from its name', () => {
  // The chart builder seeds a form before anything is known about the table,
  // so it judges from the name — the same line `classifyColumns` draws, shared
  // rather than copied.
  assert.equal(honestAggregate('Monthly Price USD'), 'AVG', 'a price is not a quantity to add up');
  assert.equal(honestAggregate('Intelligence Index'), 'AVG');
  assert.equal(honestAggregate('Agentic Coding Score'), 'AVG');
  assert.equal(honestAggregate('Churn Rate'), 'AVG');
  assert.equal(honestAggregate('Average Tenure Months'), 'AVG');

  assert.equal(honestAggregate('Min Seats'), 'SUM');
  assert.equal(honestAggregate('Revenue'), 'SUM');
  assert.equal(honestAggregate('Units'), 'SUM');

  assert.equal(honestAggregate(''), 'SUM', 'and nothing at all does not throw');
  assert.equal(honestAggregate(null), 'SUM');
});

test('a table with nothing to add up leads with averages, not record counts', () => {
  // The shape of a comparison table: every measure is a price, a score or an
  // index, so none of them is summable. COUNT(*) is not a stand-in for a
  // magnitude here — it counts rows of the file, not anything about the
  // subject — and it used to outrank the average-by-category charts and take
  // the top of the deck.
  const rows = [];
  const providers = ['OpenAI', 'Anthropic', 'xAI', 'Google', 'Mistral', 'Cohere', 'Moonshot', 'Z AI'];
  const tiers = ['Entry', 'Mid', 'High'];
  providers.forEach((provider, i) =>
    tiers.forEach((tier, j) =>
      rows.push({
        Provider: provider,
        Plan: tier,
        Audience: j === 2 ? 'Business' : 'Individual',
        'Monthly Price USD': [20, 100, 300][j] + i * 7,
        'Intelligence Index': 53 - i * 4,
        'Coding Score': 91 - i * 6,
        'ARC AGI 2 Score': 95 - i * 5,
      })
    )
  );

  const charts = planCharts(rows, { max: 9 });
  assert.ok(charts.length > 0);

  const isCount = (c) => /COUNT\(\*\)/i.test(String(c.sql || ''));
  assert.ok(!isCount(charts[0]), `the deck opens on "${charts[0].title}"`);
  assert.ok(/AVG\(/i.test(String(charts[0].sql || '')), 'the leading chart is not an average');

  // Counts may still appear; they must not lead.
  const firstCount = charts.findIndex(isCount);
  const firstAvg = charts.findIndex((c) => /AVG\(/i.test(String(c.sql || '')));
  assert.ok(firstAvg < firstCount || firstCount === -1, 'a record count outranked an average');

  // And more than one measure gets drawn — charting the same score four times
  // says less than charting four different ones.
  const measured = new Set(
    charts.map((c) => (String(c.sql || '').match(/AVG\(\[([^\]]+)\]\)/) || [])[1]).filter(Boolean)
  );
  assert.ok(measured.size > 1, `only ${[...measured]} was ever averaged`);
});

test('a table with a real quantity still leads with the magnitude', () => {
  // The other half of the same rule: where something IS summable, summing it
  // is what the reader came for and nothing below should have displaced it.
  const rows = Array.from({ length: 40 }, (_, i) => ({
    Region: ['North', 'South', 'East', 'West'][i % 4],
    Channel: ['Web', 'Retail'][i % 2],
    Revenue: 100 + (i % 7) * 50,
    Discount: (i % 5) * 2,
  }));
  const charts = planCharts(rows, { max: 8 });
  assert.ok(/SUM\(/i.test(String(charts[0].sql || '')), `expected a total to lead, got "${charts[0].title}"`);
});
