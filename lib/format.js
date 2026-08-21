/**
 * Single source of truth for number / label formatting across every chart,
 * tooltip, axis and the PDF report. Previously each renderer re-implemented
 * its own (subtly different) formatter — this unifies them.
 */

const CURRENCY_KEY_RE = /(charge|price|revenue|cost|amount|sales|spend|margin|profit|sum|total|value)/i;

// Format a number into a compact, human-readable string (1.2K, 3.4M, etc.).
// Small integers (counts) are left clean. Non-numbers pass through untouched.
export function formatNumber(val) {
  if (typeof val !== 'number' || !isFinite(val)) return val;
  const abs = Math.abs(val);
  if (Number.isInteger(val) && abs < 1000) return val;
  if (abs >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return (val / 1_000).toFixed(1) + 'K';
  return Number(val.toFixed(2));
}

// Does this column name represent a monetary measure?
export function isCurrencyKey(key) {
  return CURRENCY_KEY_RE.test(String(key || ''));
}

// Format a value, prefixing a currency symbol when the column is monetary.
export function formatValue(val, key) {
  const formatted = formatNumber(val);
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
