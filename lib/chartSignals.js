/**
 * What the data actually shows — measured before a chart is chosen.
 *
 * The planner's playbook (lib/analystPlanner.js) decides which charts are
 * *valid* for a schema: which columns can be summed, which can be averaged,
 * which are categories worth grouping by. That is a question about column
 * shapes, and it is answered without ever looking at a value.
 *
 * Which of those valid charts is worth a slide is a different question, and it
 * cannot be answered from shapes at all. "Average order value by region" is a
 * perfectly well-formed chart; if every region sits within one percent of the
 * mean it is also six bars of the same height and a sentence that says nothing.
 * A senior analyst does not find that out by building the chart — they glance
 * at the numbers, see there is nothing there, and build something else.
 *
 * This module is that glance, made explicit. Each function measures one kind of
 * signal on the real rows and returns 0..1, where 0 means "this chart has
 * nothing to say" and 1 means "this is the finding". The planner adds the
 * result to its structural prior, so a chart earns its place by what it shows
 * rather than by where it sat in a fixed playbook.
 *
 * Every measure here is a standard statistic rather than a hand-tuned
 * heuristic, because the numbers end up deciding what a reader is told:
 *
 *   - eta squared        does the category explain the measure at all
 *   - total variation    how far a mix is from evenly split
 *   - R^2 over time      how much of a series is trend rather than noise
 *   - Pearson/Spearman   a relationship, and whether outliers are carrying it
 *   - Cramer's V         whether two dimensions are the same dimension twice
 *
 * Pure module: no imports, no side effects, deterministic for a given input.
 */

/**
 * The most rows any signal looks at.
 *
 * Every function here is a single linear pass, so the cost is bounded by
 * candidates times rows; on a 200,000-row file with twenty candidates and a
 * dozen dimension pairs that is tens of millions of reads, which is enough to
 * be felt even inside a worker. Signals are all ratios, and a stride sample of
 * 25,000 rows estimates every ratio below to well inside the precision the
 * scores are used at. The stride is fixed, so the same file always scores the
 * same way.
 */
export const SIGNAL_SAMPLE = 25_000;

/** A deterministic, order-preserving sample of at most `limit` rows. */
export function sampleRows(rows, limit = SIGNAL_SAMPLE) {
  if (!Array.isArray(rows) || rows.length <= limit) return rows || [];
  const stride = Math.ceil(rows.length / limit);
  const out = [];
  for (let i = 0; i < rows.length; i += stride) out.push(rows[i]);
  return out;
}

const isNum = (v) => typeof v === 'number' && isFinite(v);

function toNum(v) {
  if (isNum(v)) return v;
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(String(v).replace(/[$,%\s]/g, ''));
  return isFinite(n) ? n : NaN;
}

const isBlank = (v) => v === null || v === undefined || v === '';

function mean(xs) {
  if (!xs.length) return 0;
  let s = 0;
  for (const v of xs) s += v;
  return s / xs.length;
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

/** Clamp to the 0..1 range every signal in this module reports on. */
const unit = (v) => (isNum(v) ? Math.max(0, Math.min(1, v)) : 0);

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Group rows by one dimension and aggregate one measure — the same shape the
 * planner's SQL would produce, computed here so a candidate can be scored
 * before any query runs.
 *
 * `measure` is ignored for COUNT, which counts rows. Blank dimension values are
 * counted (as `blanks`) but never become a group: a bar labelled with the empty
 * string is a data-quality report, not a category.
 *
 * Each group keeps its raw values as well as its aggregate, because "does this
 * split the total unevenly" and "does this explain the measure" are different
 * questions and need different inputs.
 */
export function groupAggregate(rows, dimension, measure, aggregate = 'COUNT') {
  const agg = String(aggregate).toUpperCase();
  const buckets = new Map();
  let blanks = 0;
  let missingMeasure = 0;

  for (const row of rows) {
    const raw = row?.[dimension];
    if (isBlank(raw)) {
      blanks++;
      continue;
    }
    const label = String(raw);
    let bucket = buckets.get(label);
    if (!bucket) {
      bucket = { label, n: 0, sum: 0, values: [] };
      buckets.set(label, bucket);
    }
    bucket.n++;
    if (agg !== 'COUNT') {
      const v = toNum(row?.[measure]);
      if (isNum(v)) {
        bucket.sum += v;
        bucket.values.push(v);
      } else {
        missingMeasure++;
      }
    }
  }

  const groups = [];
  for (const b of buckets.values()) {
    let value;
    if (agg === 'COUNT') value = b.n;
    else if (agg === 'SUM') value = b.sum;
    else value = b.values.length ? b.sum / b.values.length : NaN;
    if (!isNum(value)) continue;
    groups.push({ label: b.label, value, n: b.n, values: b.values });
  }
  groups.sort((a, b) => b.value - a.value);

  const counted = rows.length || 1;
  return {
    groups,
    blanks,
    blankRate: blanks / counted,
    missingMeasureRate: agg === 'COUNT' ? 0 : missingMeasure / counted,
  };
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/**
 * How readable a breakdown is at this number of groups.
 *
 * Independent of what the numbers say: three to eight bars is a chart someone
 * reads at a glance, twenty is a wall, and one is not a comparison. Applied as
 * a multiplier, so an interesting finding buried in forty categories still
 * scores below the same finding in six.
 */
export function legibility(groupCount) {
  if (groupCount < 2) return 0;
  if (groupCount === 2) return 0.7;
  if (groupCount <= 8) return 1;
  if (groupCount <= 12) return 0.85;
  if (groupCount <= 20) return 0.6;
  return 0.4;
}

/**
 * How unevenly a total is split across groups — the question a ranking or a
 * part-to-whole chart actually asks.
 *
 * Total variation distance from a uniform split, normalised so 0 is "every
 * group holds exactly the same share" and 1 is "one group holds everything".
 * A 50/50 split scores 0, and should: the chart is two identical bars.
 *
 * Only defined for non-negative magnitudes, which is what SUM and COUNT charts
 * carry. A mix containing negatives has no meaningful share of a whole, and
 * returns 0 rather than a number that looks like one.
 */
export function mixUnevenness(values) {
  const vals = values.filter(isNum);
  const k = vals.length;
  if (k < 2) return 0;
  if (vals.some((v) => v < 0)) return 0;
  const total = vals.reduce((s, v) => s + v, 0);
  if (total <= 0) return 0;
  const even = 1 / k;
  let tvd = 0;
  for (const v of vals) tvd += Math.abs(v / total - even);
  // The largest this sum can be is 2 * (1 - 1/k), when one group holds it all.
  return unit(tvd / (2 * (1 - even)));
}

/**
 * How much of a measure's variation the category explains — eta squared, the
 * correlation ratio.
 *
 * This is the right question for an *average* by category, where unevenness is
 * not. Average order value can differ by half across regions and still be noise
 * if orders inside each region differ by a factor of ten. Eta squared compares
 * the spread between groups against the spread within them, so it separates
 * "regions differ" from "orders differ, and region is just how we sliced them".
 *
 * 0 means the category tells you nothing about the measure; 1 means it tells
 * you everything.
 *
 * Reported as epsilon squared rather than the raw ratio, because raw eta
 * squared rises with the number of groups whether or not the groups mean
 * anything. Twenty-five products with one order each partition the measure
 * perfectly — every value is its own group, nothing is left inside one — so the
 * ratio is exactly 1 and a chart of pure noise scored higher than any real
 * finding in the deck. The same bias is what made a cross-tab look like an
 * interaction: the pair of dimensions always cuts the rows finer than either
 * one alone, so it always explained a little more. Subtracting the share a
 * random split of the same width would have explained removes both: it is the
 * standard small-sample correction, it is negligible once groups hold real
 * numbers of rows, and it is decisive when they hold one.
 */
export function varianceExplained(groups) {
  const all = [];
  const used = groups.filter((g) => (g.values || []).length > 0);
  for (const g of used) for (const v of g.values) all.push(v);
  if (all.length < 4 || used.length < 2) return 0;

  // No rows left over once every group has its own mean: nothing to compare a
  // between-group difference against, so there is no evidence either way.
  const within = all.length - used.length;
  if (within < 1) return 0;

  const grand = mean(all);
  let ssTotal = 0;
  for (const v of all) ssTotal += (v - grand) ** 2;
  if (ssTotal === 0) return 0;

  let ssBetween = 0;
  for (const g of used) {
    ssBetween += g.values.length * (mean(g.values) - grand) ** 2;
  }
  const eta = ssBetween / ssTotal;
  return unit(eta - (1 - eta) * ((used.length - 1) / within));
}

/**
 * How much of a series is trend rather than noise, and whether the trend is
 * big enough to matter.
 *
 * R^2 alone rewards a perfectly straight line that barely moves; amplitude
 * alone rewards pure noise with a wide range. A chart is worth a slide when
 * both hold, so the two are multiplied. Amplitude saturates at 20% of the mean,
 * which is roughly where a movement stops being something you have to squint
 * at.
 */
export function trendStrength(values) {
  const ys = values.filter(isNum);
  const n = ys.length;
  if (n < 4) return 0;

  const my = mean(ys);
  const mx = (n - 1) / 2;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  const r2 = (sxy * sxy) / (sxx * syy);

  const slope = sxy / sxx;
  const swing = Math.abs(slope) * (n - 1);
  const scale = Math.abs(my) || Math.max(...ys.map(Math.abs)) || 1;
  const amplitude = Math.min(1, swing / scale / 0.2);

  return unit(r2 * amplitude);
}

/** Pearson correlation, or null when it is undefined. */
export function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return Math.max(-1, Math.min(1, num / Math.sqrt(dx * dy)));
}

/** Ranks for a list of numbers, ties sharing their average rank. */
function ranks(xs) {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const shared = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k].i] = shared;
    i = j + 1;
  }
  return out;
}

/**
 * Spearman's rank correlation — Pearson computed on ranks.
 *
 * Carried alongside Pearson because the two disagreeing is itself the finding.
 * A Pearson of 0.85 next to a Spearman of 0.1 is one extreme point pretending
 * to be a relationship, and the scatter drawn from it is a cloud with a dot in
 * the corner.
 */
export function spearman(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  return pearson(ranks(xs.slice(0, n)), ranks(ys.slice(0, n)));
}

/**
 * How much of a relationship there is between two measures, discounted for the
 * two ways a correlation lies.
 *
 * Too few points: with six points a correlation of 0.7 is unremarkable, so the
 * score only reaches its full value as n passes about twenty. Outlier-driven:
 * where Pearson and Spearman disagree, the smaller of the two is what the chart
 * will actually look like.
 */
export function relationshipStrength(xs, ys) {
  const r = pearson(xs, ys);
  if (r === null) return 0;
  const rs = spearman(xs, ys);
  const robust = rs === null ? Math.abs(r) : Math.min(Math.abs(r), Math.abs(rs));
  const n = Math.min(xs.length, ys.length);
  const confidence = Math.min(1, (n - 2) / 18);
  return unit(robust * confidence);
}

/**
 * How far a distribution departs from flat, and which way it leans.
 *
 * A histogram earns its slide by having a shape: a long tail, a pile-up at one
 * end, two peaks. A near-rectangular one tells the reader values are spread
 * evenly, which they could have guessed. Measured as unevenness across the
 * bands, lifted when the distribution is also visibly skewed — skew is the case
 * where the mean and the typical record part company, which is the single most
 * useful thing a histogram has to say.
 */
export function distributionShape(values) {
  const xs = values.filter(isNum);
  if (xs.length < 8) return { signal: 0, skew: 0 };

  const mu = mean(xs);
  let m2 = 0, m3 = 0;
  for (const v of xs) {
    const d = v - mu;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= xs.length;
  m3 /= xs.length;
  const sd = Math.sqrt(m2);
  const skew = sd > 0 ? m3 / sd ** 3 : 0;

  const sorted = [...xs].sort((a, b) => a - b);
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  if (hi === lo) return { signal: 0, skew: 0 };

  const bands = new Array(8).fill(0);
  for (const v of xs) {
    const idx = Math.min(7, Math.floor(((v - lo) / (hi - lo)) * 8));
    bands[idx]++;
  }

  const unevenness = mixUnevenness(bands);
  const skewLift = Math.min(1, Math.abs(skew) / 1.5);
  return { signal: unit(0.6 * unevenness + 0.4 * skewLift), skew };
}

/**
 * Cramer's V between two categorical columns: 0 when knowing one tells you
 * nothing about the other, 1 when one determines the other.
 *
 * This is what catches the deck that spends six slides saying the same thing.
 * `city` and `state`, `product` and `category`, `plan` and `price_band` are
 * each one dimension wearing two names, and a planner that spreads across
 * "different" columns will happily build a chart of each. Measured on a sample,
 * because the number of dimension pairs is quadratic.
 */
export function association(rows, a, b) {
  const table = new Map();
  const rowTotals = new Map();
  const colTotals = new Map();
  let n = 0;

  for (const row of rows) {
    const va = row?.[a];
    const vb = row?.[b];
    if (isBlank(va) || isBlank(vb)) continue;
    const ka = String(va);
    const kb = String(vb);
    const key = `${ka}\u0000${kb}`;
    table.set(key, (table.get(key) || 0) + 1);
    rowTotals.set(ka, (rowTotals.get(ka) || 0) + 1);
    colTotals.set(kb, (colTotals.get(kb) || 0) + 1);
    n++;
  }

  const r = rowTotals.size;
  const c = colTotals.size;
  if (n === 0 || r < 2 || c < 2) return 0;

  let chi2 = 0;
  for (const [ka, ra] of rowTotals) {
    for (const [kb, cb] of colTotals) {
      const expected = (ra * cb) / n;
      const observed = table.get(`${ka}\u0000${kb}`) || 0;
      chi2 += (observed - expected) ** 2 / expected;
    }
  }
  return unit(Math.sqrt(chi2 / (n * Math.min(r - 1, c - 1))));
}

/**
 * Expected cells per combination — how much evidence the table above rests on.
 *
 * Cramer's V is only meaningful when the contingency table is populated. Put a
 * column of 3,000 distinct salaries against a three-level risk band and the
 * table has 9,000 cells holding 3,000 rows: almost every cell is empty, every
 * expected count is a fraction, and chi-squared explodes. V comes back 1.0 —
 * "each column perfectly determines the other" — from two columns that have
 * nothing to do with each other beyond both existing.
 *
 * That is not a hypothetical. It is why `Risk_Category` was dropped from a
 * verified brief with the reason "Average_Salary determines it", and why the
 * same test inside the planner would have thrown away any low-cardinality
 * dimension measured against a continuous column.
 *
 * Five expected rows per cell is the conventional floor for trusting a
 * chi-squared statistic at all, and it is the right floor here for the same
 * reason: below it the number is arithmetic rather than evidence.
 */
export function associationIsReliable(rows, a, b, { minExpected = 5 } = {}) {
  const ra = new Set();
  const rb = new Set();
  let n = 0;
  for (const row of rows) {
    const va = row?.[a];
    const vb = row?.[b];
    if (isBlank(va) || isBlank(vb)) continue;
    ra.add(String(va));
    rb.add(String(vb));
    n++;
  }
  const cells = ra.size * rb.size;
  if (!cells || n === 0) return false;
  return n / cells >= minExpected;
}

/**
 * Does `a` determine `b` — the same column arriving twice, or one computed from
 * the other?
 *
 * `association` alone is not the test, because it answers confidently on tables
 * too sparse to answer from. Where the evidence is too thin, the honest answer
 * is "not shown to", and returning false means the caller keeps a chart it
 * might have dropped — the failure that costs a reader nothing.
 */
export function determines(rows, a, b, { threshold = 0.99 } = {}) {
  // A category computed by banding a number is the case this test exists for
  // and the one Cramer's V is worst at, so it is asked first and directly.
  if (isBandingOf(rows, a, b) || isBandingOf(rows, b, a)) return true;
  if (!associationIsReliable(rows, a, b)) return false;
  return association(rows, a, b) >= threshold;
}

/**
 * Is `label` just `measure` cut into bands?
 *
 * `Risk_Category` holds Low, Medium and High, and it was computed by banding
 * `Automation_Probability_2030`. Charting the probability by the risk band is
 * therefore a definition with a chart around it — three bars in a staircase,
 * tagged STRONG EVIDENCE, saying that high-risk jobs have high risk.
 *
 * Cramer's V cannot see this reliably. On the full 3,000-row file it returns
 * 1.0 and the chart is correctly refused; on a 1,000-row sample of the same
 * file the contingency table is too sparse to trust, `associationIsReliable`
 * says so, and the tautology walks straight into the deck as the lead slide. A
 * test whose answer depends on how many rows you happened to sample is not a
 * test.
 *
 * The direct question has none of that trouble. If each label covers a distinct
 * interval of the measure and those intervals do not overlap, the label IS the
 * measure, cut up. Two levels whose ranges overlap even slightly are two groups
 * that genuinely differ, which is the most interesting chart in the deck rather
 * than the emptiest.
 *
 * Requires at least three levels and a real spread, so a two-level flag — where
 * non-overlap is ordinary and meaningful — is left to the association test.
 */
export function isBandingOf(rows, label, measure, { minLevels = 3, maxLevels = 12 } = {}) {
  const ranges = new Map();
  let numeric = 0;
  let seen = 0;

  for (const row of rows) {
    const key = row?.[label];
    const raw = row?.[measure];
    if (isBlank(key) || isBlank(raw)) continue;
    const v = typeof raw === 'number' ? raw : Number(raw);
    seen++;
    if (!Number.isFinite(v)) continue;
    numeric++;

    const k = String(key);
    const r = ranges.get(k);
    if (!r) ranges.set(k, { min: v, max: v, n: 1 });
    else {
      if (v < r.min) r.min = v;
      if (v > r.max) r.max = v;
      r.n++;
    }
    if (ranges.size > maxLevels) return false;
  }

  // `measure` has to actually be a number and `label` a handful of levels.
  if (!seen || numeric / seen < 0.95) return false;
  if (ranges.size < minLevels) return false;

  const spans = [...ranges.values()].filter((r) => r.n >= 2).sort((a, b) => a.min - b.min);
  if (spans.length < minLevels) return false;
  // A measure that never varies has every level covering the same point, which
  // is not a banding of anything.
  if (spans[spans.length - 1].max <= spans[0].min) return false;

  // Disjoint intervals, in order: each level starts where the last one ended.
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].min <= spans[i - 1].max) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Presentation decisions that depend on the data, not the schema
// ---------------------------------------------------------------------------

/**
 * How many bands a histogram should have.
 *
 * Freedman-Diaconis, which sizes bins from the interquartile range and the row
 * count rather than picking a number in advance. A fixed four bands is wrong in
 * both directions: on a tight, symmetric measure it merges the only structure
 * there is, and on a long-tailed one it produces three empty bands and a wall.
 * Falls back to Sturges when the IQR is zero — a measure with one dominant
 * repeated value — and is clamped to what stays readable on an axis.
 */
export function bucketCount(values, { min = 4, max = 10 } = {}) {
  const xs = values.filter(isNum).sort((a, b) => a - b);
  const n = xs.length;
  if (n < 8) return min;
  const spread = xs[n - 1] - xs[0];
  if (spread <= 0) return min;

  const iqr = quantile(xs, 0.75) - quantile(xs, 0.25);
  const width = iqr > 0 ? (2 * iqr) / Math.cbrt(n) : 0;
  const count = width > 0 ? Math.ceil(spread / width) : Math.ceil(Math.log2(n) + 1);
  return Math.max(min, Math.min(max, count));
}

/**
 * Whether a set of category labels needs a horizontal bar chart.
 *
 * Vertical bars give each label the width of one bar. Product names, cities and
 * payment methods do not fit in it, so they get rotated, truncated or dropped —
 * and a chart whose categories cannot be read is not a chart. Turned sideways,
 * every label gets a full line. The app has always been able to draw one;
 * nothing ever planned one.
 */
export function needsHorizontalBars(labels) {
  const lengths = labels.map((l) => String(l ?? '').length).filter((n) => n > 0);
  if (lengths.length < 2) return false;
  const sorted = [...lengths].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const longest = sorted[sorted.length - 1];

  if (median > 14 || longest > 24) return true;

  /**
   * And the case the length tests miss.
   *
   * "Month-to-month", "One year", "Two year" has a median of eight, so neither
   * threshold fires and the chart came out as three vertical bars under three
   * rotated labels. With a handful of bars the vertical axis is the one with
   * room to spare — a name sitting flat beside its bar is legible where the
   * same name at thirty-five degrees under it is not, and four rows of that
   * read better than four columns of it.
   */
  if (lengths.length <= 8 && longest > 10) return true;

  // And the other end: a dozen vertical bars with names of any real length
  // under them is a row of rotated text with the chart above it. Sideways there
  // is a line per bar and the names read straight across.
  return lengths.length > 10 && median > 6;
}

/**
 * Whether a part-to-whole chart is honest at this shape.
 *
 * A donut of the top six segments is a lie when those six are 40% of the total:
 * the reader adds up the visible slices, treats them as the whole, and walks
 * away with a different business. Slices also stop being comparable by eye
 * somewhere around seven. Where either test fails the planner draws the same
 * query as a ranking instead, which claims nothing about a whole it never
 * showed.
 */
export function suitsPartToWhole(groups, shown, { maxSlices = 7, minCoverage = 0.8 } = {}) {
  if (!groups.length || shown < 2) return false;
  if (shown > maxSlices) return false;
  if (groups.some((g) => g.value < 0)) return false;
  const total = groups.reduce((s, g) => s + (isNum(g.value) ? g.value : 0), 0);
  if (total <= 0) return false;
  const covered = groups.slice(0, shown).reduce((s, g) => s + g.value, 0);
  return covered / total >= minCoverage;
}

/**
 * Two measures averaged per group — the points a correlation chart will plot.
 *
 * The scatter the planner builds does not correlate the raw columns; it groups
 * by a dimension and correlates the group averages, which is a different and
 * usually much stronger relationship. Scoring it on the raw columns would rate
 * a chart nobody is going to see, so the preview is built the same way the
 * query is.
 */
export function groupMeanPairs(rows, dimension, xColumn, yColumn) {
  const buckets = new Map();
  for (const row of rows) {
    const raw = row?.[dimension];
    if (isBlank(raw)) continue;
    const x = toNum(row?.[xColumn]);
    const y = toNum(row?.[yColumn]);
    if (!isNum(x) || !isNum(y)) continue;
    const key = String(raw);
    let b = buckets.get(key);
    if (!b) {
      b = { sx: 0, sy: 0, n: 0 };
      buckets.set(key, b);
    }
    b.sx += x;
    b.sy += y;
    b.n++;
  }
  const xs = [];
  const ys = [];
  for (const b of buckets.values()) {
    xs.push(b.sx / b.n);
    ys.push(b.sy / b.n);
  }
  return { xs, ys };
}

/**
 * Is one of these two columns arithmetic on the other?
 *
 * The correlation machinery above is careful about the ways a relationship can
 * lie — too few points, one outlier carrying it, Pearson and Spearman
 * disagreeing. It had nothing to say about the way that matters most, because
 * that one is not a statistical error at all.
 *
 * `Revenue` is `Unit_Price` × `Quantity`. Correlate revenue against unit price
 * and you get a strong relationship every time, on every dataset, because it is
 * arithmetic rather than evidence. A deck that reports it says "average revenue
 * and average unit price show a strong positive relationship (r = 0.79)" and
 * then recommends testing whether moving one shifts the other — which is a
 * recommendation to run an experiment on a multiplication.
 *
 * So before a pair is scored as a relationship, it is checked for dependence:
 * whether one column is, row by row, the product or the ratio of the other and
 * some third thing. That is a property of the values, not of the names, so a
 * column called `amount` is caught as readily as one called `total_revenue`.
 *
 * @returns {{ dependent: boolean, kind: string|null, via: string|null }}
 */
const DEPENDENCE_R = 0.95;

export function measureDependence(rows, a, b, columns = []) {
  const pairs = [];
  for (const row of rows) {
    const x = toNum(row?.[a]);
    const y = toNum(row?.[b]);
    if (isNum(x) && isNum(y)) pairs.push([x, y, row]);
    if (pairs.length >= 600) break;
  }
  if (pairs.length < 8) return { dependent: false, kind: null, via: null };

  // The simplest dependence: one is a fixed multiple of the other, so their
  // ratio never moves. `Revenue` against `Revenue_In_Thousands`.
  const ratios = pairs.map(([x, y]) => (y === 0 ? null : x / y)).filter(isNum);
  if (ratios.length >= pairs.length * 0.8 && steady(ratios)) {
    return { dependent: true, kind: 'scale', via: null };
  }

  // The one that matters: a third column c for which a ≈ b × c across the
  // rows. Checked as a steady ratio of a / (b × c) rather than by fitting, so
  // one wild row cannot pass it and no threshold on r is involved.
  for (const c of columns) {
    if (c === a || c === b) continue;

    // Both directions of the same fact. Revenue is price x quantity, and price
    // is revenue / quantity — whichever way round the pair arrives, the
    // dependence is the same one, and checking only the product missed it half
    // the time depending on which column the planner called primary.
    const product = [];
    const ratio = [];
    // Kept alongside the exact test for the ordinary case where the identity is
    // not exact — revenue is price x quantity x a discount, or x an exchange
    // rate, and the quotient then drifts instead of holding still. On real
    // sales rows with a 45% seasonal decay the exact test misses it and this
    // one reads 0.975, against 0.67 for a pair that only looks related.
    const target = [];
    const combined = [];
    const ratioTarget = [];
    const divided = [];
    for (const [x, y, row] of pairs) {
      const z = toNum(row?.[c]);
      if (!isNum(z)) continue;
      if (y * z !== 0) {
        product.push(x / (y * z));
        target.push(x);
        combined.push(y * z);
      }
      if (y !== 0) ratio.push((x * z) / y);
      if (z !== 0) {
        ratioTarget.push(x);
        divided.push(y / z);
      }
    }

    const enough = pairs.length * 0.6;
    if (product.length >= enough && steady(product)) return { dependent: true, kind: 'product', via: c };
    if (ratio.length >= enough && steady(ratio)) return { dependent: true, kind: 'ratio', via: c };

    if (target.length >= enough && Math.abs(pearson(target, combined) || 0) >= DEPENDENCE_R) {
      return { dependent: true, kind: 'product', via: c };
    }
    if (ratioTarget.length >= enough && Math.abs(pearson(ratioTarget, divided) || 0) >= DEPENDENCE_R) {
      return { dependent: true, kind: 'ratio', via: c };
    }
  }

  return { dependent: false, kind: null, via: null };
}

/**
 * Does this set of numbers barely move?
 *
 * A relative spread under a couple of percent means the quantity is a constant
 * that floating point and rounding have jittered, not a variable.
 */
function steady(xs) {
  const mu = mean(xs);
  if (!isNum(mu) || Math.abs(mu) < 1e-9) return false;
  let worst = 0;
  for (const x of xs) worst = Math.max(worst, Math.abs(x - mu) / Math.abs(mu));
  return worst < 0.02;
}

/**
 * How much an outcome rate moves between segments.
 *
 * Not variance explained. Eta squared on a yes/no flag is small even when the
 * difference is the whole story — churn of 40% in one segment against 15% in
 * another comes out at 0.08, below the floor at which a chart is dropped, and
 * that chart is the most important one in a retention review. The reason is
 * that a binary outcome carries most of its variance within a group no matter
 * how different the groups are, so the ratio understates by construction.
 *
 * What a reader actually judges is the spread relative to the base rate: a
 * churn rate that runs from 15% to 40% around a base of 27% is a segment
 * difference worth acting on, and one that runs from 26% to 28% is not. That is
 * what this measures, saturating where the spread equals the base rate.
 *
 * Groups too small to estimate a rate from are dropped rather than allowed to
 * set the extremes — one customer who left is not a 100% churn segment.
 */
export function outcomeSpread(groups, { minGroup = null } = {}) {
  /**
   * How many rows a group needs before its number is worth quoting, which is
   * not the same question for a rate and for a mean.
   *
   * Twelve is right for a share: below it a rate is mostly made of the
   * granularity of the denominator — one customer who left is not a 100% churn
   * segment — and the extremes of a chart would be set by its thinnest groups.
   * A mean has no such floor. Four values give a usable estimate of one, and
   * the significance test below already discounts a group for being small, so
   * the floor is doing a second job it was not needed for.
   *
   * On a 44-row comparison of subscription plans across twelve providers, every
   * group holds three or four rows. At twelve, all of them are discarded, fewer
   * than two survive, and the outcome the file exists to rank on scores zero and
   * never reaches the deck.
   */
  const continuousGroups = groups.some((g) => isNum(g.sd));
  const floor = minGroup ?? (continuousGroups ? 4 : 12);
  const usable = groups.filter((g) => g.n >= floor && isNum(g.rate));
  if (usable.length < 2) return 0;

  let events = 0;
  let total = 0;
  for (const g of usable) {
    events += g.rate * g.n;
    total += g.n;
  }
  const base = total ? events / total : 0;
  // A base of zero has no relative scale to measure a spread against. A
  // *negative* one does — a margin or a change averaging below zero is an
  // ordinary continuous outcome — so the test is on the magnitude rather than
  // on the sign, which is what it was when only shares reached here.
  if (!Math.abs(base)) return 0;

  const rates = usable.map((g) => g.rate);
  const spread = Math.max(...rates) - Math.min(...rates);

  /**
   * And whether the spread is more than sampling would produce anyway.
   *
   * Relative spread alone reported that churn "varies by region, 25% to 37%" on
   * data where region was assigned at random — 225 rows a group at a base rate
   * of 31% has a standard error of three points, so a twelve-point range across
   * four groups is an ordinary afternoon. Every group's distance from the base
   * rate is measured in its own standard errors, and the largest of those has
   * to clear the level below which the difference is indistinguishable from
   * chance. Two standard errors is the conventional line; full confidence at
   * four, so a result just past significance is not treated as a certainty.
   */
  /**
   * The standard error depends on what kind of number the group carries.
   *
   * A share has its spread determined by its own level — `base*(1-base)` is the
   * whole variance of a coin, so the rate is enough to compute it. A mean does
   * not: a group averaging 0.5 might hold values all at 0.5 or values spread
   * across the unit interval, and those are different findings. So a continuous
   * outcome's groups carry their own `sd` and it is used, pooled across the
   * groups so one thin segment cannot set the scale.
   *
   * Without this branch a continuous outcome is scored with a binomial error
   * term — `base*(1-base)` on a mean salary of 89,000 is negative, its square
   * root is NaN, and every comparison against it is false, so `z` stays 0 and
   * every continuous outcome chart scores exactly zero and is dropped. Silently:
   * NaN does not throw.
   */
  const continuous = usable.some((g) => isNum(g.sd));
  let pooled = 0;
  if (continuous) {
    let ss = 0;
    for (const g of usable) ss += g.sd * g.sd * g.n;
    pooled = Math.sqrt(total ? ss / total : 0);
  }

  let z = 0;
  for (const g of usable) {
    const se = continuous
      ? pooled / Math.sqrt(g.n)
      : Math.sqrt((base * (1 - base)) / g.n);
    if (se > 0) z = Math.max(z, Math.abs(g.rate - base) / se);
  }
  const confidence = unit((z - 2) / 2);

  // Relative to the base either way, so a rate running 15% to 40% and a score
  // running 0.2 to 0.6 are comparable numbers on the same scale. `base` can be
  // negative for a continuous outcome — a margin, a temperature, a change — and
  // a negative denominator would flip the sign and score every such chart at
  // zero, so the magnitude is what divides.
  return unit((spread / Math.abs(base)) * confidence);
}

/**
 * One group per level of `dimension`, carrying the outcome's level in it.
 *
 * For a flag or a named class that level is the share of rows holding `event`.
 * For a continuous outcome it is the group's mean, and the group additionally
 * carries the spread of its own values, because a mean without one cannot be
 * told apart from noise — see `outcomeSpread`, which needs it and which has no
 * other way to get it once the rows have been collapsed to groups.
 *
 * Both shapes come back as `rate`, on purpose. Every caller does the same three
 * things with it — take the extremes, weight by `n`, sort — and none of them
 * cares which kind of number it is. A second field name would mean a branch at
 * every one of those call sites for no difference in the arithmetic.
 *
 * @param {'binary'|'continuous'|'ordinal'|'multiclass'} [options.kind]
 */
export function outcomeGroups(rows, dimension, column, event, { kind = 'binary' } = {}) {
  const continuous = kind === 'continuous';
  const buckets = new Map();
  const want = String(event);

  for (const row of rows) {
    const raw = row?.[dimension];
    if (isBlank(raw)) continue;

    const label = String(raw);
    let b = buckets.get(label);
    if (!b) {
      b = { label, n: 0, hits: 0, sum: 0, sumSq: 0 };
      buckets.set(label, b);
    }

    if (continuous) {
      // A blank outcome is not a zero. Counting it as one drags the group's
      // mean toward the origin in proportion to how much of the column is
      // missing, which reads as a real difference between segments and is an
      // artefact of the gaps.
      const v = row?.[column];
      if (isBlank(v)) continue;
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) continue;
      b.n++;
      b.sum += n;
      b.sumSq += n * n;
      continue;
    }

    b.n++;
    if (String(row?.[column]) === want) b.hits++;
  }

  return [...buckets.values()]
    .map((b) => {
      if (!continuous) {
        return { ...b, rate: b.n ? b.hits / b.n : null, value: b.n ? b.hits / b.n : 0 };
      }
      const mean = b.n ? b.sum / b.n : null;
      // Population variance within the group, floored at zero against the
      // rounding error that makes `sumSq/n - mean^2` very slightly negative on
      // a group whose values are all identical.
      const variance = b.n ? Math.max(0, b.sumSq / b.n - mean * mean) : 0;
      return { ...b, rate: mean, value: mean ?? 0, sd: Math.sqrt(variance) };
    })
    .filter((b) => isNum(b.rate))
    .sort((a, b) => b.rate - a.rate);
}

/**
 * Are these two columns the same column, arriving twice?
 *
 * Joining three files puts one fact on the board under two names — `Age_Group`
 * from the orders sheet and `Customer_Age_Group` from the customers sheet — and
 * the deck charts both, identically, in a different order.
 *
 * Perfect association is not the test. Two columns can agree completely and
 * still be different facts: a gender column and a has-dependents column can be
 * in lockstep across a sample and are plainly not one column. What identifies a
 * join duplicate is that the values themselves match, row for row.
 */
export function sameColumn(rows, a, b, { sample = 500, agreement = 0.98 } = {}) {
  if (!a || !b || a === b) return false;
  let seen = 0;
  let same = 0;
  for (const row of rows) {
    const x = row?.[a];
    const y = row?.[b];
    if (isBlank(x) && isBlank(y)) continue;
    seen++;
    if (String(x) === String(y)) same++;
    if (seen >= sample) break;
  }
  return seen >= 20 && same / seen >= agreement;
}
