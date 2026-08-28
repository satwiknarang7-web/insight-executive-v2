/**
 * The analysis pipeline — planning, SQL execution, chart resolution and
 * deterministic insight generation, as one pure(ish) module.
 *
 * This used to live inside the /api/query route, which meant the entire dataset
 * had to be serialized and POSTed to the server on every analysis. It is now a
 * standalone module so it can run inside a Web Worker in the browser: the rows
 * never leave the device, and the only thing sent to the server is a few KB of
 * already-computed findings for the LLM to phrase.
 *
 * Dependencies are limited to alasql + the existing pure analytic modules.
 */
import alasql from 'alasql';
import { planCharts, planKpis, recommendedChartCount } from './analystPlanner.js';
import {
  resolveChart,
  isAggregatedSql,
  ADVANCED_TYPES,
  profileColumns,
  isTemporalValue,
  usesSecondDimension,
} from './chartResolver.js';
import { analyzeStoryboard, chronologicalRows } from './insightEngine.js';

/**
 * The name the analysis view is always mounted under.
 *
 * Every planned and LLM-written query targets this one name. With a multi-sheet
 * workbook it is the joined view built by `lib/dataModel.js`; with a single
 * sheet it is that sheet. Keeping the name fixed is what lets the planner, the
 * insight engine and every previously saved analysis stay oblivious to joins.
 */
export const TABLE = 'SalesData';

/** Load rows into alasql under a stable table name. */
export function mountTable(rows, table = TABLE) {
  try {
    alasql(`DROP TABLE IF EXISTS [${table}]`);
  } catch {
    /* table did not exist */
  }
  alasql(`CREATE TABLE [${table}]`);
  alasql.tables[table].data = rows;
}

export function unmountTable(table = TABLE) {
  try {
    alasql(`DROP TABLE IF EXISTS [${table}]`);
  } catch {
    /* already gone */
  }
}

/**
 * Mount the whole model: every source sheet under its own name, plus the joined
 * analysis view under `TABLE`.
 *
 * The named sheets exist so the SQL console and the Ask page can write genuine
 * multi-table joins; the view exists so the automated pipeline doesn't have to.
 * Returns the list of mounted names so the caller can unmount exactly those.
 */
export function mountTables({ tables = {}, view = null, viewName = TABLE } = {}) {
  const mounted = [];
  for (const [name, rows] of Object.entries(tables)) {
    if (name === viewName) continue; // the view owns that name
    mountTable(rows, name);
    mounted.push(name);
  }
  if (view) {
    mountTable(view, viewName);
    mounted.push(viewName);
  }
  return mounted;
}

export function unmountTables(names = []) {
  for (const name of names) unmountTable(name);
}

/**
 * Run one SQL string against the mounted tables.
 *
 * This used to rewrite *every* occurrence of `SalesData` to the target table,
 * which was fine when only one table could ever be mounted but would corrupt a
 * real multi-table join. All that survives is normalising the case of the view
 * name, since generated SQL writes it inconsistently.
 */
export function runSql(sql, table = TABLE) {
  const cleaned = String(sql || '').replace(/\[?\bSalesData\b\]?/gi, `[${table}]`);
  return alasql(cleaned) || [];
}

const ID_RE = /(^id$|_id$|key|code|guid|uuid|index|row|sr|sno|serial)/i;

/**
 * When a planned query returns nothing, returns an unusable number of rows, or
 * was never aggregated at all, rebuild it as a simple category average so the
 * slide still shows something truthful.
 */
function selfHeal(chart, rows) {
  const sample = rows[0] || {};
  const stringCols = Object.keys(sample).filter((k) => typeof sample[k] === 'string' && !ID_RE.test(k));
  const numCols = Object.keys(sample).filter((k) => typeof sample[k] === 'number' && !ID_RE.test(k));
  if (stringCols.length === 0 || numCols.length === 0) return null;

  // Skip a leading column that is really a row counter.
  const firstNumVals = rows.slice(0, 5).map((r) => r[numCols[0]]);
  const isSequential = firstNumVals.every((v, i) => i === 0 || v === firstNumVals[i - 1] + 1);
  const metricCol = isSequential && numCols.length > 1 ? numCols[1] : numCols[0];

  const originalType = (chart.chart_type || '').toLowerCase();
  const cat = stringCols[0];
  const alias = (c) => `Avg ${String(c).replace(/_/g, ' ').trim()}`;

  if (originalType === 'scatter' && numCols.length >= 2) {
    const second = numCols.find((c) => c !== metricCol) || numCols[1];
    const ax = alias(metricCol);
    const ay = alias(second);
    return {
      sql: `SELECT [${cat}], AVG([${metricCol}]) AS [${ax}], AVG([${second}]) AS [${ay}] FROM ${TABLE} GROUP BY [${cat}] ORDER BY [${ax}] DESC LIMIT 10`,
      chart_type: 'scatter',
      xAxisKey: ax,
      yAxisKey: ay,
      // The planned title named the original measures; the fallback picked
      // different ones, so retitle rather than mislabel the chart.
      title: `${ax} vs ${ay} by ${String(cat).replace(/_/g, ' ')}`,
    };
  }

  // Types that structurally require more than one metric cannot survive here.
  const type = ['composed', 'radar', 'scatter'].includes(originalType) ? 'bar' : chart.chart_type;
  return {
    sql: `SELECT [${cat}], AVG([${metricCol}]) AS [Average] FROM ${TABLE} GROUP BY [${cat}] ORDER BY [Average] DESC LIMIT 10`,
    chart_type: type,
    xAxisKey: cat,
    yAxisKey: 'Average',
  };
}

/**
 * Reorder result rows to a caller-supplied label order.
 *
 * Histograms depend on their buckets appearing low-to-high, but AlaSQL returns
 * grouped rows in an order it does not guarantee — `ORDER BY MIN(col)` over a
 * column that isn't in the SELECT list is silently ignored, so buckets came back
 * shuffled. The planner knows the intended order, so it is simply reapplied.
 */
function applyLabelOrder(rows, labelKey, order) {
  if (!order || !Array.isArray(order) || rows.length === 0 || !labelKey) return rows;
  if (!(labelKey in rows[0])) return rows;

  const rank = new Map(order.map((label, i) => [label, i]));
  // Anything not in the expected order keeps its position at the end.
  return [...rows].sort((a, b) => {
    const ai = rank.has(a[labelKey]) ? rank.get(a[labelKey]) : Number.MAX_SAFE_INTEGER;
    const bi = rank.has(b[labelKey]) ? rank.get(b[labelKey]) : Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
}

/**
 * Merge several categorical result columns into one composite label so charts
 * don't render duplicate ticks. Correlation charts keep their raw dimensions.
 */
function compositeLabels(resultData, chartType, requestedXKey) {
  if (resultData.length === 0) return { resultData, xKey: requestedXKey };
  const stringKeys = Object.keys(resultData[0]).filter((k) => typeof resultData[0][k] === 'string');
  const wantsScatter = /scatter|distribution|correlation/.test((chartType || '').toLowerCase());
  // A matrix and a ribbon read the second string column as their own axis, so
  // folding the two into one label is what would break them.
  if (stringKeys.length <= 1 || wantsScatter || usesSecondDimension(chartType)) {
    return { resultData, xKey: requestedXKey };
  }

  const compositeKey = stringKeys.join(' & ');
  return {
    resultData: resultData.map((row) => ({
      ...row,
      [compositeKey]: stringKeys.map((k) => String(row[k] ?? '')).join(' - '),
    })),
    xKey: compositeKey,
  };
}

/**
 * Reassign duplicate chart types to under-represented "advanced" types, but only
 * where the chart's own result data can genuinely support the new type.
 */
export function enforceChartDiversity(charts) {
  if (!charts || charts.length < 3) return charts;

  const typeOf = (c) => (c.chart_type || 'bar').toLowerCase();
  // A histogram's x-axis is a set of value ranges, not categories. Part-to-whole
  // charts imply named segments, so those charts are never retyped.
  const isDistribution = (c) =>
    /distribution|histogram/i.test(c.title || '') || /range|bucket/i.test(c.xAxisKey || '');

  // Does this chart's x-axis carry a real chronological order?
  const isTimeChart = (c) => {
    const rows = c.resultData || [];
    if (rows.length === 0) return false;
    const p = profileColumns(rows);
    return p.temporal.includes(c.xAxisKey) || isTemporalValue(rows[0]?.[c.xAxisKey]);
  };

  // line/area assert an ordering along the x-axis; donut/treemap/radial assert a
  // meaningful whole. Only offer a chart the targets its own data supports.
  const TIME_TYPES = new Set(['line', 'area']);
  const SHARE_TYPES = new Set(['donut', 'treemap', 'radial']);
  const allowedTarget = (c, target, timeChart) =>
    timeChart ? !SHARE_TYPES.has(target) : !TIME_TYPES.has(target);
  const counts = {};
  charts.forEach((c) => {
    const t = typeOf(c);
    counts[t] = (counts[t] || 0) + 1;
  });

  const missing = ADVANCED_TYPES.filter((t) => !counts[t]);
  if (missing.length === 0) return charts;

  let mi = 0;
  for (let i = charts.length - 1; i >= 0 && mi < missing.length; i--) {
    const chart = charts[i];
    const t = typeOf(chart);
    if (isDistribution(chart)) continue;
    if (counts[t] < 2) continue; // keep at least one of every existing type
    const rd = chart.resultData;
    if (!rd || rd.length === 0) continue;

    const target = missing[mi];
    if (!allowedTarget(chart, target, isTimeChart(chart))) {
      mi++;
      continue;
    }
    const spec = resolveChart(rd, {
      type: target,
      xKey: chart.xAxisKey,
      yKey: chart.yAxisKey,
      secondaryYAxisKey: chart.secondaryYAxisKey,
    });

    if (spec.type === target) {
      counts[t]--;
      counts[target] = (counts[target] || 0) + 1;
      chart.chart_type = spec.type;
      chart.xAxisKey = spec.xKey;
      chart.yAxisKey = spec.yKey;
      chart.secondaryYAxisKey = spec.secondaryKey || chart.secondaryYAxisKey;
    }
    mi++;
  }
  return charts;
}

/** Chart types whose x axis carries a real order rather than a ranking. */
const ORDERED_X_TYPES = new Set(['line', 'area', 'waterfall', 'ribbon']);

/**
 * Execute a list of chart specs against the mounted table and resolve each one
 * into a final, data-validated spec carrying its own result rows.
 */
export function executeCharts(specs, rows, { onProgress } = {}) {
  const executed = [];

  specs.forEach((chart, i) => {
    const work = { ...chart };
    let resultData = [];
    const rawSql = work.sql || work.sql_query || '';

    try {
      resultData = runSql(rawSql);
    } catch (e) {
      work.sqlError = e.message;
      resultData = [];
    }

    const wasAggregated = isAggregatedSql(rawSql);
    if (!resultData.length || resultData.length > 30 || !wasAggregated) {
      const heal = selfHeal(work, rows);
      if (heal) {
        try {
          const healed = runSql(heal.sql);
          if (healed.length) {
            resultData = healed;
            work.sql = heal.sql;
            work.chart_type = heal.chart_type;
            work.xAxisKey = heal.xAxisKey;
            work.yAxisKey = heal.yAxisKey;
            if (heal.title) work.title = heal.title;
            work.healed = true;
          }
        } catch (e) {
          work.sqlError = e.message;
        }
      }
    }

    resultData = applyLabelOrder(resultData, work.xAxisKey, work.sortLabels);

    // A line, an area or a waterfall asserts that its x axis runs in order. When
    // the labels are periods, put them in that order rather than trusting the
    // query's — an ad-hoc chart ordered by size and drawn as a line is a made-up
    // trend, and the findings computed from it would describe the sort.
    if (ORDERED_X_TYPES.has(String(work.chart_type || '').toLowerCase())) {
      resultData = chronologicalRows(resultData, work.xAxisKey);
    }

    const composed = compositeLabels(resultData, work.chart_type, work.xAxisKey);
    resultData = composed.resultData;

    if (resultData.length > 0) {
      const spec = resolveChart(resultData, {
        type: work.chart_type,
        xKey: composed.xKey,
        yKey: work.yAxisKey,
        secondaryYAxisKey: work.secondaryYAxisKey,
      });
      work.chart_type = spec.type;
      work.xAxisKey = spec.xKey;
      work.yAxisKey = spec.yKey;
      work.secondaryYAxisKey = spec.secondaryKey || work.secondaryYAxisKey;
    }

    executed.push({ ...work, resultData });
    onProgress?.({ done: i + 1, total: specs.length, title: work.title });
  });

  return enforceChartDiversity(executed);
}

/**
 * Full local analysis: plan → execute → resolve → compute verified findings.
 *
 * Returns everything the UI needs, plus a compact `narrationRequest` payload
 * (a few KB) that is the ONLY thing that ever has to reach the server.
 */
export function runAnalysis(rows, { focus = null, maxCharts = null, tables = null, provenance = {}, roles = {}, onProgress } = {}) {
  if (!rows || rows.length === 0) {
    return { charts: [], kpis: [], perChart: [], synthesis: null, narrationRequest: null };
  }

  onProgress?.({ stage: 'Planning charts', percent: 10 });
  const target = maxCharts || recommendedChartCount(rows);
  const specs = planCharts(rows, { max: target, provenance, roles });
  const kpis = planKpis(rows, { provenance, roles });

  onProgress?.({ stage: 'Running queries', percent: 30 });
  // `rows` is the analysis view; the source sheets ride along so a healed or
  // hand-written query can still reach them by name.
  const mounted = mountTables({ tables: tables || {}, view: rows });
  let charts;
  try {
    charts = executeCharts(
      specs.map((c, i) => ({ ...c, id: c.id || `slide_${i + 1}` })),
      rows,
      {
        onProgress: ({ done, total, title }) =>
          onProgress?.({ stage: `Querying: ${title}`, percent: 30 + Math.round((done / total) * 45) }),
      }
    );
  } finally {
    unmountTables(mounted);
  }

  onProgress?.({ stage: 'Verifying the maths', percent: 85 });
  const { perChart, synthesis } = analyzeStoryboard(charts, rows);

  // The small payload the narrative LLM receives. No raw rows, ever.
  const narrationRequest = {
    focus,
    synthesis,
    findings: perChart.map((f) => ({
      id: f.id,
      title: f.title,
      type: f.type,
      finding: f.headline,
      context: f.detail,
      suggested_next_step: f.recommendation,
      verified_numbers: f.verifiedFacts,
    })),
  };

  onProgress?.({ stage: 'Ready', percent: 100 });
  return { charts, kpis, perChart, synthesis, narrationRequest };
}
