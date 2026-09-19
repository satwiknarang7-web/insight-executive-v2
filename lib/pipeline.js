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
import { composeBoard, planSlicers } from './boardComposer.js';
import {
  resolveChart,
  isAggregatedSql,
  ADVANCED_TYPES,
  profileColumns,
  isTemporalValue,
  usesSecondDimension,
} from './chartResolver.js';
import { analyzeStoryboard, chronologicalRows, isAdditiveMeasure } from './insightEngine.js';
import { outcomeColumn } from './measureSemantics.js';
import { critique } from './critic.js';
import { nearDuplicates, argumentSpine, spineAsBullets } from './synthesiser.js';
import { excludeVoidRows } from './voidRows.js';
import { detectRepeatedMeasures } from './dataGrain.js';
import { RECORD_COUNT, aggregateTitle } from './aggregateNames.js';
import { rateSensitivity } from './rateDefinition.js';
import { registerEngineFunctions } from './engineFunctions.js';

// Every query the engine runs sees the same null-safe function set. Done once,
// here, because this is the one module everything that touches alasql imports.
registerEngineFunctions(alasql);

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
  const cleaned = outsideLiterals(String(sql || ''), (part) =>
    part.replace(/\[?\bSalesData\b\]?/gi, `[${table}]`)
  );
  return alasql(cleaned) || [];
}

/**
 * Apply `fn` to the parts of a statement that are not inside quotes.
 *
 * The view-name rewrite used to run over the whole string, so `WHERE note =
 * 'SalesData'` was rewritten to `'[SalesData]'` and matched nothing, and
 * `SELECT 'SalesData'` returned the brackets. A name substitution has no
 * business inside quoted text.
 */
function outsideLiterals(sql, fn) {
  const parts = sql.split(/('(?:[^']|'')*'|"(?:[^"]|"")*")/);
  for (let i = 0; i < parts.length; i += 2) parts[i] = fn(parts[i]);
  return parts.join('');
}

const ID_RE = /(^id$|_id$|key|code|guid|uuid|index|row|sr|sno|serial)/i;

/** Each column's type, taken from the first row that has a value in it. */
function columnTypes(rows, sample = 50) {
  const types = {};
  const limit = Math.min(rows.length, sample);
  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    if (!row) continue;
    for (const key of Object.keys(row)) {
      if (types[key]) continue;
      const v = row[key];
      if (v === null || v === undefined || v === '') continue;
      types[key] = typeof v;
    }
  }
  return types;
}

/**
 * When a planned query returns nothing, returns an unusable number of rows, or
 * was never aggregated at all, rebuild it as a simple category average so the
 * slide still shows something truthful.
 */
function selfHeal(chart, rows) {
  // Read each column's type from the first row that actually has a value in it.
  // Taking it from `rows[0]` alone meant one empty optional field in the first
  // record left the fallback with no category and no measure to build from, so
  // the broken chart was shipped as it was.
  const types = columnTypes(rows);
  const named = (k) => !ID_RE.test(k);
  const stringCols = Object.keys(types).filter((k) => types[k] === 'string' && named(k));
  const numCols = Object.keys(types).filter((k) => types[k] === 'number' && named(k));
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

  /**
   * Only when the deck is genuinely monotonous.
   *
   * This existed because the planner used to emit the same two or three shapes
   * whatever the data was. It now chooses from the data — a trend, a cross-tab
   * over the pair that interacts, a waterfall of what moved — and retyping on
   * top of that makes the deck worse rather than better: a bar chart of seven
   * categories where one holds 72% was turned into a radial, concentric arcs
   * with one ring and six threads, unreadable, purely so the deck could say it
   * had a radial in it. Variety earned by choosing a fitting chart is worth
   * having; variety imposed by redrawing a clear one is not.
   */
  const distinct = new Set(charts.map((c) => (c.chart_type || 'bar').toLowerCase()));
  if (distinct.size >= 3) return charts;

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
  const allowedTarget = (c, target, timeChart) => {
    if (timeChart) return !SHARE_TYPES.has(target);
    // A radial draws each slice as an arc of a different radius, which the eye
    // compares badly at the best of times and not at all when one slice is most
    // of the whole. Few segments, and no runaway leader.
    if (target === 'radial') {
      const values = (c.resultData || []).map((r) => Number(r?.[c.yAxisKey])).filter(Number.isFinite);
      const total = values.reduce((a, b) => a + b, 0);
      if (values.length > 5 || !total) return false;
      if (Math.max(...values) / total > 0.5) return false;
    }
    // A part-to-whole chart claims its slices add up to something. Averages and
    // rates do not: four category averages sum to a number that is not the
    // revenue of any business, and a slice of it reads exactly like a market
    // share. Variety is not worth a chart that asserts a whole it does not have.
    if (SHARE_TYPES.has(target) && !isAdditiveMeasure(c.yAxisKey)) return false;
    return !TIME_TYPES.has(target);
  };
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
      const promised = [chart.yAxisKey, chart.secondaryYAxisKey];
      chart.chart_type = spec.type;
      chart.xAxisKey = spec.xKey;
      chart.yAxisKey = spec.yKey;
      chart.secondaryYAxisKey = spec.secondaryKey || chart.secondaryYAxisKey;
      // Retyping for variety is still a retype: if the new shape drops a series
      // the heading was counting on, the heading goes with it.
      chart.title = titleForDrawn(chart.title, promised, [spec.yKey, spec.secondaryKey], spec.xKey);
    }
    mi++;
  }
  return charts;
}

/** Chart types whose x axis carries a real order rather than a ranking. */
const ORDERED_X_TYPES = new Set(['line', 'area', 'waterfall', 'ribbon']);

/**
 * The title a chart has earned, once the data has decided its shape.
 *
 * Titles are composed by the planner for the shape it asked for, and the
 * resolver is allowed to refuse that shape. Nothing carried the title across
 * that refusal, so a card could end up headed for a chart nobody drew: a radar
 * of three measures that the resolver reduced to one measure it could draw
 * legibly kept "Product Category Profile Across Key Metrics" — a promise of
 * key metrics, over a donut of one.
 *
 * Two ways a title stops being true, and both are answerable from the spec
 * rather than from a table of which type became which:
 *
 *  - It names a measure the chart no longer draws. That is the composed chart
 *    reduced to a single series, still advertising both.
 *  - It names none of the measures the chart does draw. That is the bespoke
 *    title a particular shape gets, which stops meaning anything once the
 *    shape is gone.
 *
 * Anything else is left alone. "What Moved Total Revenue by Month" is a fine
 * heading for a waterfall and for the bar it falls back to, and rewriting it
 * would cost the reader a sentence somebody wrote on purpose.
 */
export function titleForDrawn(title, promised, drawn, xKey) {
  const shown = (drawn || []).filter(Boolean);
  if (!shown.length) return title;

  const text = String(title || '').toLowerCase();
  const names = (list) => list.filter(Boolean).map((m) => String(m).toLowerCase());
  const isShown = new Set(names(shown));

  const overstates = names(promised || []).some((m) => !isShown.has(m) && text.includes(m));
  const namesNothingShown = !names(shown).some((m) => text.includes(m));
  if (!overstates && !namesNothingShown) return title;

  return aggregateTitle(shown, [xKey]);
}

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

    // What self-healing is for: a query that returned nothing, or one that was
    // never an aggregate at all and so came back as raw rows.
    //
    // It used to fire on any result over thirty rows as well, aggregate or not,
    // and silently replace the chart with an average by the first string
    // column. That is fine for a bar chart of ten categories and wrong for
    // everything else: a monthly trend over three years is thirty-six rows, a
    // cross-tab is up to fifty, a map is up to fifty. Each of those is a
    // correct, deliberate, aggregated query, and each was being thrown away and
    // answered with a different chart carrying the original title. The ceiling
    // is now only a backstop against a group-by on an identifier column.
    const RUNAWAY_ROWS = 2000;
    if (!resultData.length || !wasAggregated || resultData.length > RUNAWAY_ROWS) {
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
      const asked = work.chart_type;
      const promised = [work.yAxisKey, work.secondaryYAxisKey];
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
      // A title was written for the shape that was asked for. If the data could
      // not support that shape, it may now be describing a chart nobody drew.
      if (spec.type !== asked) {
        work.title = titleForDrawn(work.title, promised, [spec.yKey, spec.secondaryKey], spec.xKey);
      }
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
/**
 * How flat a chart's own results are, once it has run.
 *
 * The same question the planner's signals ask, asked of the numbers that came
 * back: does this chart show a difference a reader could not have guessed? A
 * spread under a few percent of the mean is a row of identical bars whatever
 * the measure behind it was.
 */
// Six bars whose values span a tenth of their mean are six bars of the same
// height to anyone looking at them. The coupon discount rate survived at 0.08
// and still read as a flat row across every age group.
const FLAT_SPREAD = 0.15;
/**
 * One measure over one column is one slide, however many ways it is drawn.
 *
 * A shipped deck had seven findings and about four distinct claims: `Total
 * Amount Trend Over Month` and `Monthly Changes in Total Amount` were one flat
 * series told twice, and a ranking and a share of the same categories were one
 * comparison drawn two ways. Every slide was correct. The deck was padded.
 *
 * Matched on what a chart is OF — the measure it aggregates and the column it
 * breaks that measure down by — rather than on its title or its type, because
 * the pair that duplicated in practice shared neither. A distribution is safe
 * from this: its dimension is a band of the measure, not a column.
 *
 * The survivor is the planner's own higher-scored candidate. The score is
 * already how the deck decides what makes it at all, so using anything else
 * here would mean two disagreeing opinions about which chart is better.
 *
 * `lib/synthesiser.js` still asks about duplicates it finds in the finished
 * findings. That is the safety net for pairs this cannot see — the same claim
 * reached through different columns — and it asks rather than cuts.
 */
function dropDuplicateCharts(charts) {
  const seen = new Map();
  for (const c of charts) {
    const measure = String(c.yAxisKey ?? '').toLowerCase().trim();
    const dimension = String(c.dimension ?? c.xAxisKey ?? '').toLowerCase().trim();
    if (!measure || !dimension) continue;
    const subject = `${measure}|${dimension}`;
    const held = seen.get(subject);
    if (!held || (c.score || 0) > (held.score || 0)) seen.set(subject, c);
  }

  const survivors = new Set(seen.values());
  const kept = charts.filter((c) => {
    const measure = String(c.yAxisKey ?? '').toLowerCase().trim();
    const dimension = String(c.dimension ?? c.xAxisKey ?? '').toLowerCase().trim();
    // A chart this cannot identify is never cut on a guess.
    if (!measure || !dimension) return true;
    return survivors.has(c);
  });

  // Never cut a deck down to nothing on redundancy alone.
  return kept.length >= 2 ? kept : charts;
}


/**
 * How many charts may be about nothing but how many rows there are.
 *
 * "Record Count by Provider" is a fact about the file, not about the business:
 * it says how many plan tiers somebody happened to list, and a donut of it says
 * the same thing with a hole in the middle. One of those is useful context at
 * the top of a deck. The last report shipped three — a donut by audience, a
 * donut by buyer unit and a bar chart by flagship model — which between them
 * made the same claim three times and left the file's actual measures, the
 * prices and the benchmark scores, off the report entirely.
 *
 * The cap is conditional, because on a dataset with nothing to add up counting
 * rows is the only honest thing a chart can do. It only bites once there are
 * enough real measures to fill the deck without them.
 */
const COUNT_CHARTS_MAX = 1;

/** Is this chart measuring anything other than how many rows there are? */
function isRecordCountChart(chart) {
  const y = String(chart?.yAxisKey || '');
  if (y === RECORD_COUNT) return true;
  // The share variants carry the same measure under a title of their own.
  return /^\s*record count\b/i.test(y);
}

export function limitRecordCounts(charts) {
  const counts = charts.filter(isRecordCountChart);
  if (counts.length <= COUNT_CHARTS_MAX) return charts;

  const measured = charts.filter((c) => !isRecordCountChart(c));
  // Not enough else to say: the counts are the deck, so they stay.
  if (measured.length < KEEP_AT_LEAST - COUNT_CHARTS_MAX) return charts;

  // Keep the most informative one rather than the first: a count split evenly
  // across many categories describes the file, one where a single category
  // holds nearly everything describes only that category.
  const spread = (c) => {
    const values = (c.resultData || []).map((r) => Number(r?.[c.yAxisKey])).filter(Number.isFinite);
    const total = values.reduce((a, b) => a + b, 0);
    if (!total || values.length < 2) return 0;
    // Effective segments: the inverse Herfindahl, so an even split scores high.
    const hhi = values.reduce((sum, v) => sum + (v / total) ** 2, 0);
    return hhi > 0 ? 1 / hhi : 0;
  };
  const keep = new Set([...counts].sort((a, b) => spread(b) - spread(a)).slice(0, COUNT_CHARTS_MAX));
  return charts.filter((c) => !isRecordCountChart(c) || keep.has(c));
}

/** Never cut below this, however little any of it says. */
const KEEP_AT_LEAST = 3;

function dropFlatCharts(charts) {
  const flatness = (c) => {
    // Only the shapes where "every bar the same height" means the chart says
    // nothing. A trend is judged on its direction, a histogram on whether it
    // has a shape, a scatter on whether the points line up — a flat one of any
    // of those can still be the finding.
    if (!['bar', 'hbar', 'donut', 'pie', 'treemap', 'radial'].includes(c.chart_type)) return null;
    // A histogram is a bar chart by type and a distribution by intent.
    if (/^Distribution of /.test(c.title || '')) return null;
    const values = (c.resultData || [])
      .map((r) => Number(r?.[c.yAxisKey]))
      .filter((v) => Number.isFinite(v));
    if (values.length < 3) return null;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (!Number.isFinite(mean) || Math.abs(mean) < 1e-9) return null;
    return (Math.max(...values) - Math.min(...values)) / Math.abs(mean);
  };

  const flat = [];
  const kept = [];
  for (const c of charts) {
    const spread = flatness(c);
    if (spread !== null && spread < FLAT_SPREAD) flat.push(c);
    else kept.push(c);
  }
  if (!flat.length || kept.length >= KEEP_AT_LEAST) return kept;

  // Put back the least flat of them rather than ship a deck of two.
  flat.sort((a, b) => (flatness(b) || 0) - (flatness(a) || 0));
  return [...kept, ...flat.slice(0, KEEP_AT_LEAST - kept.length)];
}

export function runAnalysis(
  allRows,
  {
    focus = null,
    maxCharts = null,
    tables = null,
    provenance = {},
    roles = {},
    profile = null,
    withheld = [],
    claims = null,
    voidClaim = null,
    // What the table is for, where a model could say — see lib/datasetPurpose.js.
    // Null on every deployment without a key, and null means the ranking below
    // is the statistical one this planner has always used.
    purpose = null,
    includeVoid = false,
    // Which cells the cleaner had to guess at, so a finding built on them
    // cannot claim more than the reading underneath it supports.
    confidence = null,
    onProgress,
  } = {}
) {
  if (!allRows || allRows.length === 0) {
    return { charts: [], kpis: [], perChart: [], synthesis: null, narrationRequest: null };
  }

  /**
   * Rows the data itself says did not happen, taken out before anything counts.
   *
   * This is the one place it can be done. Every chart, every KPI, every share
   * and every finding below derives from `rows`, so filtering here is the
   * difference between a report about completed orders and a report that
   * silently includes 25,000 cancellations inside its headline revenue — which
   * is what shipped, arithmetically perfect throughout.
   *
   * Only the ANALYSIS is filtered. `allRows` is untouched and the source tables
   * are mounted whole below, so Explore, Ask and the SQL console still see
   * every row. Nothing is deleted; something is excluded, and said so.
   */
  const sourceShape = profile || profileColumns(allRows);
  const { rows, excluded } = excludeVoidRows(allRows, sourceShape, voidClaim, { include: includeVoid });
  // Profiled once, here, and passed to everything below.
  //
  // `profileColumns` costs about two and a half seconds on 250,000 rows, and it
  // used to run four times in one analysis — once here and once inside each of
  // `recommendedChartCount`, `planCharts` and `planKpis` — for ten seconds of
  // the twenty-two a large file took before a single query ran. A worker busy
  // for that long looks to the person watching like a hang, not like work.
  //
  // Re-profiled only when the exclusion actually removed rows: with nothing to
  // exclude `excludeVoidRows` returns the same array by identity, so the
  // profile of the source is the profile of the view.
  const shape = excluded && excluded.applied !== false ? profileColumns(rows) : sourceShape;

  onProgress?.({ stage: 'Planning charts', percent: 10 });
  // Which measures repeat because they arrived across a one-to-many join. The
  // charts and the KPI strip need the same answer and it costs another two and
  // a half seconds, so it is found once.
  const repeated = detectRepeatedMeasures(rows, shape);
  const target = maxCharts || recommendedChartCount(rows, shape);
  const specs = planCharts(rows, { max: target, provenance, roles, claims, profile: shape, repeated, purpose });
  const kpis = planKpis(rows, { provenance, roles, claims, profile: shape, repeated, purpose });

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

  // Some charts cannot be scored before they run.
  //
  // A chart built on a derived measure — a shipping cost rate, a coupon
  // discount rate, a returned-or-cancelled rate — is an arbitrary SQL
  // expression, so the planner has no way to measure what it would show and
  // waves it through unscored, at the highest base score in the deck. Three of
  // them opened a nine-chart slide: identical bars across every age group, a
  // rate that is the same everywhere drawn three times. Now that they have run,
  // the values are right there to look at.
  charts = dropFlatCharts(charts);
  // One chart may be about how many rows there are; three cannot.
  charts = limitRecordCounts(charts);
  // And a deck does not need one measure over one column twice.
  charts = dropDuplicateCharts(charts);

  /**
   * Test the definition, not just the arithmetic.
   *
   * A ratio can be a ratio of sums or a mean of ratios, both correct and not
   * equal. On a real export they named different leaders — Books by the first,
   * Grocery by the second — and the engine ranked by one silently, measured the
   * leader 3.7 standard deviations clear of the field, and printed that as
   * robustness. The figure was right; the claim it implied was not.
   *
   * Run here because this is where the rows and the built charts are both in
   * hand. The result rides on the chart so the finding can state which
   * definition produced it and, where the two disagree, stop claiming the
   * ordering is stable.
   */
  for (const chart of charts) {
    const parts = chart?.measure?.parts;
    if (!parts?.numerator || !parts?.denominator || !chart.dimension) continue;
    chart.rateCheck = rateSensitivity(rows, {
      dimension: chart.dimension,
      numerator: parts.numerator,
      denominator: parts.denominator,
    });
    chart.rateParts = parts;
  }

  onProgress?.({ stage: 'Verifying the maths', percent: 78 });
  const { perChart, synthesis } = analyzeStoryboard(charts, rows, confidence);

  /**
   * Read the finished deck before handing it over.
   *
   * The review used to run after the analysis was already on screen, so it
   * could describe a gap but never travel with the thing it was describing. It
   * is a stage now: it reports its own progress, and its questions leave with
   * the result.
   *
   * It repairs nothing, and that is a measured decision rather than a missing
   * feature. The one gap that looked structural — an outcome column with no
   * chart about it — cannot actually occur once the outcome is detected:
   * outcome charts carry a base score of 98, second only to the time trend, so
   * they reach any deck of more than one slide even when the rate barely moves.
   * The athlete export failed because detection failed, not because the charts
   * lost. A repair for it was written, measured against a uniform outcome and a
   * two-slide deck, never fired in either, and was removed.
   *
   * The rest are not repairable by construction. Columns that lost on merit did
   * not lose by accident and re-planning re-derives the same answer; a
   * contradiction is a bug to fix in the engine, not something to paper over at
   * runtime. So the review says what it found and leaves it to a reader, which
   * is the honest shape of a check that cannot also be the fix.
   */
  onProgress?.({ stage: 'Reviewing the deck', percent: 84 });
  const outcome = outcomeColumn({
    columns: [...(shape.measures || []), ...(shape.dimensions || [])],
    sample: rows.slice(0, 500),
    cardinality: shape.cardinality || {},
  });
  const review = () =>
    critique({
      findings: perChart,
      profile: { ...shape, rowCount: rows.length },
      outcome,
      withheld,
    });
  const questions = review();

  /**
   * Turn the findings into an argument instead of a list.
   *
   * The summary was four strong readings, ranked, each written as though its
   * chart were the only one in the deck. True sentences in a stack, with no
   * spine: nothing said what the data was about, what was in doubt before
   * anything was claimed, or what to decide.
   *
   * The spine is deterministic and free, so it is what the customer sees at
   * first paint; the model pass that writes it up runs later, alongside the
   * narration, and can only reach figures already in the findings it cites.
   *
   * `contestedBasis` runs here because it needs the rows. A status column
   * marking a tenth of them cancelled or returned changes what every total in
   * the report is a total OF, and a doubt that size belongs before the figures
   * it undermines rather than in a footnote after them.
   */
  const duplicates = nearDuplicates(perChart);
  const argument = argumentSpine({
    findings: perChart,
    connections: synthesis?.connections || [],
    excluded,
    rowCount: rows.length,
  });
  if (argument.length) {
    synthesis.argument = argument;
    synthesis.macroInsights = spineAsBullets(argument);
  }
  synthesis.excluded = excluded;

  onProgress?.({ stage: 'Writing the report', percent: 88 });

  // The small payload the narrative LLM receives. No raw rows, ever.
  const narrationRequest = {
    focus,
    synthesis,
    findings: perChart.map((f) => ({
      id: f.id,
      title: f.title,
      type: f.type,
      // What the finding is about, so the narrator can say "categories" rather
      // than read the chart title back, and can tell two findings apart when
      // both describe the same categories measured differently.
      measures: f.measure,
      broken_out_by: f.dimension,
      finding: f.headline,
      context: f.detail,
      suggested_next_step: f.recommendation,
      // How far the wording is allowed to go past the number. Sent as its own
      // field rather than buried in the numbers, because it governs every
      // sentence written about this finding.
      evidence: f.metrics?.evidence || null,
      evidence_notes: f.metrics?.evidenceNotes || [],
      verified_numbers: f.verifiedFacts,
    })),
  };

  /**
   * And the board the charts are arranged on.
   *
   * Last, and deliberately after every pass that reads the deck. The filter
   * tiles are charts by construction — they run a query and return rows — but
   * they are not findings, and a slicer that had gone through the engine above
   * would have had a statistic computed about it, a sentence written under it,
   * and a fair chance of arriving in the executive summary as "Month-to-month
   * leads contract types on record count". So they are planned, executed and
   * placed here, where the narrative is already written and closed.
   *
   * The arrangement covers both: `composeBoard` sizes every chart by what its
   * shape can use, gives the lead finding the top of the board, and puts the
   * filters in a rail down the left. It rides on the charts as `layout`, which
   * `buildStoryboard` copies onto the slide — where the reader can move it.
   */
  onProgress?.({ stage: 'Arranging the board', percent: 92 });
  let filters = [];
  try {
    const wanted = planSlicers(charts, { profile: shape, columns: Object.keys(rows[0] || {}), sample: rows.slice(0, 200) });
    if (wanted.length) {
      const mountedFilters = mountTables({ tables: tables || {}, view: rows });
      try {
        filters = executeCharts(wanted, rows);
      } finally {
        unmountTables(mountedFilters);
      }
    }
  } catch {
    // A board without its filters is a board. Nothing above depends on them.
    filters = [];
  }

  /*
   * The cards are tiles too.
   *
   * They used to be a strip above the board, which meant they could not be
   * moved, sized or arranged with anything else — a row of numbers the reader
   * was given rather than a part of the board they were building. They are
   * placed here with everything else and carry the same kind of box.
   */
  const cardTiles = kpis.map((card, i) => ({ ...card, id: card.id || `kpi_${i + 1}` }));
  const board = composeBoard(charts, filters, cardTiles);
  for (const tile of [...charts, ...filters, ...cardTiles]) {
    const box = board.get(String(tile.id));
    if (box) tile.layout = box;
  }

  // Deliberately short of 100 and short of 'Ready'. The deck is built and
  // verified here; it is not finished until it has been read back and repaired,
  // and that happens in the provider because it can reach a model and this
  // cannot. Announcing 'Ready' here would tick the last box on the panel while
  // two steps were still to run.
  return {
    charts: [...charts, ...filters],
    kpis: cardTiles,
    perChart,
    synthesis,
    narrationRequest,
    critique: questions,
    // Findings that say what another finding already said. Returned rather than
    // acted on here, because clearing a repeated instruction is an edit to the
    // deck and every edit in this product goes through one whitelist.
    duplicates,
  };
}

