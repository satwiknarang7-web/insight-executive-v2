import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChart, analyzeStoryboard } from '../lib/insightEngine.js';
import { enforceChartDiversity, executeCharts, mountTable, runAnalysis, unmountTable } from '../lib/pipeline.js';

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

test('diversity enforcement never retypes a distribution chart', () => {
  const charts = [
    { title: 'A by Region', chart_type: 'bar', xAxisKey: 'Region', yAxisKey: 'Total', resultData: [{ Region: 'N', Total: 5 }, { Region: 'S', Total: 3 }] },
    { title: 'B by Channel', chart_type: 'bar', xAxisKey: 'Channel', yAxisKey: 'Total', resultData: [{ Channel: 'X', Total: 4 }, { Channel: 'Y', Total: 2 }] },
    { ...histogram, chart_type: 'bar' },
  ];
  enforceChartDiversity(charts);
  assert.equal(charts[2].chart_type, 'bar', 'the histogram must stay a bar chart');
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

test('a share chart is never retyped into a time series', () => {
  // Regions have no chronological order; drawing them as an area chart made the
  // narrative describe a "trend" over them.
  const share = {
    title: 'Region Share of Monthly Charge',
    chart_type: 'donut',
    xAxisKey: 'region',
    yAxisKey: 'Total',
    resultData: [
      { region: 'West', Total: 20300 },
      { region: 'North', Total: 19400 },
      { region: 'East', Total: 18900 },
      { region: 'South', Total: 17200 },
    ],
  };
  const charts = [
    { ...share },
    { ...share, title: 'Plan Share', xAxisKey: 'plan', resultData: share.resultData.map((r) => ({ plan: r.region, Total: r.Total })) },
    { ...share, title: 'Channel Share', xAxisKey: 'channel', resultData: share.resultData.map((r) => ({ channel: r.region, Total: r.Total })) },
  ];
  enforceChartDiversity(charts);
  for (const c of charts) {
    assert.ok(!['line', 'area'].includes(c.chart_type), `${c.title} became ${c.chart_type}`);
  }
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

test('histogram buckets are ordered low to high, whatever order SQL returns', () => {
  // AlaSQL ignores ORDER BY over an aggregate of an unselected column, so the
  // planner's intended bucket order has to be reapplied after execution.
  // Skewed rather than evenly spread. A uniform column has no shape to show, so
  // it no longer earns a histogram at all — and this test is about the order of
  // the buckets, not about which columns deserve one.
  const rows = [];
  for (let i = 0; i < 300; i++) {
    const tail = i > 270 ? 5 : i > 240 ? 2.5 : 1;
    rows.push({ channel: ['A', 'B', 'C'][i % 3], impressions: (45000 + ((i * 7919) % 90000)) * tail });
  }
  const { charts } = runAnalysis(rows);
  const hist = charts.find((c) => /Distribution/.test(c.title));
  assert.ok(hist, 'expected a distribution chart');

  const labels = hist.resultData.map((r) => r[hist.xAxisKey]);
  assert.ok(labels.length >= 3, 'expected several buckets');
  assert.match(labels[labels.length - 1], /\+$/, 'the open-ended bucket must come last');

  // Each label starts with its own lower edge, so the leading numbers ascend.
  const lead = (l) => parseFloat(String(l).replace(/[^0-9.]/g, '')) * (/K/.test(l) ? 1000 : 1);
  for (let i = 1; i < labels.length; i++) {
    assert.ok(lead(labels[i]) >= lead(labels[i - 1]), `buckets out of order: ${labels.join(' | ')}`);
  }
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

/**
 * A deck where the only advanced type still missing is a part-to-whole one, so
 * the diversity pass reaches for a share chart on its very first attempt. The
 * pass walks the deck backwards and advances through the missing types one per
 * chart, so the chart under test goes last.
 */
function deckMissingOnlyShareTypes(subject) {
  const present = [
    { id: 'area', chart_type: 'area', xAxisKey: 'Month', yAxisKey: 'Total Revenue',
      resultData: [
        { Month: '2026-01', 'Total Revenue': 100 },
        { Month: '2026-02', 'Total Revenue': 140 },
      ] },
    { id: 'scatter', chart_type: 'scatter', xAxisKey: 'Spend', yAxisKey: 'Total Revenue',
      resultData: [{ Spend: 1, 'Total Revenue': 2 }, { Spend: 3, 'Total Revenue': 5 }] },
    { id: 'radar', chart_type: 'radar', xAxisKey: 'Team', yAxisKey: 'Total Revenue',
      resultData: [{ Team: 'A', 'Total Revenue': 2 }, { Team: 'B', 'Total Revenue': 5 }] },
    { id: 'composed', chart_type: 'composed', xAxisKey: 'Team', yAxisKey: 'Total Revenue',
      resultData: [{ Team: 'A', 'Total Revenue': 2 }, { Team: 'B', 'Total Revenue': 5 }] },
    // Two bars, so the pass is willing to retype one of them.
    { id: 'filler', title: 'Total Revenue by Channel', chart_type: 'bar', xAxisKey: 'Channel',
      yAxisKey: 'Total Revenue',
      resultData: [
        { Channel: 'Online', 'Total Revenue': 900 },
        { Channel: 'Retail', 'Total Revenue': 400 },
        { Channel: 'Partner', 'Total Revenue': 120 },
      ] },
    subject,
  ];
  return enforceChartDiversity(present.map((c) => ({ ...c })));
}

test('an average by category is never redrawn as a part-to-whole chart', () => {
  // A donut asserts that its slices add up to something. Four category averages
  // sum to a number that is not the revenue of any business, so a slice of it
  // reads as a market share of a quantity that does not exist.
  const out = deckMissingOnlyShareTypes({
    id: 'subject',
    title: 'Average Total Revenue by Category',
    chart_type: 'bar',
    xAxisKey: 'Category',
    yAxisKey: 'Average Total Revenue',
    resultData: [
      { Category: 'Electronics', 'Average Total Revenue': 800 },
      { Category: 'Home', 'Average Total Revenue': 210 },
      { Category: 'Toys', 'Average Total Revenue': 160 },
      { Category: 'Garden', 'Average Total Revenue': 110 },
    ],
  });
  const subject = out.find((c) => c.id === 'subject');
  for (const partToWhole of ['donut', 'treemap', 'radial', 'pie']) {
    assert.notEqual(subject.chart_type, partToWhole, `averages drawn as a ${partToWhole}`);
  }
});

test('a summed measure is still free to be redrawn as a share', () => {
  const out = deckMissingOnlyShareTypes({
    id: 'subject',
    title: 'Total Revenue by Category',
    chart_type: 'bar',
    xAxisKey: 'Category',
    yAxisKey: 'Total Revenue',
    resultData: [
      { Category: 'Electronics', 'Total Revenue': 800 },
      { Category: 'Home', 'Total Revenue': 210 },
      { Category: 'Toys', 'Total Revenue': 160 },
      { Category: 'Garden', 'Total Revenue': 110 },
    ],
  });
  const subject = out.find((c) => c.id === 'subject');
  assert.ok(
    ['donut', 'treemap', 'radial'].includes(subject.chart_type),
    `a real total should still be offered as a share, got ${subject.chart_type}`
  );
});
