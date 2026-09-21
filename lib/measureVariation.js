/**
 * Which measure in a table is worth putting in front of a reader.
 *
 * The planner and the KPI strip both have to choose one, and both chose by
 * `(max - min) / mean`: how wide the column's range is, relative to its own
 * size. The relative part is load-bearing and stays — without it the widest
 * range belongs to whichever column is counted in the biggest numbers, which
 * is how a context window in tokens became the headline of a report about what
 * subscriptions cost.
 *
 * What it misses is that a range is decided by two rows, and sometimes by one.
 * On a 44-row comparison of AI subscription plans, `Min Seats` is the number 1
 * on thirty-two rows and 2 on six; one row — Microsoft's enterprise tier —
 * reads 300. That single row gave the column a range of 299 and the widest
 * relative range in the file, and the dashboard opened with "Average Min Seats
 * 8.8": a mean no plan in the file is anywhere near, describing a column whose
 * answer is "one" for almost everybody.
 *
 * The fix is not a different ranking. Four real files say the old ordering is a
 * good one — it puts revenue first on a retail export, support calls first on a
 * churn file, and cost per acquisition first on a campaign file, and every
 * robust dispersion measure tried here moved at least one of those to something
 * worse. The fix is to notice the one shape it cannot see.
 *
 * A column whose interquartile range is zero is one number on more than half
 * its rows — that is what an empty middle half means. Whatever its extremes
 * say, it does not vary, its mean describes nobody, and it is not a headline.
 * `Min Seats`, `Max Seats` and a context window quoted as 1M by every vendor
 * are all exactly this, and nothing else in any of the four files is.
 *
 * So: constant columns go last, and everything else keeps the order it had.
 *
 * Pure. No SQL, no DOM.
 */

/**
 * How many values to look at before sampling.
 *
 * Sorting every value of every numeric column of a 250,000-row file costs about
 * a second, and this runs on the critical path of an analysis, twice — once for
 * the charts and once for the card strip. Twenty thousand values put a quartile
 * far inside the precision anything here needs; the whole question is which of
 * a dozen columns moves most, not what the third quartile is to four places.
 */
const SAMPLE_TARGET = 20000;

/** Greatest common divisor, for choosing a stride that cannot alias. */
function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Indices spread across the file, deterministically, without aliasing.
 *
 * The obvious sample is every k-th row. It is deterministic, which matters —
 * the same file has to produce the same report — but it aliases badly with the
 * structure real exports have. A file with five rows per order and a stride of
 * five reads the same position in every order and never sees the other four, so
 * the "quantiles" belong to one phase of the data rather than to the column.
 *
 * Stepping by a stride coprime to the row count and wrapping around fixes it.
 * Any period that divides the row count also divides out of a coprime stride,
 * so the phase advances on every visit and the walk covers the file evenly.
 */
function sampleIndices(n, target) {
  if (n <= target) return null; // take everything
  let step = Math.floor(n / target);
  if (step < 2) step = 2;
  // At most a handful of tries: consecutive integers cannot share every factor
  // of n, and this stops well before it could matter.
  while (step < n && gcd(step, n) !== 1) step++;
  return step;
}

/** Linear-interpolated quantile of an ascending list. */
export function quantile(ascending, fraction) {
  const n = ascending.length;
  if (!n) return NaN;
  if (n === 1) return ascending[0];
  const at = (n - 1) * fraction;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return lo === hi ? ascending[lo] : ascending[lo] + (ascending[hi] - ascending[lo]) * (at - lo);
}

/** The finite numbers in one column, ascending, sampled if the file is large. */
function ascendingValues(rows, column, step) {
  const n = rows.length;
  const out = [];
  if (step === null) {
    for (let i = 0; i < n; i++) {
      const v = rows[i]?.[column];
      if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
    }
  } else {
    // Walks n/step distinct indices before it returns to where it started,
    // because the stride is coprime to n.
    const visits = Math.floor(n / step);
    for (let k = 0, i = 0; k < visits; k++, i = (i + step) % n) {
      const v = rows[i]?.[column];
      if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
    }
  }
  // A typed array sorts numerically in native code; a plain sort with a
  // comparator is several times slower and this runs per column.
  const sorted = Float64Array.from(out);
  sorted.sort();
  return sorted;
}

/**
 * Two readings of how much each measure varies, relative to its own size.
 *
 * `relIqr` is the robust one and the one that decides. `relSpread` is the old
 * min-to-max reading, kept only to break ties between columns that are flat
 * through their middle half — a file where every measure is constant except in
 * its tails still has to put something on the card, and there the extremes are
 * the only information there is.
 *
 * @param {Array<object>} rows
 * @param {string[]} measures
 * @param {Object<string, {mean:number, spread:number}>} stats from `measureStats`
 */
/**
 * How much of a column has to be filled in before it can headline a file.
 *
 * Half. A measure present on a sixth of the rows describes a sixth of the
 * table, and on a 58-column export with fifty-three statistically
 * indistinguishable columns that is how "Average Field 35" — filled on 54 of
 * 300 rows — became the headline while `score`, filled on all 300, went
 * unmentioned. Nothing was reading completeness at all.
 */
const WELL_FILLED = 0.5;

export function measureVariation(rows, measures, stats = {}) {
  const out = {};
  // Chosen once, so every column is read at the same positions and the columns
  // stay comparable with each other.
  const step = sampleIndices((rows || []).length, SAMPLE_TARGET);
  for (const m of measures || []) {
    const values = ascendingValues(rows || [], m, step);
    const sampled = step === null ? (rows || []).length : Math.floor((rows || []).length / step);
    const median = quantile(values, 0.5);
    const iqr = values.length ? quantile(values, 0.75) - quantile(values, 0.25) : 0;
    const mean = stats[m]?.mean;
    const spread = stats[m]?.spread;

    // Scale by the median, because that is the centre the IQR is measured
    // around. A column centred on zero — a profit or a delta — has no
    // meaningful relative spread, so fall back to the mean and then to the
    // absolute figure rather than dividing by nothing.
    const scale =
      Math.abs(median) > 1e-9
        ? Math.abs(median)
        : Number.isFinite(mean) && Math.abs(mean) > 1e-9
          ? Math.abs(mean)
          : 0;

    out[m] = {
      /**
       * Does the middle half of this column hold more than one number?
       *
       * Asked against the column's own range rather than against its centre,
       * because a centre can be zero. A profit, a delta, a temperature anomaly
       * swings hard in both directions and averages out to nothing, and
       * dividing by that says "constant" about the most variable column in the
       * file. The range is never zero unless the column really is.
       */
      varies: Number.isFinite(iqr) && Number.isFinite(spread) && iqr > Math.abs(spread) * 1e-9,
      relIqr: Number.isFinite(iqr) && scale > 0 ? iqr / scale : 0,
      // The existing ranking, unchanged: the range over the column's own mean.
      // Kept on the mean rather than the median because this is the number the
      // planner has always ordered by, and every file checked says it orders
      // well once the constant columns are out of its way.
      relSpread:
        Number.isFinite(spread) && Number.isFinite(mean) && Math.abs(mean) > 1e-9
          ? spread / Math.abs(mean)
          : Number.isFinite(spread)
            ? spread
            : 0,
      median: Number.isFinite(median) ? median : 0,
      iqr: Number.isFinite(iqr) ? iqr : 0,
      // Measured on the sample this walked, which is the whole column unless
      // the file is large enough to be strided — and a stride samples blanks
      // in the same proportion as values.
      filled: values.length / Math.max(1, sampled),
    };
  }
  return out;
}

/**
 * Most varied first, with the columns that do not actually vary put last.
 *
 * Two levels, and the first one is a gate rather than a score: a column that is
 * one number through its middle half loses to any column that is not, however
 * wide its extremes are. Among the rest — and among the constant ones, if a
 * file has nothing else — the order is the one the planner has always used.
 *
 * Returns a comparator, so it drops into `orderByPurpose` where the purpose
 * pass still ranks above it on a file a model has been asked about.
 */
export function byVariation(variation) {
  const varies = (m) => (variation?.[m]?.varies ? 1 : 0);
  // A column filled on most of the rows describes the table; one filled on a
  // sixth of them describes a sixth of it.
  const populated = (m) => ((variation?.[m]?.filled ?? 1) >= WELL_FILLED ? 1 : 0);
  return (a, b) => {
    const varying = varies(b) - varies(a);
    if (varying) return varying;
    const present = populated(b) - populated(a);
    if (present) return present;
    return (variation?.[b]?.relSpread || 0) - (variation?.[a]?.relSpread || 0);
  };
}
