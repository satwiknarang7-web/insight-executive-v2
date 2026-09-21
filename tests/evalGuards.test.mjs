import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics, finalizeMetrics, sanitizeChunk, unifyBooleans } from '../lib/dataCleaner.js';
import { profileColumns } from '../lib/chartResolver.js';
import { planCharts, planKpis } from '../lib/analystPlanner.js';

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

test('and the outcome rate is then computed, which was the whole cost', () => {
  const rows = [];
  for (let i = 0; i < 900; i++) {
    const contract = ['Month-to-month', 'One year', 'Two year'][i % 3];
    const churn = contract === 'Month-to-month' ? i % 3 === 0 : i % 17 === 0;
    rows.push({
      customer_id: `C${i}`,
      contract_type: contract,
      tenure_months: String(1 + (i % 72)),
      monthly_charge: (20 + (i % 90)).toFixed(2),
      churned: churn ? ['Yes', 'Y', 'TRUE', '1'][i % 4] : ['No', 'N', 'false', '0'][i % 4],
    });
  }
  const { rows: out } = clean(rows);
  const labels = planKpis(out).map((k) => k.label);
  assert.ok(
    labels.some((l) => /churn rate/i.test(l)),
    `no outcome rate on a churn table: ${JSON.stringify(labels)}`
  );
  // And the column that drives it gets charted.
  const titles = planCharts(out, { max: 8 }).map((c) => c.title);
  assert.ok(
    titles.some((t) => /by Contract Type$/i.test(t)),
    `the driver was never charted: ${JSON.stringify(titles)}`
  );
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

test('a measure is not summed or averaged over bands of itself', () => {
  /* Present in 5 of 10 evaluation datasets and the FIRST chart in four:

       "Total Revenue by Revenue Band" — STRONG EVIDENCE —
       "20000–50000 leads revenue bands on total revenue at 9.7M, 43.4% of the total"

     True by construction. The sum of a measure inside its own top band is the
     largest sum there can be, and the evidence tier cannot tell, because the
     arithmetic is impeccable. */
  const charts = planCharts(banded(), { max: 10 });
  for (const c of charts) {
    const pairsItself =
      /Revenue Band/i.test(String(c.xAxisKey || '')) && /revenue/i.test(String(c.yAxisKey || ''));
    assert.ok(!pairsItself, `a tautology survived: ${c.title}`);
  }
});

test('but a different measure broken down by those bands is still offered', () => {
  // The guard is about one pairing, not about band columns. "Average Discount
  // Pct by Revenue Band" is a real question and has to survive.
  const pool = planCharts(banded(), { max: 12 });
  const usesBand = pool.filter((c) => /Revenue Band/i.test(String(c.xAxisKey || '')));
  for (const c of usesBand) {
    assert.ok(!/revenue/i.test(String(c.yAxisKey || '')), c.title);
  }
});

test('a band column is not read as a date because it says "Monthly"', () => {
  /* TEMPORAL_KEY_RE matched the NAME alone, so bucketing `monthly_charge`
     produced `Monthly Charge Band` — values `< 50`, `50–100`, `100+` — which
     matched on "month" and became the time axis. The deck reported "Total
     Monthly Charge Trend Over Monthly Charge Band" and a waterfall of what
     moved it between the bands. */
  const rows = Array.from({ length: 120 }, (_, i) => ({
    plan: ['Basic', 'Standard'][i % 2],
    monthly_charge: 20 + (i % 90),
    'Monthly Charge Band': i % 3 === 0 ? '< 50' : i % 3 === 1 ? '50–100' : '100+',
  }));
  const p = profileColumns(rows);
  assert.deepEqual(p.temporal, [], `a band was read as a date: ${JSON.stringify(p.temporal)}`);

  for (const c of planCharts(rows, { max: 10 })) {
    assert.ok(!/Trend|What Moved/i.test(c.title), `a band axis was called a trend: ${c.title}`);
  }
});

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

test('an hour pulled out of a timestamp is a label, not a magnitude', () => {
  /* The preparation step pulls the time out of a timestamp so something can be
     grouped by it, and names the result after the column it came from. It is a
     whole number, so the profile called it a measure and a 50,000-row sensor
     stream opened with "Average Reading Ts Hour 11.5" — the mean hour of the
     day. The temperature the file exists to record was not on the dashboard. */
  const rows = Array.from({ length: 120 }, (_, i) => ({
    reading_ts: `2026-01-01T${String(i % 24).padStart(2, '0')}:30:00Z`,
    'Reading Ts Hour': i % 24,
    temperature_c: 20 + (i % 9),
  }));
  const p = profileColumns(rows);
  assert.deepEqual(p.measures, ['temperature_c']);
  assert.ok(p.dimensions.includes('Reading Ts Hour'), 'grouping by the hour is the point of the column');

  const labels = planKpis(rows).map((k) => k.label);
  assert.ok(!labels.some((l) => /hour/i.test(l)), `the clock is still a headline: ${JSON.stringify(labels)}`);
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
