import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeChart,
  analyzeStoryboard,
  pearson,
  compactNum,
} from '../lib/insightEngine.js';

test('compactNum formats magnitudes', () => {
  assert.equal(compactNum(1500000), '1.5M');
  assert.equal(compactNum(2400), '2.4K');
  assert.equal(compactNum(56), '56');
  assert.equal(compactNum(0.42), '0.42');
});

test('pearson detects a perfect positive relationship', () => {
  const r = pearson([1, 2, 3, 4], [2, 4, 6, 8]);
  assert.ok(r > 0.99);
});

test('pearson returns null for constant data', () => {
  assert.equal(pearson([1, 1, 1, 1], [2, 4, 6, 8]), null);
});

test('ranking chart: leader, share and average are computed from real data', () => {
  const chart = {
    id: 'slide_1',
    title: 'Revenue by Region',
    chart_type: 'bar',
    xAxisKey: 'region',
    yAxisKey: 'Total',
    resultData: [
      { region: 'North', Total: 5000 },
      { region: 'South', Total: 3000 },
      { region: 'East', Total: 1500 },
      { region: 'West', Total: 500 },
    ],
  };
  const f = analyzeChart(chart);
  assert.equal(f.metrics.leader, 'North');
  assert.equal(f.metrics.leaderValue, 5000);
  assert.equal(f.metrics.leaderSharePct, 50); // 5000 / 10000
  assert.equal(f.metrics.categories, 4);
  assert.equal(f.metrics.laggard, 'West');
  assert.ok(f.headline.includes('North'));
  // No invented numbers — share must match arithmetic exactly.
  assert.ok(f.verifiedFacts.some((x) => x.includes('50')));
});

test('trend chart: direction and total change reflect the series', () => {
  const chart = {
    id: 'slide_2',
    title: 'Revenue Trend Over Month',
    chart_type: 'area',
    xAxisKey: 'Month',
    yAxisKey: 'Total',
    resultData: [
      { Month: '2026-01', Total: 100 },
      { Month: '2026-02', Total: 120 },
      { Month: '2026-03', Total: 140 },
      { Month: '2026-04', Total: 200 },
    ],
  };
  const f = analyzeChart(chart);
  assert.equal(f.metrics.direction, 'rising');
  assert.equal(f.metrics.totalChangePct, 100); // 100 -> 200
  assert.equal(f.metrics.peakLabel, '2026-04');
  assert.equal(f.metrics.troughLabel, '2026-01');
});

test('declining trend is detected', () => {
  const chart = {
    chart_type: 'line',
    xAxisKey: 'Year',
    yAxisKey: 'Sales',
    resultData: [
      { Year: '2022', Sales: 500 },
      { Year: '2023', Sales: 400 },
      { Year: '2024', Sales: 250 },
    ],
  };
  const f = analyzeChart(chart);
  assert.equal(f.metrics.direction, 'declining');
  assert.equal(f.metrics.totalChangePct, -50);
});

test('composition chart: dominant share and HHI concentration', () => {
  const chart = {
    title: 'Category Share',
    chart_type: 'donut',
    xAxisKey: 'cat',
    yAxisKey: 'val',
    resultData: [
      { cat: 'A', val: 80 },
      { cat: 'B', val: 15 },
      { cat: 'C', val: 5 },
    ],
  };
  const f = analyzeChart(chart);
  assert.equal(f.metrics.dominant, 'A');
  assert.equal(f.metrics.dominantSharePct, 80);
  assert.equal(f.metrics.concentration, 'high'); // HHI = .64+.0225+.0025 > 0.5
});

test('scatter chart: correlation strength and direction', () => {
  const chart = {
    title: 'Spend vs Conversions',
    chart_type: 'scatter',
    xAxisKey: 'spend',
    yAxisKey: 'conversions',
    resultData: [
      { campaign: 'a', spend: 10, conversions: 100 },
      { campaign: 'b', spend: 20, conversions: 210 },
      { campaign: 'c', spend: 30, conversions: 290 },
      { campaign: 'd', spend: 40, conversions: 420 },
    ],
  };
  const f = analyzeChart(chart);
  assert.equal(f.metrics.direction, 'positive');
  assert.ok(['strong', 'very strong'].includes(f.metrics.strength));
  assert.ok(f.metrics.correlation > 0.9);
});

test('outliers are flagged via IQR', () => {
  const chart = {
    chart_type: 'bar',
    xAxisKey: 'name',
    yAxisKey: 'v',
    resultData: [
      { name: 'a', v: 10 },
      { name: 'b', v: 11 },
      { name: 'c', v: 12 },
      { name: 'd', v: 13 },
      { name: 'e', v: 9 },
      { name: 'f', v: 200 },
    ],
  };
  const f = analyzeChart(chart);
  assert.ok(f.metrics.outliers.includes('f'));
});

test('empty result data returns null', () => {
  assert.equal(analyzeChart({ resultData: [] }), null);
  assert.equal(analyzeChart({ resultData: null }), null);
});

test('analyzeStoryboard produces synthesis with macro insights', () => {
  const charts = [
    {
      id: 's1', title: 'Revenue by Region', chart_type: 'bar', xAxisKey: 'region', yAxisKey: 'Total',
      resultData: [
        { region: 'North', Total: 9000 },
        { region: 'South', Total: 600 },
        { region: 'East', Total: 400 },
      ],
    },
    {
      id: 's2', title: 'Revenue Trend', chart_type: 'area', xAxisKey: 'Month', yAxisKey: 'Total',
      resultData: [
        { Month: '2026-01', Total: 100 },
        { Month: '2026-02', Total: 300 },
      ],
    },
  ];
  const { perChart, synthesis } = analyzeStoryboard(charts, new Array(50).fill({}));
  assert.equal(perChart.length, 2);
  assert.equal(synthesis.rowsAnalyzed, 50);
  assert.ok(synthesis.macroInsights.length >= 1);
  assert.ok(synthesis.strategicScorecard.risk.length > 0);
});

test('histogram range labels are NOT misread as a time trend', () => {
  const chart = {
    title: 'Distribution of Revenue',
    chart_type: 'bar',
    xAxisKey: 'Revenue Range',
    yAxisKey: 'Count',
    resultData: [
      { 'Revenue Range': '1000-1850', Count: 20 },
      { 'Revenue Range': '1850-2700', Count: 64 },
      { 'Revenue Range': '2700-3550', Count: 40 },
      { 'Revenue Range': '3550+', Count: 20 },
    ],
  };
  const f = analyzeChart(chart);
  // Should describe a distribution (modal band), never a "trend".
  assert.equal(f.metrics.modalBucket, '1850-2700');
  assert.ok(!('direction' in f.metrics), 'distribution must not produce a trend direction');
  assert.ok(/band/i.test(f.headline));
});

test('single-period trend reads cleanly (no "from X to X")', () => {
  const chart = {
    chart_type: 'area',
    xAxisKey: 'Month',
    yAxisKey: 'Total',
    resultData: [
      { Month: '2026-04', Total: 100 },
      { Month: '2026-04', Total: 100 },
    ],
  };
  const f = analyzeChart(chart);
  assert.ok(!/from 2026-04 to 2026-04/.test(f.headline), 'should not repeat identical span');
  assert.ok(/stayed around/.test(f.headline));
});

test('the synthesis opens with a line that is not just the first bullet again', () => {
  const charts = [
    {
      id: 's1', title: 'Revenue by Category', chart_type: 'bar', xAxisKey: 'cat', yAxisKey: 'Total',
      resultData: [
        { cat: 'Electronics', Total: 9000 },
        { cat: 'Toys', Total: 600 },
        { cat: 'Books', Total: 400 },
      ],
    },
  ];
  const { synthesis } = analyzeStoryboard(charts, new Array(1200).fill({}));

  assert.ok(synthesis.headline.length > 0);
  assert.notEqual(synthesis.headline, synthesis.macroInsights[0]);
  // A concentrated leader is named, with the scale of the data it came from.
  assert.match(synthesis.headline, /Electronics/);
  assert.match(synthesis.headline, /1,200 rows/);
});

test('a summary bullet carries a consequence, not just the reading', () => {
  const charts = [
    {
      id: 's1', title: 'Revenue by Category', chart_type: 'bar', xAxisKey: 'cat', yAxisKey: 'Total',
      resultData: [
        { cat: 'Electronics', Total: 9000 },
        { cat: 'Toys', Total: 600 },
        { cat: 'Books', Total: 400 },
      ],
    },
  ];
  const { perChart, synthesis } = analyzeStoryboard(charts, []);
  const bullet = synthesis.macroInsights[0];

  assert.ok(bullet.startsWith(perChart[0].headline), 'the finding still leads the bullet');
  assert.ok(bullet.length > perChart[0].headline.length, 'and something follows from it');
  assert.ok(bullet.length <= 240);
});

test('no findings still produces an honest opening line', () => {
  const { synthesis } = analyzeStoryboard([], []);
  assert.match(synthesis.headline, /Nothing/);
  assert.equal(synthesis.macroInsights.length, 1);
});
