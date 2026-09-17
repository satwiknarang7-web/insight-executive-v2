/**
 * The shaping an analyst would do before charting, without a model.
 *
 * `deriveMeasures` already writes the measures a report uses — order value,
 * basket size — from the profile alone, so a deck built with no API key still
 * talks about the business rather than about whichever column held the largest
 * numbers. Shaping had no such path. The only thing proposing a transform was
 * `/api/prepare`, which needs the viewer's own key, so on the deployment as it
 * ships — which holds no key by design — a report never derived a month
 * column, never split a compound field, never banded a number. Measures
 * appeared and steps did not, which reads as the analyst having an opinion
 * about one and not the other rather than as a provider being absent.
 *
 * So this is the same bargain, one layer down: the steps that are defensible
 * from evidence already in the browser. Every rule here answers "what does this
 * column actually contain" with the vocabulary the worker computed, and every
 * step it returns only ADDS a column — `ADDITIVE_KINDS` in transforms.js — so
 * it can go into effect before the charts without changing what any number
 * already meant. Nothing that filters, drops, groups or replaces is proposed
 * here at all: those change what the data says, and a person should be the one
 * saying it.
 *
 * It is deliberately shy. A rule fires on strong, boring evidence or it does
 * not fire, because a wrong column added to every report is worse than a right
 * one missing from some.
 *
 * Pure: takes a profile and a vocabulary, returns proposals. Nothing is planned
 * or executed here — `acceptSteps` validates these against the real column list
 * exactly as it validates a model's.
 */
import { prettyColumn } from './aggregateNames.js';

/** At most this many derived steps, however much the table offers. */
export const MAX_DERIVED = 4;

/** Separators worth splitting a column on, and what each is called. */
const SEPARATORS = [
  { text: ', ', name: 'comma' },
  { text: ' - ', name: 'dash' },
  { text: ' | ', name: 'bar' },
  { text: '/', name: 'slash' },
];

/** How much of a column has to share a shape before it is treated as its shape. */
const CONSISTENT = 0.9;

/** A date with more distinct values than this is finer than monthly. */
const DAILY_ENOUGH = 31;

/** A number with fewer distinct values than this is already a category. */
const CONTINUOUS_ENOUGH = 20;

/**
 * Names that mean the number is a rate, a score or a label rather than a
 * quantity — none of which bands say anything useful about.
 *
 * Matched against the name with its punctuation turned into spaces, because
 * `\b` counts an underscore as a word character: against the raw name
 * `\brate\b` does not match inside `Churn_Rate`, and snake_case is most of
 * what an export is written in.
 */
const NOT_BANDABLE = /(percent|\bpct\b|\brate\b|ratio|\bscore\b|\bindex\b|\bid\b|\byear\b|\bzip\b|postcode|latitude|longitude|\blat\b|\blong?\b)/i;

const spaced = (name) => String(name).replace(/[^a-zA-Z0-9]+/g, ' ').trim();

/**
 * The steps this table justifies.
 *
 * @param {object} context
 * @param {string[]} context.columns    the columns as they are now
 * @param {object}   context.profile    dimensions, measures, temporal, cardinality
 * @param {object}   context.vocabulary the worker's value map, when there is one
 * @returns {object[]} raw step proposals, each with `why`, in the order to apply
 */
export function deriveSteps({ columns = [], profile = null, vocabulary = null } = {}) {
  if (!profile || !columns.length) return [];

  const existing = new Set(columns.map((c) => String(c).toLowerCase()));
  const steps = [];
  const take = (step) => {
    if (steps.length >= MAX_DERIVED) return;
    const names = step.kind === 'split' ? step.into : [step.name];
    if (names.some((n) => existing.has(String(n).toLowerCase()))) return;
    for (const n of names) existing.add(String(n).toLowerCase());
    steps.push(step);
  };

  for (const step of splitSteps(profile, vocabulary)) take(step);
  for (const step of dateSteps(profile, vocabulary)) take(step);
  for (const step of bandSteps(profile, vocabulary)) take(step);

  return steps.slice(0, MAX_DERIVED);
}

/**
 * A column holding two things with a separator between them.
 *
 * "Berlin, DE" is a city and a country, and no chart can group by the country
 * while they share a cell. The evidence has to be overwhelming — nearly every
 * value split by the same separator into the same number of non-empty parts —
 * because a comma in a free-text field is a comma in a sentence.
 */
function splitSteps(profile, vocabulary) {
  const out = [];
  const levels = vocabulary?.dimensions || {};
  const temporal = new Set(profile?.temporal || []);

  for (const column of profile?.dimensions || []) {
    if (temporal.has(column)) continue;
    const values = (levels[column] || []).map((v) => String(v.value));
    // Fewer than four distinct values is a category, not a compound field, and
    // the "parts" would be two halves of one name.
    if (values.length < 4) continue;

    for (const sep of SEPARATORS) {
      const parts = values.map((v) => v.split(sep.text));
      const width = parts[0].length;
      if (width < 2 || width > 3) continue;
      const consistent = parts.filter(
        (p) => p.length === width && p.every((piece) => piece.trim().length > 0)
      ).length;
      if (consistent / values.length < CONSISTENT) continue;

      const label = prettyColumn(column);
      out.push({
        kind: 'split',
        column,
        separator: sep.text,
        into: Array.from({ length: width }, (_, i) => `${label} ${i + 1}`),
        dropOriginal: false,
        why: `Every value of ${column} is ${width} things with a ${sep.name} between them, and nothing can group by the second one while they share a cell.`,
      });
      break;
    }
  }

  return out;
}

/**
 * The parts of a date that are a dimension rather than an axis.
 *
 * A month is the one an analyst writes first, and it is not the same thing as
 * the chart planner bucketing a date axis: a column can be grouped by, put on
 * the rows of a matrix, or split a legend, and a SUBSTRING inside one chart's
 * SQL cannot. Weekday and hour are only proposed when the column carries them —
 * a date with no time in it has no hour, and a month of dates has no weekday
 * worth reading.
 */
function dateSteps(profile, vocabulary) {
  const out = [];
  const cardinality = profile?.cardinality || {};
  const sample = vocabulary?.sample || [];

  for (const column of profile?.temporal || []) {
    const distinct = cardinality[column];
    const values = sample.map((row) => String(row?.[column] ?? '')).filter(Boolean);
    if (!values.length) continue;

    // Daily data grouped by month; monthly data is already by month. More than
    // thirty-one distinct values cannot fit in one month, so the span is not
    // worth re-deriving from a sample — what the sample is for is checking the
    // column really holds dates, since a "temporal" column of "Week 1".."Week
    // 52" would otherwise get a month column holding nothing.
    if (Number.isFinite(distinct) && distinct > DAILY_ENOUGH && lookLikeDates(values)) {
      out.push({
        kind: 'datepart',
        column,
        part: 'year_month',
        name: `${prettyColumn(column)} Month`,
        why: `${column} is daily and covers more than one month, so a month column is what a trend or a breakdown is grouped by.`,
      });
    }

    // An hour only exists if the values carry a time, and only says something
    // if that time is not the same on every row — an export stamped midnight
    // would otherwise get a column holding nothing but zero.
    const times = values.map(timeOf).filter((t) => t !== null);
    if (times.length >= Math.ceil(values.length * CONSISTENT) && new Set(times).size > 1) {
      out.push({
        kind: 'datepart',
        column,
        part: 'hour',
        name: `${prettyColumn(column)} Hour`,
        why: `${column} carries a time of day that varies between rows, which nothing can group by while it is inside the timestamp.`,
      });
    }
  }

  return out;
}

/** The HH part of a timestamp, or null when the value carries no time. */
function timeOf(value) {
  const match = /[T\s](\d{1,2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : null;
}

/** Does this column hold what the cleaner writes a date as? */
function lookLikeDates(values) {
  const dated = values.filter((value) => /^\d{4}-\d{2}-\d{2}/.test(value)).length;
  return dated >= Math.ceil(values.length * CONSISTENT);
}

/**
 * A continuous number banded into a handful of groups.
 *
 * "Average revenue by age" over four hundred distinct ages is four hundred
 * bars; by age band it is four. The edges are taken from the values — the
 * midpoint of each half, around the median — and rounded to something a person
 * would have picked, because a band boundary at 37.428 tells a reader the
 * number came from a machine that did not think about it.
 *
 * Only one column, the widest-spread one: banding every number in the table
 * would add more columns than the table started with.
 */
function bandSteps(profile, vocabulary) {
  const ranges = vocabulary?.measures || {};
  const cardinality = profile?.cardinality || {};

  let best = null;
  for (const column of profile?.measures || []) {
    if (NOT_BANDABLE.test(spaced(column))) continue;
    const distinct = cardinality[column];
    if (Number.isFinite(distinct) && distinct < CONTINUOUS_ENOUGH) continue;
    const range = ranges[column];
    if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) continue;
    // A median at either end means the column is a spike with a tail, and bands
    // cut from it would put every row in one of them.
    const spread = range.max - range.min;
    if (!(spread > 0)) continue;
    const balance = (range.median - range.min) / spread;
    if (balance < 0.15 || balance > 0.85) continue;
    if (!best || spread > best.spread) best = { column, range, spread };
  }
  if (!best) return [];

  const { min, median, max } = best.range;
  const edges = unique([round(min + (median - min) / 2), round(median), round(median + (max - median) / 2)]);
  if (edges.length < 2) return [];

  return [
    {
      kind: 'bucket',
      column: best.column,
      name: `${prettyColumn(best.column)} Band`,
      edges,
      why: `${best.column} is continuous, so a chart broken down by it is one bar per value; bands make it readable.`,
    },
  ];
}

/** A boundary a person would have chosen: 1, 2 or 5 times a power of ten. */
function round(n) {
  if (!Number.isFinite(n) || n === 0) return 0;
  const sign = n < 0 ? -1 : 1;
  const value = Math.abs(n);
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled < 1.5 ? 1 : scaled < 3.5 ? 2 : scaled < 7.5 ? 5 : 10;
  return sign * step * magnitude;
}

/** Ascending, without repeats — two edges that round to the same number are one. */
function unique(list) {
  return [...new Set(list)].sort((a, b) => a - b);
}
