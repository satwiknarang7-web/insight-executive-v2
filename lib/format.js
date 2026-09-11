/**
 * Single source of truth for number / label formatting across every chart,
 * tooltip, axis and the PDF report. Previously each renderer re-implemented
 * its own (subtly different) formatter — this unifies them.
 */

const CURRENCY_KEY_RE = /(charge|price|revenue|cost|amount|sales|spend|margin|profit|sum|total|value)/i;

// Format a number into a compact, human-readable string (1.2K, 3.4M, etc.).
// Small integers (counts) are left clean. Non-numbers pass through untouched.
//
// The scale runs to T and then stops. Past that the suffix ladder is worse than
// useless: it ran only to M once, so a sum of 1.08e18 formatted as
// "1080507215161.0M" — seventeen characters, no readable magnitude, and on a y
// axis sized for "200.0K" the leading digits were simply clipped, leaving every
// tick showing an identical run of zeros. Extending the ladder forever only
// moves that failure (1.08e24 would be "1080507215161.0T"), so above 1e15 the
// honest answer is an exponent, which is bounded in width and states the
// magnitude outright. Anything that large is a unit error or a sum over the
// wrong grain, and a reader is better served seeing "1.08e18" and asking why.
export function formatNumber(val) {
  if (typeof val !== 'number' || !isFinite(val)) return val;
  const abs = Math.abs(val);
  if (Number.isInteger(val) && abs < 1000) return val;
  if (abs >= 1e15) return val.toExponential(2).replace('e+', 'e');
  if (abs >= 1_000_000_000_000) return (val / 1_000_000_000_000).toFixed(1) + 'T';
  if (abs >= 1_000_000_000) return (val / 1_000_000_000).toFixed(1) + 'B';
  if (abs >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return (val / 1_000).toFixed(1) + 'K';
  return Number(val.toFixed(2));
}

/**
 * Does this column name represent a percentage?
 *
 * Checked before currency, and it has to be: `CURRENCY_KEY_RE` matches "cost",
 * so "Shipping Cost Rate" — a percentage of order value — was formatted as a
 * sum of money and drawn on an axis reading 0.6, 1.2, 1.8 with no unit at all.
 * A rate that loses its sign is indistinguishable from a quantity of whatever
 * the column happens to mention.
 */
const PERCENT_KEY_RE = /(\b(share|rate|percent|pct|percentage)\b|%)/i;

/**
 * A percentage, which is never abbreviated.
 *
 * `formatNumber` compacts at a thousand, so a rate came out as "2.3K%" — a
 * suffix for magnitude on a number that cannot usefully have one. Percentages
 * live in a bounded range and want a decimal place, not a scale.
 */
export function formatPercent(val) {
  if (typeof val !== 'number' || !isFinite(val)) return val;
  const abs = Math.abs(val);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${Number(val.toFixed(decimals))}%`;
}

export function isPercentKey(key) {
  return PERCENT_KEY_RE.test(String(key || ''));
}

// Does this column name represent a monetary measure?
export function isCurrencyKey(key) {
  return !isPercentKey(key) && CURRENCY_KEY_RE.test(String(key || ''));
}

// Format a value, prefixing a currency symbol when the column is monetary.
export function formatValue(val, key) {
  // A number that is a label is never abbreviated, wherever it is drawn: a PIN
  // code shown as "505.8K" on a card, in a table cell or in a grid is the same
  // mistake as on a chart axis.
  if (typeof val === 'number' && isIdentifierKey(key)) return String(val);
  const formatted = formatNumber(val);
  if (typeof val === 'number' && isPercentKey(key)) return formatPercent(val);
  if (typeof val === 'number' && isCurrencyKey(key)) return `$${formatted}`;
  return formatted;
}

// Truncate a long categorical axis label with an ellipsis.
// NOTE: takes ONLY the tick value. Recharts invokes tickFormatter as
// (value, index); accepting a second positional arg here would let that index
// clobber the max length and collapse every label to "…".
const MAX_TICK_LABEL = 16;
export function truncateLabel(tick) {
  if (typeof tick !== 'string') return tick;
  return tick.length > MAX_TICK_LABEL ? `${tick.slice(0, MAX_TICK_LABEL - 1)}…` : tick;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Render ISO dates/months/years as compact, human-readable text, leaving
// everything else untouched. Split out from `formatAxisLabel` so a caller that
// sizes its own axis gutter can get the date handling WITHOUT the 16-character
// truncation — that truncation is what was hiding long category names.
export function formatDateLabel(value) {
  if (typeof value !== 'string') return value;
  let m = value.match(/^(\d{4})-(\d{2})$/); // month bucket: 2025-07
  if (m) return `${MONTHS[+m[2] - 1] || m[2]} '${m[1].slice(2)}`;
  m = value.match(/^(\d{4})-(\d{2})-(\d{2})/); // full date / datetime
  if (m) return `${MONTHS[+m[2] - 1] || m[2]} ${+m[3]}`;
  return value; // includes bare years
}

// Format an axis/tooltip label, rendering ISO dates/months/years as compact,
// human-readable text (and otherwise truncating). Used for any X axis so a
// `date` column shows "Jul 26" / "Jul '25" instead of "2025-07-26T00:00:00…".
// Single-arg by design (recharts passes an index as the 2nd arg).
export function formatAxisLabel(value) {
  const formatted = formatDateLabel(value);
  return typeof formatted === 'string' ? truncateLabel(formatted) : formatted;
}

/**
 * A value as it is, for a table of rows rather than a summary of them.
 *
 * `formatNumber` abbreviates, which is right on a card and wrong in a data
 * table: a PIN code of 505800 was displayed as "505.8K", which is not a
 * shorter way of writing that postal code, it is a different thing. A table's
 * job is to show what is in the cell.
 *
 * Identifiers keep their digits unseparated — a postal code, an order number
 * or a year with a comma in it reads as a quantity, which is exactly the
 * mistake being fixed. Everything else gets thousands separators and keeps its
 * decimals.
 */
export function formatExact(val, key = '') {
  if (typeof val !== 'number' || !Number.isFinite(val)) return val;
  if (isIdentifierKey(key)) return String(val);
  // A fixed locale, not the machine's. The same export opened on two laptops
  // otherwise groups its digits two different ways, and a saved analysis is
  // meant to read identically wherever it is opened.
  if (Number.isInteger(val)) return val.toLocaleString('en-US');
  return val.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

/**
 * Column names whose numbers are labels rather than amounts.
 *
 * Kept here rather than imported from the chart layer because formatting is
 * needed in places that have no business loading the planner, and because this
 * list is about how a value should be *written* — postal codes and years are
 * not identifiers to a chart, but they are to a comma.
 */
const IDENTIFIER_KEY_RE = new RegExp(
  [
    '\\bid$', // customer id, order id
    '^id\\b', // id, id number
    '\\bcode$', // pincode, zip code, product code
    '\\bzip\\b',
    '\\bpostal\\b',
    '\\bpin ?code\\b',
    '\\bguid\\b',
    '\\buuid\\b',
    '\\bnumber$',
    '\\bno$',
    '\\bphone\\b',
    '\\bserial\\b',
    '\\byear$', // a year with a comma in it reads as a quantity
    '\\baccount\\b',
    '\\binvoice\\b',
  ].join('|'),
  'i'
);

/**
 * Word boundaries throughout, deliberately.
 *
 * A bare `id$` also matches "paid", "valid" and "grid", so a column called
 * `Total_Paid` would stop being formatted as money — a worse bug than the one
 * being fixed, and a quieter one. Every name here is matched as a whole word
 * against a column name whose separators have been normalised, so
 * `customer_id`, `customerID` and `Customer ID` are one name and `Paid` is not
 * among them.
 */
export function isIdentifierKey(key) {
  const name = String(key || '')
    // Split camelCase first, so `customerID` becomes `customer ID`.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[\s_-]+/g, ' ')
    .trim();
  return IDENTIFIER_KEY_RE.test(name);
}
