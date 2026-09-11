/**
 * Whether two rows' values are in the same unit.
 *
 * Every aggregate in this app assumes they are. SUM, AVG, a correlation and a
 * histogram all take values from different rows and combine them, and each is
 * meaningless the moment those rows are denominated differently. The planner
 * has no way to notice: the numbers are numeric, finite and plausibly scaled,
 * and nothing about 219901623082 says Brazilian reais rather than dollars.
 *
 * `Tax_revenue_current_LCU_Value` is the case that motivated this. LCU is the
 * World Bank's "local currency unit" — literally *whichever currency that
 * country uses*. Totalling it across Brazil, China, the United States, the
 * United Kingdom and Greece adds BRL to CNY to USD to GBP to EUR and reports
 * the result as one figure. Grain detection already stops that particular file,
 * because the column repeats once per athlete. It does not stop the same column
 * in a properly shaped country-year panel, where nothing repeats and every
 * aggregate is still a category error.
 *
 * Two things are detectable without looking at a single value:
 *
 *   1. The name says the unit is per-entity — LCU, local currency, national
 *      currency. The denomination is not fixed, by definition of the unit.
 *   2. The table carries its own unit column — `currency`, `uom`, `unit` — and
 *      that column has more than one value in it. Long-format exports do this
 *      constantly, and the unit sitting right there in the row is the strongest
 *      evidence available that the measure column is not homogeneous.
 *
 * Both are conservative: they refuse an aggregate rather than correct one. What
 * that gives up is stated in `detectDenomination` below.
 */

/**
 * Names that mark a value as denominated in whatever unit the row's entity uses.
 *
 * The boundaries are doing real work and must stay: "calculated" contains the
 * letters l-c-u, so an unanchored /lcu/ reads `calculated_value` as a currency
 * and silently withdraws a legitimate column. They are non-alphanumeric rather
 * than [\s_-] because real headers arrive as "Revenue (local currency)" and
 * "GDP, current LCU" as readily as snake_case.
 */
const LOCAL_CURRENCY_RE =
  /(^|[^a-z0-9])(lcu|local[\s_-]?currency|national[\s_-]?currency)([^a-z0-9]|$)/i;

/** Columns that state the unit of some other column in the same row. */
const UNIT_COLUMN_RE = /^(currency|currency[\s_-]?code|ccy|unit|units|uom|unit[\s_-]?of[\s_-]?measure|measure[\s_-]?unit|denomination)$/i;

/** Measures a row-level unit column would be describing. */
const DENOMINABLE_RE = /(revenue|sales|amount|value|spend|spent|price|cost|charge|turnover|gmv|expense|income|debt|budget|payment|salary|wage|fee)/i;

/**
 * Measures whose unit is not fixed across rows.
 *
 * Deliberately strict. A file covering a single country holds one currency, so
 * summing its LCU column would in fact be sound — and this refuses it anyway,
 * because "how many entities does this file cover" is a question about meaning
 * rather than about the column, and guessing it wrong reports a wrong number
 * with confidence. The cost of the strict reading is a lost sum on a
 * single-entity file, recoverable by naming the measure explicitly on
 * /measures. The cost of the loose one is another 1.08e18 on a dashboard.
 *
 * @param {object} profile      from `profileColumns`
 * @param {object} cardinality  distinct counts per column
 * @returns {Object<string, {unit: string, why: string}>} keyed by column
 */
export function detectDenomination({ profile, cardinality = {} } = {}) {
  const measures = profile?.measures || [];
  if (measures.length === 0) return {};

  const out = {};

  // 1. The name carries the unit.
  for (const m of measures) {
    if (LOCAL_CURRENCY_RE.test(m)) {
      out[m] = {
        unit: 'local currency',
        why:
          'counted in each row\'s own local currency, so values from different ' +
          'rows are not the same unit — adding or averaging them mixes currencies',
      };
    }
  }

  // 2. The table states the unit in a column of its own, and it varies.
  const unitColumn = [...(profile?.dimensions || []), ...measures].find(
    (c) => UNIT_COLUMN_RE.test(String(c).trim()) && (cardinality[c] || 0) > 1
  );
  if (unitColumn) {
    for (const m of measures) {
      if (m === unitColumn || out[m]) continue;
      if (!DENOMINABLE_RE.test(m)) continue;
      out[m] = {
        unit: `per-row ${unitColumn}`,
        why:
          `this table carries a ${unitColumn} column holding ${cardinality[unitColumn]} ` +
          'different values, so rows are not in a common unit — combining them ' +
          'across rows would add unlike quantities',
      };
    }
  }

  return out;
}
