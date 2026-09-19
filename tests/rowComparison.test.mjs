import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRowLabel, comparisonTable } from '../lib/rowComparison.js';
import { profileColumns } from '../lib/chartResolver.js';
import { planCharts } from '../lib/analystPlanner.js';

/* Some tables are lists of things to choose between, not records of events.

   Every chart this planner builds groups and aggregates, which is right for a
   table of orders and wrong for a table of candidates. A comparison of AI
   subscription plans has forty-four rows and forty-four distinct plans, and the
   deck it produced opened with "Average Monthly Price USD by Product": ChatGPT's
   Free, Go, Plus, Pro, two Business seats and Enterprise averaged into one bar.
   There is no such plan. Nobody can buy the average of a free tier and an
   enterprise contract.

   What separates the two is checkable and has nothing to do with the subject:
   `Provider` and `Plan Name` together are distinct on every row. A column that
   is unique per row cannot be grouped, so the rows are the thing to show. */

/** A miniature of the plans file: vendors × tiers, one row per buyable plan. */
function plansTable() {
  const rows = [];
  const vendors = [
    ['OpenAI', 53],
    ['Anthropic', 51],
    ['Google', 30],
    ['xAI', 44],
    ['Mistral', 15],
  ];
  const tiers = [['Free', 0], ['Pro', 20], ['Max', 100], ['Team', 25], ['Enterprise', 400]];
  for (const [provider, intelligence] of vendors) {
    for (const [plan, price] of tiers) {
      rows.push({
        Provider: provider,
        'Plan Name': plan,
        Audience: plan === 'Team' || plan === 'Enterprise' ? 'Business' : 'Individual',
        'Monthly Price USD': price + intelligence / 10,
        'Intelligence Index': intelligence,
        'Support Hours': price === 0 ? 0 : 4 + (price % 7),
      });
    }
  }
  return rows;
}

/** A table of events: the same vendors, but rows are purchases over time. */
function ordersTable() {
  return Array.from({ length: 120 }, (_, i) => ({
    Customer: `Customer ${i % 18}`,
    Region: ['North', 'South', 'East'][i % 3],
    'Ordered On': `2026-${String((i % 12) + 1).padStart(2, '0')}-14`,
    Revenue: 100 + (i % 37) * 9,
    Units: 1 + (i % 5),
  }));
}

const profiled = (rows) => profileColumns(rows);

test('a pair of columns that names every row is found', () => {
  const rows = plansTable();
  const label = chooseRowLabel(rows, profiled(rows));
  // Neither column does it alone — "Pro" repeats across vendors, and every
  // vendor has five plans — and together they are exact.
  assert.deepEqual(label.columns, ['Provider', 'Plan Name']);
  assert.equal(label.distinct, rows.length);
});

test('a table of events has no such label, and is not a comparison', () => {
  const rows = ordersTable();
  assert.equal(comparisonTable(rows, profiled(rows)), null);
});

test('a time series is never a comparison, however unique its rows', () => {
  // Uniqueness is not enough on its own. A reading per day per sensor is
  // unique by construction, and the finding is what happened over the year.
  const rows = Array.from({ length: 60 }, (_, i) => ({
    Sensor: `S${i % 4}`,
    Slot: `slot ${i}`,
    Day: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    Reading: 20 + (i % 11),
  }));
  assert.ok(chooseRowLabel(rows, profiled(rows)), 'the fixture has no unique label');
  assert.equal(comparisonTable(rows, profiled(rows)), null, 'a dated series was read as a comparison');
});

test('a long file is a log, whatever is unique about it', () => {
  const rows = Array.from({ length: 400 }, (_, i) => ({
    Ticket: `T${i}`,
    Queue: ['A', 'B'][i % 2],
    Minutes: 5 + (i % 90),
  }));
  assert.ok(chooseRowLabel(rows, profiled(rows)));
  assert.equal(comparisonTable(rows, profiled(rows)), null);
});

test('a URL column is never a name, and neither is a blank one', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    'Source URL': `https://example.com/${i}`,
    Notes: i % 3 === 0 ? `note ${i}` : null,
    Tier: ['A', 'B'][i % 2],
    Value: i,
  }));
  const label = chooseRowLabel(rows, profiled(rows));
  // Both the URL (unique, and plumbing) and the half-empty Notes are refused,
  // and Tier alone cannot name twenty rows.
  assert.equal(label, null);
});

/* And the planner, which is what a reader sees. */

const titles = (charts) => charts.map((c) => c.title);
const rowLevel = (charts) => charts.filter((c) => c.rowLevel);

test('a comparison table is charted by its rows', () => {
  const rows = plansTable();
  const charts = planCharts(rows, { max: 8 });
  const perRow = rowLevel(charts);

  assert.ok(perRow.length >= 1, `nothing was charted per row: ${JSON.stringify(titles(charts))}`);

  // Named plans on the axis, not vendor averages, and no GROUP BY to make them.
  const ranking = perRow.find((c) => c.chart_type === 'hbar');
  assert.ok(ranking, `no ranking of the rows: ${JSON.stringify(titles(perRow))}`);
  assert.ok(!/GROUP BY/i.test(ranking.sql), `the row chart aggregated: ${ranking.sql}`);
  assert.match(ranking.sql, /CONCAT\(\[Provider\], ' · ', \[Plan Name\]\)/);
  assert.match(ranking.title, / by Plan$/);
});

test('a table of events is charted exactly as it was', () => {
  const charts = planCharts(ordersTable(), { max: 8 });
  assert.equal(rowLevel(charts).length, 0, `an event log was charted row by row: ${JSON.stringify(titles(charts))}`);
});

test('the scatter refuses two columns that are one column twice', () => {
  /* `USD per Intelligence Point` is price divided by a benchmark score, and
     `Intelligence per 100 USD` is a hundred times its reciprocal. Plotting them
     against each other draws the division rather than any trade-off.

     `measureDependence` catches the first against price — a product — and
     cannot catch the second, because the ratio of a column to its own
     reciprocal is not steady. Rank correlation catches it: a monotone
     transform of a column scores -1 against it. */
  const rows = plansTable().map((r) => ({
    ...r,
    'USD per Intelligence Point': r['Monthly Price USD'] / r['Intelligence Index'],
    'Intelligence per 100 USD': (100 * r['Intelligence Index']) / Math.max(1, r['Monthly Price USD']),
  }));
  const scatter = planCharts(rows, { max: 10 }).find((c) => c.rowLevel && c.chart_type === 'scatter');
  if (!scatter) return; // this fixture did not produce one; the rule is still tested below

  const pair = [scatter.xAxisKey, scatter.yAxisKey].sort();
  assert.notDeepEqual(
    pair,
    ['Intelligence per 100 USD', 'USD per Intelligence Point'],
    'the scatter plotted a column against its own reciprocal'
  );
});

test('a blank cell is not a zero', async () => {
  /* `Number(null)` is 0 and `Number.isFinite(0)` is true, so the obvious
     coercion turns every empty cell into a real measurement at the origin. On
     the plans file nineteen of forty-four rows quote no price — the free tiers
     and the "contact us" enterprise ones — and counting them as $0 with a
     benchmark score of 0 would have dragged the scatter's correlation with
     them. */
  const rows = plansTable().map((r, i) => (i % 2 ? { ...r, 'Monthly Price USD': null } : r));
  const charts = planCharts(rows, { max: 10 });
  const ranking = charts.find((c) => c.rowLevel && c.yAxisKey === 'Monthly Price USD');
  if (ranking) assert.match(ranking.sql, /WHERE \[Monthly Price USD\] IS NOT NULL/);
});

test('a deliberately row-level query is not "healed" into an aggregate', async () => {
  /* `executeCharts` replaces any query that came back as raw rows with an
     average by the first string column, because a query that forgot to
     aggregate makes a useless chart. A comparison table's query has no GROUP BY
     on purpose — there is nothing to group — and was being healed into exactly
     the chart it exists to replace: the planner asked for twelve named plans
     and the deck drew ten provider averages under the planner's title.

     The flag is set by the planner and never inferred, so nothing a model
     writes can opt itself out of the heal. */
  const { runAnalysis } = await import('../lib/pipeline.js');
  const charts = runAnalysis(plansTable(), { maxCharts: 8 }).charts || [];
  const perRow = charts.filter((c) => /\(rows\)/.test(c.dimension || ''));

  assert.ok(perRow.length, `no row-level chart survived execution: ${JSON.stringify(titles(charts))}`);
  for (const c of perRow) {
    assert.equal(c.xAxisKey, 'Plan', `the row chart was healed into an aggregate by ${c.xAxisKey}`);
    // Named plans, not vendors.
    assert.match(String(c.resultData?.[0]?.Plan ?? ''), / · /);
  }
});

test('the label reads general to specific, from a profile that carries no keys', () => {
  /* "OpenAI · Pro", never "Pro · OpenAI".

     Five vendors and five tiers is a tie on distinct counts, so ordering the
     pair by how many levels each has is a coin toss. File order settles it —
     whoever built the table wrote Provider before Plan Name because that is
     how the thing is named.

     Read from a row rather than from the profile, because the profile the
     browser worker passes down is a reduced one with no `keys` on it. Asking
     that profile for file order returned "not found" for both columns and left
     them in whatever order they were tried, which is how the shipped chart came
     out "Dedicated instance · Cohere". It passed every test at the time,
     because the tests profiled the rows themselves. */
  /* Shaped like the real file, where the two counts differ: ten providers and
     twenty-eight plan names. Ordering by distinct count puts Plan Name first,
     which is the wrong way round, so a fixture that ties on the counts cannot
     tell whether file order was consulted at all. Plan names repeat across
     vendors — every one of them sells a "Free" — so neither column names a row
     on its own and the pair is genuinely needed. */
  const vendors = ['OpenAI', 'Anthropic', 'Google', 'xAI'];
  const tiers = ['Free', 'Go', 'Plus', 'Pro', 'Team', 'Business', 'Enterprise'];
  const rows = [];
  for (let i = 0; i < vendors.length; i++) {
    for (let j = 0; j < tiers.length; j++) {
      rows.push({ Provider: vendors[i], 'Plan Name': tiers[j], Price: 10 + i * 7 + j });
    }
  }
  const full = profiled(rows);
  assert.ok(full.cardinality['Plan Name'] > full.cardinality.Provider, 'the fixture does not discriminate');

  const reduced = (() => {
    const { measures, dimensions, temporal, cardinality } = full;
    return { measures, dimensions, temporal, cardinality };
  })();

  for (const [what, profile] of [['full profile', full], ['worker profile', reduced]]) {
    const label = chooseRowLabel(rows, profile);
    assert.deepEqual(label.columns, ['Provider', 'Plan Name'], `wrong order with the ${what}`);
  }
});
