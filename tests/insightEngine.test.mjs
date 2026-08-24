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

test('the risk card names the same concentration the opening line does', () => {
  // A composition chart reports `dominantSharePct`, not `leaderSharePct`. Risk
  // used to read only the latter, so it announced no concentration directly
  // beside an opening line calling concentration the dominant story.
  const charts = [
    {
      id: 's1', title: 'Plan Mix', chart_type: 'donut', xAxisKey: 'plan', yAxisKey: 'accounts',
      resultData: [
        { plan: 'Enterprise', accounts: 456 },
        { plan: 'Basic', accounts: 261 },
        { plan: 'Pro', accounts: 183 },
        { plan: 'Free', accounts: 100 },
      ],
    },
  ];
  const { synthesis } = analyzeStoryboard(charts, new Array(1000).fill({}));
  const { risk, opportunity } = synthesis.strategicScorecard;

  assert.match(synthesis.headline, /concentration/i);
  assert.match(risk, /Enterprise/, 'the risk names the concentrated category');
  assert.doesNotMatch(risk, /no single dominant|not detected/i);
  assert.notEqual(risk, opportunity);
});

test('a leader on half the total is never called a balanced mix', () => {
  // A long tail holds HHI under 0.5 while one category still carries half the
  // business. Focus read HHI and said "maintain the balanced mix"; risk read the
  // top share and said "outsized" — the two cards contradicted each other.
  const chart = {
    title: 'Product Category by Revenue',
    chart_type: 'radial',
    xAxisKey: 'cat',
    yAxisKey: 'rev',
    resultData: [
      { cat: 'Electronics', rev: 513 },
      { cat: 'Apparel', rev: 130 },
      { cat: 'Grocery', rev: 120 },
      { cat: 'Home', rev: 110 },
      { cat: 'Beauty', rev: 70 },
      { cat: 'Sports', rev: 57 },
    ],
  };
  const f = analyzeChart(chart);
  assert.ok(f.metrics.hhi < 0.5, 'the tail keeps HHI below the old threshold');
  assert.ok(f.metrics.dominantSharePct >= 40);
  assert.doesNotMatch(f.recommendation, /balanced mix/i);
  assert.match(f.recommendation, /Electronics/);

  const { synthesis } = analyzeStoryboard([chart], new Array(720).fill({}));
  const { focus, risk } = synthesis.strategicScorecard;
  assert.doesNotMatch(focus, /balanced/i, 'focus does not call it balanced');
  assert.match(risk, /outsized share/, 'while risk calls it concentrated');
});

test('risk and opportunity are never the same fact pointing two ways', () => {
  const concentration = {
    id: 's1', title: 'Plan Mix', chart_type: 'donut', xAxisKey: 'plan', yAxisKey: 'accounts',
    resultData: [
      { plan: 'Enterprise', accounts: 456 },
      { plan: 'Basic', accounts: 261 },
      { plan: 'Pro', accounts: 183 },
      { plan: 'Free', accounts: 100 },
    ],
  };
  const growth = {
    id: 's2', title: 'Revenue by Month', chart_type: 'line', xAxisKey: 'month', yAxisKey: 'rev',
    resultData: [
      { month: '2025-01', rev: 100 },
      { month: '2025-02', rev: 140 },
      { month: '2025-03', rev: 190 },
      { month: '2025-04', rev: 260 },
    ],
  };
  const { synthesis } = analyzeStoryboard([concentration, growth], new Array(1000).fill({}));
  const { risk, opportunity } = synthesis.strategicScorecard;

  assert.match(risk, /Enterprise/, 'the concentration is the risk');
  assert.doesNotMatch(opportunity, /45\.6%|Enterprise/, 'so it cannot also be the opportunity');
  assert.ok(opportunity.length > 0, 'the genuine upside is reported instead');
});

test('with nothing positive left, the opportunity card is empty rather than the risk restated', () => {
  const charts = [
    {
      id: 's1', title: 'Plan Mix', chart_type: 'donut', xAxisKey: 'plan', yAxisKey: 'accounts',
      resultData: [
        { plan: 'Enterprise', accounts: 456 },
        { plan: 'Basic', accounts: 261 },
        { plan: 'Pro', accounts: 183 },
        { plan: 'Free', accounts: 100 },
      ],
    },
  ];
  const { synthesis } = analyzeStoryboard(charts, new Array(1000).fill({}));

  assert.match(synthesis.strategicScorecard.risk, /Enterprise/);
  assert.equal(synthesis.strategicScorecard.opportunity, '');
});

test('a scorecard card is left empty rather than filled with "nothing found"', () => {
  // An even spread with no trend: there is genuinely no risk to report.
  const charts = [
    {
      id: 's1', title: 'Orders by Region', chart_type: 'bar', xAxisKey: 'region', yAxisKey: 'orders',
      resultData: [
        { region: 'North', orders: 260 },
        { region: 'South', orders: 255 },
        { region: 'East', orders: 250 },
        { region: 'West', orders: 245 },
      ],
    },
  ];
  const { synthesis } = analyzeStoryboard(charts, new Array(1010).fill({}));

  assert.equal(synthesis.strategicScorecard.risk, '', 'no risk means no risk card');
});
