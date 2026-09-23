import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics, finalizeMetrics, sanitizeChunk } from '../lib/dataCleaner.js';
import { profileColumns } from '../lib/chartResolver.js';
import { classifyColumns } from '../lib/measureSemantics.js';
import { detectLongFormat } from '../lib/measureUnits.js';
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

/* ── 3. A column of numbers nobody could read is not a category ─────────── */

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
