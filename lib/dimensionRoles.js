/**
 * What kind of thing a dimension's levels are, and which sentences that permits.
 *
 * The analyzers reach for portfolio language whenever one level takes a large
 * share: a concentration to hedge, segments that behave like fewer independent
 * bets, a bad quarter for the leader being a bad quarter for the total. On a
 * product line or a sales region that is exactly the right reading, and it is
 * the most useful sentence the summary produces.
 *
 * On an athlete export it produced this, about the column `Sex`:
 *
 *   "Concentration risk: M carries an outsized share (66.7%)."
 *   "a plan that treats them as 2 independent bets is buying diversification
 *    it does not have."
 *
 * Nothing is arithmetically wrong there. 66.7% is the share, and the effective
 * segment count is what the index says. What is wrong is that sex is not a
 * portfolio: there is no position to rebalance, no exposure to hedge, and no
 * decision the reader could take that would change the split. The same reflex
 * called Summer and Winter "quarters" and warned that a bad one would be bad
 * for the total, on a dimension whose two levels are alternating Games.
 *
 * A share on a demographic column is a statement about who the dataset covers,
 * which matters enormously — it is the difference between "our customers skew
 * male" and "we are over-exposed to men" — and it is a caveat about
 * representativeness rather than a risk to manage. A share on a cyclical column
 * is seasonality. Both deserve a sentence; neither deserves that one.
 *
 * This module decides only what a level *is*. It computes nothing and it vetoes
 * no number: every share, index and count is reported exactly as before. It
 * governs the verb, in the same way the evidence tier already governs how far a
 * finding may go.
 */

/**
 * Levels that describe people. Concentration here is composition, not exposure.
 *
 * Deliberately narrow. Anything it does not recognise keeps the existing
 * business framing, so a false negative costs nothing that is not already the
 * status quo, while a false positive silences a real concentration warning on a
 * column that deserved one.
 */
const DEMOGRAPHIC_RE =
  /(^|[^a-z0-9])(sex|gender|age([\s_-]?(band|group|range|bracket|bucket))?|race|ethnicity|ethnic[\s_-]?group|marital[\s_-]?status|religion|disability|nationality|pronouns?)([^a-z0-9]|$)/i;

/**
 * Levels that are positions in a cycle. A large share here is seasonality.
 *
 * `quarter`, `month` and `season` are the ones that matter: a summary that
 * warns about "a bad quarter for Q4" when Q4 is 40% of the year has mistaken
 * the calendar for a customer.
 */
const CYCLICAL_RE =
  /(^|[^a-z0-9])(season|quarter|qtr|month|week|weekday|weekend|day[\s_-]?of[\s_-]?week|semester|fiscal[\s_-]?period|part[\s_-]?of[\s_-]?day|shift)([^a-z0-9]|$)/i;

/**
 * Classify a dimension by name.
 *
 * @param {string} name  the column or its display label
 * @returns {'demographic'|'cyclical'|'segment'}
 */
export function dimensionRole(name) {
  const raw = String(name ?? '').trim();
  if (!raw) return 'segment';
  if (DEMOGRAPHIC_RE.test(raw)) return 'demographic';
  if (CYCLICAL_RE.test(raw)) return 'cyclical';
  // Geography stays a segment on purpose: "84% of revenue comes from one
  // region" is a genuine concentration with a genuine decision attached.
  return 'segment';
}

/**
 * Counting rows, as opposed to measuring something the business accumulates.
 *
 * The aliases come from `lib/aggregateNames.js`, so a count of rows always
 * arrives as one of these two shapes.
 */
const RECORD_COUNT_RE = /^(record count|count of\b)/i;

/**
 * May a large share on this dimension be described as a position to manage?
 *
 * The dimension alone cannot answer it, which is what a 250,000-row order
 * export made obvious. "M is 66.7% of athletes" is a fact about who the data
 * covers. "26-35 is 43.2% of revenue" is a commercial concentration with a
 * decision attached — the same demographic column, and a retailer would act on
 * the second without hesitating.
 *
 * What separates them is the measure. A share of the RECORD COUNT on a
 * demographic says how the dataset is populated; a share of money or quantity
 * says where the business actually sits. So a demographic keeps its softened
 * wording only while it is counting rows.
 *
 * A cycle carries no position either way: a quarter cannot be rebalanced.
 *
 * @param {string} name       the dimension
 * @param {string} [measure]  the measure a share was computed on
 * @returns {boolean}
 */
export function allowsPortfolioFraming(name, measure = null) {
  const role = dimensionRole(name);
  if (role === 'segment') return true;
  if (role === 'cyclical') return false;
  // Demographic. Without knowing what was measured, stay with the reading that
  // claims less.
  if (measure === null || measure === undefined) return false;
  return !RECORD_COUNT_RE.test(String(measure).trim());
}

/**
 * The consequence of a large share, in terms the dimension can carry.
 *
 * Returns null for a segment, where the caller's existing sentence is right.
 *
 * @param {string} name   the dimension
 * @param {string} who    the dominant level
 * @param {string} of     what the share was measured against
 * @returns {string|null}
 */
export function shareConsequence(name, who, of, measure = null) {
  if (allowsPortfolioFraming(name, measure)) return null;
  const role = dimensionRole(name);
  const label = String(name || 'this field').toLowerCase();

  if (role === 'demographic') {
    return (
      `Most of ${of} is ${who}, so the figures here describe ${who} more than ` +
      `anyone else — that is who the data covers, not a position to rebalance. ` +
      `Check the split is the one you meant to analyse before reading the rest ` +
      'as a statement about everyone.'
    );
  }

  if (role === 'cyclical') {
    return (
      `${who} carries most of ${of}, which is the shape of the ${label} rather ` +
      `than a concentration to act on. Compare like with like — one ${label} ` +
      'against the same one — before reading any movement as a change.'
    );
  }

  return null;
}
