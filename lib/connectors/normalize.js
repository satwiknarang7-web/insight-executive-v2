/**
 * Turning driver output into values the analysis engine can actually use.
 *
 * Postgres has a global type-parser registry, so its conversions live in
 * `pgTypes.js`. MySQL and SQL Server have no such hook, so their rows are
 * normalised after the fact — here, in a plain module with no `server-only`
 * import, so it can be tested rather than inferred.
 *
 * Three conversions, each fixing a bug that shows up as a wrong chart rather
 * than an error:
 *
 * 1. **Dates become ISO strings.** Drivers hand back JS `Date` objects. A Date
 *    survives the trip to the worker, but the CSV and workbook paths both
 *    produce ISO strings, and the axis formatter is written for those. Keeping
 *    one representation means one set of behaviour.
 *
 * 2. **Wide numerics become numbers.** `BIGINT` and `DECIMAL` arrive as strings
 *    so the driver never loses precision. Correct in general, wrong here: the
 *    engine profiles a column as a measure only when its values are numbers, so
 *    a revenue column of strings is treated as a category and never charted.
 *
 * 3. **Binary columns become null.** A `varbinary` or `blob` is not analysable,
 *    and shipping megabytes of it to the browser to be ignored is pure waste.
 */

/** How much of a binary column to keep as a marker. Zero — it is dropped. */
const BINARY_PLACEHOLDER = null;

/** Is this a binary payload rather than a value? */
function isBinary(value) {
  return (
    (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer
  );
}

/**
 * Normalise one value.
 *
 * Deliberately does NOT try to turn arbitrary numeric-looking strings into
 * numbers: an id like `"007"` or a postcode like `"01234"` would lose its
 * leading zeros and stop matching across tables. Numeric conversion is driven
 * by the column's declared type instead — see `normalizeRows`.
 */
export function normalizeValue(value) {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'bigint') {
    // Beyond 2^53 this loses precision, which is the same limit the browser
    // engine works under; a string here would be worse, since it would stop
    // being analysable as a measure at all.
    return Number(value);
  }
  if (isBinary(value)) return BINARY_PLACEHOLDER;

  // mssql surfaces money and some decimals as { value, scale } style objects on
  // certain drivers; anything object-shaped that is not a plain value is JSON
  // rather than something to chart.
  if (typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value.toISOString === 'function') return value.toISOString();
    return value;
  }

  return value;
}

/**
 * Normalise a result set.
 *
 * `numericColumns` names the columns the database *declared* as numeric. Those
 * are the only ones whose string values are converted, which is what keeps
 * `"007"` in a text column intact while a `DECIMAL` revenue column becomes a
 * number.
 */
export function normalizeRows(rows, { numericColumns = null } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const numeric = numericColumns instanceof Set ? numericColumns : new Set(numericColumns || []);

  return rows.map((row) => {
    const out = {};
    for (const key of Object.keys(row)) {
      let value = normalizeValue(row[key]);
      if (numeric.has(key) && typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        if (!Number.isNaN(n)) value = n;
      }
      out[key] = value;
    }
    return out;
  });
}

/**
 * Build the set of numeric column names from a driver's column metadata.
 *
 * `describe` maps a column name to whatever the driver calls its type; the
 * matcher is by name because every driver spells these differently and all of
 * them contain the same handful of words.
 */
const NUMERIC_TYPE_RE = /(int|decimal|numeric|float|real|double|money|number|bigint|smallmoney)/i;

export function numericColumnsFrom(describe) {
  const names = new Set();
  if (!describe) return names;

  const entries = Array.isArray(describe) ? describe : Object.entries(describe);
  for (const entry of entries) {
    // Accepts [name, type], {name, type} and {name, type: {name}}.
    const [name, type] = Array.isArray(entry) ? entry : [entry?.name, entry?.type];
    if (!name) continue;
    const label = typeof type === 'string' ? type : type?.name || type?.declaration || '';
    if (NUMERIC_TYPE_RE.test(String(label))) names.add(name);
  }
  return names;
}
