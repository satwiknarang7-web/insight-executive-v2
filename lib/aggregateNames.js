/**
 * What a computed column is called.
 *
 * This exists because of a bug report that was not a bug. A chart summing
 * `billed_artist_count` by `is_collaboration` returned 46 and put it on screen
 * under the single word **Total** — as the axis title, and as the only label in
 * the tooltip. Checked against Power BI, which was showing *Count of
 * billed_artist_count* = 23, our number looked like double counting. It was
 * not: 23 collaborations billed to two artists each is 46, and both figures
 * were right. Nothing on our chart said which one it was.
 *
 * A number nobody can identify cannot be checked, and a product whose whole
 * claim is "every figure traces back to a query you can read" cannot afford a
 * figure that reads as whatever the viewer assumes. So an aggregate is named
 * after the operation *and* the column it was applied to, everywhere, by this
 * one function — the planner that generates charts and the dialog that builds
 * them by hand both call it, so the two can never drift into different
 * conventions and mean different things by "Total".
 *
 * Pure: no imports, no side effects.
 */

/** The word for each aggregate, as a person would say it. */
export const AGGREGATE_LABELS = {
  SUM: 'Total',
  AVG: 'Average',
  COUNT: 'Count',
  MAX: 'Maximum',
  MIN: 'Minimum',
};

export const AGGREGATE_KEYS = Object.keys(AGGREGATE_LABELS);

export function aggregateLabel(key) {
  return AGGREGATE_LABELS[String(key || '').toUpperCase()] || key;
}

/**
 * Column names read as prose: `unit_price` -> `Unit Price`, `dailyStreams` ->
 * `Daily Streams`, a joined `Orders.region` -> `Orders · Region`.
 *
 * The one implementation. There were three, differing in which of those rules
 * they applied, so an alias could be built as "Total DailyStreams" and then
 * rendered on the axis as "Daily Streams" — two names for one number, which is
 * exactly what this module exists to prevent.
 */
export function prettyColumn(name) {
  return String(name ?? '')
    .replace(/_/g, ' ')
    .replace(/\./g, ' · ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** What a counted-rows column is called. Not "Count", which says count of what. */
export const RECORD_COUNT = 'Record Count';

/**
 * The name for one aggregated column.
 *
 * `aggregateAlias('SUM', 'billed_artist_count')` is `Total Billed Artist Count`
 * — which is the whole point: read off an axis or out of a tooltip it says
 * exactly which figure it is, and can be compared against the same figure
 * computed anywhere else.
 *
 * A count with no column is a count of rows, and says so.
 */
export function aggregateAlias(aggregate, column = null) {
  const agg = String(aggregate || '').toUpperCase();
  if (agg === 'COUNT' && !column) return RECORD_COUNT;
  if (!column) return aggregateLabel(agg);

  const name = prettyColumn(column);
  // "Count of Distinct Customer" reads better than "Count Customer".
  if (agg === 'COUNT') return `Count of ${name}`;

  const label = aggregateLabel(agg);
  // A column already called `Total_Amount` does not become "Total Total Amount"
  // when summed. The word is the same word, and repeating it reads as a bug to
  // anyone looking at the axis — which, on a report, it effectively is.
  if (name.toLowerCase() === label.toLowerCase()
      || name.toLowerCase().startsWith(label.toLowerCase() + ' ')) return name;
  return `${label} ${name}`;
}

/**
 * The title for a chart of one or more aggregates broken out by dimensions.
 *
 * Reads in the order a person says it — "Total Revenue by Region", not "Region
 * by Revenue", which was the old shape and left the reader to work out which
 * of the two names was the thing being measured.
 */
export function aggregateTitle(aliases, dimensions = []) {
  const measured = (Array.isArray(aliases) ? aliases : [aliases]).filter(Boolean).join(' and ');
  const by = (dimensions || []).filter(Boolean).map(prettyColumn);
  if (!by.length) return measured;
  if (by.length === 1) return `${measured} by ${by[0]}`;
  return `${measured} by ${by[0]} and ${by[1]}`;
}
