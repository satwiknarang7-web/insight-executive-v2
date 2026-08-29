import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeChart,
  analyzeStoryboard,
  chronological,
  pearson,
  compactNum,
  truncation,
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

// ---------------------------------------------------------------------------
// Saying it correctly: a share of the top ten is not a share of the business
// ---------------------------------------------------------------------------

test('a result that hit its own LIMIT is known to be the top, not the whole', () => {
  assert.deepEqual(truncation({ sql: 'SELECT a FROM t GROUP BY a LIMIT 10' }, 10), {
    limited: true,
    limit: 10,
  });
  assert.equal(truncation({ sql: 'SELECT a FROM t GROUP BY a LIMIT 10' }, 6).limited, false, 'room to spare');
  assert.equal(truncation({ sql: 'SELECT SUM(x) AS v FROM t' }, 1).limited, false, 'no limit at all');
});

test('shares from a truncated query are not described as shares of the total', () => {
  const rows = [
    { Region: 'West', Revenue: 500 },
    { Region: 'East', Revenue: 300 },
    { Region: 'North', Revenue: 200 },
  ];
  const capped = analyzeChart({
    id: 'c1',
    title: 'Revenue by region',
    chart_type: 'bar',
    xAxisKey: 'Region',
    yAxisKey: 'Revenue',
    sql: 'SELECT [Region], SUM([Revenue]) AS [Revenue] FROM SalesData GROUP BY [Region] LIMIT 3',
    resultData: rows,
  });
  assert.equal(capped.metrics.sharesMeasuredAgainst, 'shown');
  assert.match(capped.headline, /of the 3 shown/);
  assert.match(capped.detail, /not of the whole dataset/);

  const whole = analyzeChart({
    id: 'c2',
    title: 'Revenue by region',
    chart_type: 'bar',
    xAxisKey: 'Region',
    yAxisKey: 'Revenue',
    sql: 'SELECT [Region], SUM([Revenue]) AS [Revenue] FROM SalesData GROUP BY [Region]',
    resultData: rows,
  });
  assert.equal(whole.metrics.sharesMeasuredAgainst, 'total');
  assert.match(whole.headline, /of the total/);
  assert.doesNotMatch(whole.detail, /not of the whole dataset/);
});

test('a trend is read off the calendar, not off the sort order', () => {
  // Exactly what `ORDER BY revenue DESC LIMIT 4` returns for a rising year.
  const sortedBySize = [
    { Month: '2026-04', Revenue: 400 },
    { Month: '2026-03', Revenue: 300 },
    { Month: '2026-02', Revenue: 200 },
    { Month: '2026-01', Revenue: 100 },
  ];
  const finding = analyzeChart({
    id: 't1',
    title: 'Revenue by month',
    chart_type: 'line',
    xAxisKey: 'Month',
    yAxisKey: 'Revenue',
    resultData: sortedBySize,
  });
  assert.equal(finding.metrics.direction, 'rising', 'the year rose; only the query descended');
  assert.equal(finding.metrics.startLabel, '2026-01');
  assert.equal(finding.metrics.endLabel, '2026-04');
});

test('labels that are not periods keep the order the query chose', () => {
  const points = [{ label: 'West', value: 3 }, { label: 'East', value: 1 }];
  assert.deepEqual(chronological(points), points, 'no arbitrary re-sort');
});

test('the last period is reported separately from the overall direction', () => {
  const rows = [
    { Month: '2026-01', Revenue: 100 },
    { Month: '2026-02', Revenue: 150 },
    { Month: '2026-03', Revenue: 200 },
    { Month: '2026-04', Revenue: 160 },
  ];
  const finding = analyzeChart({
    id: 't2',
    title: 'Revenue by month',
    chart_type: 'line',
    xAxisKey: 'Month',
    yAxisKey: 'Revenue',
    resultData: rows,
  });
  assert.equal(finding.metrics.direction, 'rising');
  assert.ok(finding.metrics.lastPeriodChangePct < 0, 'the last month fell');
  assert.match(finding.detail, /breaking the trend/);
});

// ---------------------------------------------------------------------------
// A fitted direction and a start-to-end change are two measurements, not one.
//
// The bug these cover: the headline took its adjective from the regression
// slope and its percentage from the endpoints, so a series that climbed for six
// periods and collapsed in the seventh was described as "trended up ... a 10.0%
// decrease" — a contradiction inside one clause, on a slide, in a product whose
// promise is an analysis you can defend. The same pairing appeared in the
// implication, the summary lede and both scorecard cards.
// ---------------------------------------------------------------------------

/** A month-by-month line chart over the given values. */
const trendChart = (values, id = 'rev') => ({
  id,
  title: 'Revenue by month',
  chart_type: 'line',
  xAxisKey: 'Month',
  yAxisKey: 'Revenue',
  sql: 'SELECT [Month], SUM([Revenue]) AS [Revenue] FROM SalesData GROUP BY [Month] ORDER BY [Month] ASC',
  resultData: values.map((v, i) => ({ Month: `2025-${String(i + 1).padStart(2, '0')}`, Revenue: v })),
});

const REVERSED_UP = [100, 140, 180, 220, 260, 300, 90]; // rises, then collapses
const REVERSED_DOWN = [300, 260, 220, 180, 140, 100, 340]; // falls, then recovers

test('a headline never calls the same move both an increase and a decrease', () => {
  for (const values of [REVERSED_UP, REVERSED_DOWN]) {
    const { headline } = analyzeChart(trendChart(values));
    const saysUp = /trended up|increase/.test(headline);
    const saysDown = /trended down|decrease/.test(headline);
    assert.ok(!(saysUp && saysDown), `contradictory headline: ${headline}`);
  }
});

test('a series that rises then collapses is described as both, not as one', () => {
  const f = analyzeChart(trendChart(REVERSED_UP));
  assert.equal(f.metrics.direction, 'rising');
  assert.equal(f.metrics.totalChangePct, -10);
  assert.match(f.headline, /rose across most of/);
  assert.match(f.headline, /finished 10\.0% below where it started/);
  assert.ok(f.metrics.netChangeVsTrend, 'the disagreement is recorded for the narrator');
});

test('a series that falls then recovers reads the same way, mirrored', () => {
  const f = analyzeChart(trendChart(REVERSED_DOWN));
  assert.equal(f.metrics.direction, 'declining');
  assert.match(f.headline, /fell across most of/);
  assert.match(f.headline, /finished 13\.3% above where it started/);
});

test('an ordinary trend keeps the wording it always had', () => {
  const up = analyzeChart(trendChart([100, 140, 180, 220, 260, 300, 340]));
  assert.equal(up.headline, 'Revenue trended up from 2025-01 to 2025-07, a 240.0% increase.');
  assert.equal(up.metrics.netChangeVsTrend, null);

  const down = analyzeChart(trendChart([340, 300, 260, 220, 180, 140, 100]));
  assert.match(down.headline, /trended down from 2025-01 to 2025-07, a 70\.6% decrease\./);
  assert.equal(down.metrics.netChangeVsTrend, null);
});

test('a flat series reports its net change as its own fact, not as a move', () => {
  const f = analyzeChart(trendChart([200, 205, 198, 202, 199, 203, 201]));
  assert.equal(f.metrics.direction, 'flat');
  assert.match(f.headline, /held roughly flat from 2025-01 to 2025-07, within 0\.5% end to end\./);
});

test('the per-period rate is named as the endpoint measure it is', () => {
  // It is a start-to-end rate, so on a reversed series it runs opposite to the
  // fitted direction. Saying "that works out to" made it read as a restatement
  // of the trend rather than a second measurement of it.
  const f = analyzeChart(trendChart(REVERSED_UP));
  assert.match(f.detail, /Measured start to end that is about 1\.7% decline per period/);
});

test('a reversal is put on the risk card, never offered as the opportunity', () => {
  const rows = trendChart(REVERSED_UP).resultData;
  const { synthesis } = analyzeStoryboard([trendChart(REVERSED_UP)], rows);
  const { risk, opportunity } = synthesis.strategicScorecard;

  assert.match(risk, /rose for most of the period and then turned/);
  assert.match(risk, /ending 10\.0% below where it started/);
  // A rise that ended below its start is not an upside to chase, and the
  // opportunity card only ever looked at the fitted direction.
  assert.equal(opportunity, '');
});

test('the risk card does not quote a recovery as the size of a fall', () => {
  const rows = trendChart(REVERSED_DOWN).resultData;
  const { synthesis } = analyzeStoryboard([trendChart(REVERSED_DOWN)], rows);
  const { risk } = synthesis.strategicScorecard;

  assert.match(risk, /still trending down, though it has recovered past where it started/);
  assert.ok(!/13\.3%/.test(risk), 'the +13.3% net change is not reported as a decline');
});

test('the summary lede calls a reversal a reversal', () => {
  const rows = trendChart(REVERSED_UP).resultData;
  const { synthesis } = analyzeStoryboard([trendChart(REVERSED_UP)], rows);
  assert.match(synthesis.headline, /is a reversal:/);
  assert.match(synthesis.headline, /rose for most of the period and ended 10\.0% below where it started/);
  assert.ok(!/is growth:/.test(synthesis.headline));
});

test('every summary bullet carries a consequence a decision could hang on', () => {
  const charts = [
    {
      id: 'a',
      title: 'Revenue by category',
      chart_type: 'bar',
      xAxisKey: 'Category',
      yAxisKey: 'Revenue',
      resultData: [
        { Category: 'Electronics', Revenue: 900 },
        { Category: 'Home', Revenue: 220 },
        { Category: 'Toys', Revenue: 180 },
        { Category: 'Garden', Revenue: 90 },
      ],
    },
    {
      id: 'b',
      title: 'Revenue by month',
      chart_type: 'line',
      xAxisKey: 'Month',
      yAxisKey: 'Revenue',
      resultData: [
        { Month: '2026-01', Revenue: 400 },
        { Month: '2026-02', Revenue: 330 },
        { Month: '2026-03', Revenue: 280 },
        { Month: '2026-04', Revenue: 210 },
      ],
    },
  ];
  const { synthesis } = analyzeStoryboard(charts, new Array(500).fill({}));

  assert.ok(synthesis.macroInsights.length >= 1);
  for (const bullet of synthesis.macroInsights) {
    assert.ok(bullet.length > 60, `a bullet is more than a reading: ${bullet}`);
  }
  assert.ok(Array.isArray(synthesis.caveats), 'the summary carries its own caveats');
});

test('a truncated chart puts its caveat on the summary, not only on its slide', () => {
  const charts = [
    {
      id: 'a',
      title: 'Revenue by category',
      chart_type: 'bar',
      xAxisKey: 'Category',
      yAxisKey: 'Revenue',
      sql: 'SELECT [Category], SUM([Revenue]) AS [Revenue] FROM SalesData GROUP BY [Category] LIMIT 2',
      resultData: [
        { Category: 'Electronics', Revenue: 900 },
        { Category: 'Home', Revenue: 220 },
      ],
    },
  ];
  const { synthesis } = analyzeStoryboard(charts, new Array(500).fill({}));
  assert.equal(synthesis.caveats.length, 1);
  assert.match(synthesis.caveats[0], /not of the whole dataset/);
});

// ---------------------------------------------------------------------------
// How much the prose is allowed to claim
//
// The complaint these cover is not that any sentence was wrong. It is that a
// fifteen-point lead over two hundred rows and a four-point lead over nine were
// written in exactly the same voice, because the engine only ever had the
// number and never how much the number was worth.
// ---------------------------------------------------------------------------

const ranking = (rows, extra = {}) => ({
  id: 'r',
  title: 'Revenue by Region',
  chart_type: 'bar',
  xAxisKey: 'region',
  yAxisKey: 'Revenue',
  resultData: rows,
  ...extra,
});

test('a bunched field is described as a tie, not as a ranking', () => {
  const f = analyzeChart(
    ranking([
      { region: 'North', Revenue: 1010 },
      { region: 'South', Revenue: 1000 },
      { region: 'East', Revenue: 990 },
      { region: 'West', Revenue: 1005 },
      { region: 'Central', Revenue: 995 },
    ])
  );
  assert.match(f.metrics.leadIsReal, /provisional/);
  assert.match(f.detail, /nearer a tie than a ranking/);
  assert.match(f.recommendation, /provisional/);
  assert.equal(f.metrics.evidence, 'thin');
});

test('a statistically clear lead in a tight band is still not separation', () => {
  // Five values inside a one-percent band hand the top one a two-sigma lead,
  // because a z-score has no idea how small the gap is in the units anyone
  // cares about. Reporting that as separation manufactures a story out of
  // rounding, which is the single easiest way for a generated summary to be
  // technically true and completely misleading.
  const f = analyzeChart(
    ranking([
      { region: 'North', Revenue: 1010 },
      { region: 'South', Revenue: 1000 },
      { region: 'East', Revenue: 999 },
      { region: 'West', Revenue: 1001 },
      { region: 'Central', Revenue: 1000 },
    ])
  );
  assert.ok(f.metrics.leadOverFieldSd > 1.5, 'the z-score alone says "clear leader"');
  assert.doesNotMatch(f.detail, /standard deviations clear/);
  assert.doesNotMatch(f.detail, /leader rather than a first place/);
});

test('a runaway leader is called one, without an unreadable z-score', () => {
  const f = analyzeChart(
    ranking([
      { region: 'North', Revenue: 9000 },
      { region: 'South', Revenue: 300 },
      { region: 'East', Revenue: 290 },
      { region: 'West', Revenue: 280 },
      { region: 'Central', Revenue: 270 },
      { region: 'Coastal', Revenue: 260 },
      { region: 'Inland', Revenue: 250 },
      { region: 'Border', Revenue: 240 },
    ])
  );
  assert.match(f.metrics.leadIsReal, /clear of the rest/);
  assert.match(f.detail, /leader rather than a first place/);
  assert.doesNotMatch(f.detail, /\d{3,}\.\d standard deviations/, 'no arithmetic nobody can picture');
});

test('an average pulled up by a few large categories says so', () => {
  const f = analyzeChart(
    ranking([
      { region: 'North', Revenue: 9000 },
      { region: 'South', Revenue: 800 },
      { region: 'East', Revenue: 700 },
      { region: 'West', Revenue: 650 },
      { region: 'Central', Revenue: 600 },
      { region: 'Coastal', Revenue: 550 },
    ])
  );
  assert.ok(f.metrics.median < f.metrics.average);
  assert.ok(f.metrics.meanAboveMedianPct > 50);
  assert.match(f.detail, /pulling the mean up/);
});

test('two differently shaped rankings are not described in the same sentences', () => {
  const topHeavy = analyzeChart(
    ranking([
      { region: 'North', Revenue: 9000 },
      { region: 'South', Revenue: 400 },
      { region: 'East', Revenue: 300 },
      { region: 'West', Revenue: 200 },
    ])
  );
  const even = analyzeChart(
    ranking([
      { region: 'North', Revenue: 1100 },
      { region: 'South', Revenue: 1000 },
      { region: 'East', Revenue: 950 },
      { region: 'West', Revenue: 900 },
    ])
  );
  const shapeOf = (text) => text.replace(/[\d.,%×]+/g, '#');
  assert.notEqual(
    shapeOf(topHeavy.detail),
    shapeOf(even.detail),
    'the same template with different numbers is what makes a report read as generated'
  );
});

// ---------------------------------------------------------------------------
// A direction is worth what the fit behind it is worth
// ---------------------------------------------------------------------------

test('a faint direction over a noisy series is not offered as a trend', () => {
  const f = analyzeChart(trendChart([100, 180, 60, 210, 90, 240, 110, 250]));
  assert.equal(f.metrics.direction, 'rising');
  assert.ok(f.metrics.fitQualityPct < 30, `fit was ${f.metrics.fitQualityPct}`);
  assert.match(f.detail, /period-to-period variation/);
  assert.match(f.recommendation, /Do not plan off this direction yet/);
});

test('a clean series is not described as volatile just because it grew', () => {
  // A perfect exponential has an enormous coefficient of variation purely
  // because it went up. Reading that as volatility told the reader not to trust
  // the steadiest chart in the deck.
  const f = analyzeChart(trendChart([100, 140, 196, 274, 384, 538, 753]));
  assert.ok(f.metrics.volatilityPct > 40, 'raw spread around the mean is large');
  assert.ok(f.metrics.swingAroundTrendPct < 25, 'but the series barely leaves its trend');
  assert.doesNotMatch(f.detail, /Period-to-period swings are large/);
});

test('acceleration is read in the direction the series is going', () => {
  const falling = analyzeChart(trendChart([500, 470, 430, 380, 300, 220, 120]));
  assert.equal(falling.metrics.direction, 'declining');
  assert.equal(falling.metrics.momentum, 'accelerating');
  assert.match(falling.detail, /steepening/);
  assert.doesNotMatch(falling.detail, /picking up rather than levelling off/);

  const rising = analyzeChart(trendChart([100, 140, 196, 274, 384, 538, 753]));
  assert.equal(rising.metrics.momentum, 'accelerating');
  assert.match(rising.detail, /picking up rather than levelling off/);
});

test('a series sitting well below its own peak says so', () => {
  const f = analyzeChart(trendChart([500, 470, 520, 430, 380, 300, 260, 240]));
  assert.ok(f.metrics.belowPeakPct > 40);
  assert.match(f.detail, /below its 2025-03 peak/);

  const atPeak = analyzeChart(trendChart([100, 140, 196, 274, 384, 538, 753]));
  assert.equal(atPeak.metrics.belowPeakPct, null, 'a series at its high has no drawdown to report');
});

// ---------------------------------------------------------------------------
// Correlations that a chart cannot show you are correlations
// ---------------------------------------------------------------------------

const scatter = (points) => ({
  id: 'sc',
  title: 'Spend vs Conversions',
  chart_type: 'scatter',
  xAxisKey: 'spend',
  yAxisKey: 'conversions',
  resultData: points.map(([spend, conversions], i) => ({ campaign: `c${i}`, spend, conversions })),
});

test('a correlation within reach of chance is reported as such', () => {
  const f = analyzeChart(scatter([[1, 3], [2, 1], [3, 4], [4, 2]]));
  assert.match(f.metrics.statisticalSignificance, /within what chance produces/);
  assert.match(f.detail, /not distinguishable from chance/);
  assert.match(f.recommendation, /Collect more observations/);
  assert.equal(f.metrics.evidence, 'thin');
});

test('a correlation carried by one extreme point is flagged, not celebrated', () => {
  const blob = Array.from({ length: 14 }, (_, i) => [i + 1, [5, 3, 6, 2, 7, 1, 4, 8, 3, 6, 2, 7, 4, 5][i]]);
  const f = analyzeChart(scatter([...blob, [400, 900]]));
  assert.ok(f.metrics.correlation > 0.9, 'Pearson alone looks like a discovery');
  assert.ok(f.metrics.rankCorrelation < 0.6, 'the ranks do not agree');
  assert.match(f.metrics.outlierWarning, /extreme points are carrying/);
  assert.match(f.detail, /carrying the line/);
  assert.match(f.recommendation, /extreme points/);
});

test('an honest strong relationship keeps its plain reading', () => {
  const clean = Array.from({ length: 24 }, (_, i) => [i, i * 3 + (i % 2)]);
  const f = analyzeChart(scatter(clean));
  assert.match(f.metrics.statisticalSignificance, /stronger than chance/);
  assert.equal(f.metrics.outlierWarning, null);
  assert.match(f.recommendation, /usable lever/);
});

// ---------------------------------------------------------------------------
// A distribution decides whether an average may be quoted at all
// ---------------------------------------------------------------------------

test('a skewed distribution warns that the average is not the typical record', () => {
  const f = analyzeChart({
    id: 'd',
    title: 'Distribution of Basket Value',
    chart_type: 'bar',
    xAxisKey: 'Basket Value Range',
    yAxisKey: 'Record Count',
    resultData: [
      { 'Basket Value Range': '5-60', 'Record Count': 400 },
      { 'Basket Value Range': '60-115', 'Record Count': 60 },
      { 'Basket Value Range': '115-170', 'Record Count': 25 },
      { 'Basket Value Range': '170+', 'Record Count': 15 },
    ],
  });
  assert.equal(f.metrics.skew, 'right');
  assert.match(f.detail, /run long to the upper end/);
  assert.match(f.recommendation, /rather than the average/);
});

// ---------------------------------------------------------------------------
// What the charts say to each other
// ---------------------------------------------------------------------------

const revenueByCategory = {
  id: 'a',
  title: 'Total Revenue by Category',
  chart_type: 'bar',
  xAxisKey: 'Category',
  yAxisKey: 'Total Revenue',
  resultData: [
    { Category: 'Electronics', 'Total Revenue': 520000 },
    { Category: 'Home', 'Total Revenue': 180000 },
    { Category: 'Toys', 'Total Revenue': 90000 },
    { Category: 'Books', 'Total Revenue': 60000 },
  ],
};

const ordersByCategory = {
  id: 'b',
  title: 'Record Count Share by Category',
  chart_type: 'donut',
  xAxisKey: 'Category',
  yAxisKey: 'Record Count',
  resultData: [
    { Category: 'Books', 'Record Count': 9000 },
    { Category: 'Toys', 'Record Count': 6000 },
    { Category: 'Home', 'Record Count': 4000 },
    { Category: 'Electronics', 'Record Count': 2000 },
  ],
};

test('two measures over the same categories are reconciled into one statement', () => {
  const { synthesis } = analyzeStoryboard([revenueByCategory, ordersByCategory], new Array(21000).fill({}));
  const gap = synthesis.connections.find((c) => /Electronics/.test(c) && /but only/.test(c));

  assert.ok(gap, `expected the revenue/volume gap: ${JSON.stringify(synthesis.connections)}`);
  assert.match(gap, /61\.2% of total revenue/);
  assert.match(gap, /9\.5% of record count/);
  assert.match(gap, /where the margin sits/);
  assert.ok(synthesis.macroInsights.includes(gap), 'and it reaches the summary');
});

test('a composition headline names the measure it is a share of', () => {
  // Two composition slides over the same categories both said "42.9% of the
  // total". Side by side in one summary they read as a contradiction rather
  // than as the two halves of the most interesting fact in the file.
  const f = analyzeChart(ordersByCategory);
  assert.match(f.headline, /of record count/);
});

test('a trend that one segment largely is gets said out loud', () => {
  const trend = {
    id: 'c',
    title: 'Total Revenue Trend Over Month',
    chart_type: 'line',
    xAxisKey: 'Month',
    yAxisKey: 'Total Revenue',
    resultData: [100, 140, 175, 215, 250, 300, 340].map((v, i) => ({
      Month: `2025-0${i + 1}`,
      'Total Revenue': v * 1000,
    })),
  };
  const { synthesis } = analyzeStoryboard([revenueByCategory, trend], new Array(21000).fill({}));
  const link = synthesis.connections.find((c) => /substantially a report on/.test(c));
  assert.ok(link, `expected the trend/concentration link: ${JSON.stringify(synthesis.connections)}`);
  assert.match(link, /Electronics/);
});

test('shares of two different wholes are never compared', () => {
  // One chart stopped at its LIMIT and the other did not, so their percentages
  // are shares of different things. Putting them in one sentence would be
  // quietly false, and a reader has no way to catch it.
  const capped = {
    ...revenueByCategory,
    sql: 'SELECT [Category], SUM([Revenue]) AS [Total Revenue] FROM SalesData GROUP BY [Category] LIMIT 4',
  };
  const { synthesis } = analyzeStoryboard([capped, ordersByCategory], new Array(21000).fill({}));
  for (const line of synthesis.connections) {
    assert.doesNotMatch(line, /but only/, `compared two different wholes: ${line}`);
  }
});

test('no two summary bullets draw the same consequence', () => {
  const concentratedTwice = [
    revenueByCategory,
    {
      id: 'b2',
      title: 'Total Revenue by Channel',
      chart_type: 'bar',
      xAxisKey: 'Channel',
      yAxisKey: 'Total Revenue',
      resultData: [
        { Channel: 'Direct', 'Total Revenue': 700000 },
        { Channel: 'Partner', 'Total Revenue': 90000 },
        { Channel: 'Marketplace', 'Total Revenue': 60000 },
      ],
    },
  ];
  const { synthesis } = analyzeStoryboard(concentratedTwice, new Array(5000).fill({}));
  const tails = synthesis.macroInsights.map((b) => b.split('. ').slice(1).join('. '));
  assert.equal(new Set(tails).size, tails.length, `a consequence was reused: ${tails.join(' || ')}`);
});

test('a thin finding does not lead the summary over a solid one', () => {
  const thin = {
    id: 'thin',
    title: 'Revenue by Tier',
    chart_type: 'bar',
    xAxisKey: 'Tier',
    yAxisKey: 'Revenue',
    // Two categories, one taking almost everything: a large number on almost
    // no evidence.
    resultData: [
      { Tier: 'Gold', Revenue: 990 },
      { Tier: 'Silver', Revenue: 10 },
    ],
  };
  const solid = {
    id: 'solid',
    title: 'Revenue by Category',
    chart_type: 'bar',
    xAxisKey: 'Category',
    yAxisKey: 'Revenue',
    resultData: [
      { Category: 'Electronics', Revenue: 5200 },
      { Category: 'Home', Revenue: 1800 },
      { Category: 'Toys', Revenue: 900 },
      { Category: 'Books', Revenue: 600 },
      { Category: 'Garden', Revenue: 500 },
      { Category: 'Pets', Revenue: 400 },
      { Category: 'Sports', Revenue: 300 },
      { Category: 'Auto', Revenue: 300 },
    ],
  };
  const { perChart, synthesis } = analyzeStoryboard([thin, solid], new Array(9000).fill({}));
  const rank = ['thin', 'indicative', 'moderate', 'strong'];
  const thinFinding = perChart.find((f) => f.id === 'thin');
  const solidFinding = perChart.find((f) => f.id === 'solid');

  assert.ok(thinFinding.metrics.leaderSharePct > solidFinding.metrics.leaderSharePct, 'its number is bigger');
  assert.ok(
    rank.indexOf(thinFinding.metrics.evidence) < rank.indexOf(solidFinding.metrics.evidence),
    'and its evidence is weaker'
  );
  assert.match(synthesis.headline, /Electronics/, 'so the better-evidenced finding opens the summary');
});

// ---------------------------------------------------------------------------
// A share of a set of averages is not a share of anything
// ---------------------------------------------------------------------------

test('an average by category is never given a share of a total', () => {
  // Adding four category averages produces a number that is not the revenue of
  // any business, and a category's "62% of the total" measured against it reads
  // exactly like a market share. Nothing on the chart tells the two apart.
  const f = analyzeChart({
    id: 'avg',
    title: 'Average Total Revenue by Product Category',
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

  assert.equal(f.metrics.leaderSharePct, null, 'no share');
  assert.equal(f.metrics.total, null, 'no total');
  assert.equal(f.metrics.paretoCount, null, 'and no Pareto count over one');
  assert.doesNotMatch(f.headline, /% of/);
  assert.doesNotMatch(f.detail, /80% of/);

  // The multiple of the average says the same thing about the size of the gap
  // and claims nothing false.
  assert.equal(f.metrics.leaderVsAverage, 2.5);
  assert.match(f.headline, /2\.5× the/);
  assert.match(f.detail, /do not add up to a whole/);
});

test('a summed measure keeps its shares', () => {
  const f = analyzeChart({
    id: 'sum',
    title: 'Total Revenue by Product Category',
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
  assert.equal(f.metrics.leaderSharePct, 62.5);
  assert.match(f.headline, /62\.5% of the total/);
});

test('a share of a sum is never reconciled against a share of averages', () => {
  const summed = {
    id: 'sum',
    title: 'Total Revenue by Category',
    chart_type: 'bar',
    xAxisKey: 'Category',
    yAxisKey: 'Total Revenue',
    resultData: [
      { Category: 'Electronics', 'Total Revenue': 900 },
      { Category: 'Home', 'Total Revenue': 60 },
      { Category: 'Toys', 'Total Revenue': 40 },
    ],
  };
  const averaged = {
    id: 'avg',
    title: 'Average Total Revenue by Category',
    chart_type: 'bar',
    xAxisKey: 'Category',
    yAxisKey: 'Average Total Revenue',
    resultData: [
      { Category: 'Electronics', 'Average Total Revenue': 300 },
      { Category: 'Home', 'Average Total Revenue': 120 },
      { Category: 'Toys', 'Average Total Revenue': 90 },
    ],
  };
  const { synthesis } = analyzeStoryboard([summed, averaged], new Array(3000).fill({}));
  for (const line of synthesis.connections) {
    assert.doesNotMatch(line, /average total revenue/i, `compared against an average: ${line}`);
  }
});

test('a correlation within reach of chance can never be strong evidence', () => {
  // Eighteen points and r = 0.34: the effect size and the sample size both look
  // respectable, and the relationship is still not there.
  const ys = [0, 63, 29, 92, 58, 24, 86, 52, 18, 81, 47, 13, 76, 42, 105, 71, 36, 99];
  const points = ys.map((y, i) => [i, y]); // r = 0.33, t = 1.40 against a 2.09 bar
  const f = analyzeChart(scatter(points));
  assert.match(f.metrics.statisticalSignificance, /within what chance produces/);
  assert.ok(['thin', 'indicative'].includes(f.metrics.evidence), `evidence was ${f.metrics.evidence}`);
});
