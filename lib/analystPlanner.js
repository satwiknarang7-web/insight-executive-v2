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
import { classifyColumns, deriveMeasures } from './measureSemantics.js';
import { RECORD_COUNT, aggregateAlias, aggregateTitle, prettyColumn } from './aggregateNames.js';
import {
  association,
  bucketCount,
  distributionShape,
  groupAggregate,
  groupMeanPairs,
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
    const yearly = isISODate && tDistinct > 750; // multi-year daily data → bucket by year
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
      score: 78 - i * 10,
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
  const avgCompanion = rankedComparable.find((m) => m !== sumCol) || null;
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
  for (const c of candidates) {
    const read = readSignal(c.signal, rows, sumCol);
    if (read === null) {
      out.push(c);
      continue;
    }
    // Nothing to compare. A single bar is not a chart, whatever it is a chart
    // of, and every statistic below is undefined on one group.
    if (read.degenerate) continue;

    out.push({
      ...c,
      chart_type: refineType(c, read),
      signalScore: round2(read.score),
      score: c.score + (read.score - 0.5) * 2 * SIGNAL_WEIGHT,
    });
  }
  return out;
}

const round2 = (v) => Math.round(v * 100) / 100;

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
    const { xs, ys } = groupMeanPairs(rows, signal.dimension, signal.x, signal.y);
    if (xs.length < 2) return { degenerate: true };
    return { points: xs.length, score: relationshipStrength(xs, ys) };
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
    if (scores.every((v) => v === 0)) return { degenerate: false, score: 0 };
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

function selectDiverse(candidates, max, { relatedness = () => 0 } = {}) {
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
  const dimOf = (c) => c.dimension || c.xAxisKey;
  const pairOf = (c) => `${dimOf(c)}|${c.yAxisKey}`;

  while (picked.length < max && remaining.length > 0) {
    let bestIdx = -1;
    let bestEff = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const dupeKey = `${c.chart_type}:${c.xAxisKey}:${c.yAxisKey}`;
      if (seen.has(dupeKey)) continue;
      if (usedPairs.has(pairOf(c))) continue;
      let closest = 0;
      for (const p of picked) {
        const other = dimOf(p);
        if (other !== dimOf(c)) closest = Math.max(closest, relatedness(dimOf(c), other));
      }
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

  const kpis = [{ label: 'Records Analyzed', value: compact(rows.length), trend: 'up' }];

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
  if (p.dimensions[0]) {
    kpis.push({ label: `${pretty(p.dimensions[0])} Segments`, value: compact(p.cardinality[p.dimensions[0]]), trend: 'up' });
  }
  return kpis.slice(0, 4);
}

function compact(val) {
  if (typeof val !== 'number' || !isFinite(val)) return String(val);
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return (val / 1_000).toFixed(1) + 'K';
  return Number.isInteger(val) ? String(val) : val.toFixed(1);
}
