import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics, finalizeMetrics, sanitizeChunk } from '../lib/dataCleaner.js';
import { profileColumns } from '../lib/chartResolver.js';
import { classifyColumns } from '../lib/measureSemantics.js';
import { detectLongFormat } from '../lib/measureUnits.js';
import { byVariation, measureVariation } from '../lib/measureVariation.js';
import { planCharts, planKpis } from '../lib/analystPlanner.js';
import { analyzeChart } from '../lib/insightEngine.js';

/* The six defects eval/RESULTS.md listed as still wrong. */

function clean(rows) {
  const columns = Object.keys(rows[0]);
  const metrics = createMetrics(columns, rows.length);
  const cleaned = [];
  sanitizeChunk(rows, columns, metrics, cleaned);
  metrics.totalRows = rows.length;
  finalizeMetrics(cleaned, columns, metrics);
  return { rows: cleaned, metrics };
}
const col = (rows, c) => rows.map((r) => r[c]);

/* ── 1. A minus sign that is not the hyphen-minus ───────────────────────── */

test('the unicode minus signs are minus signs', () => {
  // Excel writes U+2212 for a number-formatted cell; typeset and European
  // exports write the en dash. Neither matched, so the value stayed text — and
  // a few of them drop a column below the numeric bar and turn money into a
  // category.
  for (const [label, written] of [
    ['U+2212 minus', '−567.89'],
    ['en dash', '–567.89'],
    ['em dash', '—567.89'],
    ['fullwidth', '－567.89'],
  ]) {
    const rows = Array.from({ length: 20 }, () => ({ k: 'x', amount: written }));
    assert.equal(clean(rows).rows[0].amount, -567.89, label);
  }
});

test('a dash between two numbers is a range, not a subtraction', () => {
  // The rewrite is of a LEADING sign only. "10–20" is a band label, and
  // turning it into minus ten would invent a value.
  const rows = Array.from({ length: 20 }, () => ({ k: 'x', band: '10–20' }));
  assert.equal(clean(rows).rows[0].band, '10–20');
});

/* ── 2. A trend needs enough points to be a line ────────────────────────── */

test('a month of minute-level readings is charted by day, not by month', () => {
  /* 50,000 readings over 34.7 days bucketed to month gave two points — a whole
     January and four days of February — and the finding read "Record Count
     trended down from 2026-01 to 2026-02, a 88.0% decrease". The decrease was
     February not having happened yet. */
  const start = Date.UTC(2026, 0, 1);
  const rows = Array.from({ length: 3000 }, (_, i) => ({
    reading_ts: new Date(start + i * 1000 * 60 * 17).toISOString(),
    line: ['A', 'B'][i % 2],
    temperature_c: 20 + (i % 9),
  }));
  const trend = planCharts(rows, { max: 8 }).find((c) => /Trend Over/i.test(c.title));
  assert.ok(trend, 'no trend at all');
  assert.match(trend.title, /Over Day$/, trend.title);
  assert.match(trend.sql, /SUBSTRING\(\[reading_ts\], 1, 10\)/);
});

test('two years of daily rows are still charted by month', () => {
  // The grain is the coarsest one that still has enough points, so a long span
  // does not become seven hundred days.
  const start = Date.UTC(2025, 0, 1);
  const rows = Array.from({ length: 700 }, (_, i) => ({
    order_date: new Date(start + i * 86400000).toISOString().slice(0, 10),
    region: ['North', 'South'][i % 2],
    revenue: 100 + (i % 50),
  }));
  const trend = planCharts(rows, { max: 8 }).find((c) => /Trend Over/i.test(c.title));
  assert.match(trend.title, /Over Month$/, trend.title);
});

/* ── 3. A column of numbers nobody could read is not a category ─────────── */

test('a column the cleaner refused to type is charted as neither', () => {
  /* `amount` held both comma conventions — 2,345.00 and 1.234,56 — which
     cannot both be right, so the cleaner refused to guess. Correct. What
     followed was not: the column became a dimension and the deck charted
     "Total Qty by Amount" and offered Amount as a slicer. */
  // Many distinct amounts, written in both conventions — which is what a real
  // refused money column looks like. Two values would be a flag, and a flag is
  // a category by any reading.
  const rows = Array.from({ length: 60 }, (_, i) => ({
    item: `Item ${i}`,
    region: ['North', 'South'][i % 2],
    amount: i % 2 ? `${1 + i},${String(100 + i).slice(0, 3)}.00` : `${1 + i}.${String(200 + i).slice(0, 3)},50`,
    qty: String(1 + (i % 9)),
  }));
  const { rows: out } = clean(rows);
  const p = profileColumns(out);

  assert.ok(!p.measures.includes('amount'), 'it did not parse, so it is not a measure');
  assert.ok(!p.dimensions.includes('amount'), 'money was offered as an axis of categories');
  assert.deepEqual(p.unparsed, ['amount'], 'and the caller is told, so the column does not vanish');

  for (const c of planCharts(out, { max: 10 })) {
    assert.ok(!/amount/i.test(String(c.xAxisKey || '')), c.title);
  }
});

test('an ordinary category is not mistaken for a refused number', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({
    sku: `SKU-${i % 9}`,
    region: ['North', 'South', 'East'][i % 3],
    qty: 1 + (i % 9),
  }));
  assert.deepEqual(profileColumns(rows).unparsed, []);
});

/* ── 4. A value column holding several quantities is never pooled ───────── */

/** The long format an indicator export arrives in. */
function longPanel() {
  const rows = [];
  const indicators = [
    ['GDP (current LCU)', 1e12, 5e12],
    ['Population, total', 8e7, 1.4e9],
    ['Life expectancy at birth', 55, 84],
    ['Inflation, consumer prices (annual %)', 1, 22],
  ];
  for (const country of ['Brazil', 'China', 'Germany', 'India', 'Nigeria', 'United States']) {
    for (let y = 2014; y <= 2025; y++) {
      for (const [indicator, lo, hi] of indicators) {
        rows.push({ country, year: y, indicator, value: lo + ((y - 2014) / 11) * (hi - lo) });
      }
    }
  }
  return rows;
}

test('a value column that means something different per key is refused', () => {
  /* "GDP (current LCU) leads indicators on average value at 4560B, 4.0× the
     1140B average across 4 indicators" — a GDP averaged against a life
     expectancy, badged STRONG EVIDENCE. Neither the column's name nor the key
     column's name says anything; the values say it plainly. */
  const rows = longPanel();
  const p = profileColumns(rows);
  const claims = detectLongFormat(rows, { profile: p, cardinality: p.cardinality });
  assert.ok(claims.value, 'the scale gap was not noticed');
  assert.match(claims.value.unit, /per indicator/);

  const sem = classifyColumns({
    profile: p,
    cardinality: p.cardinality,
    rowCount: rows.length,
    rows,
  });
  assert.equal(sem.byColumn.value.kind, 'denominated');

  for (const c of planCharts(rows, { max: 10 })) {
    assert.ok(!/\bvalue\b/i.test(String(c.yAxisKey || '')), `it was aggregated anyway: ${c.title}`);
  }
  assert.ok(!planKpis(rows).some((k) => /value/i.test(k.label)));
});

test('near-unique is what continuous means, not what identifying means', () => {
  /* The claim above was never reached: `value` had 288 distinct values across
     288 rows, so it was called an identifier on uniqueness alone and the
     classification stopped there. A measurement to two decimal places is
     distinct on nearly every row by construction. */
  const rows = longPanel();
  const sem = classifyColumns({
    profile: profileColumns(rows),
    cardinality: profileColumns(rows).cardinality,
    rowCount: rows.length,
    rows,
  });
  assert.notEqual(sem.byColumn.value.kind, 'identifier');

  // A genuine sequence key is still one: whole numbers through a dense range.
  const keyed = Array.from({ length: 200 }, (_, i) => ({ seq: i + 1, region: 'North', amount: 10.5 + i }));
  const kp = profileColumns(keyed);
  const ks = classifyColumns({ profile: kp, cardinality: kp.cardinality, rowCount: keyed.length, rows: keyed });
  assert.equal(ks.byColumn.seq.kind, 'identifier');
  assert.notEqual(ks.byColumn.amount.kind, 'identifier');
});

test('measures within a factor of a few are left alone', () => {
  // The threshold is three orders of magnitude. Revenue differs between aisles
  // by a factor of a few, and withdrawing it over that would be a disaster.
  const rows = Array.from({ length: 400 }, (_, i) => ({
    category: ['Electronics', 'Grocery', 'Apparel'][i % 3],
    revenue: [2000, 400, 900][i % 3] + (i % 50),
  }));
  const p = profileColumns(rows);
  assert.deepEqual(detectLongFormat(rows, { profile: p, cardinality: p.cardinality }), {});
});

/* ── 5. A measure that is barely populated is not the headline ──────────── */

test('a column filled on a sixth of the rows does not headline the file', () => {
  /* 58 columns, 53 of them statistically indistinguishable. "Average Field 35"
     — filled on 54 of 300 rows — was the headline while `score`, filled on all
     300, went unmentioned. Nothing was reading completeness at all. */
  const rows = Array.from({ length: 300 }, (_, i) => {
    const row = { site: ['Leeds', 'Bristol'][i % 2], score: i % 100 };
    for (let f = 1; f <= 20; f++) row[`field_${f}`] = i % 6 === 0 ? (i * f) % 500 : null;
    return row;
  });
  const labels = planKpis(rows).map((k) => k.label);
  assert.ok(labels.some((l) => /score/i.test(l)), JSON.stringify(labels));
  assert.ok(!labels.some((l) => /field/i.test(l)), JSON.stringify(labels));
});

test('completeness only breaks ties between columns that both vary', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    full_flat: 7,
    sparse_varying: i % 5 === 0 ? i : null,
  }));
  const stats = {
    full_flat: { mean: 7, spread: 0 },
    sparse_varying: { mean: 100, spread: 199 },
  };
  const v = measureVariation(rows, ['full_flat', 'sparse_varying'], stats);
  // A column that does not move loses to one that does, however complete it is.
  assert.deepEqual(['full_flat', 'sparse_varying'].sort(byVariation(v)), ['sparse_varying', 'full_flat']);
});

/* ── 6. Two charts of the same numbers, and a ratio across zero ─────────── */

test('a multiple is not quoted across a change of sign', () => {
  /* Refund rows carry a negative quantity, so units-per-order averaged 3.5 for
     sales and -0.73 for refunds, and the sentence read "Sale leads txn types on
     units per order at 3.5, 4.7× the 0.73 average" — a ratio taken across
     zero, quoted without its sign. */
  const f = analyzeChart(
    {
      id: 'c1',
      title: 'Units per Order by Txn Type',
      chart_type: 'bar',
      dimension: 'txn_type',
      xAxisKey: 'txn_type',
      yAxisKey: 'Units per Order',
      resultData: [
        { txn_type: 'Sale', 'Units per Order': 3.5 },
        { txn_type: 'Refund', 'Units per Order': -0.73 },
      ],
    },
    1200
  );
  assert.ok(!/×/.test(f.headline), `a multiple was quoted across zero: ${f.headline}`);
  assert.match(f.headline, /Sale leads/);
});

test('an all-positive ranking keeps its multiple', () => {
  const f = analyzeChart(
    {
      id: 'c2',
      title: 'Average Price by Tier',
      chart_type: 'bar',
      dimension: 'tier',
      xAxisKey: 'tier',
      yAxisKey: 'Average Price',
      resultData: [
        { tier: 'Enterprise', 'Average Price': 900 },
        { tier: 'Pro', 'Average Price': 90 },
        { tier: 'Free', 'Average Price': 10 },
      ],
    },
    600
  );
  assert.match(f.headline, /×/);
});

test('two charts of the same drawn numbers become one', async () => {
  /* "Units per Order by Txn Type" and "Average Qty by Txn Type" are one chart.
     Where a row is an order, the quantity over the order count IS the average
     quantity — and `dropDuplicateCharts` keyed on the measure's NAME, so it
     saw two subjects and the deck carried both, side by side, with the same two
     bars and the same sentence under each.

     The names cannot be reconciled — one is a derived measure, the other an
     aggregate — but by this point the values have been drawn, and those can. */
  const { runAnalysis } = await import('../lib/pipeline.js');
  const rows = Array.from({ length: 600 }, (_, i) => {
    const refund = i % 8 === 0;
    return {
      order_id: `ORD-${i}`,
      category: ['Audio', 'Computing', 'Wearables'][i % 3],
      txn_type: refund ? 'Refund' : 'Sale',
      qty: refund ? -(1 + (i % 3)) : 1 + (i % 6),
      amount: (refund ? -1 : 1) * (50 + (i % 400)),
      order_date: `2026-0${1 + (i % 9)}-15`,
    };
  });
  const charts = (runAnalysis(rows, { maxCharts: 10 }).charts || []).filter((c) => c.chart_type !== 'slicer');

  // Group by what each chart actually draws.
  const shapes = new Map();
  for (const c of charts) {
    if (!c.xAxisKey || !c.yAxisKey) continue;
    const key = (c.resultData || [])
      .map((r) => `${r[c.xAxisKey]}=${Number(r[c.yAxisKey]).toPrecision(6)}`)
      .sort()
      .join(',');
    if (!key) continue;
    shapes.set(key, [...(shapes.get(key) || []), c.title]);
  }
  for (const [, titles] of shapes) {
    assert.equal(titles.length, 1, `the same numbers drawn twice: ${JSON.stringify(titles)}`);
  }
});
