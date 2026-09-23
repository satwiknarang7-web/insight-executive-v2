import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChart, analyzeStoryboard } from '../lib/insightEngine.js';
import { executeCharts, mountTable, runAnalysis, runSql, titleForDrawn, unmountTable } from '../lib/pipeline.js';

// A histogram: the x labels are value ranges, not named segments.
const histogram = {
  id: 'h1',
  title: 'Distribution of Revenue',
  chart_type: 'radial', // as if diversity enforcement had retyped it
  xAxisKey: 'Revenue Range',
  yAxisKey: 'Count',
  resultData: [
    { 'Revenue Range': '76-3719', Count: 631 },
    { 'Revenue Range': '3719-7362', Count: 61 },
    { 'Revenue Range': '7362-11005', Count: 20 },
    { 'Revenue Range': '11005+', Count: 8 },
  ],
};

test('a histogram reads as a distribution even when drawn as a radial chart', () => {
  const f = analyzeChart(histogram);
  assert.ok(f.metrics.modalBucket, 'should produce distribution metrics');
  assert.match(f.headline, /band/i);
  // The old bug: describing the bucket range as if it were a named segment.
  assert.doesNotMatch(f.headline, /largest share/i);
});

test('a modal bucket is not offered as the dataset opportunity', () => {
  const ranking = {
    id: 'r1',
    title: 'Revenue by Category',
    chart_type: 'bar',
    xAxisKey: 'Category',
    yAxisKey: 'Total',
    resultData: [
      { Category: 'Electronics', Total: 718000 },
      { Category: 'Sports', Total: 240000 },
      { Category: 'Apparel', Total: 180000 },
    ],
  };
  const { synthesis } = analyzeStoryboard([histogram, ranking], new Array(720).fill({}));
  assert.doesNotMatch(synthesis.strategicScorecard.opportunity, /76-3719/);
  // Electronics carries 63% here, which makes it the risk — and the same share
  // cannot be the upside as well. With only a histogram left, there is no
  // opportunity to report, so the card is empty rather than restating the risk.
  assert.match(synthesis.strategicScorecard.risk, /Electronics/);
  assert.equal(synthesis.strategicScorecard.opportunity, '');
});

test('unordered category labels are never narrated as a trend', () => {
  const f = analyzeChart({
    title: 'Region Share of Monthly Charge',
    chart_type: 'area', // as if it had been wrongly retyped
    xAxisKey: 'region',
    yAxisKey: 'Total',
    resultData: [
      { region: 'West', Total: 20300 },
      { region: 'North', Total: 19400 },
      { region: 'East', Total: 18900 },
    ],
  });
  assert.equal(f.metrics.direction, undefined, 'a set of regions has no direction');
  assert.doesNotMatch(f.headline, /trend/i);
});

test('ISO year-month labels are still recognised as a real trend', () => {
  const f = analyzeChart({
    title: 'Revenue Over Time',
    chart_type: 'area',
    xAxisKey: 'Month',
    yAxisKey: 'Total',
    resultData: [
      { Month: '2026-01', Total: 100 },
      { Month: '2026-02', Total: 150 },
      { Month: '2026-03', Total: 210 },
    ],
  });
  assert.equal(f.metrics.direction, 'rising');
});

test('a long aggregated result is kept, not replaced with an average by category', () => {
  // Thirty-six months of a trend. This is a correct, deliberate, aggregated
  // query — and it used to be thrown away for being over thirty rows and
  // answered with "average by the first string column" under the same title.
  const rows = [];
  for (let m = 0; m < 36; m++) {
    const month = `20${23 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
    for (let i = 0; i < 3; i++) {
      rows.push({ Order_Date: `${month}-1${i}`, Channel: ['A', 'B', 'C'][i], Revenue: 100 + m * 10 + i });
    }
  }

  const spec = {
    id: 'trend',
    title: 'Revenue by month',
    chart_type: 'line',
    xAxisKey: 'Month',
    yAxisKey: 'Revenue',
    sql:
      'SELECT SUBSTRING([Order_Date], 1, 7) AS [Month], SUM([Revenue]) AS [Revenue] ' +
      'FROM SalesData GROUP BY SUBSTRING([Order_Date], 1, 7) ORDER BY [Month] ASC',
  };

  mountTable(rows);
  const [chart] = executeCharts([spec], rows);
  unmountTable();

  assert.ok(!chart.healed, 'a correct aggregate is not "healed"');
  assert.equal(chart.xAxisKey, 'Month');
  assert.equal(chart.resultData.length, 36, 'all thirty-six months survive');
  assert.equal(chart.resultData[0].Month, '2023-01');
});

test('a chart with a series keeps its own axis instead of a folded label', () => {
  // Two label columns usually mean "fold them into one label". A declared
  // series is the exception: folding it made "2024-01 · North" the x axis and
  // drew one point per line.
  const rows = [];
  for (const month of ['2024-01', '2024-02', '2024-03']) {
    for (const region of ['North', 'South']) rows.push({ Month: month, Region: region, Sales: region === 'North' ? 10 : 20 });
  }
  const spec = {
    id: 's',
    title: 'Sales over month by region',
    chart_type: 'line',
    sql: 'SELECT [Month], [Region], SUM([Sales]) AS [Total Sales] FROM SalesData GROUP BY [Month], [Region] ORDER BY [Month] ASC',
    xAxisKey: 'Month',
    yAxisKey: 'Total Sales',
    seriesKey: 'Region',
  };
  mountTable(rows);
  try {
    const [chart] = executeCharts([spec], rows);
    assert.equal(chart.xAxisKey, 'Month');
    assert.equal(chart.resultData.length, 6);
    assert.deepEqual([...new Set(chart.resultData.map((r) => r.Month))], ['2024-01', '2024-02', '2024-03']);
    assert.ok(chart.resultData.every((r) => r.Region === 'North' || r.Region === 'South'));
  } finally {
    unmountTable();
  }
});

// ---------------------------------------------------------------------------
// Rewriting the view name must not reach inside quoted text
// ---------------------------------------------------------------------------

test('the view-name rewrite leaves string literals alone', () => {
  // `SalesData` was replaced wherever it appeared, quotes included, so a filter
  // comparing against that text silently matched nothing and a selected literal
  // came back as "[SalesData]".
  mountTable([{ note: 'SalesData', v: 1 }, { note: 'other', v: 2 }]);
  try {
    assert.deepEqual(runSql("SELECT v FROM SalesData WHERE note = 'SalesData'"), [{ v: 1 }]);
    assert.deepEqual(runSql("SELECT 'SalesData' AS s FROM SalesData LIMIT 1"), [{ s: 'SalesData' }]);
    // The rewrite itself still happens outside the quotes.
    assert.deepEqual(runSql('SELECT COUNT(*) AS n FROM salesdata'), [{ n: 2 }]);
  } finally {
    unmountTable();
  }
});

// ---------------------------------------------------------------------------
// Self-healing a broken query
// ---------------------------------------------------------------------------

test('a chart still heals when the first row happens to be empty', () => {
  // The fallback read its column types out of `rows[0]` alone. One null in the
  // first record — an optional field, which is what optional fields do — and it
  // found no category and no measure, so a query that returned nothing usable
  // was left exactly as it was and the slide rendered the raw rows.
  const rows = Array.from({ length: 60 }, (_, i) => ({
    Region: i === 0 ? null : ['North', 'South', 'East', 'West'][i % 4],
    Revenue: i === 0 ? null : 100 + (i % 17) * 7,
  }));
  mountTable(rows);
  try {
    const [healed] = executeCharts(
      [{ id: 'a', title: 'Broken', chart_type: 'bar', sql: 'SELECT [Nope] FROM SalesData', xAxisKey: 'Nope', yAxisKey: 'Nope' }],
      rows
    );
    assert.ok(healed.healed, 'the chart was rebuilt');
    assert.equal(healed.xAxisKey, 'Region');
    // Four regions plus the row whose region was blank.
    assert.equal(healed.resultData.length, 5);
    const named = healed.resultData.filter((r) => r.Region !== null);
    assert.equal(named.length, 4);
    assert.ok(named.every((r) => typeof r.Average === 'number'));
  } finally {
    unmountTable();
  }
});

test('a downgraded chart does not keep a title for the shape it lost', () => {
  /*
   * The radar case, from a real deck: three measures the resolver could not
   * draw on one radial axis, reduced to a donut of the one it could, still
   * headed "Product Category Profile Across Key Metrics" — a promise of key
   * metrics, over a chart of one.
   */
  assert.equal(
    titleForDrawn('Product Category Profile Across Key Metrics', ['Average Revenue'], ['Average Revenue'], 'product_category'),
    'Average Revenue by Product Category'
  );
});

test('a title that names a series the chart no longer draws is rewritten', () => {
  // A combo chart reduced to one series, still advertising both.
  assert.equal(
    titleForDrawn(
      'Total Revenue and Average Price by Month',
      ['Total Revenue', 'Average Price'],
      ['Total Revenue', null],
      'month'
    ),
    'Total Revenue by Month'
  );
});

test('a title that still describes what is drawn is left alone', () => {
  // A waterfall falling back to a bar is still a chart of total revenue by
  // month, and somebody wrote that heading on purpose.
  assert.equal(
    titleForDrawn('What Moved Total Revenue by Month', ['Total Revenue'], ['Total Revenue'], 'month'),
    'What Moved Total Revenue by Month'
  );
  // And a chart with nothing numeric left to draw keeps whatever it had, rather
  // than being retitled after an empty list of measures.
  assert.equal(titleForDrawn('Distribution of Revenue', ['Record Count'], [], 'revenue_band'), 'Distribution of Revenue');
});
