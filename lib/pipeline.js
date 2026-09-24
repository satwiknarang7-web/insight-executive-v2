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
import { outcomeVariable } from './measureSemantics.js';
import { critique } from './critic.js';
import { nearDuplicates, argumentSpine, spineAsBullets } from './synthesiser.js';
import { excludeVoidRows } from './voidRows.js';
import { RECORD_COUNT, aggregateTitle } from './aggregateNames.js';
import { rateSensitivity } from './rateDefinition.js';
import { registerEngineFunctions } from './engineFunctions.js';
import { readTable } from './tableModel.js';
import { suggestQuestions } from './questionCatalogue.js';
import { compileQuestion, headlineFigures } from './questionCompiler.js';
import { extent } from './extent.js';

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

/**
 * Take the support column out of the results, and keep what it said.
 *
 * An aggregate that carries `COUNT(measure)` alongside its average needs that
 * number for the evidence tier and must not let it anywhere near the chart:
 * left in `resultData` it is a second numeric column, which `extractSeries`
 * would treat as a second measure and a legend would draw as a second series.
 *
 * So it is lifted here, once, immediately after the query runs — the rows go on
 * to rendering and analysis in exactly the shape they had before this existed,
 * and the counts travel on the chart as `support`.
 */
export function liftSupport(chart, resultData) {
  const key = chart.supportKey;
  if (!key || !Array.isArray(resultData) || !resultData.length) return resultData;
  if (!Object.prototype.hasOwnProperty.call(resultData[0], key)) return resultData;

  const byLabel = {};
  const counts = [];
  const cleaned = [];
  for (const row of resultData) {
    const { [key]: raw, ...rest } = row;
    const n = Number(raw);

    /**
     * A group with nothing in it is not a bar.
     *
     * `GROUP BY` returns a row for every category that exists, and `AVG` over a
     * group whose measure is null on every row returns null — so the results
     * carry a category with no value. On the file this came from, eight of
     * forty-four rows have no flagship model and two vendors quote no price,
     * and the chart drew "Cursor", "Perplexity" and an empty label as bars of
     * nothing. Nobody noticed until the count was there to say so.
     *
     * Dropped here rather than rendered as a gap, because a category a reader
     * can see on the axis is a category they will read a value off.
     */
    const empty = Number.isFinite(n) && n === 0;
    const value = rest[chart.yAxisKey];
    if (empty && (value === null || value === undefined)) continue;

    if (Number.isFinite(n)) {
      counts.push(n);
      byLabel[String(row[chart.xAxisKey] ?? '')] = n;
    }
    cleaned.push(rest);
  }

  if (counts.length) {
    chart.support = {
      byLabel,
      // The weakest bar decides the tier: a chart is only as good as the
      // thinnest thing it invites a reader to compare.
      min: extent(counts).min,
      max: extent(counts).max,
      // The bar the prose names, which is the first row — the query orders by
      // the measure descending.
      leader: counts[0],
    };
  }
  delete chart.supportKey;
  return cleaned;
}

export function executeCharts(specs, rows, { onProgress } = {}) {
  const executed = [];

  specs.forEach((chart, i) => {
    const work = { ...chart };
    let resultData = [];
    const rawSql = work.sql || work.sql_query || '';

    try {
      resultData = liftSupport(work, runSql(rawSql));
    } catch (e) {
      work.sqlError = e.message;
      resultData = [];
    }

    // The figure over every row the chart was drawn from, so the sentence
    // under it compares each bar with the same number the KPI strip shows —
    // not with the unweighted mean of the bars (rule I8).
    if (work.baselineSql) {
      try {
        const v = Object.values(runSql(work.baselineSql)[0] || {})[0];
        if (typeof v === 'number' && Number.isFinite(v)) work.baseline = { value: v, word: work.baselineWord || 'average' };
      } catch {
        /* no baseline: the sentence falls back to the mean of the bars */
      }
    }

    /**
     * A query can be raw rows on purpose.
     *
     * The heal below exists because a query that forgot to aggregate comes back
     * as a wall of raw rows and makes a useless chart. But a comparison table —
     * forty-four AI subscription plans, one row each — is charted by listing
     * its rows, deliberately, and that query has no GROUP BY because there is
     * nothing to group. Without this it was healed into "average by the first
     * string column", which is the exact chart the row-level one exists to
     * replace: the planner asked for twelve named plans and the deck drew ten
     * provider averages under the planner's title.
     *
     * Set by the planner (`rowLevel`), never inferred, so nothing an LLM writes
     * can opt itself out of the heal.
     */
    const wasAggregated = work.rowLevel === true || isAggregatedSql(rawSql);

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

    // A chart with a declared series has two label columns on purpose — the
    // axis and the series (department, and Budget or Actual). Folding them into
    // one label drew "Engineering - Actual" as a bar of its own instead of two
    // bars side by side.
    const composed = work.seriesKey
      ? { resultData, xKey: work.xAxisKey }
      : compositeLabels(resultData, work.chart_type, work.xAxisKey);
    resultData = composed.resultData;

    if (resultData.length > 0) {
      const asked = work.chart_type;
      const promised = [work.yAxisKey, work.secondaryYAxisKey];
      const spec = resolveChart(resultData, {
        type: work.chart_type,
        xKey: composed.xKey,
        yKey: work.yAxisKey,
        secondaryYAxisKey: work.secondaryYAxisKey,
        seriesKey: work.seriesKey,
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

  return executed;
}

/**
 * Full local analysis: plan → execute → resolve → compute verified findings.
 *
 * Returns everything the UI needs, plus a compact `narrationRequest` payload
 * (a few KB) that is the ONLY thing that ever has to reach the server.
 */
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

  /**
   * And the pairs that are the same numbers under two names.
   *
   * The key above is the measure's NAME, so "Units per Order by Txn Type" and
   * "Average Qty by Txn Type" were two subjects. They are one chart: where one
   * row is one order, the quantity summed over the order count IS the average
   * quantity, and the deck carried both, side by side, with the same two bars
   * and the same sentence under each.
   *
   * The names cannot be reconciled — one is a derived measure and the other an
   * aggregate — but the drawn values can, and by this point they have been
   * drawn. Compared as label/value pairs, rounded, so two routes to the same
   * arithmetic that differ in the last bit still match.
   */
  const shape = (c) => {
    const rows = c.resultData || [];
    if (!rows.length || !c.xAxisKey || !c.yAxisKey) return null;
    const pairs = rows.map((r) => {
      const v = Number(r?.[c.yAxisKey]);
      return `${String(r?.[c.xAxisKey] ?? '')}=${Number.isFinite(v) ? v.toPrecision(6) : ''}`;
    });
    // Sorted, because the same comparison ordered two ways is still the same
    // comparison.
    return `${String(c.chart_type)}|${pairs.sort().join(',')}`;
  };
  const byShape = new Map();
  for (const c of seen.values()) {
    const key = shape(c);
    if (!key) continue;
    const held = byShape.get(key);
    if (!held || (c.score || 0) > (held.score || 0)) byShape.set(key, c);
  }
  for (const [key, winner] of byShape) {
    for (const [subject, c] of seen) {
      if (c !== winner && shape(c) === key) seen.delete(subject);
    }
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
    voidClaim = null,
    includeVoid = false,
    /**
     * What the dataset is about, already verified against these rows.
     *
     * Arrives from `/api/semantics` via `acceptBrief`, which drops every claim
     * the rows do not support — so by the time it is here it is a set of facts
     * about this table rather than a model's opinion of it. Null is the normal
     * case on a deployment with no provider configured, and everything below
     * behaves exactly as it did before briefs existed.
     */
    brief = null,
    // Which cells the cleaner had to guess at, so a finding built on them
    // cannot claim more than the reading underneath it supports.
    confidence = null,
    // The questions the report answers. Omitted, the catalogue's recommended
    // questions are used — see lib/questionCatalogue.js.
    questions: asked = null,
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
  // the old planner's three passes — for ten seconds of
  // the twenty-two a large file took before a single query ran. A worker busy
  // for that long looks to the person watching like a hang, not like work.
  //
  // Re-profiled only when the exclusion actually removed rows: with nothing to
  // exclude `excludeVoidRows` returns the same array by identity, so the
  // profile of the source is the profile of the view.
  const shape = excluded && excluded.applied !== false ? profileColumns(rows) : sourceShape;

  onProgress?.({ stage: 'Planning charts', percent: 10 });

  /**
   * Question first. The table is read once (lib/tableModel.js), the catalogue
   * proposes what it can answer, and each question compiles into charts that
   * cannot break the rules in docs/design/question-first-reports.md — there is
   * no generate-then-filter step, because nothing is generated that would have
   * to be filtered. A model shapes the deck only through the questions it
   * proposes (lib/modelQuestions.js), which go through this same compiler.
   */
  const tableModel = readTable(rows, { profile: shape, provenance, roles });
  const cardinality = Object.fromEntries(Object.entries(tableModel.columns).map(([c, info]) => [c, info.distinct]));
  const found = outcomeVariable({ brief, columns: Object.keys(tableModel.columns), sample: rows.slice(0, 500), cardinality });
  const suggestions = suggestQuestions(rows, tableModel, { outcome: found });
  const chosen = Array.isArray(asked) && asked.length ? asked : suggestions.filter((q) => q.recommended);
  const specs = chosen.flatMap((q) => compileQuestion(q, rows, tableModel)).slice(0, maxCharts || Infinity);
  const kpis = headlineFigures(chosen, rows, tableModel);

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

  // An asked question whose answer is "no difference" has been answered, so
  // nothing here drops a chart for being flat. A deck does not need one measure
  // over one column twice.
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
   * What leads has to be able to carry it (I10). The questions arrive in the
   * catalogue's order; a chart whose evidence is too thin to stand on moves
   * behind the ones that can, and otherwise the order is kept.
   */
  {
    const thin = new Set(perChart.filter((f) => f.metrics?.evidence === 'thin').map((f) => f.id));
    const rankOf = (c) => (thin.has(c.id) ? 1 : 0);
    charts = charts.map((c, i) => [c, i]).sort((a, b) => rankOf(a[0]) - rankOf(b[0]) || a[1] - b[1]).map(([c]) => c);
    const order = new Map(charts.map((c, i) => [c.id, i]));
    perChart.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

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
  // The critic asks whether anything in the deck is about the outcome, so it
  // has to be shown the same outcome the planner used. Reading it from the
  // lexicon here while the planner read it from the brief meant the critic
  // could report a continuous outcome as un-charted on a deck that led with it.
  const outcome = outcomeVariable({
    brief,
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
    // Every question the catalogue proposed, recommended ones marked — what
    // the question card offers the reader — and the ones this report answers.
    // Whole, outcomes included: a question handed back is compiled again.
    questions: suggestions,
    asked: chosen,
  };
}

