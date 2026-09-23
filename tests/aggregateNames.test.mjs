import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateAlias, aggregateTitle, prettyColumn } from '../lib/aggregateNames.js';
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
