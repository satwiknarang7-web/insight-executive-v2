/**
 * Deterministic "analyst playbook" chart planner.
 *
 * Given a dataset, it profiles the columns and proposes the charts a real data
 * analyst would build — each grounded in a single dimension (no nonsensical
 * cross-categorical "Male - Yes - No" buckets), with correct SQL, type and axes.
 * Candidates are scored, de-duplicated and trimmed to the strongest set.
 *
 * This is the reliable backbone of the hybrid pipeline: the LLM may reorder /
 * retitle / drop, but it never has to invent SQL, so the structural quality of
 * the deck is guaranteed.
 */
import { profileColumns } from './chartResolver.js';
import {
  classifyColumns,
  deriveMeasures,
  outcomeColumn,
  outcomeRateExpression,
  outcomeRateName,
} from './measureSemantics.js';
import { RECORD_COUNT, aggregateAlias, aggregateTitle, prettyColumn } from './aggregateNames.js';
import {
  association,
  bucketCount,
  distributionShape,
  groupAggregate,
  groupMeanPairs,
  measureDependence,
  outcomeGroups,
  sameColumn,
  outcomeSpread,
  legibility,
  mixUnevenness,
  needsHorizontalBars,
  relationshipStrength,
  sampleRows,
  suitsPartToWhole,
  trendStrength,
  varianceExplained,
} from './chartSignals.js';

const TABLE = 'SalesData';

// Optional name hints, used ONLY to upgrade a chart from COUNT to SUM when a
// column is also statistically a "quantity". Correctness never depends on these:
// composition falls back to COUNT and comparisons use AVG, both valid on any data.
const ADDITIVE_NAME_RE = /(revenue|sales|amount|count|qty|quantit|unit|price|spend|spent|cost|profit|income|volume|population|gdp|order|transaction|download|click|view|visit|session|impression|budget|payment|charge|deposit|withdrawal|sold|stock|inventory)/i;
// Names that imply a NON-additive rate/score even if they also match an additive
// word (e.g. "GDP per capita", "cost ratio") — these veto SUM.
const RATE_NAME_RE = /(per[\s_-]?capita|\bper\b|ratio|percent|\bpct\b|\brate\b|\baverage\b|\bavg\b|\bmean\b|\bmedian\b|\bindex\b|\bscore\b|\brating\b|\bnps\b|\bgrowth\b)/i;
// A price is a per-item figure, so adding prices together is meaningless.
// "unit_price" would otherwise read as additive because it contains "unit". An
// explicit total/gross/net prefix does denote a summable amount, so allow those.
const PRICE_NAME_RE = /price/i;
const PRICE_TOTAL_RE = /(total|gross|net|sum|combined|aggregate)/i;
const isSummableName = (m) =>
  ADDITIVE_NAME_RE.test(m) &&
  !RATE_NAME_RE.test(m) &&
  !(PRICE_NAME_RE.test(m) && !PRICE_TOTAL_RE.test(m));

const br = (k) => `[${k}]`;

// Title-case a raw column name for display / SQL aliases.
export const pretty = prettyColumn;

// Compute min / max / spread for numeric measures (used for bucketing & ranking).
function measureStats(rows, measures) {
  const stats = {};
  for (const m of measures) {
    let min = Infinity, max = -Infinity, sum = 0, n = 0, allInt = true;
    for (const r of rows) {
      const v = r[m];
      if (typeof v === 'number' && isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
        n++;
        if (!Number.isInteger(v)) allInt = false;
      }
    }
    // `sum` is carried rather than reconstructed later as mean * n: that
    // round-trip through a float mean is not the total, only very close to
    // it, and a KPI card labelled "Total" should be the total.
    stats[m] = { min, max, spread: max - min, sum, mean: n ? sum / n : 0, n, allInt };
  }
  return stats;
}

// Infer a numeric column's role from its DATA (not its name). This is what makes
// the planner generalize to arbitrary datasets — e.g. a `rank` column is detected
// as ordinal and never summed, regardless of what it's called.
function numericRole(s, distinct, rowCount) {
  if (!s || s.n === 0) return 'quantity';
  const { min, max, allInt } = s;
  const range = max - min;
  // Flag (0/1) — behaves like a category.
  if (allInt && min >= 0 && max <= 1 && distinct <= 2) return 'binary';
  // Calendar year — temporal, not a magnitude.
  if (allInt && min >= 1800 && max <= 2100 && distinct >= 2 && distinct <= 150) return 'year';
  // Ordinal / rank / sequential id: a dense, (near-)unique integer sequence
  // (distinct ≈ row count AND range ≈ distinct). Summing these is meaningless.
  if (allInt && rowCount >= 8 && distinct >= 0.9 * rowCount && range <= distinct * 1.25) return 'ordinal';
  // Bounded proportion 0..1 — average-only.
  if (!allInt && min >= 0 && max <= 1) return 'rate';
  return 'quantity';
}

// Classify all numeric measures into the roles the planner cares about.
//  - comparable: measures you can AVG / bucket / correlate (quantities + rates),
//    excluding ordinals/years/binaries.
//  - additive:   comparable quantities that are ALSO safe to SUM (name-confirmed).
function classifyMeasures(rows, profile, stats) {
  const rowCount = rows.length;
  const comparable = [];
  const additive = [];
  const years = [];
  for (const m of profile.measures) {
    const role = numericRole(stats[m], profile.cardinality[m] || 0, rowCount);
    if (role === 'year') { years.push(m); continue; }
    if (role === 'ordinal' || role === 'binary') continue; // not a magnitude measure
    comparable.push(m);
    if (role === 'quantity' && isSummableName(m)) {
      additive.push(m);
    }
  }
  return { comparable, additive, years };
}

/**
 * Recommend how many slides a dataset's *richness* warrants. Driven by the number
 * of usable dimensions + measures (NOT the row count — more rows don't mean more
 * charts). Anchored at ~7 for a typical dataset, clamped to an executive range so
 * a very wide dataset can expand a little and a sparse one shrinks.
 */
export function recommendedChartCount(rows) {
  if (!rows || rows.length === 0) return 0;
  const p = profileColumns(rows);
  const { comparable } = classifyMeasures(rows, p, measureStats(rows, p.measures));
  const usableDims = p.dimensions.filter((d) => {
    const c = p.cardinality[d] || 0;
    return c >= 2 && c <= 25;
  }).length;
  const richness = comparable.length + usableDims;
  return Math.max(5, Math.min(10, 4 + Math.round(richness / 3)));
}

/**
 * Produce a scored list of analyst-grade candidate charts.
 */
export function planCharts(rows, { max = 7, provenance = {}, roles = {}, derived = null } = {}) {
  if (!rows || rows.length === 0) return [];

  const p = profileColumns(rows);
  const { measures, temporal, cardinality } = p;
  const rowCount = rows.length;
  if (measures.length === 0 && p.dimensions.length === 0) return [];

  const stats = measureStats(rows, measures);

  // The rows every signal is measured on. Bounded, because scoring is a linear
  // pass per candidate and this runs inside the analysis worker.
  const signalRows = sampleRows(rows);

  // Data-driven roles: ordinals (rank/id), years and binaries are excluded from
  // measures; `comparable` can be averaged/correlated; `additive` can be summed.
  const { comparable, additive: nameAdditive, years } = classifyMeasures(rows, p, stats);

  // Where each column came from decides what may be done to it. A number that
  // arrived from a dimension table repeats once per fact row, so summing it
  // counts the same value many times — see lib/measureSemantics.js for the
  // 7.2x overstatement that motivated this.
  const semantics = classifyColumns({
    profile: p,
    provenance,
    roles,
    cardinality: p.cardinality,
    rowCount,
  });
  const notSummable = new Set([...semantics.preAggregate, ...semantics.attribute]);
  const additive = nameAdditive.filter((m) => !notSummable.has(m));
  // And they are not comparable either. Averaging `customers.Total_Spent` over
  // order rows weights each customer by how often they bought, so the "average
  // customer" it describes is not a customer — it is an average order's owner.
  // Correlating or bucketing it has the same flaw, so the column is left out of
  // distributions and correlations too rather than only out of sums.
  const comparableSafe = comparable.filter((m) => !notSummable.has(m));
  const bySpread = (arr) => [...arr].sort((a, b) => (stats[b]?.spread || 0) - (stats[a]?.spread || 0));
  const rankedComparable = bySpread(comparableSafe);
  const primary = rankedComparable[0] || null;   // a measure to AVG / correlate
  const secondary = rankedComparable[1] || null;

  // Magnitude metric for composition/ranking: prefer a SUM-able additive column,
  // else fall back to COUNT(*) — always meaningful ("records per category").
  const sumCol = bySpread(additive)[0] || null;
  // The name of the magnitude column carries its aggregate. "Total" alone was
  // the whole of a reported accuracy bug: a chart summing billed_artist_count
  // showed 46 under an axis labelled "Total", was compared against a count of
  // the same column, and read as double counting. Both figures were right; the
  // label was the only thing that could have said which was which.
  const magnitudeKey = sumCol ? aggregateAlias('SUM', sumCol) : RECORD_COUNT;
  const magnitudeSql = (cat, limit) => sumCol
    ? `SELECT ${br(cat)}, SUM(${br(sumCol)}) AS ${br(magnitudeKey)} FROM ${TABLE} GROUP BY ${br(cat)} ORDER BY ${br(magnitudeKey)} DESC LIMIT ${limit}`
    : `SELECT ${br(cat)}, COUNT(*) AS ${br(magnitudeKey)} FROM ${TABLE} GROUP BY ${br(cat)} ORDER BY ${br(magnitudeKey)} DESC LIMIT ${limit}`;
  const rankingTitle = (cat) => aggregateTitle(magnitudeKey, [cat]);
  const compositionTitle = (cat) => `${magnitudeKey} Share by ${pretty(cat)}`;

  // Dimensions, richest (most distinct values) first — a category with more levels
  // makes a more informative ranking than a yes/no binary.
  const dims = p.dimensions;
  const byCard = (arr) => [...arr].sort((a, b) => (cardinality[b] || 0) - (cardinality[a] || 0));
  const usable = dims.filter((d) => (cardinality[d] || 0) >= 2 && (cardinality[d] || 0) <= 25);

  /**
   * How informative a breakdown by this column is likely to be.
   *
   * Raw cardinality was the wrong proxy: it puts `State` (30 levels of thin
   * slices) above `Category`, and on a real store export it produced ten slides
   * about geography and none about what was being sold. A readable bar chart
   * has a handful of levels, and the columns a business actually steers by name
   * themselves.
   */
  const dimScore = (d) => {
    const c = cardinality[d] || 0;
    let score = 0;
    if (c >= 3 && c <= 12) score += 3;      // reads cleanly as a bar or donut
    else if (c <= 20) score += 1;
    if (/(category|brand|segment|type|channel|status|tier|group|payment|method|plan|product)/i.test(d)) score += 2;
    if (semantics.byColumn[d]?.kind === 'identifier') score -= 5;
    return score;
  };
  const rankDims = [...usable].sort(
    (a, b) => dimScore(b) - dimScore(a) || (cardinality[b] || 0) - (cardinality[a] || 0)
  );
  const smallDims = byCard(usable.filter((d) => cardinality[d] <= 8));
  const midCard = dims.filter((d) => cardinality[d] > 8 && cardinality[d] <= 25);
  const highCard = dims.filter((d) => cardinality[d] > 25);
  const contMeasures = rankedComparable.filter((m) => (cardinality[m] || 0) > 12);

  const candidates = [];
  const add = (c) => candidates.push({ secondaryYAxisKey: null, ...c });

  // 1. TIME TREND over a temporal/year column (magnitude metric).
  // ISO date columns are BUCKETED (by month, or year for long spans) so the trend
  // is chronological and has a readable number of points — otherwise 1000 distinct
  // timestamps would trip the self-heal fallback and scramble the order.
  const timeCol = temporal[0] || years[0] || null;
  if (timeCol) {
    const tSample = String(rows[0]?.[timeCol] ?? '');
    const isISODate = /^\d{4}-\d{2}-\d{2}/.test(tSample);
    const tDistinct = cardinality[timeCol] || 0;
    /**
     * Bucket by year only when a year axis still has points on it.
     *
     * Three years of daily rows is more than 750 distinct dates, so the rule
     * bucketed to years and drew a trend with three points on it — an arc
     * through 2024, 2025 and 2026, from which nothing about when anything
     * happened can be read. Months over the same span give thirty-six, which is
     * a trend. Years are for spans long enough to have years to compare.
     */
    const spanMonths = isISODate ? monthsCovered(rows, timeCol) : 0;
    const yearly = isISODate && spanMonths >= 96;
    // How many leading characters of the ISO date the period is cut from. Zero
    // when the column is already a period, so the signal preview buckets the
    // series exactly the way the query does.
    const prefix = isISODate ? (yearly ? 4 : 7) : 0;
    let xAlias = timeCol;
    let xExpr = br(timeCol);
    if (isISODate) {
      xAlias = yearly ? 'Year' : 'Month';
      xExpr = `SUBSTRING(${br(timeCol)}, 1, ${prefix})`;
    }
    const yExpr = sumCol ? `SUM(${br(sumCol)})` : 'COUNT(*)';
    add({
      title: `${magnitudeKey} Trend Over ${pretty(xAlias)}`,
      chart_type: 'area',
      dimension: timeCol,
      sql: `SELECT ${xExpr} AS ${br(xAlias)}, ${yExpr} AS ${br(magnitudeKey)} FROM ${TABLE} GROUP BY ${xExpr} ORDER BY ${br(xAlias)} ASC`,
      xAxisKey: xAlias,
      yAxisKey: magnitudeKey,
      signal: { kind: 'trend', column: timeCol, prefix },
      score: 100,
    });
  }

  // 2-4. MAGNITUDE RANKINGS of the richest categories (SUM additive, else COUNT).
  rankDims.slice(0, 3).forEach((cat, i) => {
    add({
      title: rankingTitle(cat),
      chart_type: 'bar',
      dimension: cat,
      sql: magnitudeSql(cat, 10),
      xAxisKey: cat,
      yAxisKey: magnitudeKey,
      signal: { kind: 'magnitude', dimension: cat, measure: sumCol, shown: 10 },
      score: 92 - i * 8,
    });
  });

  // 5-6. COMPOSITION / SHARE of up to two small categories (part-to-whole).
  if (!p.hasNegatives) {
    smallDims.slice(0, 2).forEach((cat, i) => {
      add({
        title: compositionTitle(cat),
        chart_type: 'donut',
        dimension: cat,
        sql: magnitudeSql(cat, 6),
        xAxisKey: cat,
        yAxisKey: magnitudeKey,
        signal: { kind: 'magnitude', dimension: cat, measure: sumCol, shown: 6 },
        score: 84 - i * 12,
      });
    });

    // Share of RECORDS, when the composition above is a share of a summed value.
    // "Which segments are biggest by revenue" and "which segments have the most
    // customers" are different questions, and the gap between the two answers is
    // often the most interesting thing in the data. Only offered when a sum
    // column exists — otherwise this is the same chart as above.
    if (sumCol) {
      smallDims.slice(0, 2).forEach((cat, i) => {
        add({
          title: `${RECORD_COUNT} Share by ${pretty(cat)}`,
          chart_type: 'donut',
          dimension: cat,
          sql: `SELECT ${br(cat)}, COUNT(*) AS ${br(RECORD_COUNT)} FROM ${TABLE} GROUP BY ${br(cat)} ORDER BY ${br(RECORD_COUNT)} DESC LIMIT 6`,
          xAxisKey: cat,
          yAxisKey: RECORD_COUNT,
          signal: { kind: 'magnitude', dimension: cat, measure: null, shown: 6 },
          score: 70 - i * 10,
        });
      });
    }
  }

  // 7-8. AVERAGE of comparable measures by category (AVG is valid for any measure).
  // Different metric from the COUNT/SUM ranking, so it's worth pairing even on the
  // same dimension (e.g. "Count by Region" + "Average Score by Region").
  if (primary) {
    rankDims.slice(0, 2).forEach((cat, i) => {
      const measure = (i === 1 && secondary) ? secondary : primary; // vary the metric across the two
      const avgKey = aggregateAlias('AVG', measure);
      add({
        title: aggregateTitle(avgKey, [cat]),
        chart_type: 'bar',
        dimension: cat,
        sql: `SELECT ${br(cat)}, AVG(${br(measure)}) AS ${br(avgKey)} FROM ${TABLE} GROUP BY ${br(cat)} ORDER BY ${br(avgKey)} DESC LIMIT 12`,
        xAxisKey: cat,
        yAxisKey: avgKey,
        signal: { kind: 'variance', dimension: cat, measure, shown: 12 },
        score: 74 - i * 8,
      });
    });
  }

  // 6b. DERIVED MEASURES by category.
  //
  // The measures an analyst would have written — order value, discount rate,
  // basket size — broken out by the dimensions that read best. These are the
  // charts that talk about the business rather than about whichever column
  // happened to hold the largest numbers, and they are ordinary measures: the
  // same SQL the manual builder emits, validated by the same code.
  const autoMeasures =
    derived ||
    deriveMeasures({
      profile: p,
      provenance,
      roles,
      cardinality,
      rowCount,
      columns: [...measures, ...dims],
      sample: rows.slice(0, 500),
    });

  /**
   * The question the dataset exists to answer, when it has one.
   *
   * A file whose columns include `Churn` is not a file about monthly charges
   * that happens to carry a churn flag — it is a file about churn. A deck built
   * from one went out reporting average charge by plan tier and never mentioned
   * retention, because every column was treated as interchangeable with every
   * other. Where an outcome column exists, the rate of it is charted against
   * every dimension worth splitting by, and those charts lead: this is the
   * dependent variable, and the rest of the deck is context for it.
   */
  const outcome = outcomeColumn({
    columns: [...dims, ...measures],
    sample: rows.slice(0, 500),
    cardinality,
  });

  if (outcome) {
    const rateName = outcomeRateName(outcome);
    const rateExpr = outcomeRateExpression(outcome);

    // Against the categories first, and then against tenure or any other
    // continuous measure banded — "churn by how long they have been here" is
    // the chart every retention review opens with.
    /**
     * The outcome against a continuous measure, banded.
     *
     * Tenure was on the deck as a distribution — the shape of how long people
     * have been here — while the chart every retention review actually opens
     * with is churn against that same tenure, banded. The outcome charts only
     * ever split by categorical columns, so the one crossing that answers "do
     * they leave early or late" could not be built at all.
     */
    const bandable = contMeasures.filter((m) => {
      const st = stats[m];
      return st && Number.isFinite(st.spread) && st.spread > 0;
    });

    bandable.slice(0, 1).forEach((m) => {
      const bands = bucketCount(signalRows.map((r) => r[m]), { min: 4, max: 8 });
      const edges = bandEdges(stats[m].min, stats[m].spread, bands);
      if (edges.length < 3) return;
      const labels = bandLabels(edges);
      const col = br(m);
      const clauses = [];
      for (let k = 1; k < edges.length; k++) {
        clauses.push(`WHEN ${col} < ${edges[k]} THEN '${labels[k - 1]}'`);
      }
      const caseExpr = `CASE ${clauses.join(' ')} ELSE '${labels[labels.length - 1]}' END`;
      const alias = `${pretty(m)} Band`;

      add({
        title: `${rateName} by ${pretty(m)}`,
        chart_type: 'bar',
        dimension: alias,
        // The bands run low to high, which is what makes the chart readable as
        // a progression rather than a ranking.
        ordered: true,
        sortLabels: labels,
        sql:
          `SELECT ${caseExpr} AS ${br(alias)}, ${rateExpr} AS ${br(rateName)} FROM ${TABLE} ` +
          `GROUP BY ${caseExpr} ORDER BY MIN(${col}) ASC`,
        xAxisKey: alias,
        yAxisKey: rateName,
        outcomeRate: { column: outcome.column, event: outcome.event, highIsGood: outcome.highIsGood },
        signal: { kind: 'outcomeBand', measure: m, column: outcome.column, event: outcome.event, edges },
        score: 96,
      });
    });

    rankDims
      .filter((d) => d !== outcome.column)
      .slice(0, 3)
      .forEach((cat, i) => {
        add({
          title: `${rateName} by ${pretty(cat)}`,
          chart_type: 'bar',
          dimension: cat,
          sql:
            `SELECT ${br(cat)}, ${rateExpr} AS ${br(rateName)} FROM ${TABLE} ` +
            `GROUP BY ${br(cat)} ORDER BY ${br(rateName)} DESC LIMIT 10`,
          xAxisKey: cat,
          yAxisKey: rateName,
          // Marks this as the dependent variable rather than one more measure,
          // so the scorecard can lead with it instead of with whichever segment
          // happens to be biggest.
          outcomeRate: { column: outcome.column, event: outcome.event, highIsGood: outcome.highIsGood },
          // Scored on how much the rate actually differs between the segments.
          // A churn rate that is the same everywhere is worth knowing once, not
          // three times, and the floor will drop the repeats.
          signal: { kind: 'outcome', dimension: cat, column: outcome.column, event: outcome.event },
          score: 98 - i * 3,
        });
      });
  }

  autoMeasures.slice(0, 3).forEach((m, i) => {
    const cat = rankDims[i % Math.max(1, rankDims.length)];
    if (!cat) return;
    add({
      title: `${m.name} by ${pretty(cat)}`,
      chart_type: 'bar',
      dimension: cat,
      sql:
        `SELECT ${br(cat)}, ${m.expr} AS ${br(m.name)} FROM ${TABLE} ` +
        `GROUP BY ${br(cat)} ORDER BY ${br(m.name)} DESC LIMIT 10`,
      xAxisKey: cat,
      yAxisKey: m.name,
      measure: m,
      score: 90 - i * 4,
    });
  });

  // 7-8. DISTRIBUTIONS (histograms) of up to two continuous measures via value buckets.
  //
  // The number of bands is chosen from the values rather than fixed. Four bands
  // was wrong in both directions: on a tight, symmetric measure it merged the
  // only structure there was, and on a long-tailed one it produced three empty
  // bands and a wall. Freedman-Diaconis sizes the bands from the interquartile
  // range and the row count, which is how a histogram gets built by hand.
  contMeasures.slice(0, 2).forEach((m, i) => {
    const s = stats[m];
    if (!s || !isFinite(s.min) || s.spread <= 0) return;

    const bands = bucketCount(signalRows.map((r) => r[m]));
    const edges = bandEdges(s.min, s.spread, bands);
    // Rounding can collapse two edges into one on a narrow measure, which would
    // emit a band that can never match. Distinct edges are what make the CASE
    // exhaustive and the labels readable.
    if (edges.length < 3) return;
    const labels = bandLabels(edges);

    const col = br(m);
    const rangeAlias = `${pretty(m)} Range`; // unique per measure so histograms don't collide
    const clauses = [];
    for (let k = 1; k < edges.length; k++) {
      clauses.push(`WHEN ${col} < ${edges[k]} THEN '${labels[k - 1]}'`);
    }
    const caseExpr = `CASE ${clauses.join(' ')} ELSE '${labels[labels.length - 1]}' END`;

    add({
      title: `Distribution of ${pretty(m)}`,
      chart_type: 'bar',
      dimension: m,
      // AlaSQL does not reliably honour ORDER BY over an aggregate of a column
      // that isn't selected, so the buckets can come back shuffled — which makes
      // a histogram meaningless. The intended order is carried explicitly and
      // reapplied after execution (see applyLabelOrder in pipeline.js).
      sortLabels: labels,
      sql: `SELECT ${caseExpr} AS ${br(rangeAlias)}, COUNT(*) AS ${br(RECORD_COUNT)} FROM ${TABLE} GROUP BY ${caseExpr} ORDER BY MIN(${col}) ASC`,
      xAxisKey: rangeAlias,
      yAxisKey: RECORD_COUNT,
      signal: { kind: 'distribution', measure: m },
      // A histogram describes the shape of a column, which is a fact about the
      // data rather than about the business in it. It is a good supporting
      // chart and a poor lede: a strongly skewed revenue column scores 0.84 on
      // its own statistic and was opening decks ahead of a thirty-four percent
      // revenue decline. Scored below the charts that answer a question so it
      // can still earn a slide without leading one.
      score: 62 - i * 10,
    });
  });

  // 9. MULTI-METRIC SEGMENT PROFILE (radar) — needs 3+ comparable measures + tiny category.
  const radarCat = rankDims.find((d) => cardinality[d] >= 3 && cardinality[d] <= 6);
  if (radarCat && rankedComparable.length >= 3) {
    const [m1, m2, m3] = rankedComparable;
    // Each spoke is an AVERAGE. Naming the axis after the bare column made an
    // average read as the column's own value, which is the same mislabelling
    // that made a sum look like a count.
    const [a1, a2, a3] = [m1, m2, m3].map((m) => aggregateAlias('AVG', m));
    add({
      title: `${pretty(radarCat)} Profile Across Key Metrics`,
      chart_type: 'radar',
      dimension: radarCat,
      sql: `SELECT ${br(radarCat)}, AVG(${br(m1)}) AS ${br(a1)}, AVG(${br(m2)}) AS ${br(a2)}, AVG(${br(m3)}) AS ${br(a3)} FROM ${TABLE} GROUP BY ${br(radarCat)} LIMIT 6`,
      xAxisKey: radarCat,
      yAxisKey: a1,
      signal: { kind: 'multi', dimension: radarCat, measures: [m1, m2, m3] },
      score: 66,
    });
  }

  // 10. DUAL-AXIS volume vs average (composed) — needs an additive SUM column
  //     plus a different comparable measure to average.
  const dualCat = rankDims[0];
  /**
   * A combo chart needs two measures that can share an axis.
   *
   * Drawn with a second y-axis, it invites a comparison that the second scale
   * makes up: the reader sees a line crossing bars and reads a relationship
   * into a pair of ratios chosen by the renderer. It becomes indefensible when
   * the two are orders of magnitude apart — a total of six billion against an
   * average of eighty thousand came out as a flat line pinned to the top of the
   * frame, which is not a chart of anything.
   *
   * So the pairing is only offered when the two measures live on comparable
   * scales, and the two questions are otherwise better answered by two charts.
   */
  const COMPARABLE_MAGNITUDE = 25;
  const avgCompanion =
    rankedComparable.find((m) => {
      if (m === sumCol) return false;
      const total = Math.abs((stats[sumCol]?.mean || 0) * rowCount);
      const avg = Math.abs(stats[m]?.mean || 0);
      if (!total || !avg) return false;
      const ratio = total > avg ? total / avg : avg / total;
      return ratio <= COMPARABLE_MAGNITUDE;
    }) || null;

  if (dualCat && sumCol && avgCompanion) {
    const sumAlias = aggregateAlias('SUM', sumCol);
    const avgAlias = aggregateAlias('AVG', avgCompanion);
    add({
      title: `${sumAlias} vs ${avgAlias} by ${pretty(dualCat)}`,
      chart_type: 'composed',
      dimension: dualCat,
      sql: `SELECT ${br(dualCat)}, SUM(${br(sumCol)}) AS ${br(sumAlias)}, AVG(${br(avgCompanion)}) AS ${br(avgAlias)} FROM ${TABLE} GROUP BY ${br(dualCat)} ORDER BY ${br(sumAlias)} DESC LIMIT 8`,
      xAxisKey: dualCat,
      yAxisKey: sumAlias,
      secondaryYAxisKey: avgAlias,
      signal: { kind: 'magnitude', dimension: dualCat, measure: sumCol, shown: 8 },
      score: 60,
    });
  }

  // 11. CORRELATION (scatter) — only when a dimension yields enough points.
  const corrDim = highCard[0] || midCard.find((d) => cardinality[d] >= 15);
  if (corrDim && primary && secondary) {
    // Both axes are averages per group, not raw values, and the labels say so:
    // a correlation read as though it were between the columns themselves
    // overstates what was actually measured.
    const xAlias = aggregateAlias('AVG', primary);
    const yAlias = aggregateAlias('AVG', secondary);
    add({
      title: `${xAlias} vs ${yAlias} Correlation`,
      chart_type: 'scatter',
      dimension: corrDim,
      sql: `SELECT ${br(corrDim)}, AVG(${br(primary)}) AS ${br(xAlias)}, AVG(${br(secondary)}) AS ${br(yAlias)} FROM ${TABLE} GROUP BY ${br(corrDim)} LIMIT 60`,
      xAxisKey: xAlias,
      yAxisKey: yAlias,
      signal: { kind: 'correlation', dimension: corrDim, x: primary, y: secondary },
      score: 56,
    });
  }

  /**
   * MATRIX — one category down the side, a second across the top.
   *
   * The shape that answers "which combination", which no single-dimension chart
   * can: revenue is concentrated in Electronics and also in the 26-35s, and
   * whether those are the same customers is the question a reader has next.
   * Offered when two categories are each small enough for a grid to be read.
   */
  const gridDims = rankDims.filter((d) => cardinality[d] >= 2 && cardinality[d] <= 10);
  if (gridDims.length >= 2 && sumCol) {
    // Every pair, not the first two. Which combination matters is exactly what
    // this chart is for and exactly what a column list cannot say: a deck built
    // from the first two dimensions offered "revenue by category and age" while
    // the interaction in the data was between category and region. The
    // candidates are all emitted and the interaction signal picks; a pair that
    // says nothing beyond its two columns separately falls under the floor like
    // anything else.
    const pairs = [];
    for (let a = 0; a < gridDims.length && pairs.length < 6; a++) {
      for (let b = a + 1; b < gridDims.length && pairs.length < 6; b++) {
        pairs.push([gridDims[a], gridDims[b]]);
      }
    }
    for (const [rowDim, colDim] of pairs) {
      add({
        title: `${magnitudeKey} by ${pretty(rowDim)} and ${pretty(colDim)}`,
        chart_type: 'matrix',
        dimension: rowDim,
        sql:
          `SELECT ${br(rowDim)}, ${br(colDim)}, SUM(${br(sumCol)}) AS ${br(magnitudeKey)} FROM ${TABLE} ` +
          `GROUP BY ${br(rowDim)}, ${br(colDim)} LIMIT 80`,
        xAxisKey: rowDim,
        yAxisKey: magnitudeKey,
        secondaryYAxisKey: colDim,
        signal: { kind: 'interaction', a: rowDim, b: colDim, measure: sumCol },
        score: 68,
      });
    }
  }

  /**
   * WATERFALL — what moved the total, period by period.
   *
   * A trend line says the total fell; a waterfall says which months took it
   * down and by how much, which is the difference between reporting a decline
   * and explaining one. Built from the same periods as the trend, as changes
   * rather than levels.
   */
  if (timeCol && sumCol && cardinality[timeCol] >= 3) {
    const tSample2 = String(rows[0]?.[timeCol] ?? '');
    const iso = /^\d{4}-\d{2}-\d{2}/.test(tSample2);
    const periodExpr = iso ? `SUBSTRING(${br(timeCol)}, 1, 7)` : br(timeCol);
    const alias = iso ? 'Month' : pretty(timeCol);
    add({
      title: `What Moved ${magnitudeKey} by ${alias}`,
      chart_type: 'waterfall',
      // Its own slot: a waterfall of period-over-period change is not the trend
      // line of the levels, and keying both on the same dimension and measure
      // let the line block it every time.
      dimension: `${timeCol} (change)`,
      sql:
        `SELECT ${periodExpr} AS ${br(alias)}, SUM(${br(sumCol)}) AS ${br(magnitudeKey)} FROM ${TABLE} ` +
        `GROUP BY ${periodExpr} ORDER BY ${br(alias)} ASC`,
      xAxisKey: alias,
      yAxisKey: magnitudeKey,
      // Scored on the same series the trend uses: a total that barely moves has
      // nothing for a waterfall to decompose.
      signal: { kind: 'trend', column: timeCol, prefix: iso ? 7 : 0 },
      score: 64,
    });
  }

  // 12. TREEMAP composition of a mid-cardinality category (magnitude metric).
  const treeCat = midCard[0];
  if (treeCat && !p.hasNegatives) {
    add({
      title: compositionTitle(treeCat),
      chart_type: 'treemap',
      dimension: treeCat,
      sql: magnitudeSql(treeCat, 15),
      xAxisKey: treeCat,
      yAxisKey: magnitudeKey,
      signal: { kind: 'magnitude', dimension: treeCat, measure: sumCol, shown: 15 },
      score: 52,
    });
  }

  return selectDiverse(scoreBySignal(candidates, { rows: signalRows, sumCol }), max, {
    relatedness: relatednessOf(signalRows),
    duplicate: duplicateOf(signalRows),
  });
}

/**
 * How far a candidate's own data can move it in the running order.
 *
 * The playbook scores (52..100) encode which kinds of chart usually matter:
 * a trend outranks a treemap because it usually is more important, not because
 * it always is. The signal is what the data says on this file, mapped from 0..1
 * onto plus or minus this many points. At 40 a dead chart drops roughly two
 * playbook tiers and a vivid one climbs two — enough for the evidence to
 * overturn the prior when it is emphatic, not enough for a striking treemap to
 * displace a genuine trend.
 */
const SIGNAL_WEIGHT = 40;

/**
 * The measured signal below which a chart is not worth a slide.
 *
 * Every statistic behind this is scaled to 0..1 and means the same thing: how
 * much the chart would tell a reader that they did not already know. A donut of
 * four near-equal regions, a histogram with no shape, a ranking of identical
 * bars — all land here.
 */
const SIGNAL_FLOOR = 0.12;

/** Never cut a deck below this, however little the data has to say. */
const MIN_CHARTS = 3;

/**
 * The lower edge of each histogram band: `bands` strictly increasing integers.
 *
 * The top of the range is deliberately not an edge. The final band is the CASE
 * expression's ELSE, so it runs from the last edge upwards and catches the
 * maximum — emitting an edge at the maximum instead would leave a final band
 * holding only the rows that sit exactly on it.
 *
 * The edges are rounded because they are read by people, and rounding can
 * collapse two of them on a narrow measure. Collapsed edges are dropped rather
 * than kept, so every band that is emitted can actually match a row.
 */
function bandEdges(min, spread, bands) {
  const step = spread / bands;
  const edges = [];
  for (let k = 0; k < bands; k++) {
    const edge = Math.round(min + step * k);
    if (edges.length === 0 || edge > edges[edges.length - 1]) edges.push(edge);
  }
  return edges;
}

/**
 * The label for each band, compacted — "351265-504372" is unreadable on an axis
 * and in a sentence. Bucket labels are display strings only; nothing downstream
 * parses them.
 *
 * Compacting can make two adjacent labels identical (1.2K to 1.2K), and two
 * bands with the same name is worse than two long names, so the whole set falls
 * back to exact edges the moment any pair collides.
 */
function bandLabels(edges) {
  const build = (fmt) => {
    const out = [];
    for (let k = 1; k < edges.length; k++) out.push(`${fmt(edges[k - 1])}-${fmt(edges[k])}`);
    out.push(`${fmt(edges[edges.length - 1])}+`);
    return out;
  };
  const compacted = build(compact);
  return new Set(compacted).size === compacted.length ? compacted : build(String);
}

/**
 * Measure what each candidate would actually show, and let that move its score.
 *
 * This is the difference between a planner that knows which charts are valid
 * and one that knows which are worth building. Everything above decides what
 * the schema permits; this decides what the data rewards. A candidate whose
 * query would come back as six bars of the same height loses most of its
 * playbook standing to one that would come back with a real split — and where
 * the shape argues for a different chart type than the playbook assumed, it is
 * changed here rather than drawn wrong.
 *
 * Candidates with no measurable signal (the derived measures, whose SQL is an
 * arbitrary expression this module does not evaluate) keep their prior
 * untouched rather than being penalised for being unmeasurable.
 */
function scoreBySignal(candidates, { rows, sumCol }) {
  const out = [];
  const weak = [];
  for (const c of candidates) {
    const read = readSignal(c.signal, rows, sumCol);
    if (read === null) {
      out.push(c);
      continue;
    }
    // Nothing to compare. A single bar is not a chart, whatever it is a chart
    // of, and every statistic below is undefined on one group.
    if (read.degenerate) continue;

    /**
     * Time always earns one slide.
     *
     * A trend is scored on how much of the series is direction rather than
     * noise, so a business whose revenue held steady all year scores zero and
     * loses its only chart of the time axis — and the deck then has nothing to
     * say about when anything happened, which is the first question anybody
     * asks. "Flat for twelve months" is a finding; the floor is for charts
     * that could have been guessed, and that one cannot.
     */
    if (c.signal.kind === 'trend') {
      out.push({
        ...c,
        chart_type: refineType(c, read),
        signalScore: round2(read.score),
        score: c.score + (read.score - 0.5) * 2 * SIGNAL_WEIGHT,
      });
      continue;
    }

    const scored = {
      ...c,
      chart_type: refineType(c, read),
      signalScore: round2(read.score),
      score: c.score + (read.score - 0.5) * 2 * SIGNAL_WEIGHT,
    };

    // A measured signal this low means the chart would show the reader
    // something they could have guessed: four near-equal slices, a flat
    // distribution, a ranking whose bars are the same height. Scoring it down
    // was not enough — with few candidates it still shipped, and a deck of nine
    // charts where four say nothing is worse than a deck of five. Held back
    // rather than dropped, so a thin dataset still gets a deck.
    if (read.score < SIGNAL_FLOOR) weak.push(scored);
    else out.push(scored);
  }

  if (out.length >= MIN_CHARTS) return out;

  // Back-filling a thin deck should widen it, not repeat it. Two charts of the
  // same measure that both scored nothing are one piece of non-news twice, so
  // the net takes at most one of each measure before it takes a second.
  weak.sort((a, b) => b.score - a.score);
  const taken = new Set(out.map((c) => String(c.yAxisKey || '').toLowerCase()));
  const filler = [];
  for (const pass of [0, 1]) {
    for (const c of weak) {
      if (out.length + filler.length >= MIN_CHARTS) break;
      if (filler.includes(c)) continue;
      const key = String(c.yAxisKey || '').toLowerCase();
      if (pass === 0 && taken.has(key)) continue;
      taken.add(key);
      filler.push(c);
    }
  }
  return [...out, ...filler];
}

const round2 = (v) => Math.round(v * 100) / 100;
const unitScore = (v) => Math.max(0, Math.min(1, v));

/** Run one candidate's declared signal against the sampled rows. */
function readSignal(signal, rows, sumCol) {
  if (!signal || !rows.length) return null;

  if (signal.kind === 'magnitude') {
    const agg = signal.measure ? 'SUM' : 'COUNT';
    const { groups } = groupAggregate(rows, signal.dimension, signal.measure, agg);
    if (groups.length < 2) return { degenerate: true };
    const shown = Math.min(signal.shown || groups.length, groups.length);
    return {
      groups,
      shown,
      score: mixUnevenness(groups.slice(0, shown).map((g) => g.value)) * legibility(shown),
    };
  }

  if (signal.kind === 'variance') {
    const { groups } = groupAggregate(rows, signal.dimension, signal.measure, 'AVG');
    if (groups.length < 2) return { degenerate: true };
    const shown = Math.min(signal.shown || groups.length, groups.length);
    return { groups, shown, score: varianceExplained(groups) * legibility(shown) };
  }

  if (signal.kind === 'trend') {
    const series = timeSeries(rows, signal, sumCol);
    if (series.length < 2) return { degenerate: true };
    return { series, score: trendStrength(series.map((pt) => pt.value)) };
  }

  if (signal.kind === 'correlation') {
    // A relationship between a total and one of its own factors is arithmetic,
    // not evidence. `Revenue` against `Unit_Price` correlates strongly on every
    // dataset ever collected, because revenue is unit price times quantity —
    // and a deck that reports it goes on to recommend an experiment on a
    // multiplication. Dropped outright rather than scored low: there is no
    // amount of correlation that would make it worth showing.
    const columns = Object.keys(rows[0] || {});
    const dep = measureDependence(rows, signal.x, signal.y, columns);
    if (dep.dependent) return { degenerate: true, dependence: dep };

    const { xs, ys } = groupMeanPairs(rows, signal.dimension, signal.x, signal.y);
    if (xs.length < 2) return { degenerate: true };
    return { points: xs.length, score: relationshipStrength(xs, ys) };
  }

  if (signal.kind === 'interaction') {
    // Worth a grid when the pair says more than either column alone. Measured
    // as how much of the measure's variance the combination explains against
    // the better of the two on its own — a grid whose rows all look the same is
    // two bar charts stacked sideways.
    const pairKey = (r) => `${r[signal.a]} ${r[signal.b]}`;
    const withPair = rows.map((r) => ({ ...r, __pair: pairKey(r) }));
    const both = groupAggregate(withPair, '__pair', signal.measure, 'AVG');
    const one = groupAggregate(rows, signal.a, signal.measure, 'AVG');
    const two = groupAggregate(rows, signal.b, signal.measure, 'AVG');
    if (both.groups.length < 4) return { degenerate: true };
    const pair = varianceExplained(both.groups);
    const best = Math.max(varianceExplained(one.groups), varianceExplained(two.groups));
    return { score: unitScore(pair - best) };
  }

  if (signal.kind === 'outcomeBand') {
    const band = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      for (let k = 1; k < signal.edges.length; k++) if (n < signal.edges[k]) return `b${k - 1}`;
      return `b${signal.edges.length - 1}`;
    };
    const banded = rows.map((r) => ({ __band: band(r[signal.measure]), [signal.column]: r[signal.column] }));
    const groups = outcomeGroups(banded, '__band', signal.column, signal.event);
    if (groups.length < 2) return { degenerate: true };
    return { groups, score: outcomeSpread(groups) * legibility(groups.length) };
  }

  if (signal.kind === 'outcome') {
    const groups = outcomeGroups(rows, signal.dimension, signal.column, signal.event);
    if (groups.length < 2) return { degenerate: true };
    return { groups, score: outcomeSpread(groups) * legibility(groups.length) };
  }

  if (signal.kind === 'distribution') {
    const values = rows.map((r) => r[signal.measure]);
    return { score: distributionShape(values).signal };
  }

  if (signal.kind === 'multi') {
    // A radar earns its place when the segments genuinely differ on the metrics
    // it plots. Where they do not, it is a regular polygon drawn three times.
    const scores = signal.measures.map((m) => {
      const { groups } = groupAggregate(rows, signal.dimension, m, 'AVG');
      return groups.length < 2 ? 0 : varianceExplained(groups);
    });
    if (scores.every((v) => v === 0)) return { degenerate: true };

    // And one axis carrying everything is not a profile either. A radar where a
    // single metric separates the segments and the rest are flat draws one
    // spike out of a dot — which is what "Product Category Profile Across Key
    // Metrics" was: Electronics, and a shape with no other information in it.
    const best = Math.max(...scores);
    const rest = scores.filter((v) => v !== best);
    const spike = rest.length > 0 && rest.every((v) => v < best * 0.25);
    if (spike) return { degenerate: true };

    return { score: scores.reduce((a, b) => a + b, 0) / scores.length };
  }

  return null;
}

/**
 * The trend the planner's SQL would produce, rebuilt in JS.
 *
 * `prefix` mirrors the SUBSTRING the query uses to bucket an ISO date by month
 * or by year; 0 means the column is already a period. Sorted by label, which is
 * what makes ISO periods chronological — and the same thing the query's
 * `ORDER BY` relies on.
 */
function timeSeries(rows, signal, sumCol) {
  const totals = new Map();
  for (const row of rows) {
    const raw = row?.[signal.column];
    if (raw === null || raw === undefined || raw === '') continue;
    const label = signal.prefix ? String(raw).slice(0, signal.prefix) : String(raw);
    const add = sumCol ? Number(row?.[sumCol]) : 1;
    if (!isFinite(add)) continue;
    totals.set(label, (totals.get(label) || 0) + add);
  }
  return [...totals.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([label, value]) => ({ label, value }));
}

/**
 * Correct the chart type against the shape the preview just revealed.
 *
 * Each of these is a decision the playbook cannot make, because it depends on
 * values rather than columns — and each was previously wrong on real files:
 *
 *  - Long category names in vertical bars get rotated, truncated or dropped.
 *    The app has always been able to draw a horizontal bar; nothing planned one.
 *  - A donut of the top six is a lie when those six are 40% of the total: the
 *    reader treats the visible slices as the whole. Drawn as a ranking it claims
 *    nothing about a whole it never showed.
 *  - An area chart over five points is mostly fill. A line reads the movement.
 */
function refineType(candidate, read) {
  const type = candidate.chart_type;

  if (type === 'bar' && read.groups) {
    const labels = read.groups.slice(0, read.shown).map((g) => g.label);
    if (needsHorizontalBars(labels)) return 'hbar';
    return 'bar';
  }

  if ((type === 'donut' || type === 'pie') && read.groups) {
    return suitsPartToWhole(read.groups, read.shown) ? type : 'bar';
  }

  if (type === 'treemap' && read.groups) {
    // A treemap is built for many segments, so only the coverage test applies:
    // its slice count is not the thing that makes it unreadable.
    return suitsPartToWhole(read.groups, read.shown, { maxSlices: 40 }) ? 'treemap' : 'bar';
  }

  if (type === 'area' && read.series) {
    return read.series.length <= 12 ? 'line' : 'area';
  }

  return type;
}

/**
 * Cramer's V between any two dimensions, computed once per pair.
 *
 * Used to stop a deck saying the same thing several ways. `city` and `state`,
 * `product` and `category`, `plan` and `price_band` are each one dimension
 * wearing two names: a selector that spreads across "different" columns will
 * cheerfully build a chart of each and call the deck varied.
 */
/** Memoised "these two columns hold the same values" test. */
function duplicateOf(rows) {
  const cache = new Map();
  return (a, b) => {
    if (!a || !b || a === b) return false;
    const key = a < b ? `${a} ${b}` : `${b} ${a}`;
    if (!cache.has(key)) cache.set(key, sameColumn(rows, a, b));
    return cache.get(key);
  };
}

/** How many distinct months an ISO date column covers, from a bounded sample. */
function monthsCovered(rows, column) {
  const months = new Set();
  const step = Math.max(1, Math.floor(rows.length / 4000));
  for (let i = 0; i < rows.length; i += step) {
    const v = String(rows[i]?.[column] ?? '');
    if (/^\d{4}-\d{2}/.test(v)) months.add(v.slice(0, 7));
  }
  return months.size;
}

function relatednessOf(rows) {
  const cache = new Map();
  return (a, b) => {
    if (!a || !b || a === b) return 0;
    const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    if (!cache.has(key)) cache.set(key, association(rows, a, b));
    return cache.get(key);
  };
}

// Greedily pick the strongest candidates while spreading across chart TYPES and
// DIMENSIONS. Each already-picked chart of the same type or dimension penalizes a
// candidate's effective score, so the deck stays varied — but it still fills up to
// `max` when enough distinct candidates exist, and shrinks below it otherwise.
const TYPE_PENALTY = 22;
const DIM_PENALTY = 16;
/**
 * What a chart of a dimension that duplicates one already picked costs.
 *
 * Cubed in Cramer's V so the penalty is sharply concentrated on the case it is
 * for: `city` inside `state`, `product` inside `category`, one column that
 * determines another. Those pay nearly the whole 60 and drop out of the deck.
 * A pair that is merely correlated — V around 0.5, two genuinely different
 * views that happen to move together — pays under eight points and is left
 * alone, because it is a second finding rather than the same one restated.
 *
 * Taken as the strongest relationship to anything already picked rather than
 * summed across all of them. Summing would compound: on a dataset whose columns
 * are all restatements of each other, the fourth chart would pay three times
 * over and the deck would collapse to two slides. A penalty rather than a veto
 * for the same reason — a repetitive deck beats no deck.
 */
const REDUNDANCY_PENALTY = 60;


function selectDiverse(candidates, max, { relatedness = () => 0, duplicate = () => false } = {}) {
  const remaining = [...candidates];
  const picked = [];
  const typeCount = {};
  const dimCount = {};
  const seen = new Set();
  // Same dimension, same measure = the same fact twice, whatever chart type it
  // is drawn as ("Region by Revenue" beside "Region Share of Revenue"). This is
  // a hard block rather than a penalty: a shorter deck beats a repetitive one,
  // so `max` is a ceiling, not a quota to fill.
  const usedPairs = new Set();
  let distributions = 0;
  let matrices = 0;
  const dimOf = (c) => c.dimension || c.xAxisKey;
  /**
   * What makes two charts the same fact.
   *
   * The key used to be the dimension and the axis label, which let "Average
   * Monthly Charge by Plan Tier" and "Total Monthly Charge Share by Plan Tier"
   * both through — the aliases differ, so the pair looked new, and half a
   * four-chart deck went on saying Enterprise is the biggest plan tier twice.
   * The aggregate is stripped out, so a column is spoken for on a dimension
   * whichever way it was summarised.
   */
  const measureOf = (c) => {
    // A share is its own aggregate written a different way: "Total Revenue by
    // Category" and "Total Revenue Share by Category" rank the same categories
    // on the same number. The aggregate itself is kept, because a total and an
    // average are different questions — how big each one is, against how big
    // each one is per record.
    //
    // Stripping the aggregate as well was too much. It collapsed every chart
    // over a dimension and a column into a single slot, so a category's bar,
    // its share, its profile across metrics and its combo against a second
    // measure all blocked one another and a deck of eight viable candidates
    // came out as three.
    const raw = String(c.yAxisKey || '').toLowerCase();
    return raw.replace(/\s+share$/, '').replace(/^share of\s+/, '').trim();
  };
  /**
   * A chart that plots several measures does not spend the slot for one.
   *
   * A radar across three metrics and a combo of two were each keyed on their
   * first axis, so the radar claimed "average revenue by category" and blocked
   * the bar chart of exactly that — a different question drawn a different way.
   * Those carry their own key so they compete with charts of the same span
   * rather than with every single-measure chart over the dimension.
   */
  const MULTI = new Set(['radar', 'composed', 'scatter', 'bubble', 'ribbon', 'matrix']);
  const pairOf = (c) =>
    MULTI.has(c.chart_type)
      ? `${dimOf(c)}|${c.chart_type}|${measureOf(c)}|${String(c.secondaryYAxisKey || '').toLowerCase()}`
      : `${dimOf(c)}|${measureOf(c)}`;

  while (picked.length < max && remaining.length > 0) {
    let bestIdx = -1;
    let bestEff = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const dupeKey = `${c.chart_type}:${c.xAxisKey}:${c.yAxisKey}`;
      if (seen.has(dupeKey)) continue;
      if (usedPairs.has(pairOf(c))) continue;
      // One distribution per deck. Two histograms of two different measures are
      // two charts making the same observation — "most values are small" — and
      // a deck that spends a fifth of itself on the shape of the data has that
      // much less to say about the business in it.
      if (c.signal?.kind === 'distribution' && distributions >= 1) continue;
      // One cross-tab per deck. Every pair of dimensions is offered so the
      // scorer can find the pair that actually interacts, but a grid is a dense
      // chart and a deck of them is a spreadsheet.
      if (c.chart_type === 'matrix' && matrices >= 1) continue;
      let closest = 0;
      for (const p of picked) {
        const other = dimOf(p);
        if (other !== dimOf(c)) closest = Math.max(closest, relatedness(dimOf(c), other));
      }
      // A penalty is the right answer for `city` beside `state`. A column that
      // holds the same values as one already on the board is not related to it,
      // it is it — the same fact arriving from a second sheet.
      if (picked.some((p) => duplicate(dimOf(c), dimOf(p)))) continue;
      const redundancy = closest ** 3 * REDUNDANCY_PENALTY;
      const eff =
        c.score -
        (typeCount[c.chart_type] || 0) * TYPE_PENALTY -
        (dimCount[dimOf(c)] || 0) * DIM_PENALTY -
        redundancy;
      if (eff > bestEff) {
        bestEff = eff;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    const c = remaining.splice(bestIdx, 1)[0];
    seen.add(`${c.chart_type}:${c.xAxisKey}:${c.yAxisKey}`);
    usedPairs.add(pairOf(c));
    typeCount[c.chart_type] = (typeCount[c.chart_type] || 0) + 1;
    dimCount[dimOf(c)] = (dimCount[dimOf(c)] || 0) + 1;
    if (c.signal?.kind === 'distribution') distributions++;
    if (c.chart_type === 'matrix') matrices++;
    picked.push(c);
  }

  // `signal` is the instruction for scoring, not a property of the chart. It has
  // done its work by now, and every spec here is serialised into saved analyses.
  return picked.map(({ signal, ...c }, i) => ({ ...c, id: `slide_${i + 1}` }));
}

/**
 * Deterministic KPI cards derived from the dataset.
 */
export function planKpis(rows, { provenance = {}, roles = {} } = {}) {
  if (!rows || rows.length === 0) return [];
  const p = profileColumns(rows);
  const stats = measureStats(rows, p.measures);
  const { comparable: allComparable, additive: nameAdditive } = classifyMeasures(rows, p, stats);

  // The cards obey the same rule the charts do. Without this the strip happily
  // reported "Average Total Spent 137.3K" — the mean of a customer lifetime
  // total taken over order rows, which is neither the average customer nor the
  // average order, on a report whose charts had already stopped using it.
  const semantics = classifyColumns({
    profile: p,
    provenance,
    roles,
    cardinality: p.cardinality,
    rowCount: rows.length,
  });
  const notSummable = new Set([...semantics.preAggregate, ...semantics.attribute]);
  const additive = nameAdditive.filter((m) => !notSummable.has(m));
  const comparable = allComparable.filter((m) => !notSummable.has(m));

  const kpis = [];

  /**
   * The outcome rate leads, when the dataset has an outcome.
   *
   * The strip used to open with "Records Analyzed", which is how many rows were
   * read — a fact about the file rather than about the business in it. On a
   * churn dataset the first number a reader wants is the churn rate, and it was
   * not on the card strip at all. Row count keeps a place, at the end, where a
   * piece of provenance belongs.
   */
  const outcome = outcomeColumn({
    columns: [...p.dimensions, ...p.measures],
    sample: rows.slice(0, 500),
    cardinality: p.cardinality,
  });
  if (outcome) {
    let hits = 0;
    for (const row of rows) if (String(row?.[outcome.column]) === String(outcome.event)) hits++;
    kpis.push({
      label: outcomeRateName(outcome),
      value: `${((hits / rows.length) * 100).toFixed(1)}%`,
      trend: outcome.highIsGood ? 'up' : 'down',
    });
  }

  // Only "Total X" for genuinely additive columns (never a rank/score).
  if (additive[0]) {
    const m = additive[0];
    // The summed value itself, not mean * n: that reconstruction goes through a
    // float division and back, and a card that says "Total" should be the total.
    kpis.push({ label: aggregateAlias('SUM', m), value: compact(stats[m].sum), trend: 'up' });
  }
  // The average of the most variable comparable measure.
  const avgM = [...comparable].sort((a, b) => (stats[b]?.spread || 0) - (stats[a]?.spread || 0))[0];
  if (avgM) {
    kpis.push({ label: aggregateAlias('AVG', avgM), value: compact(stats[avgM].mean), trend: 'up' });
  }
  // The count of a column's distinct values is not a business number, and it
  // was taking a card in every deck: "Region Segments 4", beside a deck with no
  // chart of regions in it. Kept only when nothing else has filled the strip,
  // where an empty card would be worse.
  // Never for a date. "Order Date Segments: 240" is the number of days the file
  // covers, dressed as a business metric, and it kept a card in a deck whose
  // charts were about categories and revenue. A segment count is only ever
  // interesting for a column somebody actually segments by, and only when it is
  // small enough to be a set of segments rather than a list.
  const segmentDim = p.dimensions.find(
    (d) => !p.temporal.includes(d) && p.cardinality[d] >= 2 && p.cardinality[d] <= 12
  );
  if (kpis.length < 3 && segmentDim) {
    kpis.push({
      label: `${pretty(segmentDim)} Segments`,
      value: compact(p.cardinality[segmentDim]),
      trend: 'up',
    });
  }

  // Provenance, last: how many rows the numbers above were computed from.
  kpis.push({ label: 'Records Analyzed', value: compact(rows.length), trend: 'up' });
  return kpis.slice(0, 4);
}

function compact(val) {
  if (typeof val !== 'number' || !isFinite(val)) return String(val);
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return (val / 1_000).toFixed(1) + 'K';
  return Number.isInteger(val) ? String(val) : val.toFixed(1);
}
