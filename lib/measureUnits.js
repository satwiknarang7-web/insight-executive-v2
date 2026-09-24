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
export const LOCAL_CURRENCY_RE =
  /(^|[^a-z0-9])(lcu|local[\s_-]?currency|national[\s_-]?currency)([^a-z0-9]|$)/i;
import { extent } from './extent.js';

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
/**
 * How far apart two groups' typical values have to be before they are not one
 * quantity.
 *
 * Three orders of magnitude. Revenue differs between a grocery aisle and an
 * electronics aisle by a factor of a few; it does not differ by a thousand.
 * What does is a column holding several different things — a GDP beside a life
 * expectancy — and that is what this is for.
 */
const SCALE_GAP = 1000;
/** Rows a group needs before its typical value counts as typical. */
const MIN_GROUP_ROWS = 4;

const medianOf = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * A value column that holds a different quantity on every group of its key.
 *
 * The long format an indicator export arrives in: `country, year, indicator,
 * value`, where `value` is a GDP on one row, a population on the next and a
 * life expectancy on the one after. Every aggregate over `value` is a category
 * error, and none of the tests above can see it — the unit is not in the
 * column's NAME, and the key column is called `indicator` rather than
 * `currency` or `uom`.
 *
 * The data says it plainly. Group the column by each candidate key and compare
 * the typical value of each group: when they are three orders of magnitude
 * apart, the groups are not measuring the same thing. Medians rather than
 * means, and a floor on group size, so one stray row cannot withdraw a
 * legitimate column.
 *
 * On the file this was written for, `value` by `indicator` gives medians of
 * 4.5 trillion, 700 million, 70 and 10. On a retail export, `revenue` by
 * `category` gives four numbers within a factor of five, and nothing happens.
 */
export function detectLongFormat(rows, { profile, cardinality = {} } = {}) {
  const out = {};
  if (!Array.isArray(rows) || rows.length < MIN_GROUP_ROWS * 2) return out;
  const measures = profile?.measures || [];
  const keys = (profile?.dimensions || []).filter((d) => {
    const levels = cardinality[d] || 0;
    return levels >= 2 && levels <= 30;
  });
  if (!measures.length || !keys.length) return out;

  for (const m of measures) {
    for (const k of keys) {
      const groups = new Map();
      for (const row of rows) {
        const v = row?.[m];
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        const label = String(row?.[k] ?? '');
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(Math.abs(v));
      }
      // Every group has to be big enough to speak for itself, and a typical
      // value of zero has no scale to compare.
      const typical = [...groups.values()]
        .filter((vals) => vals.length >= MIN_GROUP_ROWS)
        .map(medianOf)
        .filter((v) => v !== null && v > 0);
      if (typical.length < 2) continue;

      const hi = extent(typical).max;
      const lo = extent(typical).min;
      if (hi / lo < SCALE_GAP) continue;

      out[m] = {
        unit: `per ${k}`,
        why:
          `its values are a different size in every ${k} — the typical ${m} ranges from ` +
          `${lo.toPrecision(3)} to ${hi.toPrecision(3)} across them, a factor of ` +
          `${Math.round(hi / lo).toLocaleString('en-US')} — so the column holds several ` +
          'different quantities and combining them across rows adds unlike things',
      };
      break;
    }
  }
  return out;
}

export function detectDenomination({ profile, cardinality = {}, rows = null } = {}) {
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

  /**
   * 2. The table states the unit in a column of its own, and it varies.
   *
   * Dimensions only. `UNIT_COLUMN_RE` matches a column called `units`, and on a
   * retail export that is a count of things sold, not a unit of measure — so
   * the rule read "this table carries a units column holding 7 different
   * values" and withdrew the revenue column from every sum in the deck. A unit
   * of measure is a label: `kg`, `USD`, `each`. Where it is a number it is a
   * quantity, and quantities do not denominate their neighbours.
   */
  const unitColumn = (profile?.dimensions || []).find(
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

  // 3. The values say so: a column whose typical size differs by orders of
  //    magnitude between the levels of some key is holding several quantities.
  if (rows) {
    for (const [column, claim] of Object.entries(detectLongFormat(rows, { profile, cardinality }))) {
      if (!out[column]) out[column] = claim;
    }
  }

  return out;
}
