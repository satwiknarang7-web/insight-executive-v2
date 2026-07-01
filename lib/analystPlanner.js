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

const TABLE = 'SalesData';

// Optional name hints, used ONLY to upgrade a chart from COUNT to SUM when a
// column is also statistically a "quantity". Correctness never depends on these:
// composition falls back to COUNT and comparisons use AVG, both valid on any data.
const ADDITIVE_NAME_RE = /(revenue|sales|amount|count|qty|quantit|unit|spend|spent|cost|profit|income|volume|population|gdp|order|transaction|download|click|view|visit|session|impression|budget|payment|charge|deposit|withdrawal|sold|stock|inventory)/i;
// Names that imply a NON-additive rate/score even if they also match an additive
// word (e.g. "GDP per capita", "cost ratio") — these veto SUM.
const RATE_NAME_RE = /(per[\s_-]?capita|\bper\b|ratio|percent|\bpct\b|\brate\b|\baverage\b|\bavg\b|\bmean\b|\bmedian\b|\bindex\b|\bscore\b|\brating\b|\bnps\b|\bgrowth\b)/i;

const br = (k) => `[${k}]`;

// Title-case a raw column name for display / SQL aliases.
export function pretty(s) {
  return String(s)
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
    stats[m] = { min, max, spread: max - min, mean: n ? sum / n : 0, n, allInt };
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
    if (role === 'quantity' && ADDITIVE_NAME_RE.test(m) && !RATE_NAME_RE.test(m)) {
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
export function planCharts(rows, { max = 7 } = {}) {
  if (!rows || rows.length === 0) return [];

  const p = profileColumns(rows);
  const { measures, temporal, cardinality } = p;
  const rowCount = rows.length;
  if (measures.length === 0 && p.dimensions.length === 0) return [];

  const stats = measureStats(rows, measures);

  // Data-driven roles: ordinals (rank/id), years and binaries are excluded from
  // measures; `comparable` can be averaged/correlated; `additive` can be summed.
  const { comparable, additive, years } = classifyMeasures(rows, p, stats);
  const bySpread = (arr) => [...arr].sort((a, b) => (stats[b]?.spread || 0) - (stats[a]?.spread || 0));
  const rankedComparable = bySpread(comparable);
  const primary = rankedComparable[0] || null;   // a measure to AVG / correlate
  const secondary = rankedComparable[1] || null;

  // Magnitude metric for composition/ranking: prefer a SUM-able additive column,
  // else fall back to COUNT(*) — always meaningful ("records per category").
  const sumCol = bySpread(additive)[0] || null;
  const magnitudeKey = sumCol ? 'Total' : 'Count';
  const magnitudeSql = (cat, limit) => sumCol
    ? `SELECT ${br(cat)}, SUM(${br(sumCol)}) AS [Total] FROM ${TABLE} GROUP BY ${br(cat)} ORDER BY [Total] DESC LIMIT ${limit}`
    : `SELECT ${br(cat)}, COUNT(*) AS [Count] FROM ${TABLE} GROUP BY ${br(cat)} ORDER BY [Count] DESC LIMIT ${limit}`;
  const rankingTitle = (cat) => sumCol ? `${pretty(cat)} by ${pretty(sumCol)}` : `Record Count by ${pretty(cat)}`;
  const compositionTitle = (cat) => sumCol ? `${pretty(cat)} Share of ${pretty(sumCol)}` : `${pretty(cat)} Composition`;

  // Dimensions, richest (most distinct values) first — a category with more levels
  // makes a more informative ranking than a yes/no binary.
  const dims = p.dimensions;
  const byCard = (arr) => [...arr].sort((a, b) => (cardinality[b] || 0) - (cardinality[a] || 0));
  const usable = dims.filter((d) => (cardinality[d] || 0) >= 2 && (cardinality[d] || 0) <= 25);
  const rankDims = byCard(usable);
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
    let xAlias = timeCol;
    let xExpr = br(timeCol);
    if (isISODate) {
      const yearly = tDistinct > 750; // multi-year daily data → bucket by year
      xAlias = yearly ? 'Year' : 'Month';
      xExpr = `SUBSTRING(${br(timeCol)}, 1, ${yearly ? 4 : 7})`;
    }
    const yExpr = sumCol ? `SUM(${br(sumCol)})` : 'COUNT(*)';
    add({
      title: sumCol ? `${pretty(sumCol)} Trend Over ${pretty(xAlias)}` : `Volume Trend Over ${pretty(xAlias)}`,
      chart_type: 'area',
      dimension: timeCol,
      sql: `SELECT ${xExpr} AS ${br(xAlias)}, ${yExpr} AS [${magnitudeKey}] FROM ${TABLE} GROUP BY ${xExpr} ORDER BY ${br(xAlias)} ASC`,
      xAxisKey: xAlias,
      yAxisKey: magnitudeKey,
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
        score: 84 - i * 12,
      });
    });
  }

  // 7-8. AVERAGE of comparable measures by category (AVG is valid for any measure).
  // Different metric from the COUNT/SUM ranking, so it's worth pairing even on the
  // same dimension (e.g. "Count by Region" + "Average Score by Region").
  if (primary) {
    rankDims.slice(0, 2).forEach((cat, i) => {
      const measure = (i === 1 && secondary) ? secondary : primary; // vary the metric across the two
      add({
        title: `Average ${pretty(measure)} by ${pretty(cat)}`,
        chart_type: 'bar',
        dimension: cat,
        sql: `SELECT ${br(cat)}, AVG(${br(measure)}) AS [Average] FROM ${TABLE} GROUP BY ${br(cat)} ORDER BY [Average] DESC LIMIT 12`,
        xAxisKey: cat,
        yAxisKey: 'Average',
        score: 74 - i * 8,
      });
    });
  }

  // 7-8. DISTRIBUTIONS (histograms) of up to two continuous measures via value buckets.
  contMeasures.slice(0, 2).forEach((m, i) => {
    const s = stats[m];
    if (!s || !isFinite(s.min) || s.spread <= 0) return;
    const step = s.spread / 4;
    const edge = (k) => Math.round(s.min + step * k);
    const col = br(m);
    const rangeAlias = `${pretty(m)} Range`; // unique per measure so histograms don't collide
    const caseExpr =
      `CASE WHEN ${col} < ${edge(1)} THEN '${edge(0)}-${edge(1)}' ` +
      `WHEN ${col} < ${edge(2)} THEN '${edge(1)}-${edge(2)}' ` +
      `WHEN ${col} < ${edge(3)} THEN '${edge(2)}-${edge(3)}' ` +
      `ELSE '${edge(3)}+' END`;
    add({
      title: `Distribution of ${pretty(m)}`,
      chart_type: 'bar',
      dimension: m,
      sql: `SELECT ${caseExpr} AS ${br(rangeAlias)}, COUNT(*) AS [Count] FROM ${TABLE} GROUP BY ${caseExpr} ORDER BY MIN(${col}) ASC`,
      xAxisKey: rangeAlias,
      yAxisKey: 'Count',
      score: 78 - i * 10,
    });
  });

  // 9. MULTI-METRIC SEGMENT PROFILE (radar) — needs 3+ comparable measures + tiny category.
  const radarCat = rankDims.find((d) => cardinality[d] >= 3 && cardinality[d] <= 6);
  if (radarCat && rankedComparable.length >= 3) {
    const [m1, m2, m3] = rankedComparable;
    add({
      title: `${pretty(radarCat)} Profile Across Key Metrics`,
      chart_type: 'radar',
      dimension: radarCat,
      sql: `SELECT ${br(radarCat)}, AVG(${br(m1)}) AS ${br(pretty(m1))}, AVG(${br(m2)}) AS ${br(pretty(m2))}, AVG(${br(m3)}) AS ${br(pretty(m3))} FROM ${TABLE} GROUP BY ${br(radarCat)} LIMIT 6`,
      xAxisKey: radarCat,
      yAxisKey: pretty(m1),
      score: 66,
    });
  }

  // 10. DUAL-AXIS volume vs average (composed) — needs an additive SUM column
  //     plus a different comparable measure to average.
  const dualCat = rankDims[0];
  const avgCompanion = rankedComparable.find((m) => m !== sumCol) || null;
  if (dualCat && sumCol && avgCompanion) {
    const sumAlias = pretty(sumCol);
    const avgAlias = `Avg ${pretty(avgCompanion)}`;
    add({
      title: `${pretty(sumCol)} vs ${pretty(avgCompanion)} by ${pretty(dualCat)}`,
      chart_type: 'composed',
      dimension: dualCat,
      sql: `SELECT ${br(dualCat)}, SUM(${br(sumCol)}) AS ${br(sumAlias)}, AVG(${br(avgCompanion)}) AS ${br(avgAlias)} FROM ${TABLE} GROUP BY ${br(dualCat)} ORDER BY ${br(sumAlias)} DESC LIMIT 8`,
      xAxisKey: dualCat,
      yAxisKey: sumAlias,
      secondaryYAxisKey: avgAlias,
      score: 60,
    });
  }

  // 11. CORRELATION (scatter) — only when a dimension yields enough points.
  const corrDim = highCard[0] || midCard.find((d) => cardinality[d] >= 15);
  if (corrDim && primary && secondary) {
    add({
      title: `${pretty(primary)} vs ${pretty(secondary)} Correlation`,
      chart_type: 'scatter',
      dimension: corrDim,
      sql: `SELECT ${br(corrDim)}, AVG(${br(primary)}) AS ${br(pretty(primary))}, AVG(${br(secondary)}) AS ${br(pretty(secondary))} FROM ${TABLE} GROUP BY ${br(corrDim)} LIMIT 60`,
      xAxisKey: pretty(primary),
      yAxisKey: pretty(secondary),
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
      score: 52,
    });
  }

  return selectDiverse(candidates, max);
}

// Greedily pick the strongest candidates while spreading across chart TYPES and
// DIMENSIONS. Each already-picked chart of the same type or dimension penalizes a
// candidate's effective score, so the deck stays varied — but it still fills up to
// `max` when enough distinct candidates exist, and shrinks below it otherwise.
const TYPE_PENALTY = 18;
const DIM_PENALTY = 16;

function selectDiverse(candidates, max) {
  const remaining = [...candidates];
  const picked = [];
  const typeCount = {};
  const dimCount = {};
  const seen = new Set();
  const dimOf = (c) => c.dimension || c.xAxisKey;

  while (picked.length < max && remaining.length > 0) {
    let bestIdx = -1;
    let bestEff = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const dupeKey = `${c.chart_type}:${c.xAxisKey}:${c.yAxisKey}`;
      if (seen.has(dupeKey)) continue;
      const eff =
        c.score -
        (typeCount[c.chart_type] || 0) * TYPE_PENALTY -
        (dimCount[dimOf(c)] || 0) * DIM_PENALTY;
      if (eff > bestEff) {
        bestEff = eff;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    const c = remaining.splice(bestIdx, 1)[0];
    seen.add(`${c.chart_type}:${c.xAxisKey}:${c.yAxisKey}`);
    typeCount[c.chart_type] = (typeCount[c.chart_type] || 0) + 1;
    dimCount[dimOf(c)] = (dimCount[dimOf(c)] || 0) + 1;
    picked.push(c);
  }

  return picked.map((c, i) => ({ ...c, id: `slide_${i + 1}` }));
}

/**
 * Deterministic KPI cards derived from the dataset.
 */
export function planKpis(rows) {
  if (!rows || rows.length === 0) return [];
  const p = profileColumns(rows);
  const stats = measureStats(rows, p.measures);
  const { comparable, additive } = classifyMeasures(rows, p, stats);

  const kpis = [{ label: 'Records Analyzed', value: compact(rows.length), trend: 'up' }];

  // Only "Total X" for genuinely additive columns (never a rank/score).
  if (additive[0]) {
    const m = additive[0];
    kpis.push({ label: `Total ${pretty(m)}`, value: compact(stats[m].mean * stats[m].n), trend: 'up' });
  }
  // "Avg X" for the most variable comparable measure.
  const avgM = [...comparable].sort((a, b) => (stats[b]?.spread || 0) - (stats[a]?.spread || 0))[0];
  if (avgM) {
    kpis.push({ label: `Avg ${pretty(avgM)}`, value: compact(stats[avgM].mean), trend: 'up' });
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
