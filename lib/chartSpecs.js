/**
 * What each chart type actually needs before it can be built.
 *
 * Every hand-built chart used to be composed the same way — one dimension, one
 * aggregate, one measure — whatever type was chosen. That is the right shape for
 * a bar chart and the wrong shape for most of the others: a matrix is a
 * cross-tab and needs two categories, a combo chart needs two measures, a bubble
 * needs three, and a map needs a column of place names rather than any category
 * at all. Asking for one field and then rendering something that wanted three
 * produced a chart that was technically drawn and factually empty — a matrix
 * with a single column, a bubble that quietly degraded to a scatter.
 *
 * So the requirements are declared here, per type, and the builder composes the
 * SQL from whatever that type asked for. The dialog renders the fields; this
 * module decides what they are. Keeping the two apart is what makes the rules
 * testable without a browser.
 *
 * Pure: no React, no engine, no side effects.
 */
import { compileMeasure } from './measures.js';
import { AGGREGATE_KEYS, aggregateAlias, aggregateLabel, aggregateTitle, prettyColumn } from './aggregateNames.js';

/** The table the worker mounts the cleaned rows as. */
const TABLE = 'SalesData';

export const AGGREGATES = AGGREGATE_KEYS.map((key) => ({ key, label: aggregateLabel(key) }));

export { aggregateLabel };

/** Column names read as prose. Shared with the planner so both name things alike. */
export const pretty = prettyColumn;

/**
 * Does this column name suggest a place?
 *
 * Only a hint, used to pre-select a sensible column for a map and to warn when
 * the chosen one looks like something else. The map itself is the authority: it
 * reports how many names it actually matched to a boundary.
 */
export function looksGeographic(name) {
  return /(country|countries|nation|region|state|province|territory|market|geo|location|place|city)/i.test(
    String(name || '')
  );
}

// ---------------------------------------------------------------------------
// Row limits
// ---------------------------------------------------------------------------

const TOP_N = { label: 'Show top', options: [5, 10, 15, 20, 30], preset: 10 };
// Two dimensions multiply out, so the same "10" would be two or three rows of a
// grid rather than ten of them.
const GRID_N = { label: 'Show up to', options: [25, 50, 100, 200], preset: 50 };
// A correlation needs enough points to be a cloud rather than a handful of dots.
const CLOUD_N = { label: 'Show up to', options: [20, 50, 100, 200], preset: 50 };
// A radar is unreadable past a dozen spokes, and needs at least three.
const SPOKE_N = { label: 'Show top', options: [3, 5, 6, 8, 12], preset: 6 };

const fmtRows = (n) => `${n} rows`;
export const limitFormat = fmtRows;

// ---------------------------------------------------------------------------
// The requirements themselves
// ---------------------------------------------------------------------------

/**
 * How the rows of a ranked chart may be ordered.
 *
 * There used to be no choice: `orderClause` sorted by the measure, descending,
 * for everything that was not an ordered axis. That is the right default for a
 * ranking and wrong for a funnel, whose own description asked for the stages in
 * the order the process runs and then sorted them by size — a funnel sorted by
 * size is a bar chart with sloped edges. Nothing can infer process order from a
 * column of names, but a person can pick the order their stage names already
 * carry, so the choice is offered rather than guessed.
 */
export const SORTS = [
  { key: 'value-desc', label: 'Largest first' },
  { key: 'value-asc', label: 'Smallest first' },
  { key: 'category-asc', label: 'Category A → Z' },
  { key: 'category-desc', label: 'Category Z → A' },
];
const SORT_KEYS = new Set(SORTS.map((s) => s.key));

/**
 * How a date axis is grouped.
 *
 * Without this the builder grouped by every distinct date and then took the
 * first N of them, so a "trend" over a 250,000-row export was the first ten
 * days in the file. The planner has always bucketed — this is the same
 * SUBSTRING it uses, offered as a choice with the planner's own rule as the
 * default.
 */
export const BUCKETS = [
  { key: 'auto', label: 'Automatic' },
  { key: 'day', label: 'By day' },
  { key: 'month', label: 'By month' },
  { key: 'year', label: 'By year' },
];
const BUCKET_KEYS = new Set(BUCKETS.map((b) => b.key));

/** Is this column a date the builder knows how to bucket? */
export function bucketableColumn(column, context = {}) {
  if (!column) return false;
  const temporal = context.profile?.temporal || [];
  if (temporal.includes(column)) return true;
  const value = String(context.sample?.find((r) => r?.[column])?.[column] ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(value);
}

/**
 * The SQL for a bucketed date, and the name it comes back under.
 *
 * `auto` follows the planner: months, unless the column spans so many distinct
 * days that a monthly axis would still be unreadable, in which case years.
 */
function bucketExpression(column, bucket, context) {
  const chosen = BUCKET_KEYS.has(bucket) ? bucket : 'auto';
  if (chosen === 'day' || !bucketableColumn(column, context)) return null;

  let width = chosen;
  if (chosen === 'auto') {
    const distinct = context.profile?.cardinality?.[column] || 0;
    width = distinct > 750 ? 'year' : 'month';
  }
  const chars = width === 'year' ? 4 : 7;
  return { expr: `SUBSTRING([${column}], 1, ${chars})`, alias: width === 'year' ? 'Year' : 'Month' };
}

const dim = (key, label, extra = {}) => ({ key, label, ...extra });
const val = (key, label, extra = {}) => ({ key, label, ...extra });

const ONE_DIM = [dim('dimension', 'Group by')];

/**
 * The legend well: a second category that splits one measure into series.
 *
 * Optional, the way Power BI's is. Left empty the chart is what it always was —
 * one bar per category. Filled, each category is broken into one bar or line
 * per value of this column, which is the difference between "revenue by
 * category" and "revenue by category, by region", and the only way to see a mix
 * shift rather than a total.
 */
const LEGEND = dim('series', 'Legend', {
  optional: true,
  help: 'Optional. Splits each category into one series per value.',
});

// A legend is only honest while the eye can still tell the series apart.
const MAX_SERIES = 12;
const ONE_MEASURE = [val('measure', 'Measure')];

/** A plain "category on the x axis, measure on the y" chart. */
const ranked = (label, blurb, over = {}) => ({
  label,
  blurb,
  dimensions: ONE_DIM,
  measures: ONE_MEASURE,
  limit: TOP_N,
  // A ranking is the one shape where the order is a choice rather than a
  // property of the axis. `ordered` types override this to false below.
  sortable: true,
  ...over,
});

/** A map: same shape as a bar, but the category has to be somewhere real. */
const map = (label, blurb) => ({
  label,
  blurb,
  dimensions: [
    dim('dimension', 'Region column', {
      prefer: 'geo',
      help: 'Country names. They are matched against a bundled boundary file, and the map reports any it could not place.',
    }),
  ],
  measures: [val('measure', 'Measure', { help: 'What shades the region.' })],
  limit: GRID_N,
});

const REQUIREMENTS = {
  bar: ranked('column (vertical)', 'One bar per category, ordered by size.', {
    dimensions: [...ONE_DIM, LEGEND],
  }),
  hbar: ranked(
    'bar (horizontal)',
    'The same comparison, sideways — the better choice when the category names are long.',
    { dimensions: [...ONE_DIM, LEGEND] }
  ),
  table: ranked('table', 'The result rows, as rows.'),
  funnel: ranked(
    'funnel',
    'Stages that shrink. Largest first by default — if your stage names carry ' +
      'the order the process runs, sort by category instead.',
    { dimensions: [dim('dimension', 'Stage')], limit: SPOKE_N }
  ),
  waterfall: ranked(
    'waterfall',
    'How a running total is built up. Needs an ordered x axis — a period, or a sequence of steps.',
    { dimensions: [dim('dimension', 'Step', { prefer: 'time' })], ordered: true, sortable: false }
  ),
  line: ranked('line', 'A measure along an ordered axis. Pick a date or period column.', {
    dimensions: [dim('dimension', 'Period', { prefer: 'time' }), LEGEND],
    ordered: true,
    sortable: false,
  }),
  area: ranked('area', 'A trend with the volume underneath it filled in.', {
    dimensions: [dim('dimension', 'Period', { prefer: 'time' }), LEGEND],
    ordered: true,
    sortable: false,
  }),
  pie: ranked('pie', 'Share of a whole. Only honest when the parts really do add up to one total.'),
  donut: ranked('donut', 'Share of a whole, with the total in the middle.'),
  treemap: ranked('treemap', 'Share of a whole as nested area — better than a pie past a few categories.'),
  radial: ranked('radial bar', 'A few categories as concentric arcs.', { limit: SPOKE_N }),
  gauge: ranked(
    'gauge',
    'The leading category against the total of all of them. The first row is the needle; the rest set the scale.'
  ),
  multicard: ranked('multi-row card', 'A short list of values, as numbers rather than as a chart.'),

  card: {
    label: 'card',
    blurb: 'One number for the whole dataset. Nothing to group by.',
    dimensions: [],
    measures: [val('measure', 'Measure')],
    limit: null,
  },
  kpi: {
    label: 'KPI',
    blurb: 'One number, shown against the average of the series behind it.',
    dimensions: [],
    measures: [val('measure', 'Measure')],
    limit: null,
  },

  matrix: {
    label: 'matrix (cross-tab)',
    blurb: 'A grid: one category down the side, a second across the top, a measure in the cells.',
    dimensions: [
      dim('dimension', 'Rows', { help: 'The category down the left-hand side.' }),
      dim('dimension2', 'Columns', { help: 'A second, different category, across the top.' }),
    ],
    measures: [val('measure', 'Cell value')],
    limit: GRID_N,
  },
  ribbon: {
    label: 'ribbon',
    blurb: 'Which category leads in each period, and when the lead changes hands.',
    dimensions: [
      dim('dimension', 'Period', { prefer: 'time', help: 'The axis the ribbon runs along.' }),
      dim('dimension2', 'Category', { help: 'What is ranked within each period.' }),
    ],
    measures: [val('measure', 'Measure')],
    limit: GRID_N,
    ordered: true,
  },

  composed: {
    label: 'combo (line + column)',
    blurb: 'Two measures on one axis — columns for the first, a line for the second.',
    dimensions: ONE_DIM,
    measures: [
      val('measure', 'Columns', { help: 'Drawn as bars.' }),
      val('measure2', 'Line', { help: 'Drawn as a line over them. Often an average or a rate.' }),
    ],
    limit: TOP_N,
  },
  scatter: {
    label: 'scatter',
    blurb: 'Two measures against each other, one point per category — for seeing whether they move together.',
    dimensions: [dim('dimension', 'One point per', { help: 'Each value of this column becomes a point.' })],
    measures: [val('measure', 'X axis'), val('measure2', 'Y axis')],
    limit: CLOUD_N,
  },
  bubble: {
    label: 'bubble',
    blurb: 'A scatter with a third measure as the size of each point.',
    dimensions: [dim('dimension', 'One bubble per')],
    measures: [
      val('measure', 'X axis'),
      val('measure2', 'Y axis'),
      val('measure3', 'Bubble size', { help: 'Area, not radius — so it is not read as twice as big.' }),
    ],
    limit: CLOUD_N,
  },
  radar: {
    label: 'radar',
    blurb: 'A few categories scored on three measures at once.',
    dimensions: [dim('dimension', 'Group by')],
    measures: [
      val('measure', 'First measure'),
      val('measure2', 'Second measure'),
      val('measure3', 'Third measure'),
    ],
    limit: SPOKE_N,
  },

  filledmap: map('filled map', 'Regions shaded by value.'),
  bubblemap: map('bubble map', 'A circle over each region, sized by value.'),
  shapemap: map(
    'shape map',
    'Only the regions in the data are drawn, fitted to the frame — a relative comparison rather than a world map.'
  ),
};

/** Every type the builder can produce, grouped the way the picker shows them. */
export const CHART_TYPE_GROUPS = [
  { label: 'Compare', types: ['bar', 'hbar', 'funnel', 'waterfall', 'table'] },
  { label: 'Over time', types: ['line', 'area', 'ribbon'] },
  { label: 'Share of a whole', types: ['pie', 'donut', 'treemap', 'radial'] },
  { label: 'Relationships', types: ['scatter', 'bubble', 'composed', 'radar'] },
  { label: 'Numbers', types: ['card', 'kpi', 'gauge', 'multicard'] },
  { label: 'Grid', types: ['matrix'] },
  { label: 'Maps', types: ['filledmap', 'bubblemap', 'shapemap'] },
];

export const CHART_TYPES = CHART_TYPE_GROUPS.flatMap((g) => g.types);

/** The requirement for one type. Unknown types are treated as a bar. */
export function chartRequirement(type) {
  return REQUIREMENTS[type] || REQUIREMENTS.bar;
}

export function chartTypeLabel(type) {
  return chartRequirement(type).label || type;
}

/** How many distinct categories and measures a type asks for. */
export function chartArity(type) {
  const req = chartRequirement(type);
  // What the chart needs, not what it accepts: an optional well left empty is
  // still a complete chart, and callers use this to decide what to ask for.
  return {
    dimensions: req.dimensions.filter((slot) => !slot.optional).length,
    measures: req.measures.filter((slot) => !slot.optional).length,
  };
}

// ---------------------------------------------------------------------------
// Building the query
// ---------------------------------------------------------------------------

const fail = (error) => ({ spec: null, error });

/** Strip what would break a bracketed SQL alias, and never return an empty one. */
const cleanAlias = (name) => String(name || 'Value').replace(/[[\]]/g, '').trim() || 'Value';

/** Two measures can produce the same natural name; the chart needs two columns. */
function uniqueAlias(base, taken) {
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 50; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base} ${taken.length + 1}`;
}

/**
 * One measure slot as SQL.
 *
 * A saved measure and an aggregate-plus-column are the same kind of answer to
 * the same question, so both come back in the same shape and the caller does not
 * have to know which it got.
 */
export function measureExpression(selection, context = {}) {
  if (!selection) return { error: 'Choose a measure.' };

  if (selection.measureId) {
    const saved = (context.measures || []).find((m) => m.id === selection.measureId);
    if (!saved) return { error: 'That saved measure no longer exists.' };
    const compiled = compileMeasure(saved, {
      columns: context.columns || [],
      measures: context.measures || [],
    });
    if (!compiled.ok) return { error: compiled.error };
    return { expr: compiled.expr, filter: compiled.filter || null, alias: cleanAlias(saved.name) };
  }

  const aggregate = selection.aggregate || 'COUNT';
  if (aggregate === 'COUNT') return { expr: 'COUNT(*)', filter: null, alias: aggregateAlias('COUNT') };
  if (!AGGREGATE_KEYS.includes(aggregate)) return { error: `${aggregate} is not an aggregate.` };
  if (!selection.column) return { error: 'Choose the column to measure.' };

  return {
    expr: `${aggregate}([${selection.column}])`,
    filter: null,
    alias: cleanAlias(aggregateAlias(aggregate, selection.column)),
  };
}

/** The title an analyst would give this chart. */
function titleFor(type, dimCols, aliases) {
  return aggregateTitle(aliases, dimCols);
}

/**
 * ORDER BY, which is not the same question for every chart.
 *
 * A ranking wants the biggest first; anything drawn along an axis wants the axis
 * in its own order, because "the top 10 months by revenue" is not a trend line —
 * it is ten disconnected months sorted by size and then drawn as if they ran on.
 */
function orderClause(req, dimCols, aliases, sort, seriesCol = null) {
  const tail = seriesCol ? `, [${seriesCol}] ASC` : '';
  if (req.ordered && dimCols.length) {
    const secondary = dimCols.length > 1 ? `, [${aliases[0]}] DESC` : '';
    return ` ORDER BY [${dimCols[0]}] ASC${secondary}${tail}`;
  }
  if (!aliases.length && !dimCols.length) return '';

  const chosen = SORT_KEYS.has(sort) ? sort : 'value-desc';
  if (chosen.startsWith('category') && dimCols.length) {
    return ` ORDER BY [${dimCols[0]}] ${chosen === 'category-asc' ? 'ASC' : 'DESC'}${tail}`;
  }
  if (!aliases.length) return '';
  return ` ORDER BY [${aliases[0]}] ${chosen === 'value-asc' ? 'ASC' : 'DESC'}${tail}`;
}

/**
 * Which result column each axis of the finished chart points at.
 *
 * `secondaryYAxisKey` carries whatever the type needs beyond x and y: a second
 * measure for a combo chart, a bubble's size, or — for the two types that read a
 * second *category* — the column that becomes the matrix's headings or the
 * ribbon's series. That is the field the renderer already looks in, so a chart
 * built here needs no special case downstream.
 */
function axesFor(type, dimCols, aliases) {
  switch (type) {
    case 'scatter':
      return { xAxisKey: aliases[0], yAxisKey: aliases[1], secondaryYAxisKey: null };
    case 'bubble':
      return { xAxisKey: aliases[0], yAxisKey: aliases[1], secondaryYAxisKey: aliases[2] || null };
    case 'matrix':
    case 'ribbon':
      return { xAxisKey: dimCols[0], yAxisKey: aliases[0], secondaryYAxisKey: dimCols[1] || null };
    default:
      return {
        xAxisKey: dimCols[0] || aliases[0],
        yAxisKey: aliases[0],
        secondaryYAxisKey: aliases[1] || null,
      };
  }
}

/**
 * Compose a runnable chart spec from the choices a person made in the dialog.
 *
 * Returns `{ spec, error }` — never throws — so a half-filled form renders its
 * own explanation rather than blowing up the dialog.
 */
export function buildChartSpec(
  { type = 'bar', dims = {}, vals = {}, limit = null, sort = 'value-desc', bucket = 'auto' } = {},
  context = {}
) {
  const req = chartRequirement(type);

  const dimCols = [];
  const dimSelects = [];
  let bucketed = null;
  let seriesCol = null;
  for (const slot of req.dimensions) {
    const column = dims[slot.key];

    // An optional well left empty is not an error — it is the chart without
    // that feature, which is the whole point of it being optional.
    if (!column && slot.optional) continue;
    if (!column) return fail(`Choose a column for ${slot.label.toLowerCase()}.`);
    if (dimCols.includes(column)) {
      return fail(
        slot.optional
          ? 'The legend has to be a different column from the one on the axis.'
          : 'A chart with two categories needs two different columns.'
      );
    }
    if (slot.optional) {
      const levels = context.profile?.cardinality?.[column] || 0;
      if (levels > MAX_SERIES) {
        return fail(
          `“${pretty(column)}” has ${levels} values — too many to tell apart as series. ` +
            `A legend works up to about ${MAX_SERIES}.`
        );
      }
      seriesCol = column;
    }

    // A date axis is grouped by month or year rather than by the individual
    // day, so a trend is a trend and not a list of timestamps.
    const grouped =
      !slot.optional && (slot.prefer === 'time' || req.ordered)
        ? bucketExpression(column, bucket, context)
        : null;
    if (grouped) {
      bucketed = grouped;
      dimCols.push(grouped.alias);
      dimSelects.push(`${grouped.expr} AS [${grouped.alias}]`);
    } else {
      dimCols.push(column);
      dimSelects.push(`[${column}]`);
    }
  }

  const aliases = [];
  const selects = [];
  const filters = [];
  for (const slot of req.measures) {
    const built = measureExpression(vals[slot.key], context);
    if (built.error) return fail(`${slot.label}: ${built.error}`);
    const alias = uniqueAlias(built.alias, aliases);
    aliases.push(alias);
    selects.push(`${built.expr} AS [${alias}]`);
    if (built.filter) filters.push(built.filter);
  }

  // A measure can carry its own filter. Two measures carrying different ones
  // cannot share a single WHERE, and silently applying only the first would put
  // a number on screen that is not the measure the user picked.
  const distinctFilters = [...new Set(filters)];
  if (distinctFilters.length > 1) {
    return fail('Those measures filter the rows differently, so they cannot share one chart.');
  }

  const where = distinctFilters.length ? ` WHERE ${distinctFilters[0]}` : '';
  const groupBy = dimSelects.length
    ? ` GROUP BY ${dimSelects.map((sel, i) => (bucketed && i === 0 ? bucketed.expr : `[${dimCols[i]}]`)).join(', ')}`
    : '';
  const axisCols = seriesCol ? dimCols.filter((c) => c !== seriesCol) : dimCols;
  const order = dimCols.length
    ? seriesCol
      ? ` ORDER BY [${axisCols[0]}] ASC, [${seriesCol}] ASC`
      : orderClause(req, axisCols, aliases, sort, seriesCol)
    : '';

  // A bucketed date axis is the whole series, not a top ten. Cutting it to the
  // first N buckets is what turned a multi-year trend into its opening days.
  // A split chart's rows are category x series pairs, so a top-ten row limit
  // would cut categories at an arbitrary point in the middle of a series. The
  // legend is capped instead, above.
  const wholeSeries =
    !!seriesCol ||
    (axisCols.length === 1 &&
      (!!bucketed || (req.ordered && bucketableColumn(dims[req.dimensions[0].key], context))));
  const rows = Number(limit) || req.limit?.preset || 0;
  const limitClause = req.limit && rows > 0 && !wholeSeries ? ` LIMIT ${rows}` : '';
  const columns = [...dimSelects, ...selects].join(', ');

  return {
    error: null,
    spec: {
      sql: `SELECT ${columns} FROM ${TABLE}${where}${groupBy}${order}${limitClause}`,
      chart_type: type,
      title: titleFor(type, dimCols, aliases),
      ...axesFor(type, axisCols, aliases),
      seriesKey: seriesCol,
      // Carried so the chart can put a split chart's categories in the order
      // that was asked for — which can only be done once the category x series
      // rows have been folded back into one row per category.
      seriesSort: seriesCol ? (SORT_KEYS.has(sort) ? sort : 'value-desc') : null,
    },
  };
}
