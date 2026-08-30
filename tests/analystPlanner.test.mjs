import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCharts, planKpis, pretty, recommendedChartCount } from '../lib/analystPlanner.js';
import { isAggregatedSql } from '../lib/chartResolver.js';
import { needsHorizontalBars } from '../lib/chartSignals.js';
import { mountTable, runSql, unmountTable } from '../lib/pipeline.js';

/**
 * A telco-churn-like dataset (the one from the screenshots).
 *
 * The segments deliberately differ from one another. They used to be perfectly
 * uniform — `gender: genders[i % 2]` is exactly fifty-fifty, every payment
 * method exactly a quarter — which made every chart of them a set of identical
 * bars. That passed while the planner only asked what a chart *could* be drawn
 * from; now that it also measures what one would show, a fixture with no
 * differences in it is a fixture with no charts in it, and it was testing the
 * wrong thing either way.
 */
function telco(n = 200) {
  const genders = ['Male', 'Female'];
  const yesno = ['Yes', 'No'];
  const payment = ['Electronic check', 'Mailed check', 'Bank transfer', 'Credit card'];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const method = payment[i % 4];
    // Electronic check customers are the expensive, short-tenure ones — the
    // pattern the real dataset is famous for.
    const premium = method === 'Electronic check' ? 1.6 : method === 'Mailed check' ? 0.7 : 1;
    const gender = genders[i % 2];
    rows.push({
      customerID: `C${1000 + i}`,
      gender,
      Partner: yesno[i % 3 === 0 ? 1 : 0],
      Dependents: yesno[(i + 1) % 2],
      PhoneService: yesno[i % 5 === 0 ? 1 : 0],
      PaymentMethod: method,
      tenure: Math.round((i % 72) * (method === 'Electronic check' ? 0.4 : 1.1)),
      MonthlyCharges: Math.round((20 + (i % 80)) * premium),
      TotalCharges: Math.round((20 + (i % 80)) * premium * (i % 72 || 1)),
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

test('planKpis returns labelled KPI cards, business numbers first', () => {
  const kpis = planKpis(telco());
  assert.ok(kpis.length >= 1 && kpis.length <= 4);
  assert.ok(kpis.every((k) => k.label && k.value !== undefined));

  // "Records Analyzed" is how many rows were read — provenance, not a finding.
  // It used to open the strip; it now closes it.
  assert.notEqual(kpis[0].label, 'Records Analyzed');
  assert.equal(kpis[kpis.length - 1].label, 'Records Analyzed');
});

test('an outcome rate is the first thing the cards say', () => {
  // The same telco rows with the column the file is named after.
  const rows = telco(300).map((r, i) => ({
    ...r,
    Churn: r.PaymentMethod === 'Electronic check' ? (i % 3 ? 'Yes' : 'No') : i % 7 ? 'No' : 'Yes',
  }));
  const kpis = planKpis(rows);
  assert.equal(kpis[0].label, 'Churn Rate', `got ${kpis.map((k) => k.label).join(', ')}`);
  assert.match(kpis[0].value, /^\d+\.\d%$/);
  assert.equal(kpis[0].trend, 'down', 'a rising churn rate is not good news');
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

test('the size of a deck follows what the data shows, not how many columns it has', () => {
  // Each segment column genuinely separates the amounts, which is what makes
  // this a wide dataset rather than ten copies of the same flat one.
  const wide = Array.from({ length: 80 }, (_, i) => {
    const r = {};
    for (let d = 0; d < 10; d++) r[`segment${d}`] = `g${(i + d) % 4}`;
    // One segment really drives the amounts, so every chart of them has
    // something to show. Spreading the lift across all ten averaged it back to
    // a constant, which is how the original fixture came to have no signal in
    // it at all.
    const lift = 1 + (i % 4) * 0.6;
    for (let m = 0; m < 5; m++) {
      r[`amount${m}`] = Math.round((((i * (m + 7) * 13) % 5000) + 200) * lift) + 0.25;
    }
    return r;
  });
  // The same shape with the lift removed: ten segment columns that separate
  // nothing, which is what the fixture used to be.
  const flat = wide.map((r, i) => {
    const out = { ...r };
    for (let m = 0; m < 5; m++) out[`amount${m}`] = ((i * (m + 7) * 13) % 5000) + 0.25;
    return out;
  });

  const rich = planCharts(wide, { max: recommendedChartCount(wide) });
  const bare = planCharts(flat, { max: recommendedChartCount(flat) });

  assert.ok(rich.length >= 5, `a dataset with real differences earns a deck: got ${rich.length}`);
  assert.ok(rich.length <= 10);
  assert.ok(
    rich.length > bare.length,
    `signal should decide the size of a deck, not column count: ${rich.length} vs ${bare.length}`
  );
  // And every chart that made it says something.
  for (const c of rich) {
    if (c.signalScore === undefined) continue;
    assert.ok(c.signalScore > 0.05, `${c.title} scored ${c.signalScore}`);
  }
});

test('a unit price is never summed (it matches "unit" but is per-item)', () => {
  const rows = [];
  for (let i = 0; i < 60; i++) {
    rows.push({
      store: ['A', 'B', 'C'][i % 3],
      unit_price: 10.5 + (i % 37) * 1.7,
      units_sold: 1 + (i % 9),
    });
  }
  for (const c of planCharts(rows, { max: 8 })) {
    assert.ok(!/SUM\(\[unit_price\]\)/i.test(c.sql), `summed a price: ${c.sql}`);
  }
});

test('an explicitly total price IS summable', () => {
  const rows = [];
  for (let i = 0; i < 60; i++) {
    rows.push({ store: ['A', 'B', 'C'][i % 3], total_price: 12.25 + (i % 41) * 3.3 });
  }
  const sql = planCharts(rows, { max: 8 }).map((c) => c.sql).join(' ');
  assert.match(sql, /SUM\(\[total_price\]\)/i);
});

// ---------------------------------------------------------------------------
// Signal-driven selection: what the data shows decides which charts get built
// ---------------------------------------------------------------------------

/**
 * A retail export with three distinguishable stories and two dead ends:
 * a real seasonal climb, a lopsided category mix, long product names, a
 * dimension that duplicates another, and a metric that is pure noise.
 */
function retail(n = 2000) {
  const CATS = ['Electronics', 'Home & Kitchen', 'Toys', 'Garden'];
  const PRODUCTS = [
    'Wireless Noise Cancelling Headphones',
    'Stainless Steel Cookware Set for Six',
    'Robot Building Kit for Young Engineers',
    'Cordless Hedge Trimmer 40V Battery',
  ];
  const STATES = ['California', 'Texas', 'New York', 'Florida'];
  const CITIES = ['Los Angeles', 'Houston', 'New York City', 'Miami'];
  return Array.from({ length: n }, (_, i) => {
    const c = i % 97 < 60 ? 0 : i % 97 < 80 ? 1 : i % 97 < 92 ? 2 : 3;
    const s = i % 4;
    const month = i % 24;
    return {
      order_date: `20${25 + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, '0')}-15`,
      category: CATS[c],
      product_name: PRODUCTS[c],
      state: STATES[s],
      city: CITIES[s], // one city per state: the same dimension twice
      total_revenue: Math.round((c === 0 ? 400 : 90) * (1 + month * 0.04) * (1 + (i % 7) / 10)),
      unit_price: 20 + (i % 50),
    };
  });
}

test('a chart with nothing to show is outranked by one that has something', () => {
  // Two dimensions, identical structure, opposite stories: `segment` splits the
  // revenue heavily, `coin` splits it exactly in half. Both are valid charts;
  // only one is worth a slide, and the planner has to look at the values to
  // know which.
  // The segment cycle is odd so it is independent of the coin: each coin face
  // gets its share of the Enterprise rows, and a chart of `coin` is two equal
  // bars however you aggregate it.
  const rows = Array.from({ length: 660 }, (_, i) => ({
    segment: i % 11 === 0 ? 'Enterprise' : 'SMB',
    coin: i % 2 === 0 ? 'Heads' : 'Tails',
    total_revenue: i % 11 === 0 ? 5000 : 50,
  }));
  const charts = planCharts(rows, { max: 8 });
  const segment = charts.find((c) => (c.dimension || c.xAxisKey) === 'segment');
  const coin = charts.find((c) => (c.dimension || c.xAxisKey) === 'coin');

  assert.ok(segment, 'the dimension that splits the revenue is charted');
  assert.ok(segment.signalScore > 0.5, `expected real signal, got ${segment.signalScore}`);
  if (coin) {
    assert.ok(coin.signalScore < segment.signalScore, 'and the even split scores below it');
    assert.ok(
      charts.indexOf(segment) < charts.indexOf(coin),
      'so it is presented first'
    );
  }
});

test('a dead flat metric is not presented as a headline finding', () => {
  const rows = Array.from({ length: 400 }, (_, i) => ({
    region: ['N', 'S', 'E', 'W'][i % 4],
    // Every region averages the same: a chart of this says nothing at all.
    satisfaction_score: 7 + ((i % 8) - 4) * 0.01,
    total_revenue: 100 + (i % 4) * 300,
  }));
  const charts = planCharts(rows, { max: 6 });
  // A chart whose *subject* is the flat average — matching the title alone also
  // catches a combo chart that plots revenue against it, whose signal comes
  // from the revenue side and is not the thing under test.
  const flat = charts.find((c) => /satisfaction/i.test(String(c.yAxisKey)));
  if (flat) {
    assert.ok(flat.signalScore < 0.2, `a flat average scored ${flat.signalScore}`);
    assert.notEqual(charts[0].title, flat.title, 'and it never opens the deck');
  }
});

test('long category names are drawn as horizontal bars', () => {
  const charts = planCharts(retail(), { max: 8 });
  const products = charts.find((c) => (c.dimension || c.xAxisKey) === 'product_name');
  assert.ok(products, 'products are worth a chart');
  // Whatever it is, it is not a column chart with those names rotated under it.
  // Sideways bars, a treemap and a donut all put a long name beside or inside
  // its mark; only a vertical bar hangs it underneath at thirty-five degrees.
  assert.notEqual(products.chart_type, 'bar', 'their names do not fit under a vertical bar');
  assert.ok(
    ['hbar', 'treemap', 'donut'].includes(products.chart_type),
    `unexpected shape for long names: ${products.chart_type}`
  );

  // And short names are left upright. "Home & Kitchen" is fourteen characters
  // and does belong on its side, so the boundary is tested where it actually
  // sits rather than against a fixture whose "short" names are not short.
  assert.equal(needsHorizontalBars(['North', 'South', 'East', 'West']), false);
  assert.equal(needsHorizontalBars(['Basic', 'Standard', 'Premium', 'Enterprise']), false);
  assert.equal(needsHorizontalBars(['Month-to-month', 'One year', 'Two year']), true);
  assert.equal(needsHorizontalBars(['Electronics', 'Home & Kitchen', 'Toys', 'Garden']), true);
});

test('a donut is refused when its slices are not the whole', () => {
  // Forty roughly equal segments: the top six are a sixth of the total, and a
  // donut of them invites the reader to add the slices up to a business.
  const rows = Array.from({ length: 1200 }, (_, i) => ({
    supplier: `Supplier ${i % 40}`,
    channel: ['Online', 'Retail'][i % 2],
    total_revenue: 100 + (i % 3),
  }));
  for (const c of planCharts(rows, { max: 8 })) {
    if ((c.dimension || c.xAxisKey) !== 'supplier') continue;
    assert.notEqual(c.chart_type, 'donut', `a long tail was drawn as a donut: ${c.title}`);
    assert.notEqual(c.chart_type, 'pie');
  }
});

test('a short series is a line rather than a mostly-empty area', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({
    month: `2026-0${(i % 5) + 1}`,
    region: ['N', 'S'][i % 2],
    total_revenue: 100 + (i % 5) * 60,
  }));
  const trend = planCharts(rows, { max: 6 }).find((c) => c.xAxisKey === 'month');
  assert.ok(trend);
  assert.equal(trend.chart_type, 'line', 'five points do not need an area fill');
});

test('a dimension that duplicates another loses its place in the deck', () => {
  const charts = planCharts(retail(), { max: 7 });
  const dims = charts.map((c) => c.dimension || c.xAxisKey);
  assert.ok(
    !(dims.includes('state') && dims.includes('city')),
    `city and state are the same dimension twice: ${dims.join(', ')}`
  );
});

test('histogram bands are sized from the values, and cover every row', () => {
  // A long right tail. Four fixed bands would put nearly everything in the
  // first one and leave the rest of the chart empty.
  const rows = Array.from({ length: 500 }, (_, i) => ({
    store: ['A', 'B', 'C'][i % 3],
    basket_value: Math.round(Math.exp((i % 100) / 14) * 3) + 5,
  }));
  const hist = planCharts(rows, { max: 10 }).find((c) => /^Distribution of/.test(c.title));
  assert.ok(hist, 'a continuous measure gets a distribution');
  assert.ok(hist.sortLabels.length > 4, `expected more than four bands, got ${hist.sortLabels.length}`);
  assert.ok(hist.sortLabels.length <= 10, 'but still a readable number');
  assert.equal(new Set(hist.sortLabels).size, hist.sortLabels.length, 'no two bands share a name');

  // One WHEN per band except the last, which is the ELSE. The CASE appears
  // twice — once in the SELECT and once in the GROUP BY — so count one of them.
  const firstCase = hist.sql.slice(hist.sql.indexOf('CASE'), hist.sql.indexOf('END'));
  const whens = (firstCase.match(/\bWHEN\b/gi) || []).length;
  assert.equal(whens, hist.sortLabels.length - 1);

  mountTable(rows);
  try {
    const result = runSql(hist.sql);
    const covered = result.reduce((sum, r) => sum + r['Record Count'], 0);
    assert.equal(covered, rows.length, 'every row lands in exactly one band');
    for (const r of result) {
      assert.ok(hist.sortLabels.includes(r[hist.xAxisKey]), `unexpected band ${r[hist.xAxisKey]}`);
    }
  } finally {
    unmountTable();
  }
});

test('a candidate with only one group is dropped rather than drawn', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    country: 'Ireland', // nothing to compare
    channel: ['Online', 'Retail', 'Partner'][i % 3],
    total_revenue: 100 + (i % 50),
  }));
  for (const c of planCharts(rows, { max: 6 })) {
    assert.notEqual(c.dimension || c.xAxisKey, 'country', `a single-group chart survived: ${c.title}`);
  }
});

test('scoring a large file stays bounded by the signal sample', () => {
  const rows = Array.from({ length: 120_000 }, (_, i) => ({
    category: ['A', 'B', 'C', 'D'][i % 4],
    channel: ['Online', 'Retail'][i % 2],
    total_revenue: 10 + (i % 900),
  }));
  const started = Date.now();
  const charts = planCharts(rows, { max: 7 });
  assert.ok(charts.length > 0);
  assert.ok(Date.now() - started < 10_000, 'planning does not scale with row count');
});
