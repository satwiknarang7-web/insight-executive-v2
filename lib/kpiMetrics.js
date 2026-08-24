/**
 * Computed KPI cards.
 *
 * A card used to be two text fields, which meant the only way to put a number
 * on the strip was to work it out somewhere else and type it in. A typed number
 * is the one thing on this dashboard that nothing verifies — it does not come
 * from the data, it does not change when the data does, and nobody reading the
 * deck can tell it apart from the four beside it that were computed.
 *
 * So a card can name a metric and a column instead, and the value is the result
 * of a real aggregate over the loaded rows — the same SQL path every chart uses.
 * Typing a value by hand still works; it is just no longer the only option.
 */

/** The aggregates a card can be built from. */
export const KPI_METRICS = [
  { key: 'COUNT', label: 'Count', needsColumn: false },
  { key: 'SUM', label: 'Sum', needsColumn: true },
  { key: 'AVG', label: 'Average', needsColumn: true },
  { key: 'MIN', label: 'Minimum', needsColumn: true },
  { key: 'MAX', label: 'Maximum', needsColumn: true },
];

export const metricLabel = (key) => KPI_METRICS.find((m) => m.key === key)?.label || key;
export const metricNeedsColumn = (key) => !!KPI_METRICS.find((m) => m.key === key)?.needsColumn;

/**
 * The single-value query behind a card.
 *
 * Bracketed identifiers, so a column with a space or a dot in its name (which
 * joined datasets produce routinely) does not break the statement.
 */
export function buildKpiSql({ metric, column } = {}) {
  const def = KPI_METRICS.find((m) => m.key === metric);
  if (!def) return null;
  if (def.needsColumn && !column) return null;

  const expr = def.needsColumn ? `${def.key}([${column}])` : 'COUNT(*)';
  return `SELECT ${expr} AS [Value] FROM SalesData`;
}

/** What a computed card is called before the user renames it. */
export function defaultKpiLabel({ metric, column } = {}) {
  const def = KPI_METRICS.find((m) => m.key === metric);
  if (!def) return '';
  if (!def.needsColumn) return 'Record count';
  return `${def.label} of ${prettyColumn(column)}`;
}

const prettyColumn = (c) => String(c || '').replace(/_/g, ' ').replace(/\./g, ' · ').trim();

/**
 * Read the single value out of a result set.
 *
 * alasql names an unaliased aggregate unpredictably across versions, so the
 * aliased column is preferred and the first value is the fallback rather than
 * the other way round.
 */
export function readKpiValue(rows) {
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row !== 'object') return null;
  const raw = row.Value !== undefined ? row.Value : Object.values(row)[0];
  if (raw === undefined || raw === null) return null;
  // A column with some text in it can average to NaN. Reporting that as the
  // card's value would put "NaN" on the dashboard; refusing it says so instead.
  if (typeof raw === 'number' && !isFinite(raw)) return null;
  return raw;
}

/**
 * Render a computed value the way the generated cards render theirs.
 *
 * Matching `analystPlanner`'s compaction matters: a card reading 75800.42
 * beside three reading 75.8K announces itself as the hand-made one, which is
 * exactly the distinction a computed card exists to remove.
 */
export function formatKpiValue(val) {
  const n = typeof val === 'number' ? val : Number(val);
  if (val === null || val === undefined || val === '' || !isFinite(n)) return String(val ?? '');
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
