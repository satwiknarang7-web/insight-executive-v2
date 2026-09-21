/**
 * The deck a model composed, checked against the table it was shown.
 *
 * Everything else a model does in this app is narrow. The unit pass names
 * columns; the purpose pass names columns; the analyst pass reorders a finished
 * deck and rewrites its headings. The charts themselves have always been chosen
 * by `lib/analystPlanner.js` — a few hundred rules, which is why the ten-dataset
 * evaluation in eval/RESULTS.md found it dependable on the shapes those rules
 * were written for and lost on the ones they were not.
 *
 * This is the pass that lets a model choose the charts. It asks the same
 * question `/api/ask` already answers for one chart typed by a person — turn
 * what you know about this table into a chart and the SQL behind it — and asks
 * it for the whole deck at once.
 *
 * **The contract is unchanged, and this module is the contract.** The model
 * chooses the questions; the engine computes every answer. Each spec that
 * arrives is checked here against the columns that actually exist, and then
 * executed, resolved, analysed, graded for evidence, put past the sceptic and
 * the critic exactly like a planned one. Nothing about a model-composed chart
 * reaches a reader without the same arithmetic behind it and the same evidence
 * tier over it.
 *
 * Three refusals earn their keep:
 *
 *   - a query that is not a single read-only SELECT (`assertEngineSelect`);
 *   - a query naming a column the table does not have — the check `/api/ask`
 *     never had, and the one that matters most, because a model that invents
 *     `[Total Revenue]` on a table without one produces a chart that fails at
 *     runtime or, worse, an empty one with a confident title;
 *   - a chart type this app cannot draw.
 *
 * A spec that fails is dropped and the rest are kept, so one bad chart costs
 * one chart. When nothing survives, the result is `null`, and `null` means the
 * rule planner runs exactly as it does today.
 *
 * Pure. No network, no SQL execution, no DOM.
 */
import { assertEngineSelect, UnsafeQuery } from './engineSql.js';
import { CHART_TYPES } from './chartSpecs.js';
import { canonicalType } from './chartResolver.js';

/** At most this many charts, however many a model returns. */
export const MAX_COMPOSED = 12;
/** Below this many usable charts, the rule planner tops the deck up. */
export const MIN_COMPOSED = 2;
const MAX_TEXT = 200;

const text = (value, max = MAX_TEXT) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * Every `[bracketed]` name in a query.
 *
 * The prompt requires brackets on every column, which is what makes this
 * checkable: an unbracketed bare word could be a column, a function, a keyword
 * or an alias, and telling them apart means parsing SQL. A bracketed name is
 * unambiguously an identifier — either a column of the table or an alias the
 * query itself defined with AS.
 */
function bracketedNames(sql) {
  return [...String(sql).matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
}

/** The aliases a query introduces, which are legitimate names it may then use. */
function aliasesIn(sql) {
  const out = new Set();
  for (const m of String(sql).matchAll(/\bAS\s+\[([^\]]+)\]/gi)) out.add(m[1]);
  return out;
}

/**
 * Does every column this query names exist?
 *
 * Case and spacing are forgiven for the same reason `acceptPurpose` forgives
 * them — a model reading `Monthly Price USD` sometimes writes `monthly price
 * usd`, and refusing a correct query over punctuation is a worse failure than
 * accepting it. Nothing else is: a name that matches no column and no alias of
 * its own is not a column.
 */
function unknownColumns(sql, columns, table) {
  const key = (n) => String(n).toLowerCase().replace(/[\s_-]+/g, '');
  const known = new Set(columns.map(key));
  // The table's own name is bracketed in `FROM [SalesData]`.
  known.add(key(table));
  for (const alias of aliasesIn(sql)) known.add(key(alias));
  return bracketedNames(sql).filter((name) => !known.has(key(name)));
}

/**
 * Check one chart a model proposed.
 *
 * Returns the spec ready for `executeCharts`, or `{ problem }` saying what was
 * wrong — reported rather than swallowed, because a pass whose failures are
 * invisible cannot be improved.
 */
export function acceptChart(raw, { columns = [], table = 'SalesData', index = 0 } = {}) {
  if (!raw || typeof raw !== 'object') return { problem: 'not an object' };

  const title = text(raw.title);
  if (!title) return { problem: 'no title' };

  if (typeof raw.sql !== 'string' || !raw.sql.trim()) return { problem: `${title}: no query` };
  let sql;
  try {
    sql = assertEngineSelect(raw.sql);
  } catch (error) {
    if (error instanceof UnsafeQuery) return { problem: `${title}: ${error.message}` };
    throw error;
  }

  const invented = unknownColumns(sql, columns, table);
  if (invented.length) {
    return { problem: `${title}: no column called ${invented.slice(0, 3).map((c) => `"${c}"`).join(', ')}` };
  }

  /**
   * The shape, and it has to be a shape this app has.
   *
   * `canonicalType` answers 'bar' for anything it cannot place. That is the
   * right default for a person's typo in the chart picker and the wrong one
   * here: a model asking for a sankey has misunderstood the instruction, and
   * quietly drawing a bar chart under its title hides that from everyone.
   *
   * So the raw name has to be recognised — either a type by its own name, or
   * one of the phrasings `canonicalType` maps to something specific. A name it
   * can only answer 'bar' for, without the word in it, is not a name.
   */
  const named = String(raw.chart_type ?? '').toLowerCase().trim();
  const chartType = CHART_TYPES.includes(named) ? named : canonicalType(named);
  const recognised =
    CHART_TYPES.includes(named) || (chartType !== 'bar' && chartType !== 'auto') || /bar|column/.test(named);
  if (!recognised || !CHART_TYPES.includes(chartType)) {
    return { problem: `${title}: cannot draw a ${raw.chart_type}` };
  }
  // A filter tile is not a finding and is planned separately, from the columns
  // rather than from a query.
  if (chartType === 'slicer') return { problem: `${title}: slicers are not composed` };

  const xAxisKey = text(raw.xAxisKey, 120);
  const yAxisKey = text(raw.yAxisKey, 120);
  if (!xAxisKey || !yAxisKey) return { problem: `${title}: no axes` };

  return {
    chart: {
      id: `composed_${index + 1}`,
      title,
      chart_type: chartType,
      sql,
      xAxisKey,
      yAxisKey,
      secondaryYAxisKey: text(raw.secondaryYAxisKey, 120) || null,
      // What the chart is of, for the deduplicator and the board composer.
      dimension: text(raw.dimension, 120) || xAxisKey,
      // Said before the data was seen, so it carries no numbers and is kept
      // apart from the findings the engine writes from the results.
      intent: text(raw.intent),
      // How this chart got here. The deck shows it, the storyboard records it,
      // and a reader is entitled to know which pass chose their charts.
      composedBy: 'model',
    },
  };
}

/**
 * Check a whole composed deck.
 *
 * Returns `{ charts, skipped }`, or `null` when nothing survived — which the
 * caller reads as "compose nothing" and handles by planning the deck the way it
 * always has.
 */
export function acceptDeck(raw, { columns = [], table = 'SalesData', max = MAX_COMPOSED } = {}) {
  const proposals = Array.isArray(raw) ? raw : Array.isArray(raw?.charts) ? raw.charts : null;
  if (!proposals || !Array.isArray(columns) || columns.length === 0) return null;

  const charts = [];
  const skipped = [];
  const seen = new Set();
  for (const proposal of proposals) {
    if (charts.length >= max) {
      skipped.push(`${text(proposal?.title) || 'a chart'}: only the first ${max} are taken`);
      continue;
    }
    const checked = acceptChart(proposal, { columns, table, index: charts.length });
    if (checked.problem) {
      skipped.push(checked.problem);
      continue;
    }
    // The same query twice is one chart. Compared on the query rather than the
    // title, because two titles for one question is exactly what a model does.
    const fingerprint = checked.chart.sql.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(fingerprint)) {
      skipped.push(`${checked.chart.title}: the same query as an earlier chart`);
      continue;
    }
    seen.add(fingerprint);
    charts.push(checked.chart);
  }

  if (!charts.length) return null;
  return { charts, skipped };
}
