/**
 * A ratio has two definitions, and they do not agree.
 *
 * `Shipping Cost Rate by Category` can be computed two ways, both correct:
 *
 *   ratio of sums    SUM(shipping) / SUM(order_value)   what the engine does
 *   mean of ratios   AVG(shipping / order_value)        what a person often means
 *
 * On a real 250,000-row export they name different leaders. By the first, Books
 * tops the field. By the second, Grocery does. Same rows, same columns, same
 * arithmetic — a different question, asked without anybody choosing which.
 *
 * That is not a rounding difference. The engine picked one silently, ranked the
 * categories by it, measured the leader at 3.7 standard deviations clear of the
 * field, and printed that as robustness. The number was right and the claim it
 * implied was false: the ordering is not stable, it is stable *given a
 * definition nobody stated*.
 *
 * The two differ whenever the denominator varies across groups, which for
 * anything divided by an order value is always. A category of cheap baskets has
 * a high per-order rate and contributes little to the totals; the sums answer
 * "where does the money go", the means answer "what does a typical order look
 * like", and a reader shown one is rarely told which.
 *
 * So the engine keeps its definition — a ratio of sums is the right default for
 * a business total — and stops claiming more for it than it has. This computes
 * the ranking both ways and reports whether they agree. Where they do, the
 * ordering has survived a real test and can be said to be clear of the field.
 * Where they do not, the finding says so, loses its claim to separation, and
 * names both leaders.
 */

/** Groups below this contribute nothing to either ranking and destabilise both. */
const MIN_GROUP_ROWS = 5;

/** Rows to walk. A ranking that flips does so long before this many. */
const SCAN_ROWS = 50000;

const norm = (s) => String(s ?? '').trim();

/**
 * Rank the groups both ways and say whether they agree.
 *
 * @param {object[]} rows        the analysis view
 * @param {object}   spec
 * @param {string}   spec.dimension   the column the rate is broken down by
 * @param {string}   spec.numerator   the column on top
 * @param {string}   spec.denominator the column underneath
 * @returns {{agrees, leaderOfSums, leaderOfRatios, groups}|null}
 */
export function rateSensitivity(rows = [], { dimension, numerator, denominator } = {}) {
  if (!rows?.length || !norm(dimension) || !norm(numerator) || !norm(denominator)) return null;

  const stride = Math.max(1, Math.floor(rows.length / SCAN_ROWS));
  const acc = new Map();

  for (let i = 0; i < rows.length; i += stride) {
    const row = rows[i];
    const group = norm(row?.[dimension]);
    if (!group) continue;
    const num = Number(row[numerator]);
    const den = Number(row[denominator]);
    if (!Number.isFinite(num) || !Number.isFinite(den)) continue;

    if (!acc.has(group)) acc.set(group, { sumNum: 0, sumDen: 0, ratios: 0, n: 0 });
    const g = acc.get(group);
    g.sumNum += num;
    g.sumDen += den;
    g.n += 1;
    // A row whose denominator is zero has no per-row ratio. Skipped rather than
    // counted as zero, which would drag a group's mean toward nothing for a
    // reason that is about missing data rather than about the group.
    if (den !== 0) g.ratios += num / den;
  }

  const groups = [...acc.entries()]
    .filter(([, g]) => g.n >= MIN_GROUP_ROWS && g.sumDen !== 0)
    .map(([label, g]) => ({
      label,
      ratioOfSums: g.sumNum / g.sumDen,
      meanOfRatios: g.ratios / g.n,
      rows: g.n,
    }));

  if (groups.length < 2) return null;

  const bySums = [...groups].sort((a, b) => b.ratioOfSums - a.ratioOfSums);
  const byRatios = [...groups].sort((a, b) => b.meanOfRatios - a.meanOfRatios);

  return {
    agrees: bySums[0].label === byRatios[0].label,
    leaderOfSums: bySums[0].label,
    leaderOfRatios: byRatios[0].label,
    groups: groups.length,
  };
}

/**
 * How the definition should be stated, and what the disagreement costs.
 *
 * Two sentences, because they are two different things a reader needs. The
 * first names the definition whatever happened — an unstated definition is how
 * this went wrong, and stating it costs a line. The second appears only when
 * the two disagree, and it is the one that takes the claim back.
 */
export function describeRate(check, { numerator, denominator } = {}) {
  if (!check) return [];
  const said = `Computed as ${pooled(numerator)} divided by ${pooled(denominator)}, across each group.`;
  if (check.agrees) {
    return [said, 'Averaging the per-row rates instead puts the same group on top, so the ordering does not depend on which was used.'];
  }
  return [
    said,
    `Averaging the per-row rates instead puts ${check.leaderOfRatios} on top rather than ${check.leaderOfSums}. ` +
      'The ordering depends on which definition is used, so it is not a stable ranking.',
  ];
}

const prettyish = (name) => norm(name).replace(/[_-]+/g, ' ').toLowerCase() || 'the measure';

/**
 * The column's name with "total" in front, unless it is already there.
 *
 * `Total_Amount` came out as "total total amount", which reads as a typo and
 * costs the sentence its authority on the one line whose whole job is to be
 * precise about what was divided by what.
 */
const pooled = (name) => {
  const text = prettyish(name);
  return /^total\b/.test(text) ? text : `total ${text}`;
};

/** The ranking flipped, so the leader cannot be called clear of the field. */
export const orderingIsUnstable = (check) => !!check && check.agrees === false;
