/**
 * A slice of the data, as a query.
 *
 * Clicking "Month-to-month" on one chart and watching the rest of the deck
 * answer for month-to-month customers is the one interaction a dashboard is
 * expected to have. The question is what the sentences under those charts say
 * while it is on, and for this product that decides the whole design.
 *
 * Every headline here is computed from the rows — "Month-to-month has the
 * highest churn rate of any contract type at 51.7%, 2.2× the 23.2% average" is
 * not a caption, it is a reading of the result set. A filter that redrew the
 * bars and left the sentence would not be showing a stale caption; it would be
 * printing a false statement under a true chart. So a filter is not a display
 * mode. It is a narrower table, and everything is computed again over it: the
 * queries, the statistics, the findings, the cards.
 *
 * Which makes the filter itself a query, and this module is where it becomes
 * one. Nothing here filters anything — it turns a list of choices into a WHERE
 * clause and a sentence describing it, so the engine can run the deck's own SQL
 * over a narrower table and the page can say, in words and in SQL, exactly
 * which rows are behind the numbers.
 *
 * Three kinds, because three are what the data offers: some values of a
 * category, a range of a number, a span of dates. Each is checked against the
 * real column list before it is composed, and every value goes through
 * `literal()` on the way in — these strings end up concatenated into SQL, and a
 * category value is the one part of them that came from the data rather than
 * from this file.
 *
 * Pure. No engine, no React, no rows.
 */
import { literal } from './transforms.js';

export const VALUES = 'values';
export const RANGE = 'range';
export const DATES = 'dates';

/** How many values a chip names before it counts them instead. */
const NAMED_VALUES = 2;

/**
 * One filter, checked against the columns that exist.
 *
 * @returns {{ok: true, filter: object}|{ok: false, error: string}}
 */
export function validateFilter(raw, columns = []) {
  const column = String(raw?.column ?? '');
  if (!columns.includes(column)) return { ok: false, error: `There is no column called “${column}”.` };

  switch (raw?.kind) {
    case VALUES: {
      const values = [...new Set((Array.isArray(raw.values) ? raw.values : []).map((v) => String(v)))];
      if (!values.length) return { ok: false, error: 'Choose at least one value.' };
      return { ok: true, filter: { kind: VALUES, column, values } };
    }
    case RANGE: {
      const min = raw.min === '' || raw.min === null || raw.min === undefined ? null : Number(raw.min);
      const max = raw.max === '' || raw.max === null || raw.max === undefined ? null : Number(raw.max);
      if (min === null && max === null) return { ok: false, error: 'Give a lowest or a highest value.' };
      if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) {
        return { ok: false, error: 'A range is made of numbers.' };
      }
      if (min !== null && max !== null && min > max) {
        return { ok: false, error: 'The lowest value is above the highest one.' };
      }
      return { ok: true, filter: { kind: RANGE, column, min, max } };
    }
    case DATES: {
      const from = day(raw.from);
      const to = day(raw.to);
      if (!from && !to) return { ok: false, error: 'Give a date to start from or one to stop at.' };
      if (from && to && from > to) return { ok: false, error: 'The start is after the end.' };
      return { ok: true, filter: { kind: DATES, column, from, to } };
    }
    default:
      return { ok: false, error: `“${raw?.kind}” is not a kind of filter.` };
  }
}

/** A date as the cleaner writes one, or null. */
function day(value) {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

/** The filters that check out, in the order they were given. */
export function validFilters(list = [], columns = []) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const checked = validateFilter(raw, columns);
    if (checked.ok) out.push(checked.filter);
  }
  return out;
}

/**
 * The condition these filters make, or '' for none.
 *
 * Filters on different columns are AND — each one narrows what the last left,
 * which is what a reader who adds a second filter means. Values inside one
 * filter are OR, for the same reason: ticking two regions asks for both, not
 * for the rows that are somehow in each.
 */
export function filterWhere(list = []) {
  const parts = [];
  for (const filter of list) {
    const clause = clauseFor(filter);
    if (clause) parts.push(`(${clause})`);
  }
  return parts.join(' AND ');
}

function clauseFor(filter) {
  const col = `[${filter.column}]`;
  switch (filter.kind) {
    case VALUES:
      return `${col} IN (${filter.values.map((v) => literal(v)).join(', ')})`;
    case RANGE: {
      const bounds = [];
      if (filter.min !== null && filter.min !== undefined) bounds.push(`${col} >= ${literal(filter.min)}`);
      if (filter.max !== null && filter.max !== undefined) bounds.push(`${col} <= ${literal(filter.max)}`);
      return bounds.join(' AND ');
    }
    case DATES: {
      // Compared as text on the first ten characters, so a column of
      // timestamps and a column of dates behave the same way. A date column is
      // ISO by the time it reaches here — that is what the cleaner leaves — and
      // ISO dates sort as text exactly as they sort as dates.
      const dayOf = `SUBSTRING(${col}, 1, 10)`;
      const bounds = [];
      if (filter.from) bounds.push(`${dayOf} >= ${literal(filter.from)}`);
      if (filter.to) bounds.push(`${dayOf} <= ${literal(filter.to)}`);
      return bounds.join(' AND ');
    }
    default:
      return '';
  }
}

/** The whole query a filter set becomes, for showing beside the numbers. */
export function filterSql(list = [], table = 'SalesData') {
  const where = filterWhere(list);
  return where ? `SELECT * FROM ${table} WHERE ${where}` : '';
}

/**
 * One filter as a chip reads it: "Contract Type is Month-to-month".
 *
 * Names the values while there are few enough to read and counts them after
 * that, because a chip listing nine regions is a paragraph.
 */
export function describeFilter(filter, label = null) {
  const name = label || filter.column;
  switch (filter.kind) {
    case VALUES:
      return filter.values.length <= NAMED_VALUES
        ? `${name} is ${filter.values.join(' or ')}`
        : `${name} is any of ${filter.values.length}`;
    case RANGE:
      if (filter.min !== null && filter.max !== null) return `${name} ${filter.min} to ${filter.max}`;
      if (filter.min !== null) return `${name} at least ${filter.min}`;
      return `${name} at most ${filter.max}`;
    case DATES:
      if (filter.from && filter.to) return `${name} ${filter.from} to ${filter.to}`;
      if (filter.from) return `${name} from ${filter.from}`;
      return `${name} up to ${filter.to}`;
    default:
      return name;
  }
}

/** Every filter as one sentence, for a slide or a report that must say so. */
export function describeFilters(list = [], labels = {}) {
  return list.map((f) => describeFilter(f, labels[f.column])).join(', ');
}

/**
 * Turn one click into the filter it means.
 *
 * Clicking the value that is already the whole filter clears it, so the same
 * click that filtered is the click that unfilters — a reader who clicks a bar
 * to see it and clicks it again expects to be back where they were, and a
 * dashboard that needs the chip found and dismissed instead is a dashboard
 * people stop clicking. Clicking a different value on a column already
 * filtered replaces it rather than adding: two clicks on one chart are a change
 * of mind, not a union.
 */
export function toggleValue(list = [], column, value) {
  const text = String(value);
  const existing = list.find((f) => f.column === column && f.kind === VALUES);
  if (!existing) return [...list, { kind: VALUES, column, values: [text] }];
  if (existing.values.length === 1 && existing.values[0] === text) {
    return list.filter((f) => f !== existing);
  }
  return list.map((f) => (f === existing ? { ...f, values: [text] } : f));
}

/** Drop every filter on one column. */
export function clearColumn(list = [], column) {
  return list.filter((f) => f.column !== column);
}

/**
 * What clicking this chart would filter on, or null for a chart that cannot say.
 *
 * A click is only offered where the column behind the axis can be named
 * honestly. Two cases qualify and nothing else does:
 *
 * - the axis IS the column (`SELECT [Region], SUM(...)`), so a bar is one value
 *   of `Region` and clicking it means that value;
 * - the axis is a date bucketed inside the query (`SUBSTRING([Order_Date], 1,
 *   7) AS [Month]`), where the bar is not a value of any column but does name a
 *   span of days, which is a filter this module can write.
 *
 * Everything else — a chart the model wrote over an alias, a cross-tab, a
 * scatter of two measures — gets no click rather than a guessed one. Filtering
 * the wrong column is not a smaller version of filtering the right one; it is a
 * dashboard that answers a question nobody asked, which is the failure this
 * codebase spends most of its comments avoiding.
 */
export function clickTarget(chart, { columns = [], temporal = [] } = {}) {
  const column = chart?.dimension;
  if (!column || !columns.includes(column)) return null;
  const axis = chart?.xAxisKey;
  // A split chart's bars are a category AND a series; one click cannot say
  // which of the two was meant.
  if (chart?.seriesKey) return null;
  if (axis === column) return { column, kind: VALUES };
  if (temporal.includes(column)) return { column, kind: DATES };
  return null;
}

/** The filter one click means, given what the chart is about. */
export function filterFromClick(target, value) {
  if (!target) return null;
  if (target.kind === VALUES) return { kind: VALUES, column: target.column, values: [String(value)] };

  // A bucketed date: "2025-03" is every day in March, "2025" every day in the
  // year. Anything else on a date axis is a day.
  const text = String(value);
  if (/^\d{4}-\d{2}$/.test(text)) return { kind: DATES, column: target.column, from: `${text}-01`, to: endOfMonth(text) };
  if (/^\d{4}$/.test(text)) return { kind: DATES, column: target.column, from: `${text}-01-01`, to: `${text}-12-31` };
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return { kind: DATES, column: target.column, from: text.slice(0, 10), to: text.slice(0, 10) };
  }
  return null;
}

/** The last day of "YYYY-MM", leap years included. */
function endOfMonth(month) {
  const [year, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

/**
 * The same click again, as a change to the list.
 *
 * Clicking the value a chart is already filtered to clears it; see
 * `toggleValue`. A date click replaces whatever span was on that column.
 */
export function applyClick(list = [], target, value) {
  if (!target) return list;
  if (target.kind === VALUES) return toggleValue(list, target.column, value);

  const filter = filterFromClick(target, value);
  if (!filter) return list;
  const existing = list.find((f) => f.column === target.column && f.kind === DATES);
  if (existing && existing.from === filter.from && existing.to === filter.to) {
    return list.filter((f) => f !== existing);
  }
  return [...list.filter((f) => f.column !== target.column), filter];
}

/** Is this value the one a chart is currently filtered to? */
export function isSelected(list = [], column, value) {
  const filter = list.find((f) => f.column === column && f.kind === VALUES);
  return !!filter && filter.values.includes(String(value));
}
