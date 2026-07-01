import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCharts, planKpis, pretty, recommendedChartCount } from '../lib/analystPlanner.js';
import { isAggregatedSql } from '../lib/chartResolver.js';

// A telco-churn-like dataset (the one from the screenshots).
function telco(n = 200) {
  const genders = ['Male', 'Female'];
  const yesno = ['Yes', 'No'];
  const payment = ['Electronic check', 'Mailed check', 'Bank transfer', 'Credit card'];
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      customerID: `C${1000 + i}`,
      gender: genders[i % 2],
      Partner: yesno[i % 2],
      Dependents: yesno[(i + 1) % 2],
      PhoneService: yesno[i % 5 === 0 ? 1 : 0],
      PaymentMethod: payment[i % 4],
      tenure: i % 72,
      MonthlyCharges: 20 + (i % 80),
      TotalCharges: (20 + (i % 80)) * (i % 72 || 1),
    });
  }
  return rows;
}

test('planner returns at most 7 charts', () => {
  const charts = planCharts(telco(), { max: 7 });
  assert.ok(charts.length <= 7);
  assert.ok(charts.length >= 3);
});

test('every planned chart groups by a SINGLE dimension (no composite segments)', () => {
  const charts = planCharts(telco());
  for (const c of charts) {
    // xAxisKey must be a single column name or alias — never a "A & B" composite.
    assert.ok(!String(c.xAxisKey).includes(' & '), `composite x: ${c.xAxisKey}`);
    // SQL should reference exactly one GROUP BY target (one column or one CASE).
    const groupBys = (c.sql.match(/group by/gi) || []).length;
    assert.equal(groupBys, 1, `chart ${c.title} has ${groupBys} GROUP BY`);
  }
});

test('every planned chart is aggregated', () => {
  for (const c of planCharts(telco())) {
    assert.ok(isAggregatedSql(c.sql), `not aggregated: ${c.title}`);
  }
});

test('planner produces a varied deck (≥3 distinct types, none dominating)', () => {
  const charts = planCharts(telco());
  const counts = {};
  for (const c of charts) counts[c.chart_type] = (counts[c.chart_type] || 0) + 1;
  const distinctTypes = Object.keys(counts).length;
  assert.ok(distinctTypes >= 3, `only ${distinctTypes} distinct types`);
  for (const [type, n] of Object.entries(counts)) {
    assert.ok(n <= 4, `${type} appears ${n} times`);
  }
});

test('planner spreads across dimensions (no single dimension dominates)', () => {
  const charts = planCharts(telco());
  const dimCount = {};
  for (const c of charts) {
    const dim = c.dimension || c.xAxisKey;
    dimCount[dim] = (dimCount[dim] || 0) + 1;
  }
  for (const [dim, n] of Object.entries(dimCount)) {
    assert.ok(n <= 3, `dimension ${dim} used ${n} times`);
  }
});

test('scatter (if present) uses a high-cardinality dimension for enough points', () => {
  const charts = planCharts(telco());
  const scatter = charts.find((c) => c.chart_type === 'scatter');
  if (scatter) {
    // grouped by customerID (high cardinality) -> many points
    assert.match(scatter.sql, /group by \[customerID\]/i);
  }
});

test('identifier columns are never used as the chart dimension', () => {
  const charts = planCharts(telco());
  for (const c of charts) {
    if (c.chart_type !== 'scatter') {
      assert.notEqual(c.xAxisKey, 'customerID');
    }
  }
});

test('temporal data yields a trend chart', () => {
  const rows = Array.from({ length: 24 }, (_, i) => ({
    month: `2026-${String((i % 12) + 1).padStart(2, '0')}`,
    region: ['N', 'S', 'E', 'W'][i % 4],
    revenue: 1000 + i * 25,
  }));
  const charts = planCharts(rows);
  const trend = charts.find((c) => c.chart_type === 'area' || c.chart_type === 'line');
  assert.ok(trend, 'expected a trend chart for temporal data');
  assert.equal(trend.xAxisKey, 'month');
});

test('planKpis returns labelled KPI cards', () => {
  const kpis = planKpis(telco());
  assert.ok(kpis.length >= 1 && kpis.length <= 4);
  assert.ok(kpis.every((k) => k.label && k.value !== undefined));
  assert.equal(kpis[0].label, 'Records Analyzed');
});

test('pretty title-cases identifiers', () => {
  assert.equal(pretty('MonthlyCharges'), 'Monthly Charges');
  assert.equal(pretty('payment_method'), 'Payment Method');
});

test('empty dataset yields no charts', () => {
  assert.deepEqual(planCharts([]), []);
});

test('recommendedChartCount scales with schema richness, within executive bounds', () => {
  // Telco-style (3 measures + ~6 usable dims) anchors around 7.
  const telcoCount = recommendedChartCount(telco());
  assert.ok(telcoCount >= 6 && telcoCount <= 8, `telco count ${telcoCount}`);

  // Sparse dataset clamps to the floor (5).
  const sparse = [
    { region: 'N', revenue: 10 },
    { region: 'S', revenue: 20 },
  ];
  assert.equal(recommendedChartCount(sparse), 5);

  // Wide dataset expands toward the ceiling (10). Measures are continuous floats
  // (real quantities, not dense integer sequences that would read as ordinals).
  const wide = Array.from({ length: 50 }, (_, i) => {
    const r = { id: i };
    for (let d = 0; d < 12; d++) r[`dim${d}`] = `v${(i + d) % 4}`;
    for (let m = 0; m < 6; m++) r[`metric${m}`] = ((i * 37 + m * 101) % 900) + 0.5;
    return r;
  });
  assert.equal(recommendedChartCount(wide), 10);

  // Empty data needs no slides.
  assert.equal(recommendedChartCount([]), 0);
});

// A country-rankings dataset like the screenshot: an ordinal `rank`, a bounded
// `happiness_score`, a `gdp_per_capita` rate, and a high-card `country` name.
function countries(n = 130) {
  const regions = ['Sub-Saharan Africa', 'Western Europe', 'Latin America', 'South Asia', 'East Asia', 'Middle East'];
  return Array.from({ length: n }, (_, i) => ({
    country: `Country ${i}`,
    region: regions[i % regions.length],
    rank: i + 1, // dense unique ordinal -> must never be summed
    happiness_score: 2 + ((i * 0.05) % 6), // bounded score -> average, not sum
    gdp_per_capita: 500 + ((i * 137) % 80000), // a "per capita" rate -> not summed
  }));
}

test('an ordinal rank column is never SUMmed by the planner', () => {
  const charts = planCharts(countries());
  for (const c of charts) {
    assert.ok(!/SUM\(\[rank\]\)/i.test(c.sql), `rank was summed in: ${c.title}`);
  }
});

test('composition falls back to COUNT when no additive measure exists', () => {
  const charts = planCharts(countries());
  // With only rank/score/per-capita (none additive), region composition must be a
  // COUNT of records — not a SUM of any column.
  const composition = charts.find((c) => /region/i.test(c.xAxisKey) && /(donut|treemap|bar)/.test(c.chart_type));
  assert.ok(composition, 'expected a region composition chart');
  const anySum = charts.some((c) => /\bSUM\(/i.test(c.sql));
  assert.equal(anySum, false, 'no column should be summed for this dataset');
  assert.ok(charts.some((c) => /COUNT\(\*\)/i.test(c.sql)), 'composition should use COUNT(*)');
});

test('a bounded score is averaged, not summed', () => {
  const charts = planCharts(countries());
  const scoreChart = charts.find((c) => /happiness/i.test(c.title));
  if (scoreChart) {
    assert.ok(/AVG\(\[happiness_score\]\)|happiness_score Range/i.test(scoreChart.sql));
    assert.ok(!/SUM\(\[happiness_score\]\)/i.test(scoreChart.sql));
  }
});

test('an additive column (charges/revenue) IS summed', () => {
  const charts = planCharts(telco());
  const summed = charts.find((c) => /SUM\(\[TotalCharges\]\)/i.test(c.sql));
  assert.ok(summed, 'expected TotalCharges to be summed somewhere');
});

test('a "per capita" column is not summed despite matching gdp', () => {
  const charts = planCharts(countries());
  for (const c of charts) {
    assert.ok(!/SUM\(\[gdp_per_capita\]\)/i.test(c.sql), `per-capita summed in: ${c.title}`);
  }
});

test('a wide dataset actually produces more than 7 slides', () => {
  const wide = Array.from({ length: 80 }, (_, i) => {
    const r = {};
    for (let d = 0; d < 10; d++) r[`segment${d}`] = `g${(i + d) % 4}`;
    for (let m = 0; m < 5; m++) r[`amount${m}`] = ((i * (m + 7) * 13) % 5000) + 0.25;
    return r;
  });
  const charts = planCharts(wide, { max: recommendedChartCount(wide) });
  assert.ok(charts.length > 7, `expected >7, got ${charts.length}`);
  assert.ok(charts.length <= 10);
});
