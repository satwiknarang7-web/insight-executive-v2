/**
 * How Postgres values are turned into JavaScript ones.
 *
 * Kept out of the driver so it can be tested without pulling in `server-only`,
 * and because these are analysis decisions rather than connection plumbing.
 *
 * Two defaults are overridden, both for reasons that show up as wrong charts
 * rather than as errors:
 *
 * 1. `bigint` and `numeric` arrive as STRINGS, so the driver never silently
 *    loses precision. Correct for a general driver, wrong here: the analysis
 *    engine treats a column as a measure only when its values are numbers, so
 *    a revenue column of strings is profiled as a category and never charted.
 *    Converting accepts a double's precision — the same limit the browser
 *    engine works under anyway.
 *
 * 2. `date` arrives as a JS Date built at LOCAL midnight. On a server west of
 *    UTC, `2026-01-15` becomes `2026-01-14T18:30:00Z` — every date in the
 *    dataset silently shifts a day, and a "sales by day" chart is wrong by one
 *    everywhere. Keeping the string avoids the timezone entirely and matches
 *    what the CSV and workbook paths already produce.
 */

/** Postgres type OIDs. Stable across versions — they are baked into the catalog. */
export const OID = {
  INT8: 20,
  FLOAT4: 700,
  FLOAT8: 701,
  NUMERIC: 1700,
  DATE: 1082,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
};

/** Wide numeric types that must become numbers to be analysable. */
export const NUMERIC_OIDS = [OID.INT8, OID.NUMERIC, OID.FLOAT4, OID.FLOAT8];
/** Temporal types that must stay strings to avoid a timezone shift. */
export const TEMPORAL_OIDS = [OID.DATE, OID.TIMESTAMP, OID.TIMESTAMPTZ];

/** Parse a wide numeric, preserving null. */
export function parseNumeric(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isNaN(n) ? value : n;
}

/** Leave temporal values exactly as Postgres rendered them. */
export function parseTemporal(value) {
  return value;
}

/**
 * Apply both overrides to a `pg.types`-shaped object.
 *
 * Takes the types object rather than importing `pg`, so a test can hand it a
 * plain stand-in and assert what was registered.
 */
export function configureTypeParsers(types) {
  for (const oid of NUMERIC_OIDS) types.setTypeParser(oid, parseNumeric);
  for (const oid of TEMPORAL_OIDS) types.setTypeParser(oid, parseTemporal);
  return types;
}
