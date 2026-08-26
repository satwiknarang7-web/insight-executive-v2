import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateAlias, aggregateTitle, prettyColumn } from '../lib/aggregateNames.js';
import { planCharts, planKpis } from '../lib/analystPlanner.js';
import { buildChartSpec } from '../lib/chartSpecs.js';
import { analyzeChart } from '../lib/insightEngine.js';

test('an aggregate is named after the operation and the column', () => {
  assert.equal(aggregateAlias('SUM', 'billed_artist_count'), 'Total Billed Artist Count');
  assert.equal(aggregateAlias('AVG', 'daily_streams'), 'Average Daily Streams');
  assert.equal(aggregateAlias('MAX', 'rank'), 'Maximum Rank');
  assert.equal(aggregateAlias('COUNT', 'artist'), 'Count of Artist');
  assert.equal(aggregateAlias('COUNT'), 'Record Count', 'a count of rows says so');
});

test('a joined column keeps its origin in the name', () => {
  assert.equal(prettyColumn('Customers.region'), 'Customers · Region');
});

test('a title reads in the order it is said', () => {
  assert.equal(aggregateTitle('Total Revenue', ['region']), 'Total Revenue by Region');
  assert.equal(
    aggregateTitle(['Total Revenue', 'Average Order Size'], ['region', 'category']),
    'Total Revenue and Average Order Size by Region and Category'
  );
  assert.equal(aggregateTitle('Total Revenue', []), 'Total Revenue');
});

// ---------------------------------------------------------------------------
// The reported case: 46 against Power BI's 23
// ---------------------------------------------------------------------------

/**
 * A dataset shaped like the Spotify one in the report: 23 collaborations, each
 * billed to two artists, and 700 solo tracks billed to one.
 */
function spotify() {
  const rows = [];
  for (let i = 0; i < 700; i++) {
    rows.push({
      track: `solo ${i}`,
      artist: `Artist ${i % 120}`,
      is_collaboration: 'False',
      billed_artist_count: 1,
      daily_streams: 100000 + i * 37,
    });
  }
  for (let i = 0; i < 23; i++) {
    rows.push({
      track: `duet ${i}`,
      artist: `Artist ${i}`,
      is_collaboration: 'True',
      billed_artist_count: 2,
      daily_streams: 250000 + i * 91,
    });
  }
  return rows;
}

test('a summed chart says it is a sum, and of what', () => {
  // The whole of the reported bug. 46 is the correct SUM of billed_artist_count
  // over the 23 collaborations; Power BI was showing a COUNT of the same column.
  // Both are right — nothing on the chart said which one it was, because the
  // axis, the tooltip and the alias all just said "Total".
  const charts = planCharts(spotify(), { max: 12 });
  const summed = charts.find((c) => /SUM\(\[billed_artist_count\]\)/i.test(c.sql));

  assert.ok(summed, 'the additive column is summed somewhere');
  assert.equal(summed.yAxisKey, 'Total Billed Artist Count');
  assert.match(summed.sql, /AS \[Total Billed Artist Count\]/);
  assert.ok(!/AS \[Total\]/.test(summed.sql), 'never a bare "Total"');
  assert.match(summed.title, /^Total Billed Artist Count by /);
});

test('the record count Power BI was showing is available too, and named', () => {
  const charts = planCharts(spotify(), { max: 12 });
  const counted = charts.find((c) => /COUNT\(\*\)/i.test(c.sql) && /is_collaboration/.test(c.sql));

  assert.ok(counted, 'records are counted by the same dimension');
  assert.equal(counted.yAxisKey, 'Record Count');
  assert.ok(!/AS \[Count\]/.test(counted.sql), 'never a bare "Count"');
});

test('no generated chart labels an aggregate with a bare column name', () => {
  // A radar spoke and a scatter axis were averages named after the raw column,
  // so an average read as the column's own value.
  const columns = Object.keys(spotify()[0]);
  for (const chart of planCharts(spotify(), { max: 12 })) {
    const aliases = [...chart.sql.matchAll(/\bAS \[([^\]]+)\]/g)].map((m) => m[1]);
    for (const alias of aliases) {
      assert.ok(
        !columns.some((c) => prettyColumn(c) === alias),
        `${chart.title}: "${alias}" is a computed column wearing a raw column's name`
      );
    }
  }
});

test('every generated y-axis names an aggregate or a bucket', () => {
  const named = /^(Total|Average|Maximum|Minimum|Record Count|Count of) /;
  for (const chart of planCharts(spotify(), { max: 12 })) {
    const y = chart.yAxisKey;
    if (!y) continue;
    assert.ok(
      named.test(y) || y === 'Record Count' || / Range$/.test(y),
      `${chart.title}: y axis "${y}" does not say what it measures`
    );
  }
});

test('a hand-built chart and a generated one name the same figure the same way', () => {
  // The dialog and the planner used to have their own conventions, so the same
  // sum appeared as "Total" on one chart and "Total Revenue" on another.
  const built = buildChartSpec(
    {
      type: 'bar',
      dims: { dimension: 'is_collaboration' },
      vals: { measure: { aggregate: 'SUM', column: 'billed_artist_count' } },
      limit: 10,
    },
    { columns: Object.keys(spotify()[0]), measures: [] }
  ).spec;

  const planned = planCharts(spotify(), { max: 12 }).find((c) =>
    /SUM\(\[billed_artist_count\]\)/i.test(c.sql)
  );

  assert.equal(built.yAxisKey, planned.yAxisKey);
});

test('the finding written about that chart carries the same name', () => {
  const finding = analyzeChart({
    id: 's1',
    title: 'Total Billed Artist Count by Is Collaboration',
    chart_type: 'bar',
    xAxisKey: 'is_collaboration',
    yAxisKey: 'Total Billed Artist Count',
    sql: 'SELECT [is_collaboration], SUM([billed_artist_count]) AS [Total Billed Artist Count] FROM SalesData GROUP BY [is_collaboration]',
    resultData: [
      { is_collaboration: 'False', 'Total Billed Artist Count': 700 },
      { is_collaboration: 'True', 'Total Billed Artist Count': 46 },
    ],
  });

  assert.match(finding.headline, /total billed artist count/i);
  assert.equal(finding.metrics.leaderValue, 700);
  assert.equal(finding.metrics.total, 746);
});

test('a Total card carries the summed value, and says which column it summed', () => {
  const rows = spotify();
  const exact = rows.reduce((sum, r) => sum + r.billed_artist_count, 0);
  assert.equal(exact, 746, '700 solo tracks plus 23 duets billed to two artists');

  const kpis = planKpis(rows);
  const card = kpis.find((k) => /^Total /.test(k.label));

  assert.ok(card, 'an additive column gets a total card');
  assert.equal(card.label, 'Total Billed Artist Count', 'the card names the column it summed');
  // The summed value, not a mean multiplied back up: that reconstruction goes
  // through a float division and lands near the total rather than on it.
  assert.equal(card.value, String(exact));
});
