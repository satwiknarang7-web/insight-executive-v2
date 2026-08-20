import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChart, analyzeStoryboard } from '../lib/insightEngine.js';
import { enforceChartDiversity, runAnalysis } from '../lib/pipeline.js';

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
  assert.match(synthesis.strategicScorecard.opportunity, /Electronics/);
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
  const rows = [];
  for (let i = 0; i < 300; i++) {
    rows.push({ channel: ['A', 'B', 'C'][i % 3], impressions: 45000 + ((i * 7919) % 600000) });
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
