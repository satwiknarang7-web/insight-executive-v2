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
import { detectRepeatedMeasures } from './dataGrain.js';
import { isAdditiveMeasure } from './insightEngine.js';
import {
  classifyColumns,
  deriveMeasures,
  outcomeColumn,
  outcomeRateExpression,
  outcomeRateName,
} from './measureSemantics.js';
import { RECORD_COUNT, SUPPORT_KEY, aggregateAlias, aggregateTitle, prettyColumn } from './aggregateNames.js';
import { orderByPurpose, purposeAvoids, purposeRanking, purposeScore } from './datasetPurpose.js';
import { byVariation, measureVariation } from './measureVariation.js';
import { comparisonTable } from './rowComparison.js';
import {
  association,
  bucketCount,
  distributionShape,
  groupAggregate,
  groupMeanPairs,
  measureDependence,
  spearman,
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

/**
 * A cell as a number, with blanks refused rather than counted as zero.
 *
 * `Number(null)` is 0 and `Number('')` is 0, and both are finite, so the
 * obvious `Number.isFinite(Number(v))` treats every empty cell as a real zero.
 * On the plans file the eight rows with no quoted price would have joined a
 * scatter at the origin and dragged its correlation with them.
 */
const cellNum = (v) => {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

// Title-case a raw column name for display / SQL aliases.
export const pretty = prettyColumn;

/**
 * A column that records where a row came from, not what it is about.
 *
 * Source links, citations, "as of" stamps. They are good columns — this whole
 * product argues a figure should carry where it came from — and they are not
 * subjects. Nobody uploads a price list to see average seat counts broken down
 * by which URL the price was read off.
 *
 * Nothing downstream could catch this. The planner re-scores every chart on
 * real statistics after running it, and "Average Min Seats by Price Source URL"
 * scores *well*: seat minimums genuinely do vary by vendor, and the URL is a
 * proxy for the vendor. The statistic is sound and the chart is absurd, which
 * is the one combination a statistical test cannot separate.
 *
 * Judged on the values rather than the name, because a column of links is a
 * column of links whatever it is called.
 */
const URL_RE = /^\s*(https?:\/\/|www\.)\S+$/i;

function isProvenance(column, rows) {
  const sample = [];
  for (const r of rows) {
    const v = r?.[column];
    if (typeof v === 'string' && v.trim()) sample.push(v);
    if (sample.length >= 20) break;
  }
  if (sample.length < 3) return false;
  const links = sample.filter((v) => URL_RE.test(v)).length;
  return links / sample.length >= 0.8;
}

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
export function recommendedChartCount(rows, profile = null) {
  if (!rows || rows.length === 0) return 0;
  // Profiling 250,000 rows costs about two and a half seconds, and this used to
  // happen four separate times in one analysis — here, in the other two entry
  // points, and once in the pipeline — for ten seconds of the twenty-two a
  // large file took. The caller profiles once and passes it down.
  const p = profile || profileColumns(rows);
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
export function planCharts(rows, { max = 7, provenance = {}, roles = {}, derived = null, claims = null, profile = null, repeated = null, purpose = null } = {}) {
  if (!rows || rows.length === 0) return [];

  // Profiling 250,000 rows costs about two and a half seconds, and this used to
  // happen four separate times in one analysis — here, in the other two entry
  // points, and once in the pipeline — for ten seconds of the twenty-two a
  // large file took. The caller profiles once and passes it down.
  const p = profile || profileColumns(rows);
  const { measures, temporal, cardinality } = p;
  const rowCount = rows.length;
  if (measures.length === 0 && p.dimensions.length === 0) return [];

  const stats = measureStats(rows, measures);

  /**
   * What the file is for, where a model was able to say.
   *
   * Null on a deployment with no key, on a timeout, or when nothing the model
   * returned survived checking — and null means every line below falls back to
   * the statistics, which is how this planner worked until now.
   */
  const intent = purposeRanking(purpose);


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
  // Provenance covers columns this app joined. A file joined before upload
  // carries the same repetition with no join to point at, so it is measured.
  // Another two and a half seconds on a large file, and the charts and the KPI
  // strip both need the same answer. Computed once by the caller.
  const repeatedAt = repeated || detectRepeatedMeasures(rows, p);
  const semantics = classifyColumns({
    profile: p,
    provenance,
    roles,
    cardinality: p.cardinality,
    rowCount,
    repeatedAt,
    denominatedBy: claims,
  });
  // `denominated` joins them because rows in different currencies cannot be
  // combined by any aggregate — a mean of reais and dollars is as wrong as
  // their sum, so it is excluded from comparisons as well, below.
  const notSummable = new Set([
    ...semantics.preAggregate,
    ...semantics.attribute,
    ...semantics.denominated,
  ]);
  const additive = nameAdditive.filter((m) => !notSummable.has(m));
  // And they are not comparable either. Averaging `customers.Total_Spent` over
  // order rows weights each customer by how often they bought, so the "average
  // customer" it describes is not a customer — it is an average order's owner.
  // Correlating or bucketing it has the same flaw, so the column is left out of
  // distributions and correlations too rather than only out of sums.
  const comparableSafe = comparable.filter((m) => !notSummable.has(m));
  /**
   * Which column to SUM, when the table has one worth adding up.
   *
   * Absolute range, deliberately: for a total, the size of the numbers is the
   * point, and the biggest total is the headline. It is the wrong question for
   * a column being averaged or correlated — see `byInterest` just below, and
   * the context window that became the headline of a report about what
   * subscriptions cost.
   */
  const bySpread = (arr) => [...arr].sort((a, b) => (stats[b]?.spread || 0) - (stats[a]?.spread || 0));
  /**
   * Which measure is worth charting: relative to its own size, and not decided
   * by one row.
   *
   * The comparable measures used to be ordered by `spread` too — the same
   * absolute range, with the same consequence one line up, and without even the
   * division by the mean the card strip had. On the file above it ranked a
   * context window in tokens over every price in the table.
   *
   * `byVariation` orders by the range over the column's own mean, which is
   * scale-free, and puts behind everything else the columns whose middle half
   * is a single number — `Min Seats` on that file is 1 on thirty-two of
   * forty-four rows, 2 on six, and 300 on exactly one, so its range is a fact
   * about Microsoft's enterprise tier rather than about the column. See
   * lib/measureVariation.js.
   *
   * Only the comparable measures are judged this way. For a column being
   * SUMMED, the size of the total is the point, so `bySpread` above is left
   * alone: the largest total really is the headline.
   */
  const variation = measureVariation(rows, p.measures, stats);
  const byInterest = (arr) => orderByPurpose(arr, intent, 'measure', byVariation(variation));

  /**
   * Is every row a different thing, rather than another event?
   *
   * Null for an ordinary table, and null changes nothing below. See
   * lib/rowComparison.js for what it takes to be non-null and why.
   */
  const compare = comparisonTable(rows, p);
  // "Plan Name" names a plan. Keeping the word would put it on an axis twice.
  const rowLabelAlias = compare
    ? pretty(compare.columns[compare.columns.length - 1]).replace(/\s+Name$/i, '') || 'Item'
    : null;
  const rowLabelSql = compare
    ? compare.columns.length === 1
      ? br(compare.columns[0])
      // CONCAT rather than `+`: alasql's `+` returns null for the whole
      // expression when either side is null, which drops the row's label.
      : `CONCAT(${compare.columns.map((c) => br(c)).join(", ' · ', ")})`
    : null;
  const rankedComparable = byInterest(comparableSafe);
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
  /**
   * Is there anything in this table worth adding up?
   *
   * When there is, a magnitude ranking is the headline: "revenue by region" is
   * the chart a reader came for, and COUNT is a reasonable stand-in for it.
   *
   * When there is not — a table of prices, scores and indices, where every
   * measure is a rate and summing is a category error — COUNT(*) is not a
   * stand-in for anything. It stops being a measure of the business and becomes
   * a measure of the file: "Record Count by Provider" says how many plan tiers
   * each vendor sells, which nobody uploaded a price list to find out. It still
   * scored 92 against the 74 of the average-by-category charts, so it took the
   * top of every deck built on a table like that and the columns somebody
   * actually wanted ranked never got drawn.
   *
   * So the two swap places. Nothing about the SQL or the statistics changes —
   * an average by category is already its own signal kind, scored by how much
   * of the measure's variation the category explains, which is the right
   * question for an average and the wrong one for a share. Only which of them
   * leads.
   */
  const countOnly = !sumCol;
  const rankingTitle = (cat) => aggregateTitle(magnitudeKey, [cat]);
  const compositionTitle = (cat) => `${magnitudeKey} Share by ${pretty(cat)}`;

  // Dimensions, richest (most distinct values) first — a category with more levels
  // makes a more informative ranking than a yes/no binary.
  const dims = p.dimensions;
  const byCard = (arr) => [...arr].sort((a, b) => (cardinality[b] || 0) - (cardinality[a] || 0));

  /**
   * The column the trend is drawn from, which is not a category to rank.
   *
   * Every family below orders by the measure and cuts to a top ten, which is
   * the right query for a category and the wrong one for a period. A deck of a
   * declining year came out with the trend on slide one and "Average Revenue by
   * Month" on slide three — the same twelve months, sorted by size, drawn as
   * horizontal bars, so the one thing the axis was carrying was gone. The
   * builder's own `orderClause` already says why: the top ten months by revenue
   * is not a trend, it is ten disconnected months drawn as if they ran on.
   *
   * The time axis has its own chart, and a waterfall of what moved it. It does
   * not also need a ranking of itself.
   */
  const timeCol = temporal[0] || years[0] || null;
  const usable = dims.filter(
    (d) =>
      d !== timeCol &&
      (cardinality[d] || 0) >= 2 &&
      (cardinality[d] || 0) <= 25 &&
      !isProvenance(d, rows) &&
      // Columns the purpose pass called plumbing — source URLs, as-of dates,
      // verification flags. `isProvenance` catches the ones it can recognise
      // from their shape; this catches the ones you have to read the file to
      // know about.
      !purposeAvoids(intent, d)
  );

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
    /**
     * The word list is a fallback now, not the rule.
     *
     * It is a list of English nouns somebody thought of, and it decides nothing
     * on a file it was not written for — which is most files. Where the purpose
     * pass has an opinion it outweighs this by design: see `purposeScore` for
     * why the margin is deliberately larger than this whole scale.
     */
    if (/(category|brand|segment|type|channel|status|tier|group|payment|method|plan|product)/i.test(d)) score += 2;
    if (semantics.byColumn[d]?.kind === 'identifier') score -= 5;
    return score + purposeScore(intent, d, 'dimension');
  };
  const rankDims = [...usable].sort(
    (a, b) => dimScore(b) - dimScore(a) || (cardinality[b] || 0) - (cardinality[a] || 0)
  );
  const smallDims = byCard(usable.filter((d) => cardinality[d] <= 8));
  /**
   * Categories whose composition is worth tracking over time.
   *
   * Small enough that one level's share is a story rather than a sliver, and
   * never the time column itself — "the share of rows that are 1994, by year"
   * is a tautology with a chart around it.
   */
  const mixDims = byCard(
    usable.filter((d) => d !== timeCol && (cardinality[d] || 0) >= 2 && (cardinality[d] || 0) <= 6)
  ).slice(0, 2);
  const midCard = dims.filter((d) => d !== timeCol && cardinality[d] > 8 && cardinality[d] <= 25);
  const highCard = dims.filter((d) => cardinality[d] > 25);
  const contMeasures = rankedComparable.filter((m) => (cardinality[m] || 0) > 12);

  const candidates = [];
  const add = (c) => candidates.push({ secondaryYAxisKey: null, ...c });

  // 1. TIME TREND over a temporal/year column (magnitude metric).
  // ISO date columns are BUCKETED (by month, or year for long spans) so the trend
  // is chronological and has a readable number of points — otherwise 1000 distinct
  // timestamps would trip the self-heal fallback and scramble the order.
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

  /**
   * 1b. MIX SHIFT — how a category's composition changed over time.
   *
   * Every candidate above this asks about one column. A dataset's best finding
   * is often in neither column alone but in the two crossed: an athlete export
   * charted "Record Count by Sex" as a static 66/34 split and "Record Count
   * Over Year" as a flat line, and had no way to say that the female share went
   * from 19.7% in 1960 to 45.5% in 2016 — which is the most reported fact about
   * that dataset and was sitting in the two columns it had already drawn.
   *
   * Charted as one level's share of each period rather than a stack of counts,
   * because a share is the thing that moved: the raw counts rise for every
   * level at once whenever the dataset simply gets bigger, which is a fact
   * about sampling and not about the mix. It also means the series is an
   * ordinary time series of a percentage, so the trend analyzer reads it
   * without learning anything new.
   *
   * The level charted is whichever one moved most, found from the rows rather
   * than assumed — for a two-level column that is the whole story, and for a
   * longer one it is the part of the story worth a slide.
   */
  if (timeCol && mixDims.length) {
    const tSample = String(rows[0]?.[timeCol] ?? '');
    const isISODate = /^\d{4}-\d{2}-\d{2}/.test(tSample);
    const yearly = isISODate && monthsCovered(rows, timeCol) >= 96;
    const prefix = isISODate ? (yearly ? 4 : 7) : 0;
    const xAlias = isISODate ? (yearly ? 'Year' : 'Month') : timeCol;
    const xExpr = isISODate ? `SUBSTRING(${br(timeCol)}, 1, ${prefix})` : br(timeCol);

    for (const [i, cat] of mixDims.entries()) {
      const moved = biggestMover(signalRows, timeCol, cat, prefix);
      if (!moved) continue;
      const alias = `${moved.level} Share of Records`;
      add({
        title: `${pretty(cat)} Mix Over ${pretty(xAlias)}`,
        chart_type: 'line',
        dimension: timeCol,
        sql:
          `SELECT ${xExpr} AS ${br(xAlias)}, ` +
          `SUM(CASE WHEN ${br(cat)} = ${sqlLiteral(moved.raw)} THEN 1 ELSE 0 END) * 100.0 / COUNT(*) ` +
          `AS ${br(alias)} FROM ${TABLE} GROUP BY ${xExpr} ORDER BY ${br(xAlias)} ASC`,
        xAxisKey: xAlias,
        yAxisKey: alias,
        // The series runs over time, so the finding's dimension is the
        // calendar. What is actually changing is this column's composition, and
        // the write-up needs to know which.
        mixOf: cat,
        signal: { kind: 'mixShift', column: timeCol, prefix, dimension: cat, level: moved.level },
        score: 92 - i * 4,
      });
    }
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
      score: (countOnly ? 60 : 92) - i * 8,
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
        score: (countOnly ? 54 : 84) - i * 12,
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
    // Two of these beside a magnitude ranking; four when they ARE the deck,
    // because a table with nothing to add up has nothing else to lead with.
    rankDims.slice(0, countOnly ? 4 : 2).forEach((cat, i) => {
      // Widest-spread measure first, then the next: on a table of a dozen
      // scores, charting the same one four times says less than charting four.
      const measure =
        rankedComparable[Math.min(i, rankedComparable.length - 1)] ||
        ((i === 1 && secondary) ? secondary : primary);
      const avgKey = aggregateAlias('AVG', measure);
      add({
        title: aggregateTitle(avgKey, [cat]),
        chart_type: 'bar',
        dimension: cat,
        /**
         * `COUNT(measure)` rides along so the finding knows what each bar
         * rests on.
         *
         * An average by category says nothing about how many values went into
         * each one, and the evidence tier was reading the *mean* group size —
         * so a chart where one bar was a single row and another was thirty-one
         * scored as though every bar had fifteen. "Average Min Seats by
         * Audience" shipped as STRONG EVIDENCE with its leading bar, 300,
         * resting on exactly one row.
         *
         * `COUNT(col)` rather than `COUNT(*)` deliberately: SQL's AVG skips
         * nulls, so the number of rows in the group is not the number of values
         * the average was taken over, and on this file those differ by most of
         * the group. The column is lifted out of the results in
         * `executeCharts` — see `SUPPORT_KEY` — so nothing draws or analyses it
         * as a second measure.
         */
        sql: `SELECT ${br(cat)}, AVG(${br(measure)}) AS ${br(avgKey)}, COUNT(${br(measure)}) AS ${br(SUPPORT_KEY)} FROM ${TABLE} GROUP BY ${br(cat)} ORDER BY ${br(avgKey)} DESC LIMIT 12`,
        supportKey: SUPPORT_KEY,
        xAxisKey: cat,
        yAxisKey: avgKey,
        signal: { kind: 'variance', dimension: cat, measure, shown: 12 },
        score: (countOnly ? 94 : 74) - i * 8,
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
      /**
       * Identifiers included, because a per-order measure is defined BY one.
       *
       * This was `[...measures, ...dims]`, and an identifier is in neither. So
       * `Order_ID` never reached `deriveMeasures`, and every measure that
       * counts orders — average order value, units per order — could not be
       * written at all. Not scored low: never proposed.
       *
       * That is why four consecutive reports on a retail export missed the
       * clearest finding in it, a basket size of about 29K for buyers under 45
       * and about 8K for buyers over 45. The chart that shows it is
       * "Average Order Value by Customer Age Group", and the column that makes
       * the word "order" mean anything was filtered out before the measure
       * could be written.
       */
      columns: [...measures, ...dims, ...(p.keys || [])],
      sample: rows.slice(0, 500),
      repeatedAt,
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

    /**
     * A column that already determines the outcome is not a breakdown of it.
     *
     * Refusing `outcome.column` by name is only half the problem: a table that
     * encodes the same fact twice — a `churn_status` of 1/0 beside the flag the
     * rate is computed from — gets one charted against the other, and the
     * result is a bar at 100% next to a bar at 0%. Every number in it is right
     * and the chart is a definition restated as evidence: customers who
     * churned churned. It arrives tagged STRONG EVIDENCE, because the
     * separation between the groups really is total, which is exactly how a
     * tautology scores.
     *
     * Cramer's V is the test rather than a name comparison, for the reason the
     * rest of the planner avoids lexicons: the duplicate column can be called
     * anything, in any language, and 1.0 means one column determines the other
     * whatever either is called.
     *
     * The threshold sits at the very top of the range deliberately. A
     * dimension that merely predicts the outcome well is the most interesting
     * chart in the deck; only one that *fixes* it is worthless.
     */
    const restatesOutcome = (d) => association(signalRows, d, outcome.column) >= 0.99;

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
      if (!st || !Number.isFinite(st.spread) || st.spread <= 0) return false;
      // A numeric 0/1 flag has a spread of 1, so it reaches this filter and
      // bands into the same tautology the categorical path produces.
      return !restatesOutcome(m);
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

    /**
     * Which breakdowns of the rate to offer.
     *
     * `rankDims` ranks a dimension by how legibly a bar chart of it reads, and
     * `usable` drops anything past 25 levels — both right for a plain ranking,
     * and both wrong here. What makes a dimension worth charting against an
     * outcome is how much the rate MOVES across it, which is measured from the
     * rows a moment later by `outcomeSpread`. Pre-filtering to the three most
     * legible columns threw the answer away before the measurement: on an
     * athlete export, medal rate runs from 37.6% to 5.0% across Sport, and
     * Sport has 51 levels, so it never reached the scorer at all.
     *
     * So the pool is widened and the evidence decides, which is what the rest
     * of the planner already does. The query orders by rate and takes ten, so a
     * long dimension arrives as a top-ten chart rather than an unreadable one.
     *
     * Binary columns join it. A 0/1 flag is not a magnitude — the planner is
     * right to refuse to sum it — but it is a perfectly good two-level
     * category, and it is usually there precisely because someone thought it
     * might explain the outcome. `Representing_Host` is that column, and the
     * host advantage it encodes (21.7% against 13.0%) was unreachable while
     * flags were dropped from every list.
     */
    const flagDims = measures.filter(
      (m) => m !== outcome.column && numericRole(stats[m], cardinality[m] || 0, rowCount) === 'binary'
    );
    /**
     * A number is not a category.
     *
     * A column that is numeric but not quite clean enough to profile as a
     * measure still lands in `dims`, and grouping a rate by it produces one
     * thin group per distinct value. `Avg_Temp` did exactly that — "Medal Rate
     * by Avg Temp", ten arbitrary temperatures ordered by a rate — which is not
     * a finding but a hundred and forty-eight chances for one to look like one.
     * A continuous column belongs in the banded chart above, not this one.
     */
    const continuousDim = (d) => {
      if ((cardinality[d] || 0) <= 12) return false;
      let numeric = 0;
      let seen = 0;
      for (const r of signalRows) {
        const v = r[d];
        if (v === null || v === undefined || v === '') continue;
        seen++;
        if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v)))) {
          numeric++;
        }
        if (seen >= 200) break;
      }
      return seen > 0 && numeric / seen >= 0.9;
    };
    const wideDims = dims.filter(
      (d) =>
        d !== timeCol &&
        (cardinality[d] || 0) > 25 &&
        (cardinality[d] || 0) <= 200 &&
        !continuousDim(d)
    );
    /**
     * A rate needs a denominator worth quoting. Ordering by rate puts the
     * smallest groups on top — one sport with three athletes and two medals
     * outranks every real one — so groups thinner than this are not charted.
     * Proportional, with a floor, because "too thin to quote" scales with the
     * table.
     */
    const rateFloor = Math.max(5, Math.round(rowCount * 0.001));
    [...rankDims, ...wideDims, ...flagDims]
      .filter((d, i, all) => d !== outcome.column && all.indexOf(d) === i)
      .filter((d) => !restatesOutcome(d))
      .slice(0, 8)
      .forEach((cat, i) => {
        add({
          title: `${rateName} by ${pretty(cat)}`,
          chart_type: 'bar',
          dimension: cat,
          sql:
            `SELECT ${br(cat)}, ${rateExpr} AS ${br(rateName)} FROM ${TABLE} ` +
            `GROUP BY ${br(cat)} HAVING COUNT(*) >= ${rateFloor} ` +
            `ORDER BY ${br(rateName)} DESC LIMIT 10`,
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

  /**
   * Each derived measure against the dimensions worth splitting it by.
   *
   * It used to take one dimension per measure, `rankDims[i % length]` — the
   * measure and the breakdown paired by their positions in two unrelated lists.
   * A measure that varies enormously across one column and not at all across
   * another was then charted against whichever it happened to draw, so its
   * score said more about the pairing than about the data.
   *
   * The base scores carried the same fault at one remove: 90, 86, 82 in the
   * order `deriveMeasures` builds them. On a 250,000-row order export that put
   * a 0.58% shipping-cost rate on a slide and left a 10% returned-or-cancelled
   * rate out of the deck entirely, because "shipping" is checked before
   * "status" inside that function. The prior is now a tie-break rather than a
   * ranking, and the evidence decides.
   */
  /**
   * Propose widely and let the evidence choose.
   *
   * This was the first three measures against the first three dimensions —
   * nine combinations, fixed before a single number was read. Everything after
   * it exists to rank candidates on what they actually show, and none of that
   * can reach a chart this grid never emitted.
   *
   * Both limits were paying for a cost that has since been removed: scoring
   * runs on a 25,000-row sample, and the profile is computed once for the whole
   * analysis rather than per entry point. Six by four is twenty-four
   * candidates, scored the same way, chosen the same way.
   */
  autoMeasures.slice(0, 6).forEach((m, i) => {
    rankDims.slice(0, 4).forEach((cat, j) => {
    if (!cat) return;
    // A measure cannot explain itself. "Returned Or Cancelled Rate by Order
    // Status" is 100% on the two levels it counts and 0% on the rest — a
    // perfect spread, a top score, and a tautology with a chart around it. The
    // same holds for a ratio split by its own numerator or denominator.
    const from = m.parts;
    if (from && (from.column === cat || from.numerator === cat || from.denominator === cat)) return;
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
      // Measured against the rows when the measure can say what it is made of.
      // Without this these candidates carried a fixed score and were ranked by
      // the order `deriveMeasures` happens to build them in: on a 250,000-row
      // order export that put a 0.58% shipping-cost rate on a slide and left a
      // 10% returned-or-cancelled rate — the most consequential number in the
      // file — out of the deck, because "shipping" is checked before "status".
      signal: m.parts ? { kind: 'derived', dimension: cat, parts: m.parts } : undefined,
      score: 88 - i - j,
    });
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

  /**
   * 11. CORRELATION (scatter) — only when a dimension yields enough points, and
   * only when those points are all of them.
   *
   * `highCard[0]` took the widest column in the table. On an athlete export that
   * was `Name`: 100,164 distinct values grouped into averages of about two rows
   * each, then cut to `LIMIT 60` with no ORDER BY. The reported r = 0.56 was
   * therefore measured across sixty athletes chosen by whatever order the engine
   * returned them in — not a sample of the data, an accident of row order, and
   * nothing in the write-up could have told the reader that.
   *
   * So the grouping column has to clear both ends. Enough rows behind each point
   * for an average to mean something, and few enough groups that the limit is
   * not silently discarding most of them: at or under the limit, every group is
   * on the chart and there is nothing to truncate. An identifier is refused
   * outright — a column with one value per row has no groups to average.
   */
  const CORR_MAX_GROUPS = 60;
  const corrEligible = (d) =>
    semantics.byColumn[d]?.kind !== 'identifier' && (cardinality[d] || 0) <= CORR_MAX_GROUPS;
  const corrDim =
    midCard.find((d) => cardinality[d] >= 15 && corrEligible(d)) ||
    highCard.find((d) => corrEligible(d)) ||
    null;
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
   * 11b. THE ROWS THEMSELVES — when each row is a different thing to choose
   * between rather than another event to add up.
   *
   * Everything above this point groups. On a table of forty-four AI
   * subscription plans that produced "Average Monthly Price USD by Product":
   * ChatGPT's Free, Go, Plus, Pro, two Business seats and Enterprise averaged
   * into a single bar. There is no such plan. A reader deciding what to buy was
   * handed ten numbers, none of which describes anything they could buy.
   *
   * `comparisonTable` is what decides, and it decides from the data: a label
   * that is distinct on every row, few enough rows that they are the subject,
   * and no series running through time. A column that is unique per row cannot
   * be grouped — grouping by it hands the rows back — so a table that has one
   * is a list of things, and the things go on the chart.
   *
   * These are added beside the aggregates rather than instead of them, and they
   * are scored like everything else. On a table of events there is no label, so
   * none of this exists; on a table like the one above they win because they
   * are the charts with the spread in them.
   */
  if (compare) {
    /**
     * Ranked, one bar per row, on the measures a reader came for.
     *
     * `hbar` because the labels are names — "OpenAI · Plus", "Anthropic · Max
     * 20x" — and names do not fit under a vertical axis. Twelve because that is
     * what every other ranking here shows.
     */
    rankedComparable.slice(0, 3).forEach((measure, i) => {
      add({
        title: `${pretty(measure)} by ${rowLabelAlias}`,
        chart_type: 'hbar',
        // Its own dimension name so the deduplicator does not read this as the
        // aggregate over the same measure: they are different charts of it.
        dimension: `${compare.columns.join(' + ')} (rows)`,
        sql:
          `SELECT ${rowLabelSql} AS ${br(rowLabelAlias)}, ${br(measure)} FROM ${TABLE} ` +
          `WHERE ${br(measure)} IS NOT NULL ORDER BY ${br(measure)} DESC LIMIT 12`,
        xAxisKey: rowLabelAlias,
        yAxisKey: measure,
        // Raw rows by design: see `rowLevel` in lib/pipeline.js.
        rowLevel: true,
        signal: { kind: 'rowRank', measure, shown: 12 },
        // Above the aggregate rankings, which on this shape of table are
        // averaging things nobody can buy.
        score: 96 - i * 6,
      });
    });

    /**
     * And the trade-off, one point per row.
     *
     * The chart a comparison is for: what each thing costs against what it is
     * worth, with every candidate on it and nothing averaged away. The scatter
     * above this one plots group means, which on a table of distinct rows is
     * the same points with the labels lost — but it only runs when a single
     * column has enough levels, and here the label is two columns.
     */
    /**
     * Two measures that are not the same measure twice.
     *
     * `primary` and `secondary` are the two most varied comparable columns, and
     * on this file they are `USD per Intelligence Point` and `Monthly Price
     * USD` — one of which is the other divided by a benchmark score. Plotting
     * them against each other draws the division, not the trade-off, and
     * `measureDependence` refuses it, correctly, so the chart never appeared.
     *
     * So the pair is searched for rather than assumed: the highest-ranked two
     * columns that are not arithmetic restatements of one another. Limited to
     * the leading few because this reads the rows, and a pair nobody ranked is
     * not the trade-off anybody came for.
     */
    const SCATTER_SEARCH = 5;
    /**
     * And a pair that is not the same column twice in different units.
     *
     * `measureDependence` catches a product and a scaling — `USD per
     * Intelligence Point` against `Monthly Price USD`, which is the first pair
     * here and is one divided by a benchmark score. It does not catch a
     * reciprocal: `USD per Intelligence Point` against `Intelligence per 100
     * USD` is literally 100/x against x, and their ratio is not steady so
     * nothing above notices. Rank correlation does: a monotone transform of a
     * column has |rho| of 1 against it, and the pair above measures -0.999.
     *
     * Not quite 1, because real data rounds.
     */
    const COLLINEAR_RHO = 0.98;
    const allColumns = Object.keys(rows[0] || {});
    const pairedValues = (a, b) => {
      const xs = [];
      const ys = [];
      for (const row of rows) {
        const x = cellNum(row?.[a]);
        const y = cellNum(row?.[b]);
        if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
      }
      return { xs, ys };
    };

    let sx = null;
    let sy = null;
    const shortlist = rankedComparable.slice(0, SCATTER_SEARCH);
    for (let i = 0; i < shortlist.length && !sx; i++) {
      for (let j = i + 1; j < shortlist.length; j++) {
        const [a, b] = [shortlist[i], shortlist[j]];
        if (measureDependence(rows, a, b, allColumns).dependent) continue;
        const { xs, ys } = pairedValues(a, b);
        if (xs.length < 4) continue;
        if (Math.abs(spearman(xs, ys)) >= COLLINEAR_RHO) continue;
        sx = a;
        sy = b;
        break;
      }
    }
    if (sx && sy) {
      add({
        title: `${pretty(sx)} vs ${pretty(sy)} by ${rowLabelAlias}`,
        chart_type: 'scatter',
        dimension: `${compare.columns.join(' + ')} (scatter)`,
        sql:
          `SELECT ${rowLabelSql} AS ${br(rowLabelAlias)}, ${br(sx)}, ${br(sy)} FROM ${TABLE} ` +
          `WHERE ${br(sx)} IS NOT NULL AND ${br(sy)} IS NOT NULL LIMIT 200`,
        xAxisKey: sx,
        yAxisKey: sy,
        rowLevel: true,
        signal: { kind: 'rowCorrelation', x: sx, y: sy },
        score: 90,
      });
    }
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
      /**
       * Scored on what a waterfall is for, which is not what a trend is for.
       *
       * Declaring `trend` here did two things wrong. It scored the chart on how
       * much of the series is direction — the question the line beside it
       * already answers — and it collected the "time always earns one slide"
       * exemption, which waives the floor. That exemption exists so a flat year
       * still gets its one chart of the time axis; it was never meant to seat a
       * second chart of the same series. On a 250,000-row order export both
       * came out at 0.07 and both shipped, printing identical prose on two
       * consecutive pages.
       *
       * A waterfall earns its place when the movement is concentrated — when a
       * few periods did the work and naming them tells the reader something the
       * line cannot. Spread evenly across two years, there is nothing to
       * decompose, and now it faces the floor like any other chart.
       */
      signal: { kind: 'contribution', column: timeCol, prefix: iso ? 7 : 0 },
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

  /**
   * A ranking of rows is worth a slide when its bars differ.
   *
   * The same question every other ranking is scored on, asked without a GROUP
   * BY: take the values this chart would draw and see whether they are all the
   * same height. Twelve plans priced within a few rupees of each other is a
   * table, not a chart.
   */
  if (signal.kind === 'rowRank') {
    const values = rows
      .map((r) => cellNum(r?.[signal.measure]))
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => b - a);
    if (values.length < 2) return { degenerate: true };
    const shown = Math.min(signal.shown || values.length, values.length);
    return { shown, score: mixUnevenness(values.slice(0, shown)) * legibility(shown) };
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

  if (signal.kind === 'mixShift') {
    const periods = sharesByPeriod(rows, signal.column, signal.dimension, signal.prefix).filter(
      ([, bucket]) => bucket.n >= MIN_MIX_PERIOD_ROWS
    );
    if (periods.length < MIN_MIX_PERIODS) return { degenerate: true };
    const series = periods.map(([label, bucket]) => ({
      label,
      value: ((bucket.levels.get(signal.level)?.count || 0) / bucket.n) * 100,
    }));
    // Scored the way every other time series is: how much of the movement the
    // fitted line actually explains, scaled by how far it travelled. A share
    // that wanders and ends where it started scores nothing, which is correct.
    return { series, score: trendStrength(series.map((pt) => pt.value)) };
  }

  if (signal.kind === 'derived') {
    const groups = derivedGroups(rows, signal.dimension, signal.parts);
    if (groups.length < 2) return { degenerate: true };
    // Not enough rows behind any group to tell is not the same as measured and
    // found flat. `outcomeSpread` discounts groups under a dozen rows and
    // returns zero when none survive, which on a small table would drop every
    // derived measure rather than report that the question could not be asked.
    // The prior stands where there is no evidence either way.
    if (!groups.some((g) => g.n >= 12)) return { groups, score: 0.5 };
    // Scored on how far the rate moves between groups, discounted for thin
    // ones — the same measure the outcome charts are ranked by, because it is
    // the same question: does this number differ by where you look?
    return { groups, score: outcomeSpread(groups) * legibility(groups.length) };
  }

  if (signal.kind === 'contribution') {
    const series = timeSeries(rows, signal, sumCol);
    if (series.length < 3) return { degenerate: true };
    const levels = series.map((pt) => pt.value);
    const moves = [];
    for (let i = 1; i < levels.length; i++) moves.push(Math.abs(levels[i] - levels[i - 1]));
    const level = levels.reduce((a, b) => a + Math.abs(b), 0) / levels.length;
    if (!level || !moves.length) return { degenerate: true };
    const gross = moves.reduce((a, b) => a + b, 0);
    // Two things have to hold. The series has to have travelled far enough for
    // the movement to be worth decomposing at all, and that movement has to sit
    // in a few periods rather than being spread evenly across every one of
    // them — which is the difference between "March took it down" and "it
    // drifted".
    const travelled = unitScore(gross / level / 0.5);
    return { series, score: mixUnevenness(moves) * travelled };
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

  /**
   * The same question asked of the rows, for a scatter that plots them.
   *
   * `correlation` above measures the relationship between two GROUP MEANS,
   * because the chart it scores plots group means. A comparison table's scatter
   * plots one point per row, so scoring it on means would rate a chart nobody
   * is looking at — and on a table whose label is two columns there are no
   * groups to take means of in the first place.
   */
  if (signal.kind === 'rowCorrelation') {
    const columns = Object.keys(rows[0] || {});
    // The same refusal: a total against one of its own factors is arithmetic.
    const dep = measureDependence(rows, signal.x, signal.y, columns);
    if (dep.dependent) return { degenerate: true, dependence: dep };

    const xs = [];
    const ys = [];
    for (const row of rows) {
      const x = cellNum(row?.[signal.x]);
      const y = cellNum(row?.[signal.y]);
      if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
    }
    if (xs.length < 4) return { degenerate: true };
    return { points: xs.length, score: relationshipStrength(xs, ys) };
  }

  if (signal.kind === 'interaction') {
    // Worth a grid when the pair says more than either column alone. Measured
    // as how much of the measure's variance the combination explains against
    // the better of the two on its own — a grid whose rows all look the same is
    // two bar charts stacked sideways.
    const pairKey = (r) => `${r[signal.a]}\u0000${r[signal.b]}`;
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
 * A SQL literal of the right type for a value taken from the rows.
 *
 * The same trap as the outcome rate expression: a level parsed from CSV can be
 * the NUMBER 1, and `[flag] = '1'` matches nothing — every group comes back
 * zero, the chart draws an empty line, and nothing raises an error.
 */
function sqlLiteral(value) {
  if (typeof value === 'number' && isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value).toUpperCase();
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * A derived rate per group of `dimension`, from the columns it is made of.
 *
 * Shaped as `outcomeSpread` wants it — a rate and the rows behind it — so a
 * derived measure is ranked by the same test as an outcome: how much it differs
 * across the field, with thin groups discounted rather than allowed to top it.
 */
function derivedGroups(rows, dimension, parts) {
  const acc = new Map();
  for (const row of rows) {
    const key = row?.[dimension];
    if (key === null || key === undefined || key === '') continue;
    const label = String(key);
    let g = acc.get(label);
    if (!g) {
      g = { label, n: 0, hit: 0, numerator: 0, denominator: 0 };
      acc.set(label, g);
    }
    g.n++;
    if (parts.kind === 'levelShare') {
      if (parts.levels.includes(String(row?.[parts.column]))) g.hit++;
    } else if (parts.kind === 'ratio') {
      const num = Number(row?.[parts.numerator]);
      const den = Number(row?.[parts.denominator]);
      if (isFinite(num)) g.numerator += num;
      if (isFinite(den)) g.denominator += den;
    }
  }
  const out = [];
  for (const g of acc.values()) {
    // A FRACTION, not a percentage. `outcomeSpread` tests the spread against
    // what sampling would produce, and its standard error is
    // sqrt(base * (1 - base) / n) — which is only a standard error while base
    // is a proportion. Handing it percentages makes (1 - base) negative, the
    // square root NaN, and the significance guard silently inert: a shipping
    // cost rate of 0.105% against 0.001% then scored a perfect 1.0 and led the
    // deck on a spread of one tenth of a percentage point.
    const rate =
      parts.kind === 'levelShare'
        ? g.hit / g.n
        : g.denominator
          ? g.numerator / g.denominator
          : null;
    if (rate === null || !isFinite(rate) || rate < 0 || rate > 1) continue;
    // `value` as well as `rate`, because everything downstream of the scorer —
    // the type refinement, the legibility test — reads a group's value, and
    // `outcomeGroups` carries both for exactly that reason.
    out.push({ label: g.label, n: g.n, rate, value: rate });
  }
  return out;
}

/** One period's share of rows belonging to each level of `dimension`. */
function sharesByPeriod(rows, timeColumn, dimension, prefix) {
  const periods = new Map();
  for (const row of rows) {
    const raw = row?.[timeColumn];
    if (raw === null || raw === undefined || raw === '') continue;
    const label = prefix ? String(raw).slice(0, prefix) : String(raw);
    let bucket = periods.get(label);
    if (!bucket) {
      bucket = { n: 0, levels: new Map() };
      periods.set(label, bucket);
    }
    bucket.n++;
    const level = row?.[dimension];
    if (level === null || level === undefined || level === '') continue;
    const key = String(level);
    const seen = bucket.levels.get(key) || { count: 0, raw: level };
    seen.count++;
    bucket.levels.set(key, seen);
  }
  return [...periods.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** Periods thinner than this are noise, not a point on a mix chart. */
const MIN_MIX_PERIOD_ROWS = 12;
/** Below this many points there is no shift to describe, only two numbers. */
const MIN_MIX_PERIODS = 4;
/** Percentage points a level's share must travel before it is worth a slide. */
const MIN_MIX_TRAVEL = 8;
/** Two levels this close to each other's magnitude are the same finding. */
const TIE_EPSILON = 0.5;

/**
 * The level of `dimension` whose share moved most across the period range.
 *
 * Measured first-to-last rather than max-to-min: a level that dips and recovers
 * has not shifted the mix, and reporting its widest excursion as a change would
 * make noise look like a trend on every dataset with enough periods.
 */
function biggestMover(rows, timeColumn, dimension, prefix) {
  const periods = sharesByPeriod(rows, timeColumn, dimension, prefix).filter(
    ([, bucket]) => bucket.n >= MIN_MIX_PERIOD_ROWS
  );
  if (periods.length < MIN_MIX_PERIODS) return null;

  const shareIn = (bucket, key) => ((bucket.levels.get(key)?.count || 0) / bucket.n) * 100;
  const [, first] = periods[0];
  const [, last] = periods[periods.length - 1];
  const keys = new Set([...first.levels.keys(), ...last.levels.keys()]);

  let best = null;
  for (const key of keys) {
    const travel = shareIn(last, key) - shareIn(first, key);
    const candidate = {
      level: key,
      travel,
      raw: last.levels.get(key)?.raw ?? first.levels.get(key)?.raw ?? key,
    };
    if (!best) {
      best = candidate;
      continue;
    }
    const gap = Math.abs(travel) - Math.abs(best.travel);
    // A tie is not a coincidence: on a two-level column one share is the other
    // subtracted from a hundred, so both levels always move by exactly the same
    // amount in opposite directions, and which one wins is otherwise decided by
    // iteration order. The rising level is the better chart of the two. "The
    // female share rose from 19.7% to 45.5%" is the sentence that dataset is
    // known for; "the male share fell from 80.3% to 54.5%" is the same
    // arithmetic told backwards, and reads as a decline in something.
    if (gap > TIE_EPSILON || (Math.abs(gap) <= TIE_EPSILON && travel > best.travel)) {
      best = candidate;
    }
  }
  return best && Math.abs(best.travel) >= MIN_MIX_TRAVEL ? best : null;
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
    const shown = read.shown ?? read.groups.length;
    const labels = read.groups.slice(0, shown).map((g) => g.label);

    /**
     * A ranking of a real total, over many segments, is a treemap.
     *
     * Fifteen bars is a list the eye reads one at a time; the same fifteen as
     * nested area is a shape read at once, and the comparison a reader actually
     * wants — how much of the whole each one is — is the thing a treemap shows
     * and a bar chart makes them work out. Only for an additive measure whose
     * visible segments really are most of the whole: a treemap of averages, or
     * of the top ten of two hundred, asserts a total that does not exist.
     */
    if (
      shown >= 8 &&
      isAdditiveMeasure(candidate.yAxisKey) &&
      suitsPartToWhole(read.groups, shown, { maxSlices: 40, minCoverage: 0.85 })
    ) {
      return 'treemap';
    }

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
    const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
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

/**
 * What a third chart of the same column costs.
 *
 * A deck with churn rate by contract type, average tenure by contract type and
 * total charge by contract type is three answers to one question and none to
 * the others, and it is how a board of seven came to look like a board of two.
 * The penalty compounds — the second chart of a column pays it once and the
 * third twice — so a strong finding can still take a second slide where the
 * column really is the story, and a fourth effectively cannot.
 */
const DIM_PENALTY = 34;
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

/** Never stop this early, however repetitive what is left. */
const MIN_DECK = 3;


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
  /**
   * What column a chart counts against the two-per-dimension allowance.
   *
   * A chart that spans two dimensions is not another chart of the first one. A
   * cross-tab over category and region answers "which combination", which
   * neither a chart of category nor a chart of region can, and keying it on its
   * row dimension made it compete with them and lose — the one chart in the
   * deck that says something new was the first to be cut as a repeat.
   */
  const MULTI_DIM = new Set(['matrix', 'ribbon']);
  const dimOf = (c) =>
    MULTI_DIM.has(c.chart_type) && c.secondaryYAxisKey
      ? `${c.dimension || c.xAxisKey}×${c.secondaryYAxisKey}`
      : c.dimension || c.xAxisKey;
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
  /**
   * How much of a column, against how much per record: two questions.
   *
   * `measureOf` already draws this line — "a total and an average are different
   * questions" — but the two-charts-per-column allowance did not, so a per-unit
   * measure competed for the same slot as a total of the same column and lost
   * to whatever got there first.
   *
   * On a retail export that cost the best finding in the file. Total Amount by
   * Customer Age Group says 26-35 is the biggest group, which is a fact about
   * how many of them there are. Average Order Value by Customer Age Group says
   * buyers under 45 spend about 29K an order and buyers over 45 about 8K — a
   * different question, a different answer, and a cliff rather than a ranking.
   * Two charts of that column already existed, so the third was penalised out
   * and then ended the deck.
   *
   * A measure built from a numerator over a denominator is asking the per-record
   * question by construction, so it carries its own allowance on the column.
   */
  const perUnit = (c) => {
    // Read off the expression rather than the `parts` metadata, which only
    // exists for ratios of two summable columns. Average Order Value is
    // SUM(Total_Amount) / COUNT(DISTINCT Order_ID) and carries no parts at all,
    // and it is the measure this whole distinction was drawn for.
    //
    // A derived measure that divides is asking a per-record question; one that
    // does not — a count, a total — is asking how much there is.
    const expr = String(c.measure?.expr || '');
    return expr.includes('/');
  };
  const questionOf = (c) => (perUnit(c) ? `${dimOf(c)}|per-record` : dimOf(c));

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
        (dimCount[questionOf(c)] || 0) ** 1.6 * DIM_PENALTY -
        redundancy;
      if (eff > bestEff) {
        bestEff = eff;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    /**
     * Never a third chart of one column.
     *
     * `max` is a ceiling rather than a quota, but the loop filled to it anyway:
     * once every other dimension was used, the least-bad candidate left was
     * another chart of a column already answered twice, and it went on the
     * board because nothing better remained. Churn rate by contract type,
     * average tenure by contract type and total charge by contract type is
     * three answers to one question and none to the others.
     *
     * Two is the allowance — a column that really is the story deserves a
     * second look at it — and the deck ends rather than reaching for a third.
     */
    const dimUses = dimCount[questionOf(remaining[bestIdx])] || 0;
    if (picked.length >= MIN_DECK && dimUses >= 2) break;
    const c = remaining.splice(bestIdx, 1)[0];
    seen.add(`${c.chart_type}:${c.xAxisKey}:${c.yAxisKey}`);
    usedPairs.add(pairOf(c));
    typeCount[c.chart_type] = (typeCount[c.chart_type] || 0) + 1;
    dimCount[questionOf(c)] = (dimCount[questionOf(c)] || 0) + 1;
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
export function planKpis(rows, { provenance = {}, roles = {}, claims = null, profile = null, repeated = null, purpose = null } = {}) {
  if (!rows || rows.length === 0) return [];
  // Profiling 250,000 rows costs about two and a half seconds, and this used to
  // happen four separate times in one analysis — here, in the other two entry
  // points, and once in the pipeline — for ten seconds of the twenty-two a
  // large file took. The caller profiles once and passes it down.
  const p = profile || profileColumns(rows);
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
    repeatedAt: repeated || detectRepeatedMeasures(rows, p),
    denominatedBy: claims,
  });
  const notSummable = new Set([
    ...semantics.preAggregate,
    ...semantics.attribute,
    ...semantics.denominated,
  ]);
  /**
   * The strip answers to the same question the charts do.
   *
   * Without this the cards drifted away from the deck they sit above: a report
   * whose charts were about price opened with "Average Context Window 753.2K",
   * because that column has the widest range in the file and the strip ranked
   * on range. A column the purpose pass calls plumbing — a source URL, an
   * as-of date — is not a headline number either.
   */
  const intent = purposeRanking(purpose);
  const wanted = (m) => !notSummable.has(m) && !purposeAvoids(intent, m);
  const additive = nameAdditive.filter(wanted);
  const comparable = allComparable.filter(wanted);

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

  /**
   * The totals, largest first, and more than one of them when there is room.
   *
   * This took `additive[0]` — the first summable column in *file order*. On a
   * table of `…, units, revenue` that is the unit count, so the strip opened
   * with "Total Units Sold 11.9K", revenue was demoted to the average card
   * below it, and the one number an executive looks for first — the total
   * revenue, 1.4M — was not on the dashboard at all. The chart underneath was
   * meanwhile reporting "718K, 51.3% of the total", so the report knew the
   * figure and did not show it.
   *
   * Ordering by the magnitude of the sum puts the headline measure first
   * without reading a column name to find out which one it is: money totals
   * dominate the counts of the things sold, which is what makes one the
   * headline and the other the detail. It is the same evidence-over-lexicon
   * rule the chart planner works by.
   *
   * Two totals rather than one, because a strip of four that spends two cards
   * on provenance is a strip of two. Units sold beside revenue is the pair a
   * reader wants; neither is a substitute for the other.
   */
  const byMagnitude = orderByPurpose(
    additive,
    intent,
    'measure',
    (a, b) => Math.abs(stats[b]?.sum || 0) - Math.abs(stats[a]?.sum || 0)
  );
  for (const m of byMagnitude.slice(0, 2)) {
    // The summed value itself, not mean * n: that reconstruction goes through a
    // float division and back, and a card that says "Total" should be the total.
    kpis.push({ label: aggregateAlias('SUM', m), value: compact(stats[m].sum), trend: 'up' });
  }
  /**
   * And one average, preferring a measure the totals have not already covered.
   *
   * A rate, a score or a price says something the two totals cannot. Where
   * there is no such column the average falls back to the most variable
   * comparable measure even if it is one of the totals, because the average of
   * a revenue column beside its total is the average order value — a figure
   * every reader of this strip wants and neither total gives them.
   */
  const reported = new Set(byMagnitude.slice(0, 2));
  const avgPool = comparable.filter((m) => !reported.has(m));
  /**
   * The most varied measure — and a column is not varied because of one row.
   *
   * Two separate things were wrong with `max - min`. It is in the column's own
   * units, so the widest range belongs to whichever column is counted in the
   * biggest numbers: a comparison of AI plans led its strip with "Average
   * Context Window 753.2K", a column reading 1M on most of its rows and telling
   * a reader nothing. Dividing by the mean fixed that, and left the same file
   * opening with "Average Min Seats 8.8" — because a range is decided by two
   * rows, and there by one. `Min Seats` is the number 1 on thirty-two of
   * forty-four rows and 300 on Microsoft's enterprise tier, and 8.8 describes
   * no plan in the file.
   *
   * The division by the mean stays. What is added is that a column whose middle
   * half is a single value goes last, whatever its extremes say, because a
   * column that is one number for most of its rows has no average worth
   * printing. See lib/measureVariation.js.
   */
  const variation = measureVariation(rows, p.measures, stats);
  const avgM = orderByPurpose(
    avgPool.length ? avgPool : comparable,
    intent,
    'measure',
    byVariation(variation)
  )[0];
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
  // Raised from "fewer than three" to "fewer than two": with two totals and an
  // average the strip now fills itself with measures, and a distinct-value
  // count is only better than an empty card, never better than a number about
  // the business.
  if (kpis.length < 2 && segmentDim) {
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
