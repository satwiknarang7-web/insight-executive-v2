import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics, finalizeMetrics, sanitizeChunk, unifyBooleans } from '../lib/dataCleaner.js';
import { profileColumns } from '../lib/chartResolver.js';

/* Four defects found by the ten-dataset evaluation in eval/RESULTS.md. Each was
   measured on the built app before being fixed, and each fixture below is the
   shape that produced it. */

/** The cleaner's own chain, as eval/chain.mjs runs it. */
function clean(rows) {
  const columns = Object.keys(rows[0]);
  const metrics = createMetrics(columns, rows.length);
  const cleaned = [];
  sanitizeChunk(rows, columns, metrics, cleaned);
  metrics.totalRows = rows.length;
  finalizeMetrics(cleaned, columns, metrics);
  return { rows: cleaned, metrics, columns };
}

/* ── 1. A boolean written several ways is one question ──────────────────── */

test('eight spellings of true and false fold to two', () => {
  /* The real distribution, from eval/data/02-outcome.csv: No 260, false 228,
     N 127, 0 99, TRUE 62, Yes 56, 1 36, Y 32. `unifyCategories` folds `No` and
     `no` because they are the same letters; it cannot fold `No`, `N`, `false`
     and `0`, which are the same ANSWER written four ways. */
  const truthy = ['Yes', 'Y', 'TRUE', '1'];
  const falsy = ['No', 'N', 'false', '0'];
  const rows = Array.from({ length: 400 }, (_, i) => ({
    id: `C${i}`,
    churned: i % 5 === 0 ? truthy[i % truthy.length] : falsy[i % falsy.length],
  }));

  const { rows: out } = clean(rows);
  const levels = [...new Set(out.map((r) => String(r.churned)))];
  assert.equal(levels.length, 2, `still ${levels.length} levels: ${JSON.stringify(levels)}`);
  // One spelling per side, and both from the set the file actually used — the
  // commonest one wins, so a file that says TRUE/FALSE keeps saying it.
  const [a, b] = levels;
  assert.ok(truthy.includes(a) !== truthy.includes(b), `both levels mean the same thing: ${a}, ${b}`);
  assert.ok(truthy.concat(falsy).includes(a) && truthy.concat(falsy).includes(b));
  // And one type, not two: a numeric 0 rewritten as the string "0" beside a
  // numeric 0 that won reports three levels for a two-valued flag.
  assert.equal(new Set(out.map((r) => typeof r.churned)).size, 1);
});

test('a column that is not a boolean is left alone', () => {
  // The subset test is what makes the fold safe. Yes / No / Maybe is a
  // three-level category, and a status column containing "No" is not a flag.
  const rows = Array.from({ length: 60 }, (_, i) => ({
    a: ['Yes', 'No', 'Maybe'][i % 3],
    b: ['Shipped', 'No', 'Pending'][i % 3],
    c: ['Yes', 'Y', 'yes'][i % 3], // one side only: nothing to fold against
  }));
  const { rows: out } = clean(rows);
  assert.equal(new Set(out.map((r) => r.a)).size, 3);
  assert.equal(new Set(out.map((r) => r.b)).size, 3);
  // `c` is folded by unifyCategories on spelling (Yes/yes) but Y survives,
  // because with no false side there is no evidence this is a flag at all.
  assert.ok(new Set(out.map((r) => r.c)).size >= 2);
});

test('the fold is recorded, not silent', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ flag: ['Yes', 'Y', 'No', 'N'][i % 4] }));
  const columns = ['flag'];
  const metrics = createMetrics(columns, rows.length);
  const cleaned = rows.map((r) => ({ ...r }));
  unifyBooleans(cleaned, columns, metrics);
  assert.ok(metrics.valuesUnified > 0);
  assert.ok(metrics.columnStats.flag.unified.length > 0);
});

/* ── 2. A declined answer is a missing value, not a level ───────────────── */

test('a refusal on 8% of rows does not cost a scale its type', () => {
  /* Ten 1-5 scales, "Prefer not to say" on 8% of rows. NUMERIC_PURITY is 0.95,
     so 0.92 made every one of them a category and left a 400-response survey
     with zero measures and "Age Band Segments 5" as its headline. */
  const rows = Array.from({ length: 400 }, (_, i) => ({
    respondent_id: `R${i}`,
    department: ['Engineering', 'Sales', 'Finance'][i % 3],
    q1_ease: i % 12 === 0 ? 'Prefer not to say' : String(1 + (i % 5)),
    q2_speed: i % 13 === 0 ? 'Prefer not to say' : String(1 + (i % 5)),
  }));
  const { rows: out } = clean(rows);
  const p = profileColumns(out);

  assert.deepEqual(p.measures.sort(), ['q1_ease', 'q2_speed']);
  assert.ok(!p.dimensions.includes('q1_ease'), 'a 1-5 scale was still a category');
  // The refusals are blank, not a sixth level on the axis.
  assert.ok(out.some((r) => r.q1_ease === null));
  assert.ok(!out.some((r) => r.q1_ease === 'Prefer not to say'));
});

/* ── 3. The cleaner's own outlier flag is not data ──────────────────────── */

test('isAnomaly never becomes a column to chart', () => {
  /* It is set only on rows that ARE outliers, and profileColumns reads its
     column list from rows[0] — so whether it appeared depended on whether the
     first row happened to be an outlier. One evaluation dataset charted it and
     another, with more outliers, did not. */
  const withFlagFirst = [{ region: 'North', v: 1, isAnomaly: true }, { region: 'South', v: 2 }];
  const withFlagLater = [{ region: 'North', v: 1 }, { region: 'South', v: 2, isAnomaly: true }];
  for (const rows of [withFlagFirst, withFlagLater]) {
    const p = profileColumns(rows);
    assert.ok(!p.dimensions.includes('isAnomaly'), JSON.stringify(p.dimensions));
    assert.ok(!p.measures.includes('isAnomaly'));
  }
});

/* ── 4. A measure is never aggregated over bands of itself ──────────────── */

/** A table as the preparation step leaves it: the measure, and bands of it. */
function banded() {
  const rows = [];
  for (let i = 0; i < 300; i++) {
    const revenue = 50 + (i % 60) * 900;
    rows.push({
      region: ['North', 'South', 'East', 'West'][i % 4],
      category: ['Electronics', 'Grocery', 'Apparel'][i % 3],
      revenue,
      discount_pct: i % 25,
      'Revenue Band': revenue < 10000 ? '< 10000' : revenue < 30000 ? '10000–30000' : '30000+',
    });
  }
  return rows;
}

test('a real date column is still found, named helpfully or not', () => {
  const named = Array.from({ length: 60 }, (_, i) => ({
    order_date: `2026-0${(i % 9) + 1}-15`, region: 'North', revenue: 100 + i,
  }));
  assert.deepEqual(profileColumns(named).temporal, ['order_date']);

  // No date-ish word in the name at all; the values carry it.
  const unnamed = Array.from({ length: 60 }, (_, i) => ({
    period: `2026-0${(i % 9) + 1}`, region: 'North', revenue: 100 + i,
  }));
  assert.deepEqual(profileColumns(unnamed).temporal, ['period']);
});

test("but a reader's own hour column is left alone", () => {
  // Matched on the prefix naming a column that exists, so "Delivery Hour"
  // with no "Delivery" column beside it is an ordinary measure.
  const rows = Array.from({ length: 60 }, (_, i) => ({ site: 'Leeds', 'Delivery Hour': 1 + (i % 9) }));
  assert.deepEqual(profileColumns(rows).measures, ['Delivery Hour']);
});

test('a scatter grouped by a number names its axes, not its grouping column', async () => {
  /* One point per hour of the day, temperature against humidity. `extractSeries`
     looked for a STRING column to use as the label, found none — an hour is a
     whole number — took the x measure as the label instead, and then named the
     grouping column as though it were a measure:

       title:  "Average Temperature C vs Average Humidity Pct Correlation"
       prose:  "Reading Ts Hour and Average Humidity Pct show a strong
                negative relationship (r = -0.79)."

     The title was right and the sentence under it was about a different pair. */
  const { analyzeChart } = await import('../lib/insightEngine.js');
  const chart = {
    id: 'c1',
    title: 'Average Temperature C vs Average Humidity Pct Correlation',
    chart_type: 'scatter',
    dimension: 'Reading Ts Hour',
    xAxisKey: 'Average Temperature C',
    yAxisKey: 'Average Humidity Pct',
    resultData: Array.from({ length: 24 }, (_, h) => ({
      'Reading Ts Hour': h,
      'Average Temperature C': 18 + h * 0.4,
      'Average Humidity Pct': 60 - h * 0.9,
    })),
  };
  const f = analyzeChart(chart, 50000);
  assert.ok(
    !/Reading Ts Hour/i.test(f.headline),
    `the grouping column was reported as a measure: ${f.headline}`
  );
  assert.match(f.headline, /Average Temperature C and Average Humidity Pct/i);
});
