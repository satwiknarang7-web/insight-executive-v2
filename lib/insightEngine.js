/**
 * Deterministic Insight Engine.
 *
 * Turns a chart's REAL query results into verifiable statistical findings and a
 * plain-language narrative aimed at non-technical executives.
 *
 * Why this exists: the analyst LLM is excellent at phrasing but unreliable at
 * arithmetic. So all numbers are computed here, deterministically, from the
 * actual result rows — never by the model. The findings are then (a) attached to
 * each slide as "verified metrics", (b) handed to the LLM as the ONLY facts it is
 * allowed to use, and (c) used to write a correct narrative even when every LLM
 * is unavailable.
 *
 * Pure module: no side effects, and its only import is the equally pure
 * statistics module the planner scores charts with. Safe to unit-test in
 * isolation.
 */
import { pearson, spearman } from './chartSignals.js';
import { usesSecondDimension } from './chartResolver.js';
import {
  attributeChange,
  interactionResidual,
  resolveColumn,
  segmentOverlap,
} from './crossFindings.js';

// Re-exported because this module used to own the implementation and callers
// still reach for it here. There is one Pearson in the codebase, not two.
export { pearson };

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

const isNum = (v) => typeof v === 'number' && isFinite(v);

/**
 * The share of the whole above which one category counts as concentrated.
 *
 * There is exactly one of these because there used to be two. HHI decided
 * whether the focus card called a mix "balanced", while a plain top-share test
 * decided whether the risk card called it "outsized" — so a leader on 51% of
 * the total was described as both, side by side, in the same scorecard. A long
 * tail can hold HHI down while one category still carries half the business;
 * every card now answers the question the same way.
 */
const CONCENTRATION_PCT = 40;

/**
 * How much a series has to have moved before the movement outranks a share on
 * the risk card. Below this it is drift, and a standing concentration is the
 * more useful thing to report.
 */
const MATERIAL_CHANGE_PCT = 15;

/** The largest share of the whole a finding reports, by either measure. */
function topSharePct(metrics = {}) {
  const shares = [metrics.leaderSharePct, metrics.dominantSharePct].filter(isNum);
  return shares.length ? Math.max(...shares) : null;
}

/**
 * Is this result set the whole picture, or the top of it?
 *
 * Almost every planned chart ends in `LIMIT n`, and when it comes back with
 * exactly n rows there is very likely an eleventh category that did not make
 * the cut. Every share computed from those rows is therefore a share of what is
 * shown, and describing it as a share of the total is simply false — it is the
 * single most common way an automatic summary states something wrong with
 * complete confidence. So the wording changes, and the metrics say which basis
 * they used so the language model cannot quietly upgrade it back.
 */
export function truncation(chart, rowCount) {
  const match = /\blimit\s+(\d+)/i.exec(String(chart?.sql || chart?.sql_query || ''));
  if (!match) return { limited: false, limit: null };
  const limit = Number(match[1]);
  return { limited: Number.isFinite(limit) && rowCount >= limit, limit };
}

function toNum(v) {
  if (isNum(v)) return v;
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(String(v).replace(/[$,%\s]/g, ''));
  return isFinite(n) ? n : NaN;
}

/** Compact, human-readable number: 1.2M, 3.4K, 56, 0.42. */
export function compactNum(v) {
  if (!isNum(v)) return String(v ?? '');
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  if (Number.isInteger(v)) return String(v);
  if (abs >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

const pct = (v, digits = 1) => `${(v >= 0 ? '' : '')}${v.toFixed(digits)}%`;

/** Pluralise an English noun well enough for column names ("category" -> "categories"). */
function plural(word) {
  const w = String(word || '');
  if (!w) return w;
  if (/(?:[^aeiou])y$/i.test(w)) return w.slice(0, -1) + 'ies';
  if (/(?:s|x|z|ch|sh)$/i.test(w)) return w + 'es';
  return w + 's';
}

function mean(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function stdev(arr, mu = mean(arr)) {
  if (arr.length < 2) return 0;
  let s = 0;
  for (const v of arr) s += (v - mu) ** 2;
  return Math.sqrt(s / arr.length);
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function correlationStrength(r) {
  const a = Math.abs(r);
  if (a >= 0.8) return 'very strong';
  if (a >= 0.6) return 'strong';
  if (a >= 0.4) return 'moderate';
  if (a >= 0.2) return 'weak';
  return 'little to no';
}

function median(arr) {
  if (!arr.length) return 0;
  return quantile([...arr].sort((a, b) => a - b), 0.5);
}

/**
 * Gini coefficient over non-negative values: 0 when every category is equal,
 * approaching 1 as one category takes everything.
 *
 * Reported alongside the leader's share because the two answer different
 * questions. A leader on 30% of a field of twenty is a different business from
 * a leader on 30% of a field of three, and only the second is a broad base.
 */
function gini(values) {
  const xs = values.filter((v) => isNum(v) && v >= 0).sort((a, b) => a - b);
  const n = xs.length;
  if (n < 2) return 0;
  const total = xs.reduce((s, v) => s + v, 0);
  if (total <= 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * xs[i];
  return Math.max(0, Math.min(1, (2 * weighted) / (n * total) - (n + 1) / n));
}

/**
 * Is the leader ahead of the field, or merely first in it?
 *
 * Every ranking has a top row. Whether that row is a finding depends on how far
 * it sits above the rest, measured in the spread of the rest — a lead of one
 * standard deviation is a nose ahead, three is a different league. Returned in
 * standard deviations rather than percent, because percent above the mean is
 * unreadable without knowing how much the mean moves around.
 */
function leadInStdevs(sortedValues) {
  if (sortedValues.length < 3) return null;
  const rest = sortedValues.slice(1);
  const mu = mean(rest);
  const sd = stdev(rest, mu);
  if (sd === 0) return null;
  return (sortedValues[0] - mu) / sd;
}

/**
 * Two-tailed 5% critical values of Student's t, by degrees of freedom.
 *
 * A correlation reported without one of these is the most common way a small
 * dataset produces a confident falsehood: six points will show r = 0.7 often
 * enough that seeing one means very little. The table covers the small-n cases
 * where it matters; beyond thirty the normal approximation is close enough that
 * the last entry is used throughout.
 */
const T_CRITICAL = {
  1: 12.71, 2: 4.30, 3: 3.18, 4: 2.78, 5: 2.57, 6: 2.45, 7: 2.36, 8: 2.31,
  9: 2.26, 10: 2.23, 12: 2.18, 15: 2.13, 20: 2.09, 25: 2.06, 30: 2.04,
};

function tCritical(df) {
  if (df <= 0) return Infinity;
  const keys = Object.keys(T_CRITICAL).map(Number).sort((a, b) => a - b);
  for (const k of keys) if (df <= k) return T_CRITICAL[k];
  return 1.96;
}

/**
 * Would a correlation this size on this many points be surprising if the two
 * things were unrelated?
 *
 * The standard t test on a correlation coefficient. It is the difference
 * between "these move together" and "these happen to line up", and it is the
 * one thing a chart of eight points cannot show you.
 */
function correlationIsSignificant(r, n) {
  if (!isNum(r) || n < 3 || Math.abs(r) >= 1) return Math.abs(r) >= 1 && n >= 3;
  const t = Math.abs(r) * Math.sqrt((n - 2) / (1 - r * r));
  return t > tCritical(n - 2);
}

// ---------------------------------------------------------------------------
// How much the prose is allowed to claim
// ---------------------------------------------------------------------------

/**
 * The four things a finding can be, and what each licenses a sentence to say.
 *
 * Every automatic summary sounds the same for the same reason: it states a
 * fifteen-point lead across two hundred rows and a four-point lead across nine
 * in exactly the same voice, because it only ever had the number and never how
 * much the number was worth. A reader who catches that once stops believing the
 * confident ones too.
 *
 * So each analyzer declares what its finding rests on, and the tier decides how
 * far the recommendation may go: `strong` says do something, `moderate` says
 * check it, `indicative` says watch it, `thin` says gather more before reading
 * anything into it. The narrator receives the tier and the reasons behind it as
 * facts it may not upgrade.
 */
const TIERS = ['thin', 'indicative', 'moderate', 'strong'];

function evidence({ observations = 0, effect = 0, limited = false, notes = [], cap = null } = {}) {
  // Effect is the analyzer's own 0..1 read on how pronounced its finding is;
  // observations is how many rows the picture rests on.
  let rank = 3;
  if (effect < 0.15) rank -= 2;
  else if (effect < 0.3) rank -= 1;
  if (observations < 4) rank -= 2;
  else if (observations < 8) rank -= 1;
  if (limited) rank -= 1;
  // Some analyzers know something the size of the effect and the number of rows
  // cannot express — a correlation inside what chance produces is not strong
  // evidence at any sample size, however clean the arithmetic looks.
  if (cap) rank = Math.min(rank, TIERS.indexOf(cap));

  const tier = TIERS[Math.max(0, Math.min(TIERS.length - 1, rank))];
  const reasons = [...notes];
  if (observations < 8) reasons.push(`rests on ${observations} data ${observations === 1 ? 'point' : 'points'}`);
  if (limited) reasons.push('measured against the rows the query returned, not the whole dataset');
  if (effect < 0.15) reasons.push('the difference it describes is small');
  return { tier, reasons };
}

/** Is a finding solid enough for the prose to tell somebody to act on it? */
const actionable = (tier) => tier === 'strong' || tier === 'moderate';

// ---------------------------------------------------------------------------
// Composing a paragraph
// ---------------------------------------------------------------------------

/**
 * Write the paragraph this data deserves rather than the paragraph the template
 * has room for.
 *
 * The old detail text was a fixed run of sentences: the spread, then the
 * Pareto count, then the outliers. Every ranking slide in every deck therefore
 * had the same three sentences in the same order with different nouns in them,
 * which is precisely what makes generated analysis read as generated — not that
 * any one sentence is wrong, but that the writer clearly had nothing to choose
 * between.
 *
 * An analyzer now offers every observation it can support, each weighted by how
 * much this particular dataset justifies saying it: the skew sentence is heavy
 * when the median and the mean have come apart and weightless when they have
 * not; the outlier sentence scales with how many there are. The heaviest few
 * are kept, then put back into narrative order, so a flat field and a top-heavy
 * one are described by different sentences rather than the same sentence with
 * different numbers.
 */
function compose(observations, limit = 3) {
  const usable = observations
    .map((o, order) => ({ ...o, order }))
    .filter((o) => o && o.text && isNum(o.weight) && o.weight > 0);

  return usable
    .sort((a, b) => b.weight - a.weight || a.order - b.order)
    .slice(0, limit)
    .sort((a, b) => a.order - b.order)
    .map((o) => o.text)
    .join(' ');
}

/** One observation for `compose`: what it says, and how much it is worth saying. */
const say = (weight, text) => ({ weight, text });

// ---------------------------------------------------------------------------
// Series extraction
// ---------------------------------------------------------------------------

/**
 * Pull a labelled categorical/temporal series + its numeric measure(s) out of a
 * result set, honoring the chart's declared axes when present.
 */
function extractSeries(rows, { xKey, yKey } = {}) {
  if (!rows || rows.length === 0) return null;
  const keys = Object.keys(rows[0]);

  // Label axis: declared xKey, else first string column, else first column.
  const labelKey =
    (xKey && keys.includes(xKey) && typeof rows[0][xKey] !== 'number' ? xKey : null) ||
    keys.find((k) => typeof rows[0][k] === 'string') ||
    xKey ||
    keys[0];

  // Numeric columns (excluding the label).
  const numericKeys = keys.filter(
    (k) => k !== labelKey && rows.every((r) => !Number.isNaN(toNum(r[k])))
  );
  // Preferred measure: declared yKey if numeric, else the first numeric column.
  const valueKey =
    (yKey && numericKeys.includes(yKey) ? yKey : null) || numericKeys[0] || keys[1] || keys[0];

  const points = rows
    .map((r) => ({ label: String(r[labelKey] ?? ''), value: toNum(r[valueKey]) }))
    .filter((p) => isNum(p.value));

  return { labelKey, valueKey, numericKeys, points, keys };
}

// ---------------------------------------------------------------------------
// Per-type analyzers — each returns { metrics, headline, detail, recommendation }
// ---------------------------------------------------------------------------

function analyzeRanking(series, ctx) {
  const { points, valueKey, labelKey } = series;
  const measure = ctx.measureLabel || prettyKey(valueKey);
  const dim = ctx.dimLabel || prettyKey(labelKey);
  const vals = points.map((p) => p.value);
  const total = vals.reduce((s, v) => s + v, 0);
  const avg = mean(vals);
  const mid = median(vals);
  const sorted = [...points].sort((a, b) => b.value - a.value);
  const sortedVals = sorted.map((p) => p.value);
  const top = sorted[0];
  const second = sorted[1];
  const bottom = sorted[sorted.length - 1];

  const leaderShare = total > 0 ? (top.value / total) * 100 : 0;
  const deltaVsAvg = avg > 0 ? ((top.value - avg) / avg) * 100 : 0;
  const gapToSecond = second && second.value !== 0 ? ((top.value - second.value) / second.value) * 100 : null;

  // Pareto: how many categories make up >= 80% of the total.
  let cum = 0, paretoCount = 0;
  for (const p of sorted) {
    cum += p.value;
    paretoCount++;
    if (total > 0 && cum / total >= 0.8) break;
  }
  const paretoShare = points.length ? (paretoCount / points.length) * 100 : 0;

  // Whether these values add up to anything. Averages and rates do not, so no
  // share, Pareto count or total is reported for them — those numbers would be
  // arithmetic over a quantity that does not exist.
  const additive = isAdditiveMeasure(measure);

  const outliers = detectOutliers(points);
  const belowAverage = points.filter((p) => p.value < avg).length;
  // How many times the leader the laggard is. More legible than a percentage
  // once the gap is large: "nine times" lands where "800% ahead" does not.
  const spread = bottom.value > 0 ? top.value / bottom.value : null;
  const basis = shareBasis(ctx, points.length);

  // Is the leader ahead of the field, or just first in it? A ranking always has
  // a top row; only some rankings have a leader, and the difference is the gap
  // measured against how much the rest of the field varies.
  //
  // Both halves of that are needed. A z-score is scale-free, so five regions
  // inside a one-percent band still hand the top one a two-sigma lead, and
  // reporting it as separation is how an automatic summary manufactures a story
  // out of rounding. A lead counts when it is large against the spread AND
  // large enough to matter — here, a runner-up at least a twentieth behind.
  const lead = leadInStdevs(sortedVals);
  const materialGap = gapToSecond === null ? 0 : Math.abs(gapToSecond);
  const separated = lead !== null && lead >= 2 && materialGap >= 5;
  const tied = lead !== null && (lead < 1 || materialGap < 2);
  const spreadIndex = gini(vals);

  // Where the mean sits relative to the typical category. They come apart when
  // a few large categories drag the average above where most of the field
  // actually is, and "above average" then describes a bar most categories could
  // never reach. This is the sentence a careful analyst adds and a template
  // never does.
  const meanVsMedian = mid !== 0 ? ((avg - mid) / Math.abs(mid)) * 100 : null;
  const skewed = isNum(meanVsMedian) && Math.abs(meanVsMedian) >= 15;

  const concentrated =
    additive && (leaderShare >= CONCENTRATION_PCT || paretoCount <= Math.max(1, points.length * 0.3));

  /**
   * What a ranking rests on is the records, not the bars.
   *
   * `observations` was the number of categories, so a comparison of three
   * contract types was scored as three observations and docked two tiers —
   * which is how a churn rate of 50% against 6%, measured across nine hundred
   * customers, came out as "the gaps here are not yet large enough to be sure
   * they are real". Three groups is a small number of bars and can be an
   * enormous amount of evidence. The bar count still matters when it is the
   * only thing there is, so the two are taken together: the records behind the
   * chart when they are known, and never more evidence than a single category
   * could support.
   */
  const perGroup = ctx.sourceRows ? ctx.sourceRows / Math.max(1, points.length) : 0;
  // Two bars is a comparison; three or more is a shape that can be reasoned
  // about. Below three the bar count stays the evidence however many records
  // sit behind it, because there is no field for the leader to be clear of.
  const restsOn =
    points.length < 3 ? points.length : Math.max(points.length, Math.min(perGroup, 40));

  const evidenceOf = evidence({
    observations: restsOn,
    // A ranking's effect size is how unequal the field is. A perfectly even one
    // is a real result and a weak finding.
    effect: spreadIndex,
    limited: ctx.limited,
    notes: tied ? ['the leader is not separated from the rest of the field'] : [],
  });

  const metrics = {
    leader: top.label,
    leaderValue: top.value,
    leaderSharePct: additive ? round(leaderShare) : null,
    // Which denominator the shares above were computed against. A LIMIT-ed
    // result cannot speak for rows it never saw. Null where there are no
    // shares: the summary collects a caveat for every finding that says
    // "shown", and a caveat about shares nobody quoted is noise.
    sharesMeasuredAgainst: additive ? basis.of : null,
    deltaVsAvgPct: round(deltaVsAvg),
    gapToSecondPct: gapToSecond === null ? null : round(gapToSecond),
    // In standard deviations of the rest of the field. Under 1 the leader is
    // not separated from the pack, however large its percentage lead looks.
    leadOverFieldSd: lead === null ? null : round(lead, 1),
    // Carried as a sentence so it survives into the narrator's fact list, where
    // a bare boolean would be one more unreadable line. Null when the leader is
    // neither clearly ahead nor effectively tied.
    leadIsReal: tied
      ? 'the field behind the leader is bunched: the ordering is provisional'
      : separated
        ? 'the leader is clear of the rest of the field'
        : null,
    runnerUp: second ? second.label : null,
    laggard: bottom.label,
    laggardValue: bottom.value,
    leaderToLaggardRatio: spread === null ? null : round(spread, 1),
    average: round(avg),
    median: round(mid),
    // How many times the average the leader is. The comparison that survives
    // when a share does not: it is meaningful for an average or a rate, where
    // "share of the total" is not.
    leaderVsAverage: avg > 0 ? round(top.value / avg, 1) : null,
    // Positive when the average sits above the typical category, which means a
    // few large ones are carrying it.
    meanAboveMedianPct: meanVsMedian === null ? null : round(meanVsMedian),
    belowAverage,
    total: additive ? round(total) : null,
    categories: points.length,
    paretoCount: additive ? paretoCount : null,
    paretoSharePct: additive ? round(paretoShare) : null,
    // 0 is a perfectly even field, 1 is one category holding everything.
    spreadIndex: round(spreadIndex, 2),
    outliers: outliers.map((o) => o.label),
    evidence: evidenceOf.tier,
    evidenceNotes: evidenceOf.reasons,
  };

  const opener = `${top.label} leads ${plural(dim.toLowerCase())} on ${measurePhrase(measure)} at ${compactNum(top.value)}`;
  const headline = additive
    ? `${opener}${leaderShare > 0 ? `, ${pct(leaderShare)} of ${basis.phrase}` : ''}.`
    : avg > 0
      // No share, because there is no whole. The multiple of the average says
      // the same thing about the size of the gap and claims nothing false.
      ? `${opener}, ${(top.value / avg).toFixed(1)}× the ${compactNum(avg)} average across ${points.length} ${plural(dim.toLowerCase())}.`
      : `${opener}.`;

  const parts = [
    say(
      1.0,
      `That is ${pct(Math.abs(deltaVsAvg))} ${deltaVsAvg >= 0 ? 'above' : 'below'} the ${compactNum(avg)} average across ${points.length} ${plural(dim.toLowerCase())}` +
        (gapToSecond !== null
          ? `, and ${pct(Math.abs(gapToSecond))} ${gapToSecond >= 0 ? 'ahead of' : 'behind'} ${second.label}`
          : '') +
        '.'
    ),
    // Whether the lead is real. A runaway leader and a photo finish are both
    // worth a sentence; a leader a little ahead of the field is not. The
    // standard-deviation figure is only quoted while it stays a number a person
    // can picture — past about ten it is arithmetic, not information, and the
    // multiple in the sentence below already carries the point.
    tied
      ? say(
          0.9,
          `The ${plural(dim.toLowerCase())} behind ${top.label} are bunched close enough that the ordering is nearer a tie than a ranking — a normal month could rearrange it.`
        )
      : separated
        ? say(
            0.45 + Math.min(0.45, (lead - 2) / 4),
            lead <= 10
              ? `${top.label} sits ${lead.toFixed(1)} standard deviations clear of the rest of the field, so this is a leader rather than a first place.`
              : `${top.label} sits far outside the spread of the rest of the field, so this is a leader rather than a first place.`
          )
        : null,
    // The shape of the distribution, not just its top. A leader means one thing
    // when the field behind it is even and another when it has collapsed.
    spread !== null && spread >= 2
      ? say(
          0.5 + Math.min(0.4, spread / 25),
          `${top.label} is ${spread >= 10 ? Math.round(spread) : spread.toFixed(1)}× ${bottom.label} at the other end, and ${belowAverage} of ${points.length} sit below the average — the field is top-heavy rather than evenly matched.`
        )
      : points.length > 2
        ? say(0.45, `${belowAverage} of ${points.length} sit below the average, so the range is tight and the lead is narrow.`)
        : null,
    // The average against the typical case, which only matters when they differ.
    skewed
      ? say(
          // Weighted to beat the shape sentences when the divergence is large,
          // because it is the one that changes what "above average" means.
          0.5 + Math.min(0.45, Math.abs(meanVsMedian) / 250),
          `The typical ${dim.toLowerCase()} is nearer ${compactNum(mid)} than the ${compactNum(avg)} average — a handful of large ${plural(dim.toLowerCase())} are pulling the mean ${meanVsMedian >= 0 ? 'up' : 'down'}, so "above average" is a lower bar than it sounds.`
        )
      : null,
    // Pareto is a statement about a whole, so it is only made where there is one.
    additive
      ? say(
          concentrated ? 0.8 : 0.35,
          concentrated
            ? `Just ${paretoCount} of ${points.length} account for about 80% of ${basis.phrase} — a concentrated mix, so movement in those few decides the number.`
            : `It takes ${paretoCount} of ${points.length} to reach about 80% of ${basis.phrase}, so no single ${dim.toLowerCase()} moves the number on its own.`
        )
      : null,
    outliers.length
      ? say(
          0.5 + Math.min(0.35, outliers.length / 8),
          `${outliers.map((o) => o.label).join(', ')} sit outside the normal range for this set — worth checking whether that is real or a data problem.`
        )
      : null,
  ];

  // Caveats are not observations competing for space. Each is the sentence that
  // stops the numbers above being read as something they are not — a share of
  // the business when the query stopped at ten rows, or a share of a whole when
  // the values are averages that never made one.
  const noWhole = additive
    ? null
    : `These are ${measurePhrase(measure)} rather than totals, so they do not add up to a whole — the gap between ${top.label} and ${bottom.label} is the finding here, not any one ${dim.toLowerCase()}'s share of it.`;
  // The truncation caveat is worded around shares, so a chart that quotes none
  // gets the same warning said about the rows themselves instead.
  const cut = !ctx.limited
    ? null
    : additive
      ? basis.caveat
      : `This is the top ${points.length} only — the query stops there, so there are ${plural(dim.toLowerCase())} below the cut that this chart does not show.`;
  const detail = [compose(parts.filter(Boolean), 3), noWhole, cut].filter(Boolean).join(' ');

  const recommendation = rankingRecommendation({
    tier: evidenceOf.tier,
    concentrated,
    tied,
    leader: top.label,
    belowAverage,
    basis,
    dim,
  });

  return { metrics, headline, detail, recommendation };
}

/**
 * What to do about a ranking — and how firmly to say it.
 *
 * Three different shapes get three different asks, and none of them gets a
 * verb the evidence does not support. A ranking whose leader is not separated
 * from the field cannot carry "press this advantage"; the honest instruction
 * there is to stop treating the order as information.
 */
function rankingRecommendation({ tier, concentrated, tied, leader, belowAverage, basis, dim }) {
  if (tied) {
    return `Treat the order here as provisional: ${leader} is not separated from the field, so ranking work off it will chase noise. Find a cut of the data where the ${plural(dim.toLowerCase())} actually diverge.`;
  }
  if (concentrated) {
    const what = basis.of === 'shown' ? 'the number' : 'the total';
    return actionable(tier)
      ? `Decide whether the reliance on ${leader} is a strength to press or an exposure to hedge, and model what ${what} looks like if it slips.`
      : `Confirm the reliance on ${leader} against a fuller cut of the data before planning around it — on this evidence it is a pattern to watch rather than one to act on.`;
  }
  return actionable(tier)
    ? `Find what the leaders do differently and whether it transfers — lifting the ${belowAverage} below average is worth more here than pushing ${leader} further ahead.`
    : `Look for what separates the ${belowAverage} below average from the rest before committing effort either way; the gaps here are not yet large enough to be sure they are real.`;
}

/**
 * Can the values on this chart be added up into a whole?
 *
 * Only some can, and the distinction decides whether a share may be quoted at
 * all. A chart of AVG(revenue) by category returns four averages; adding them
 * produces a number that is not the revenue of anything, and a category's
 * "62.2% of the total" computed against it is a percentage of a quantity that
 * does not exist. It reads exactly like a market share, which is what makes it
 * worse than saying nothing — a reader has no way to tell the two apart.
 *
 * The aliases these names come from are generated by lib/aggregateNames.js, so
 * an average always arrives as "Average <column>". The rate words cover the
 * columns that are already per-something before any aggregate is applied.
 */
export function isAdditiveMeasure(name) {
  const m = String(name || '').trim();
  if (!m) return true;
  if (/^(average|avg|mean|median|rate|ratio|index|score|percent)\b/i.test(m)) return false;
  return !/\b(per|percent|pct|rate|ratio|margin|share)\b/i.test(m);
}

/**
 * How to describe the denominator a share was computed against.
 *
 * Returns the phrase to use in prose, the machine-readable basis for the
 * metrics, and — when the result is a truncated top-N — the sentence that says
 * so out loud, once, rather than letting the reader assume otherwise.
 */
function shareBasis(ctx, shown) {
  if (!ctx?.limited) return { of: 'total', phrase: 'the total', caveat: null };
  return {
    of: 'shown',
    phrase: `the ${shown} shown`,
    caveat: `These shares are of the ${shown} rows this chart returned, not of the whole dataset \u2014 the query stops at ${shown}.`,
  };
}

function analyzeTrend(series, ctx) {
  const { valueKey } = series;
  const measure = ctx.measureLabel || prettyKey(valueKey);
  // Read the direction off time, not off whatever order the query returned.
  //
  // A chart whose SQL ends `ORDER BY revenue DESC LIMIT 12` gives twelve months
  // sorted by size. Walking that as a series produces a confident, precise
  // "declining 64% from March to November" describing nothing but the sort.
  const points = chronological(series.points);
  const vals = points.map((p) => p.value);
  const first = points[0];
  const last = points[points.length - 1];
  const totalChange = first.value !== 0 ? ((last.value - first.value) / Math.abs(first.value)) * 100 : null;

  // Per-period growth (CAGR-style) over the number of intervals.
  const periods = points.length - 1;
  let perPeriod = null;
  if (periods > 0 && first.value > 0 && last.value > 0) {
    perPeriod = (Math.pow(last.value / first.value, 1 / periods) - 1) * 100;
  }

  const maxP = points.reduce((a, b) => (b.value > a.value ? b : a));
  const minP = points.reduce((a, b) => (b.value < a.value ? b : a));
  const mu = mean(vals);
  const volatility = mu !== 0 ? (stdev(vals, mu) / Math.abs(mu)) * 100 : 0;
  // How much the series moves that the trend does not account for.
  //
  // Raw spread around the mean is the wrong number for the sentence it was
  // feeding. A clean exponential has an enormous coefficient of variation
  // purely because it grew, so the steadiest series in the deck was being
  // described as wildly volatile and the reader told not to trust any single
  // period of it. What "one period is a poor guide to the next" actually needs
  // is the spread of the residuals: the part of the movement the direction
  // cannot explain.
  const noise = mu !== 0 ? (stdev(residuals(vals)) / Math.abs(mu)) * 100 : 0;

  // Linear regression slope sign for robust direction (less noisy than endpoints).
  const slope = linregSlope(vals);
  const direction =
    Math.abs(slope) < (Math.abs(mu) * 0.005 || 1e-9) ? 'flat' : slope > 0 ? 'rising' : 'declining';

  // How much of the movement the trend line actually accounts for.
  //
  // The single most useful number on a time series and the one nothing here
  // reported. A direction with an R^2 of 0.9 is a trend you can plan against; the
  // same direction at 0.15 is a series bouncing around a flat mean with a faint
  // tilt, and calling both of them "trended up" is how a forecast gets built on
  // noise. Everything below that describes the direction is weighted by it.
  const fit = fitQuality(vals);

  // Is the movement speeding up or running out? Compared as the slope of the
  // back half against the slope of the front half, which is the question
  // "is this still happening" — invisible in a start-to-end growth rate.
  const half = Math.floor(points.length / 2);
  const early = linregSlope(vals.slice(0, half + (points.length % 2)));
  const late = linregSlope(vals.slice(half));
  let momentum = null;
  if (points.length >= 6 && Math.abs(early) > 0 && direction !== 'flat') {
    const ratio = late / early;
    if (ratio < 0) momentum = 'reversed';
    else if (ratio >= 1.5) momentum = 'accelerating';
    else if (ratio <= 0.5) momentum = 'slowing';
    else momentum = 'steady';
  }

  // How far below its own peak the series currently sits. A rise that peaked
  // three periods ago is a different situation from one still at its high, and
  // no direction word distinguishes them.
  const drawdown = maxP.value > 0 ? ((maxP.value - last.value) / maxP.value) * 100 : 0;
  const peakIsLast = maxP.label === last.label;

  /**
   * Does the net start-to-end change run against the fitted direction?
   *
   * The two are measured differently and can legitimately disagree: a series
   * that climbs for six periods and collapses in the seventh is rising by
   * slope and down on its endpoints. Both facts are true and neither is the
   * other, but every sentence below used to pair them as though they were one —
   * which produced headlines that contradicted themselves inside a single
   * clause: "Revenue trended up from 2025-01 to 2025-07, a 10.0% decrease."
   *
   * That string is also the `finding` handed to the narrator, which may rewrite
   * the wording but is forbidden to correct the numbers. So the contradiction
   * survived all the way onto the slide. Everything that could pair a direction
   * with an endpoint figure now checks this first and says two things when
   * there are two things to say.
   */
  const netAgainstTrend =
    direction !== 'flat' &&
    totalChange !== null &&
    Math.abs(totalChange) >= 0.05 && // any smaller and it prints as 0.0% anyway
    Math.sign(totalChange) !== (direction === 'rising' ? 1 : -1);

  // The most recent period-on-period change, in percent.
  const previous = points[points.length - 2];
  const lastStep =
    previous && previous.value !== 0 ? ((last.value - previous.value) / Math.abs(previous.value)) * 100 : null;

  const evidenceOf = evidence({
    observations: points.length,
    // A direction is worth as much as the fit behind it. A flat series is a
    // real answer, and its effect size is honestly near zero.
    effect: direction === 'flat' ? Math.min(0.3, fit) : fit,
    limited: ctx.limited,
    notes: [
      fit < 0.3 && direction !== 'flat'
        ? 'the trend line accounts for less than a third of the movement, so the direction is faint against the noise'
        : null,
      netAgainstTrend ? 'the direction and the net change over the span disagree' : null,
    ].filter(Boolean),
  });

  const metrics = {
    direction,
    // 0..100. How much of the movement the fitted direction explains; the rest
    // is period-to-period noise.
    fitQualityPct: round(fit * 100),
    momentum,
    lastPeriodChangePct: lastStep === null ? null : round(lastStep),
    startLabel: first.label,
    startValue: round(first.value),
    endLabel: last.label,
    endValue: round(last.value),
    totalChangePct: totalChange === null ? null : round(totalChange),
    perPeriodPct: perPeriod === null ? null : round(perPeriod),
    peakLabel: maxP.label,
    peakValue: round(maxP.value),
    troughLabel: minP.label,
    troughValue: round(minP.value),
    // Null while the series is at its own high, where a drawdown is not a fact
    // about the data so much as a rounding of zero.
    belowPeakPct: peakIsLast || drawdown <= 0 ? null : round(drawdown),
    volatilityPct: round(volatility),
    // The share of the mean that period-to-period movement swings by once the
    // trend is taken out. This, not volatilityPct, is what says whether one
    // period predicts the next.
    swingAroundTrendPct: round(noise),
    periods,
    // Carried as a sentence rather than a boolean, and null when the two agree.
    // factList turns every metric into a line of the "verified numbers" the
    // narrator works from, where a bare `false` on every well-behaved trend is
    // noise and a bare `true` is not something a reader can use.
    netChangeVsTrend: netAgainstTrend
      ? `${direction === 'rising' ? 'rose' : 'fell'} overall, but ended ${
          totalChange >= 0 ? 'above' : 'below'
        } where it started`
      : null,
    evidence: evidenceOf.tier,
    evidenceNotes: evidenceOf.reasons,
  };

  const dirWord = direction === 'flat' ? 'held roughly flat' : direction === 'rising' ? 'trended up' : 'trended down';
  const sameSpan = first.label === last.label; // single-period datasets (e.g. all one month)
  const span = `${first.label} to ${last.label}`;
  const netSide = totalChange >= 0 ? 'above' : 'below';

  let headline;
  if (sameSpan) {
    headline = `${measure} stayed around ${compactNum(mu)} across the ${first.label} period.`;
  } else if (netAgainstTrend) {
    // Two different true things, said as two things. The shape this describes —
    // a long climb that turned late, or a long fall that recovered — is the
    // most decision-relevant thing on the chart, and collapsing it into one
    // adjective and one percentage lost it as well as contradicting itself.
    headline =
      `${measure} ${direction === 'rising' ? 'rose' : 'fell'} across most of ${span}, ` +
      `but finished ${pct(Math.abs(totalChange))} ${netSide} where it started.`;
  } else if (totalChange === null) {
    headline = `${measure} ${dirWord} from ${span}.`;
  } else if (direction === 'flat') {
    // A flat slope says nothing about where the series ended, so the net change
    // is reported as its own fact rather than as the size of a move.
    headline =
      Math.abs(totalChange) >= 5
        ? `${measure} ${dirWord} from ${span}, though it ended ${pct(Math.abs(totalChange))} ${netSide} where it started.`
        : `${measure} ${dirWord} from ${span}, within ${pct(Math.abs(totalChange))} end to end.`;
  } else {
    headline = `${measure} ${dirWord} from ${span}, a ${pct(Math.abs(totalChange))} ${
      totalChange >= 0 ? 'increase' : 'decrease'
    }.`;
  }

  const observations = [
    perPeriod === null
      ? null
      : say(
          // Above every other weight so it never loses its place: this is the
          // quantification of the headline, not a supporting remark.
          1.1,
          // Named for the basis it was measured on. This is a start-to-end rate, so
          // on a series that turned late it runs opposite to the fitted direction —
          // and "That works out to" read as a restatement of the trend rather than
          // a second measurement of it.
          `Measured start to end that is about ${pct(Math.abs(perPeriod))} ${perPeriod >= 0 ? 'growth' : 'decline'} per period, compounded across ${periods} ${periods === 1 ? 'interval' : 'intervals'}.`
        ),
    // How much of the movement is the trend at all. Weighted by how badly the
    // fit fails, because a clean fit needs no comment and a poor one changes
    // what every other sentence on the slide is worth.
    direction === 'flat' || points.length < 4
      ? null
      : say(
          fit < 0.5 ? 0.7 + (0.5 - fit) : 0.3,
          fit >= 0.75
            ? `The direction is clean: a straight line accounts for ${pct(fit * 100, 0)} of the movement, so the trend is the story rather than one of several.`
            : fit >= 0.4
              ? `A straight line accounts for ${pct(fit * 100, 0)} of the movement, so the direction is real but individual periods still swing around it.`
              : `A straight line accounts for only ${pct(fit * 100, 0)} of the movement — most of what the chart shows is period-to-period variation, not the trend, so treat the direction as faint rather than established.`
        ),
    // Direction-aware, because "accelerating" is good news on a rise and bad
    // news on a fall, and one wording for both told a business its collapse was
    // picking up nicely.
    momentum === 'accelerating' || momentum === 'slowing'
      ? say(
          0.85,
          momentum === 'accelerating'
            ? direction === 'rising'
              ? `The second half grew faster than the first, so this is picking up rather than levelling off — plans built on the average rate will undershoot.`
              : `The second half fell faster than the first, so the decline is steepening rather than bottoming out, and plans built on the average rate will be too optimistic.`
            : direction === 'rising'
              ? `The second half grew more slowly than the first, so the rise is running out of momentum and plans built on the average rate will overshoot.`
              : `The second half fell more slowly than the first, so the decline is easing — the worst of it may already be in the numbers.`
        )
      : null,
    say(0.35, `It peaked at ${compactNum(maxP.value)} (${maxP.label}) and bottomed at ${compactNum(minP.value)} (${minP.label}), a range of ${compactNum(maxP.value - minP.value)}.`),
    !peakIsLast && drawdown >= 10
      ? say(
          0.5 + Math.min(0.35, drawdown / 150),
          `It is currently ${pct(drawdown)} below its ${maxP.label} peak, so the high on this chart is history rather than the level to plan from.`
        )
      : null,
    say(
      noise > 25 ? 0.65 : 0.3,
      noise > 25
        ? `Period-to-period swings are large — about ${pct(noise)} of the mean once the trend is taken out — so any single period is a poor guide to the next one, and the direction matters more than the latest number.`
        : `The series is steady around its trend, swinging about ${pct(noise)} of the mean from period to period, so the direction is worth reading as signal rather than noise.`
    ),
    // What the most recent period did, which is the part a reader acts on and
    // the part an average over the whole span hides. Weighted above everything
    // when it contradicts the trend, because that is the moment a reader would
    // otherwise walk out with the wrong expectation.
    lastStep !== null && points.length > 2
      ? (() => {
          const withTrend =
            (lastStep >= 0 && direction === 'rising') || (lastStep < 0 && direction === 'declining');
          return say(
            withTrend || direction === 'flat' ? 0.45 : 1.2,
            `The last period ${lastStep >= 0 ? 'rose' : 'fell'} ${pct(Math.abs(lastStep))} on the one before, ${
              direction === 'flat'
                ? 'against an otherwise flat series'
                : withTrend
                  ? 'continuing the trend'
                  : 'breaking the trend — worth confirming before it is read as a turning point'
            }.`
          );
        })()
      : null,
  ];

  const detail = compose(observations.filter(Boolean), 4);

  const recommendation = trendRecommendation({
    tier: evidenceOf.tier,
    netAgainstTrend,
    direction,
    momentum,
    fit,
    measure,
    last,
    minP,
  });

  return { metrics, headline, detail: detail.trim(), recommendation };
}

/** What is left of a series after its straight-line trend is subtracted. */
function residuals(ys) {
  const n = ys.length;
  if (n < 3) return ys.map(() => 0);
  const slope = linregSlope(ys);
  const my = mean(ys);
  const mx = (n - 1) / 2;
  return ys.map((y, i) => y - (my + slope * (i - mx)));
}

/** How much of a series a straight line accounts for: R^2 of the linear fit. */
function fitQuality(ys) {
  const n = ys.length;
  if (n < 3) return 0;
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
  return Math.max(0, Math.min(1, (sxy * sxy) / (sxx * syy)));
}

/**
 * The next move on a time series, matched to what the series will support.
 *
 * A faint direction over a noisy series and a clean compounding one are not the
 * same instruction, and the difference is the whole value of having measured
 * the fit. A reversal is neither: there the open question is which of the two
 * readings is real, and acting on the wrong one is the expensive mistake.
 */
function trendRecommendation({ tier, netAgainstTrend, direction, momentum, fit, measure, last, minP }) {
  if (netAgainstTrend) {
    return `Establish whether ${last.label} is a turning point or a one-off before planning on either the trend or the latest figure.`;
  }
  if (direction !== 'flat' && fit < 0.3) {
    return `Do not plan off this direction yet: most of the movement is period-to-period variation. Find the cut of the data where ${measure.toLowerCase()} moves consistently, or wait for more periods.`;
  }
  if (direction === 'declining') {
    return momentum === 'accelerating'
      ? `The fall is steepening rather than bottoming out — identify what changed around ${minP.label} and act before the next period compounds it.`
      : actionable(tier)
        ? `Identify what changed around ${minP.label} and whether the decline is structural or seasonal before it compounds.`
        : `Watch this for another period or two before treating the decline as established, then trace it back to what changed around ${minP.label}.`;
  }
  if (direction === 'rising') {
    return momentum === 'slowing'
      ? `Growth is decelerating: set targets off the recent rate rather than the average one, and find out what stopped working before the curve flattens.`
      : `Confirm the drivers behind the rise are repeatable, and set targets off the current run-rate rather than the starting point.`;
  }
  return `Find out why ${measure.toLowerCase()} is stuck flat and what lever would break it out of the range.`;
}

function analyzeComposition(series, ctx) {
  const { points, valueKey, labelKey } = series;
  const measure = ctx.measureLabel || prettyKey(valueKey);
  const dim = ctx.dimLabel || prettyKey(labelKey);
  const vals = points.map((p) => p.value);
  const total = vals.reduce((s, v) => s + v, 0);
  const sorted = [...points].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const topShare = total > 0 ? (top.value / total) * 100 : 0;
  const top2 = sorted.slice(0, 2).reduce((s, p) => s + p.value, 0);
  const top2Share = total > 0 ? (top2 / total) * 100 : 0;

  // Herfindahl–Hirschman Index (0..1) as a concentration measure.
  let hhi = 0;
  if (total > 0) for (const v of vals) hhi += (v / total) ** 2;

  // The inverse of HHI: how many equal-sized segments this mix behaves like.
  //
  // The plainest way to say what a concentration index means. "HHI 0.38" is a
  // number only an economist reads; "eight segments that behave like two and a
  // half" is the same fact in a form a room can act on, and it makes the gap
  // between the segment count and the real spread impossible to miss.
  const effectiveSegments = hhi > 0 ? 1 / hhi : points.length;
  const spreadIndex = gini(vals);

  // The long end of the mix: everything outside the top two.
  const rest = sorted.slice(2);
  const tail = {
    count: rest.length,
    sharePct: total > 0 ? round((rest.reduce((s, p) => s + p.value, 0) / total) * 100) : 0,
    first: rest.length ? rest[0].label : null,
  };
  const basis = shareBasis(ctx, points.length);

  // One leader carrying this much of the total is a concentrated mix whatever
  // the tail does, so it is not described as balanced anywhere downstream.
  const concentrated = hhi >= 0.5 || topShare >= CONCENTRATION_PCT;

  const evidenceOf = evidence({
    observations: points.length,
    effect: spreadIndex,
    limited: ctx.limited,
  });

  const metrics = {
    dominant: top.label,
    dominantSharePct: round(topShare),
    top2SharePct: round(top2Share),
    tailSegments: tail.count,
    tailSharePct: tail.sharePct,
    segments: points.length,
    hhi: round(hhi, 3),
    // How many equal segments the mix behaves like, which is always at most the
    // number it has.
    effectiveSegments: round(effectiveSegments, 1),
    spreadIndex: round(spreadIndex, 2),
    concentration: hhi >= 0.5 ? 'high' : hhi >= 0.25 ? 'moderate' : 'low',
    sharesMeasuredAgainst: basis.of,
    total: round(total),
    evidence: evidenceOf.tier,
    evidenceNotes: evidenceOf.reasons,
  };

  // Naming the measure matters more here than anywhere else in the deck. Two
  // composition slides over the same categories — one of revenue, one of order
  // counts — both said "accounts for 42.9% of the total", and side by side in a
  // summary they read as a contradiction rather than as the two halves of the
  // most interesting fact in the file.
  const headline = `${top.label} accounts for ${pct(topShare)} of ${
    basis.of === 'shown' ? basis.phrase : measurePhrase(measure)
  }, the largest share of any ${dim.toLowerCase()}.`;

  const observations = [
    say(0.9, `The top two ${plural(dim.toLowerCase())} together carry ${pct(top2Share)} across ${points.length} segments.`),
    // The gap between how many segments there are and how many the mix behaves
    // like. Only worth saying when the two have genuinely come apart.
    points.length >= 4 && effectiveSegments <= points.length * 0.7
      ? say(
          0.5 + Math.min(0.4, (points.length - effectiveSegments) / points.length),
          `Weighted by size, the ${points.length} segments behave like about ${effectiveSegments.toFixed(1)} equal ones — the segment count overstates how spread the mix really is.`
        )
      : null,
    tail.count > 0
      ? say(
          0.45 + Math.min(0.3, tail.count / 20),
          `The remaining ${tail.count} ${tail.count === 1 ? 'segment carries' : 'segments carry'} ${pct(tail.sharePct)} between them, so most of the mix is decided before you reach ${tail.first}.`
        )
      : null,
    say(
      concentrated ? 0.95 : 0.6,
      concentrated
        ? `One ${dim.toLowerCase()} dominates: ${top.label} alone carries ${pct(topShare)}, which means the headline number is largely a report on ${top.label}.`
        : hhi >= 0.25
          ? 'Concentration is moderate — there is a clear leader, but enough spread that no one segment sets the result.'
          : 'The mix is well diversified, with no single segment dominating, so a shock to any one of them is absorbable.'
    ),
  ];

  const detail = [compose(observations.filter(Boolean), 3), basis.caveat].filter(Boolean).join(' ');

  const recommendation = concentrated
    ? actionable(evidenceOf.tier)
      ? `Stress-test the exposure to ${top.label}: model what ${measurePhrase(measure)} looks like if it fell by a quarter, and decide whether that is a risk worth carrying.`
      : `Confirm the size of the exposure to ${top.label} on a fuller cut before acting on it — on these segments it is a concentration to verify, not yet one to hedge.`
    : `Keep the balance while watching whether ${top.label} keeps pulling ahead — it is the only segment currently able to change the shape of this mix.`;

  return { metrics, headline, detail, recommendation };
}

function analyzeCorrelation(series, ctx) {
  const { numericKeys } = series;
  const xK = ctx.xKey && numericKeys.includes(ctx.xKey) ? ctx.xKey : numericKeys[0];
  const yK = ctx.yKey && numericKeys.includes(ctx.yKey) && ctx.yKey !== xK ? ctx.yKey : numericKeys.find((k) => k !== xK);
  const rows = ctx.rows || [];
  const xs = rows.map((r) => toNum(r[xK])).filter(isNum);
  const ys = rows.map((r) => toNum(r[yK])).filter(isNum);
  const r = pearson(xs, ys);

  if (r === null) {
    return {
      metrics: { correlation: null, note: 'insufficient or constant data', evidence: 'thin' },
      headline: `Not enough variation to measure a relationship between ${prettyKey(xK)} and ${prettyKey(yK)}.`,
      detail: 'At least three varying points on both axes are needed for a reliable correlation.',
      recommendation: `Gather more granular records before reading a relationship into ${prettyKey(xK)} and ${prettyKey(yK)}.`,
    };
  }

  const points = Math.min(xs.length, ys.length);
  const strength = correlationStrength(r);
  const dir = r > 0 ? 'positive' : 'negative';

  // Two things a scatter plot cannot tell you by looking, and both change what
  // the chart is worth.
  //
  // Significance: with eight points, r = 0.6 turns up often enough between
  // unrelated columns that seeing it means almost nothing. Without the test,
  // every small result reads as a discovery.
  //
  // Rank agreement: Spearman is Pearson on ranks, so it ignores how far out an
  // extreme point sits. When the two disagree badly the relationship is one or
  // two rows carrying the whole line, and the honest description is a cloud
  // with a dot in the corner rather than a trend.
  const significant = correlationIsSignificant(r, points);
  const rankR = spearman(xs.slice(0, points), ys.slice(0, points));
  const outlierDriven = rankR !== null && Math.abs(r) - Math.abs(rankR) >= 0.25;

  const evidenceOf = evidence({
    observations: points,
    // The weaker of the two correlations, because that is what the chart will
    // actually look like once the extreme points are read as the rows they are.
    effect: rankR === null ? Math.abs(r) : Math.min(Math.abs(r), Math.abs(rankR)),
    limited: ctx.limited,
    // A correlation that chance produces is never better than indicative, and
    // one carried by two extreme points is never better than moderate, whatever
    // the coefficient says.
    cap: !significant ? 'indicative' : outlierDriven ? 'moderate' : null,
    notes: [
      significant ? null : 'a relationship this size on this many points is within what chance produces',
      outlierDriven ? 'the rank correlation is much weaker, so a few extreme points are carrying the line' : null,
    ].filter(Boolean),
  });

  const metrics = {
    correlation: round(r, 2),
    // Pearson on ranks. Close to the correlation above when the relationship is
    // spread across the points; far below it when a few extremes carry it.
    rankCorrelation: rankR === null ? null : round(rankR, 2),
    rSquaredPct: round(r * r * 100),
    strength,
    direction: dir,
    xField: prettyKey(xK),
    yField: prettyKey(yK),
    unexplainedPct: round(100 - r * r * 100),
    points,
    // Both carried as sentences rather than booleans: they are what a reader
    // needs in order not to over-read the chart, and the fact list turns every
    // metric into a line of prose.
    statisticalSignificance: significant
      ? 'stronger than chance would produce at this sample size'
      : 'within what chance produces at this sample size, so not yet a finding',
    outlierWarning: outlierDriven
      ? 'a few extreme points are carrying most of this relationship; the rank correlation is much weaker'
      : null,
    evidence: evidenceOf.tier,
    evidenceNotes: evidenceOf.reasons,
  };

  const headline = significant
    ? `${prettyKey(xK)} and ${prettyKey(yK)} show a ${strength} ${dir} relationship (r = ${r.toFixed(2)}).`
    : `${prettyKey(xK)} and ${prettyKey(yK)} line up loosely (r = ${r.toFixed(2)}), but across ${points} points that is within what chance produces.`;

  const observations = [
    say(
      0.9,
      `As ${prettyKey(xK).toLowerCase()} rises, ${prettyKey(yK).toLowerCase()} tends to ${r >= 0 ? 'rise too' : 'fall'}. ` +
        `${prettyKey(xK)} accounts for about ${pct(r * r * 100, 0)} of the variation in ${prettyKey(yK).toLowerCase()}, ` +
        `which leaves ${pct(100 - r * r * 100, 0)} coming from something else.`
    ),
    outlierDriven
      ? say(
          1.0,
          `On ranks alone the relationship is only ${rankR.toFixed(2)}, so a handful of extreme points are carrying the line rather than a pattern running through the middle of the data. Check those points before treating this as a rule.`
        )
      : null,
    say(
      significant ? 0.5 : 0.95,
      significant
        ? Math.abs(r) >= 0.6
          ? `Across ${points} points that is a strong enough link to plan against, though it says the two move together — not that one causes the other.`
          : `Across ${points} points that is a real but loose link: treat it as a hint worth testing, not a rule to act on.`
        : `Across ${points} points a correlation this size is not distinguishable from chance, so it is a question to put to more data rather than an answer to act on.`
    ),
    points < 12 ? say(0.6, `With only ${points} points, one unusual row could move this figure noticeably.`) : null,
  ];

  const detail = compose(observations.filter(Boolean), 3);

  const recommendation = !significant
    ? `Collect more observations before reading anything into ${prettyKey(xK).toLowerCase()} and ${prettyKey(yK).toLowerCase()} — at this sample size the pattern is not separable from noise.`
    : outlierDriven
      ? `Check the handful of extreme points first: remove them and this relationship largely goes with them, so any decision resting on it rests on those rows.`
      : Math.abs(r) >= 0.6
        ? `Test whether moving ${prettyKey(xK).toLowerCase()} reliably shifts ${prettyKey(yK).toLowerCase()} — it may be a usable lever.`
        : `Don't over-rely on this relationship; look for stronger drivers of ${prettyKey(yK).toLowerCase()}.`;

  return { metrics, headline, detail, recommendation };
}

function analyzeDistribution(series, ctx) {
  // Result rows here are already bucketed (label = range, value = count).
  const { points, valueKey } = series;
  const measure = ctx.measureLabel || prettyKey(valueKey);
  const total = points.reduce((s, p) => s + p.value, 0);
  const sorted = [...points].sort((a, b) => b.value - a.value);
  const modal = sorted[0];
  const modalShare = total > 0 ? (modal.value / total) * 100 : 0;

  const second = sorted[1] || null;
  const topTwoShare = total > 0 ? ((modal.value + (second?.value || 0)) / total) * 100 : 0;
  const sparse = points.filter((p) => total > 0 && p.value / total < 0.05).length;

  // Which way the mass leans, read off the bands in the order they are drawn.
  //
  // A histogram's whole value to a decision is whether the typical record is
  // the average one, and the answer is in the asymmetry: a right-skewed measure
  // means most records sit below the mean and a handful of large ones set it.
  // Reporting only the modal band left that unsaid on every skewed dataset.
  const modalIndex = points.indexOf(modal);
  const belowMode = points.slice(0, modalIndex).reduce((s, p) => s + p.value, 0);
  const aboveMode = points.slice(modalIndex + 1).reduce((s, p) => s + p.value, 0);
  const lean = total > 0 ? ((aboveMode - belowMode) / total) * 100 : 0;
  const skewDirection = Math.abs(lean) < 10 ? 'symmetric' : lean > 0 ? 'right' : 'left';

  // How many bands it takes to hold four records in five — the same Pareto
  // question a ranking asks, applied to a spread.
  let cum = 0;
  let coreBands = 0;
  for (const p of sorted) {
    cum += p.value;
    coreBands++;
    if (total > 0 && cum / total >= 0.8) break;
  }

  const evidenceOf = evidence({
    observations: points.length,
    // A histogram's effect size is how far it is from flat: a rectangular one
    // is a genuine result and a weak finding.
    effect: gini(points.map((p) => p.value)),
    limited: ctx.limited,
  });

  const metrics = {
    modalBucket: modal.label,
    modalSharePct: round(modalShare),
    secondBucket: second ? second.label : null,
    topTwoBandsSharePct: round(topTwoShare),
    thinBands: sparse,
    buckets: points.length,
    coreBands,
    // Which side of the busiest band the rest of the records sit on. 'right'
    // means a long upper tail, so the mean sits above the typical record.
    skew: skewDirection,
    skewLeanPct: round(lean),
    total: round(total),
    evidence: evidenceOf.tier,
    evidenceNotes: evidenceOf.reasons,
  };

  const headline = `Most records fall in the ${modal.label} band — ${pct(modalShare)} of ${total}.`;

  const observations = [
    say(
      0.9,
      `Across ${points.length} bands, ${measure.toLowerCase()} clusters around ${modal.label}${
        second ? `, with ${second.label} next at ${pct((second.value / (total || 1)) * 100)}` : ''
      }.`
    ),
    // The sentence that decides whether an average may be quoted anywhere else
    // in the deck.
    skewDirection === 'symmetric'
      ? say(0.4, 'The spread is roughly even either side of the busiest band, so the average describes the middle of this data rather than sitting off to one side of it.')
      : say(
          0.85,
          skewDirection === 'right'
            ? `The bands run long to the upper end — ${pct(Math.abs(lean))} more of the records sit above the busiest band than below it — so the average sits above the typical record and quoting it will overstate the normal case.`
            : `The bands run long to the lower end — ${pct(Math.abs(lean))} more of the records sit below the busiest band than above it — so the average sits under the typical record and quoting it will understate the normal case.`
        ),
    say(
      modalShare >= 50 ? 0.7 : 0.5,
      modalShare >= 50
        ? 'Over half the records sit in one band, so an average over the whole set describes the typical record well and hides very little.'
        : `The top two bands hold ${pct(topTwoShare)} between them, so there is a clear mode but a real spread — an average will sit between bands rather than in one.`
    ),
    sparse > 0
      ? say(
          0.45 + Math.min(0.3, sparse / 10),
          `${sparse} ${sparse === 1 ? 'band holds' : 'bands hold'} under 5% of records each; those tails are where unusual cases live.`
        )
      : null,
  ];

  const detail = compose(observations.filter(Boolean), 3);

  const recommendation =
    skewDirection === 'symmetric'
      ? `Decide whether the ${modal.label} band is the case to design for, or whether the ${sparse || 'outer'} thin ${sparse === 1 ? 'band carries' : 'bands carry'} value or risk that the bulk hides.`
      : `Design for the ${modal.label} band rather than the average, which sits ${skewDirection === 'right' ? 'above' : 'below'} it — then decide separately whether the ${skewDirection === 'right' ? 'long upper' : 'long lower'} tail is worth serving on its own terms.`;

  return { metrics, headline, detail, recommendation };
}

function analyzeMultiMetric(series, ctx) {
  // radar / composed: a small set of categories scored on several measures.
  const { points, numericKeys, labelKey } = series;
  const rows = ctx.rows || [];
  const dim = ctx.dimLabel || prettyKey(labelKey);
  const perMetric = {};
  // How far apart the segments are on each metric, so the prose can say whether
  // the shape on the chart is a profile or a regular polygon.
  const spreads = [];
  for (const k of numericKeys.slice(0, 4)) {
    const ranked = rows
      .map((r) => ({ label: String(r[labelKey] ?? ''), value: toNum(r[k]) }))
      .filter((p) => isNum(p.value))
      .sort((a, b) => b.value - a.value);
    if (!ranked.length) continue;
    perMetric[prettyKey(k)] = ranked[0].label;
    const vals = ranked.map((p) => p.value);
    const mu = mean(vals);
    spreads.push(mu !== 0 ? (vals[0] - vals[vals.length - 1]) / Math.abs(mu) : 0);
  }
  const leaders = Object.entries(perMetric);
  const allSame = leaders.length > 1 && leaders.every(([, v]) => v === leaders[0][1]);
  const distinctLeaders = new Set(leaders.map(([, v]) => v)).size;
  const separation = spreads.length ? mean(spreads) : 0;

  const evidenceOf = evidence({
    observations: points.length,
    effect: Math.min(1, separation),
    limited: ctx.limited,
    notes: separation < 0.15 ? ['the segments score within a few percent of each other on every metric'] : [],
  });

  const metrics = {
    metricLeaders: perMetric,
    allRoundLeader: allSame ? leaders[0][1] : null,
    distinctLeaders,
    categories: points.length,
    // The average gap between best and worst as a share of the metric's mean.
    // Near zero means the radar is a regular polygon and says nothing.
    segmentSeparationPct: round(separation * 100),
    evidence: evidenceOf.tier,
    evidenceNotes: evidenceOf.reasons,
  };

  const flat = separation < 0.15;
  const headline = flat
    ? `The ${plural(dim.toLowerCase())} score within a few percent of each other on every metric tracked.`
    : allSame
      ? `${leaders[0][1]} leads on every measure tracked.`
      : `No single ${dim.toLowerCase()} wins across the board — leadership is split by metric.`;

  const observations = [
    say(0.9, leaders.map(([m, who]) => `${who} leads on ${m.toLowerCase()}`).join('; ') + '.'),
    say(
      flat ? 1.0 : 0.6,
      flat
        ? `The gap between best and worst averages ${pct(separation * 100)} of each metric, so the differences here are too small to rank on.`
        : `Best and worst are ${pct(separation * 100)} apart on average across the metrics, so the profile is a real difference in shape rather than a rounding.`
    ),
    !flat && distinctLeaders > 1
      ? say(
          0.7,
          `Leadership splits ${distinctLeaders} ways, so there is no all-round best here — each ${dim.toLowerCase()} is strong at something different.`
        )
      : null,
  ];

  const detail = compose(observations.filter(Boolean), 3);

  const recommendation = flat
    ? `Do not rank on these metrics: the ${plural(dim.toLowerCase())} are effectively tied. Find a measure on which they actually diverge before making this a comparison.`
    : allSame
      ? `Understand what makes ${leaders[0][1]} a consistent all-round leader and whether it is replicable.`
      : `Match each segment to the metric it wins on rather than forcing one benchmark across all of them.`;

  return { metrics, headline, detail, recommendation };
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/**
 * Put a temporal series in date order.
 *
 * Chart queries are routinely ordered by size, because for most chart types
 * that is what you want. A trend read off that order is a description of the
 * sort, not of time — so the points are re-ordered here before any direction,
 * growth rate or "last period" is computed from them. Labels that cannot be
 * parsed keep their original order, which is the only safe fallback: an
 * arbitrary re-sort would be worse than the order the query chose.
 */
export function chronological(points) {
  const keyed = points.map((p, index) => ({ p, index, at: periodValue(p.label) }));
  if (keyed.some((k) => k.at === null)) return points;
  return keyed.sort((a, b) => a.at - b.at || a.index - b.index).map((k) => k.p);
}

/**
 * The same ordering, applied to result rows rather than extracted points.
 *
 * Used by the pipeline so that a chart which asserts an ordered x axis is drawn
 * in that order too. Without it the narrative and the picture could disagree:
 * the text would describe the year while the bars still showed the sort.
 */
export function chronologicalRows(rows, key) {
  if (!Array.isArray(rows) || rows.length < 2 || !key) return rows;
  const keyed = rows.map((row, index) => ({ row, index, at: periodValue(row?.[key]) }));
  if (keyed.some((k) => k.at === null)) return rows;
  return keyed.sort((a, b) => a.at - b.at || a.index - b.index).map((k) => k.row);
}

/** A sortable number for a period label, or null when it is not one. */
function periodValue(label) {
  const s = String(label ?? '').trim().toLowerCase();

  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s);
  if (iso) return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3] || 1);

  const year = /^(19|20)\d{2}$/.exec(s);
  if (year) return Number(s) * 10000;

  const quarter = /^q([1-4])[\s\-/']*((?:19|20)\d{2})?$/.exec(s);
  if (quarter) return Number(quarter[2] || 0) * 10000 + Number(quarter[1]) * 300;

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const named = /^([a-z]{3})[a-z]*\.?[\s\-/]*((?:19|20)\d{2})?$/.exec(s);
  if (named) {
    const month = MONTHS.indexOf(named[1]);
    if (month >= 0) return Number(named[2] || 0) * 10000 + (month + 1) * 100;
  }

  const slashed = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
  if (slashed) {
    const y = slashed[3] ? Number(slashed[3].length === 2 ? `20${slashed[3]}` : slashed[3]) : 0;
    return y * 10000 + Number(slashed[1]) * 100 + Number(slashed[2]);
  }

  return null;
}

function detectOutliers(points) {
  if (points.length < 4) return [];
  const vals = points.map((p) => p.value).sort((a, b) => a - b);
  const q1 = quantile(vals, 0.25);
  const q3 = quantile(vals, 0.75);
  const iqr = q3 - q1;
  if (iqr === 0) return [];
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  return points.filter((p) => p.value < lo || p.value > hi);
}

function linregSlope(ys) {
  const n = ys.length;
  if (n < 2) return 0;
  const xs = ys.map((_, i) => i);
  const mx = (n - 1) / 2;
  const my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function round(v, digits = 2) {
  if (!isNum(v)) return v;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function prettyKey(s) {
  return String(s ?? '')
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze a single chart's result rows and return verified findings + narrative.
 *
 * @param {Object} chart - { resultData, chart_type, xAxisKey, yAxisKey, title, ... }
 * @returns {Object|null} { id, title, type, metrics, headline, detail, recommendation, verifiedFacts }
 */
export function analyzeChart(chart, sourceRows = 0) {
  const rows = chart?.resultData;
  if (!rows || rows.length === 0) return null;

  /**
   * A cross-tab has two dimensions, and reading only the first mislabels it.
   *
   * A grid of seven categories by four regions arrives as twenty-eight rows
   * whose first column repeats four times each, so the ranking treated it as a
   * list of categories and reported "Electronics leads categories at 51M, 22.5%
   * of the total. It takes 9 of 28 to reach 80%" — a leader that is one cell,
   * a share of the whole grid, and twenty-eight of something the sentence
   * called categories. The pair is the subject, so the pair is the label.
   */
  const pairKey =
    usesSecondDimension(chart.chart_type) && chart.secondaryYAxisKey
      // Named for how it reads in a sentence: "leads combinations on total
      // amount" beats "leads category & regions", and the leader label
      // ("Electronics · East") already says which two columns are meant.
      ? 'Combination' 
      : null;
  const analysisRows = pairKey
    ? rows.map((r) => ({
        ...r,
        [pairKey]: `${r[chart.xAxisKey]} · ${r[chart.secondaryYAxisKey]}`,
      }))
    : rows;

  const series = extractSeries(analysisRows, {
    xKey: pairKey || chart.xAxisKey,
    yKey: chart.yAxisKey,
  });
  if (!series || series.points.length === 0) return null;

  const type = String(chart.chart_type || 'bar').toLowerCase();
  const cut = truncation(chart, rows.length);
  const ctx = {
    rows: analysisRows,
    xKey: pairKey || chart.xAxisKey,
    yKey: chart.yAxisKey,
    measureLabel: prettyKey(series.valueKey),
    dimLabel: prettyKey(series.labelKey),
    // Whether these rows are the whole set or the top of it. Every share the
    // analyzers compute depends on the answer.
    limited: cut.limited,
    limit: cut.limit,
    // How many records the aggregate underneath this chart was computed from,
    // as distinct from how many bars came out of it.
    sourceRows,
  };

  let analysis;
  const isTemporal = looksTemporal(series.points.map((p) => p.label));
  const isCompositionType = type === 'donut' || type === 'treemap' || type === 'radial' || type === 'pie';
  // Histogram/bucket charts use range labels (e.g. "1852-2578") that can superficially
  // resemble dates, so detect them explicitly and BEFORE the temporal-trend branch.
  const isDistribution =
    /range|distribution|bucket|histogram/i.test(series.labelKey) ||
    /distribution/i.test(chart.title || '');

  if (type === 'scatter' && series.numericKeys.length >= 2) {
    analysis = analyzeCorrelation(series, ctx);
  } else if ((type === 'radar' || type === 'composed') && series.numericKeys.length >= 2) {
    analysis = analyzeMultiMetric(series, ctx);
  } else if (isDistribution) {
    // Checked BEFORE composition: value buckets are a distribution however they
    // end up being drawn. Describing "76-3719" as holding "the largest share"
    // reads as a category name and is actively misleading.
    analysis = analyzeDistribution(series, ctx);
  } else if (isCompositionType && isAdditiveMeasure(ctx.measureLabel)) {
    // Composition charts describe part-to-whole, even if the labels look temporal.
    analysis = analyzeComposition(series, ctx);
  } else if (isTemporal) {
    // Requires genuinely chronological labels — a line drawn over unordered
    // categories is not a trend, and describing it as one invents a direction.
    analysis = analyzeTrend(series, ctx);
  } else {
    // Also where a part-to-whole chart lands when its measure does not add up.
    // The diversity pass can redraw an average-by-category bar as a donut, and
    // "Electronics holds 62% of average revenue" is a share of a quantity that
    // does not exist — a ranking is the honest reading of the same picture.
    analysis = analyzeRanking(series, ctx);
  }

  // A short, flat list of "facts" the LLM is allowed to cite verbatim.
  const verifiedFacts = factList(analysis.metrics);

  return {
    id: chart.id,
    title: chart.title,
    type,
    // Set by the planner when this chart measures the dataset's outcome — a
    // churn rate, a conversion rate — rather than one attribute among many.
    outcomeRate: chart.outcomeRate || null,
    // What this finding is *about*, kept in both machine and human form. Two
    // findings can only be reconciled against each other if something says they
    // describe the same categories measured different ways, and until now
    // nothing did — every finding was written as though it were the only one in
    // the deck.
    dimensionKey: series.labelKey,
    measureKey: series.valueKey,
    dimension: ctx.dimLabel,
    measure: ctx.measureLabel,
    // Per-category shares, for the reconciliation pass. Only meaningful where
    // the analysis was about how a whole divides up.
    shares:
      isAdditiveMeasure(ctx.measureLabel) &&
      (isNum(analysis.metrics.leaderSharePct) || isNum(analysis.metrics.dominantSharePct))
        ? shareMap(series.points)
        : null,
    metrics: analysis.metrics,
    headline: analysis.headline,
    detail: analysis.detail,
    recommendation: analysis.recommendation,
    verifiedFacts,
  };
}

/** Each label's share of the total, as a percentage. */
function shareMap(points) {
  const total = points.reduce((sum, p) => sum + p.value, 0);
  if (total <= 0) return null;
  const out = {};
  for (const p of points) out[p.label] = (p.value / total) * 100;
  return out;
}

/**
 * Analyze the whole storyboard: per-chart findings plus a dataset-level synthesis.
 *
 * @param {Array} charts - executed charts with resultData
 * @param {Array} rawRows - the full cleaned dataset (optional, for dataset stats)
 * @returns {Object} { perChart: [...], synthesis: {...} }
 */
export function analyzeStoryboard(charts, rawRows = []) {
  const perChart = (charts || []).map((c) => analyzeChart(c, rawRows.length)).filter(Boolean);

  // Dataset-level synthesis: surface the 3 most decision-relevant findings.
  const ranked = rankFindings(perChart);
  // Two charts over the same dimension can produce word-for-word identical
  // headlines; showing one takeaway three times is worse than showing two.
  const lede = synthesisHeadline(ranked, rawRows.length);
  const macroInsights = [];
  const seenHeadlines = new Set();
  // Which kinds of consequence the summary has already drawn, so no two bullets
  // make the same rhetorical move.
  const usedConsequences = new Set();
  for (const f of ranked) {
    // The opening line is built from the top finding, so that finding does not
    // also open the bullets — unless it is the only one there is.
    if (perChart.length > 1 && f.id === lede.sourceId) continue;
    const key = f.headline.trim().toLowerCase();
    if (seenHeadlines.has(key)) continue;
    seenHeadlines.add(key);
    macroInsights.push(macroBullet(f, usedConsequences));
    if (macroInsights.length === 4) break;
  }

  // What the charts say to each other.
  //
  // Every finding above was written as though its chart were the only one in
  // the deck, which is the difference between a stack of readings and an
  // analysis. The most useful sentence in a report is routinely the one that
  // holds two charts side by side — a segment taking 42% of revenue on 18% of
  // the orders is a fact neither chart contains, and no amount of rewriting one
  // of them produces it.
  const connections = reconcile(perChart, { rows: rawRows, charts });
  for (const line of connections) {
    if (macroInsights.length >= 6) break;
    macroInsights.push(line);
  }

  // Strategic scorecard derived deterministically.
  const trend = perChart.find((f) => f.metrics.direction);
  // Both share metrics count. Checking only `leaderSharePct` let a pie-shaped
  // finding be called "the dominant story is concentration" in the opening line
  // and drive the opportunity card, while risk — reading a field that finding
  // never sets — reported no concentration at all, in the same breath.
  const concentrated = perChart.find(
    (f) => f.metrics.concentration === 'high' || topSharePct(f.metrics) >= CONCENTRATION_PCT
  );
  // Whichever finding the risk card is written from. The opportunity may not be
  // written from the same one: a single share stated as both the exposure to
  // hedge and the upside to chase is one fact pointing two ways, and a reader
  // cannot act on both. When nothing else positive is left, the card is empty.
  // A trend belongs on the risk card when it is falling — and also when it
  // reversed, which is the same exposure arriving late. Without the second
  // case a series that climbed all year and collapsed in the final period was
  // reported as no risk at all, and then picked up by the opportunity card,
  // because both only ever read the fitted direction.
  const trendRisk =
    trend && (trend.metrics.direction === 'declining' || trend.metrics.netChangeVsTrend) ? trend : null;

  /**
   * A movement outranks a share.
   *
   * Concentration used to be checked first, so a deck whose revenue fell by a
   * third across the year led its risk card with "Electronics carries an
   * outsized share" — a fact that was very likely true in January too. A
   * standing share is a structural property; a decline is something that
   * happened, on this data, in this period, and it is what a reader needs
   * first. Concentration keeps the card when the movement is small enough to
   * be drift, because then the share really is the bigger story.
   */
  const trendIsMaterial =
    trendRisk && Math.abs(trendRisk.metrics.totalChangePct || 0) >= MATERIAL_CHANGE_PCT;

  /**
   * The outcome outranks everything.
   *
   * On a churn dataset the risk is churn. The card reported "Month-to-month
   * carries an outsized share (50.3%)" instead — true, and not the point: a
   * segment being half the book is a fact about the shape of the customer base,
   * while that segment leaving at eight times the rate of another is the thing
   * somebody has to do something about. Where a chart measures the dependent
   * variable and it is the kind where high is bad, it takes the card.
   */
  const outcomeRisk = perChart.find((f) => f.outcomeRate && f.outcomeRate.highIsGood === false);
  const riskSource = outcomeRisk || (trendIsMaterial ? trendRisk : concentrated || trendRisk);
  /**
   * Not the risk, and not about the same thing as the risk.
   *
   * Comparing finding ids was not enough. A deck reported "Enterprise carries
   * an outsized share (45.6%)" as its risk and "Enterprise leads plan tiers on
   * average monthly charge, 1.8x the average" as its opportunity — two
   * different findings, two different measures, one subject, pointing opposite
   * ways. A reader cannot act on both, and the pair reads as the deck not
   * having made up its mind. So the subject is compared as well as the id: the
   * segment the card is about, whatever statistic it reached for.
   */
  const subjectOf = (f) =>
    String(f?.metrics?.dominant || f?.metrics?.leader || '')
      .trim()
      .toLowerCase();
  const riskSubject = subjectOf(riskSource);
  const notTheRisk = (f) => {
    if (!riskSource) return true;
    if (f.id === riskSource.id) return false;
    const subject = subjectOf(f);
    return !subject || !riskSubject || subject !== riskSubject;
  };

  // Written here rather than inline in the card, because the falling case has
  // two shapes and a nested ternary in the middle of a returned object is where
  // the wrong one gets picked. `totalChangePct` is a start-to-end figure: on a
  // series still trending down but already recovered past its opening value it
  // is a rise, and quoting it after "trending down" reports the recovery as the
  // size of the fall.
  const riskLine =
    riskSource === outcomeRisk && outcomeRisk
      ? outcomeRiskLine(outcomeRisk)
      : riskSource === trendRisk && trendRisk
      ? trendRiskLine(trendRisk)
      : concentrated
        ? `Concentration risk: ${concentrated.metrics.dominant || concentrated.metrics.leader} carries an outsized share (${pct(topSharePct(concentrated.metrics))}).`
        : trendRisk
          ? trendRiskLine(trendRisk)
          : '';

  // Opportunity must be a POSITIVE signal — a rising trend, a strong positive
  // relationship, or the clearest leader. Never surface a decline here.
  const opportunity =
    // A rise that ended below where it started is not an upside to chase. It is
    // the one shape most likely to be picked up here, because the card only
    // ever looked at the fitted direction.
    perChart.find((f) => notTheRisk(f) && f.metrics.direction === 'rising' && !f.metrics.netChangeVsTrend) ||
    perChart.find((f) => notTheRisk(f) && f.type === 'scatter' && (f.metrics.correlation || 0) >= 0.6) ||
    ranked.find(
      (f) =>
        notTheRisk(f) &&
        !f.metrics.modalBucket &&
        (isNum(f.metrics.leaderSharePct) || isNum(f.metrics.dominantSharePct))
    ) ||
    // A histogram's modal bucket is a description of the shape of the data, not
    // an upside, so it is excluded from the last resort as well as the one above.
    // Belt and braces on the last resort: when concentration already took the
    // risk slot, a reversed trend is still in play here and is still not an
    // upside.
    ranked.find(
      (f) =>
        notTheRisk(f) &&
        !f.metrics.modalBucket &&
        f.metrics.direction !== 'declining' &&
        !f.metrics.netChangeVsTrend
    );

  // What a reader has to know to read the numbers correctly. Collected here
  // rather than repeated per slide, and passed to the narrator as facts it may
  // not contradict.
  const caveats = [];
  const truncated = perChart.filter((f) => f.metrics.sharesMeasuredAgainst === 'shown');
  if (truncated.length) {
    caveats.push(
      `${truncated.length === 1 ? 'One chart shows' : `${truncated.length} charts show`} only the top rows of ${truncated.length === 1 ? 'its' : 'their'} query, so shares quoted from ${truncated.length === 1 ? 'it are' : 'them are'} shares of what is shown, not of the whole dataset.`
    );
  }
  const thin = perChart.filter((f) => isNum(f.metrics.points) && f.metrics.points < 12);
  if (thin.length) {
    caveats.push('A relationship here rests on fewer than a dozen points, so one unusual row moves it.');
  }

  const synthesis = {
    title: 'Executive Summary',
    headline: lede.text,
    // Kept as their own field as well as folded into the bullets, so the
    // narrator can see which statements came from holding two charts together
    // and is not free to attribute them to either one alone.
    connections,
    caveats,
    macroInsights: macroInsights.length ? macroInsights : ['No statistically significant patterns detected in the current view.'],
    strategicScorecard: {
      // The dependent variable sets the agenda when the dataset has one.
      focus:
        (outcomeRisk && outcomeFocusLine(outcomeRisk)) ||
        ranked[0]?.recommendation ||
        'Review the leading segments for resource allocation.',
      // Empty when the data shows no risk. A card that says "no risk detected"
      // is a slot being filled rather than a finding, and it reads as a
      // contradiction next to a focus and an opportunity built on the same
      // concentration. Nothing to report is better reported by saying nothing.
      risk: riskLine,
      // A concentration is not an upside.
      //
      // With a revenue decline on the risk card the opportunity slot reached
      // for "Electronics accounts for 51.3% of the 6 shown, the largest share
      // of any product category" — which is the same kind of fact this engine
      // calls a risk when it takes the risk card, offered as the good news
      // because the slot existed. An empty card says less and claims nothing.
      opportunity: concentrationAsUpside(opportunity, riskSource) ? '' : opportunity?.headline || '',
    },
    rowsAnalyzed: rawRows.length || null,
    chartsAnalyzed: perChart.length,
  };

  return { perChart, synthesis };
}

/**
 * The statements that only exist when two findings are read together.
 *
 * Deliberately conservative. Every line is arithmetic over numbers two
 * analyzers already verified — no line asserts a cause, and none pairs charts
 * that do not describe the same thing. A reconciliation that has to guess is
 * worse than none, because it is the one kind of sentence a reader has no way
 * to check against the chart in front of them.
 */
function reconcile(findings, { rows = [], charts = [] } = {}) {
  // The joins that need the rows come first: they are the ones a reader could
  // not have made from the charts, which is what a summary is for.
  const out = crossRowJoins(findings, rows, charts);

  for (let i = 0; i < findings.length && out.length < 3; i++) {
    for (let j = i + 1; j < findings.length && out.length < 3; j++) {
      const line = reconcilePair(findings[i], findings[j]);
      if (line) out.push(line);
    }
  }

  // A rising or falling total that one segment largely is. Both halves are
  // verified; the sentence only joins them, and says what that means for how
  // much the trend is worth on its own.
  const trend = findings.find(
    (f) => (f.metrics.direction === 'rising' || f.metrics.direction === 'declining') &&
      isNum(f.metrics.fitQualityPct) && f.metrics.fitQualityPct >= 40
  );
  const concentration = findings.find((f) => (topSharePct(f.metrics) || 0) >= CONCENTRATION_PCT);
  // Not when the attribution join has already said it, and said it better: "the
  // trend is substantially a report on Electronics" is the same observation as
  // "effectively all of the fall is Electronics", inferred from two shares
  // instead of measured from the rows.
  const alreadyAttributed = out.some((line) => /of the (fall|rise) in /.test(line));
  if (trend && concentration && !alreadyAttributed && out.length < 3) {
    const who = concentration.metrics.dominant || concentration.metrics.leader;
    const share = topSharePct(concentration.metrics);
    const of = concentration.metrics.sharesMeasuredAgainst === 'shown' ? 'the rows shown' : 'the total';
    out.push(
      `${who} carries ${pct(share)} of ${of} while ${measurePhrase(trend.measure)} is ${trend.metrics.direction}, so the trend is substantially a report on ${who} — check whether it holds with ${who} taken out before treating it as a company-wide movement.`
    );
  }

  // An average ranked by category, over a measure whose own distribution is
  // skewed. The ranking is not wrong, but "average" there is not the typical
  // case, and only the histogram knows that.
  const skewed = findings.find((f) => f.metrics.skew === 'right' || f.metrics.skew === 'left');
  if (skewed && out.length < 3) {
    const subject = String(skewed.dimensionKey || '').replace(/\s*range$/i, '').trim();
    const averaged = subject
      ? findings.find((f) => f !== skewed && new RegExp(`average\\b.*${escapeRe(subject)}`, 'i').test(f.measure || ''))
      : null;
    if (averaged) {
      out.push(
        // The sentence this replaces ran "the ranking compares means that no
        // ordinary category actually looks like", which parses as nothing.
        `${prettyKey(subject)} has a long tail at the ${skewed.metrics.skew === 'right' ? 'high' : 'low'} end, ` +
          `so every average in "${averaged.title}" sits ${skewed.metrics.skew === 'right' ? 'above' : 'below'} ` +
          `the typical record — the ranking is built on means that no ordinary ` +
          `${lowerFirst(averaged.dimension || 'category')} resembles. Compare medians before acting on that order.`
      );
    }
  }

  return out;
}

/** Escape a string for use inside a regular expression. */
function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Two findings over the same categories, measured different ways.
 *
 * This is the pair the planner deliberately builds and nothing ever read: "which
 * segments are biggest by revenue" beside "which segments have the most
 * orders". The gap between the two answers is where the margin is, and it is
 * invisible on either chart alone.
 */
/**
 * The joins that need the rows, not just the findings.
 *
 * `reconcilePair` above can only speak about two charts that share a dimension,
 * because a finding carries its own aggregates and nothing else. These three go
 * back to the analysis rows, which is what lets them say things no chart in the
 * deck shows on its own.
 *
 * Each returns a sentence or null. None of them infer: every number in the
 * prose was computed in `crossFindings` from the same rows the charts were
 * drawn from.
 */
function crossRowJoins(findings, rows, charts) {
  const out = [];
  if (!rows?.length) return out;
  const columns = Object.keys(rows[0] || {});

  // ---- Who moved the total -------------------------------------------------
  //
  // The question a declining trend raises and a trend chart cannot answer.
  const trend = findings.find(
    (f) => (f.metrics.direction === 'declining' || f.metrics.direction === 'rising') &&
      isNum(f.metrics.fitQualityPct) && f.metrics.fitQualityPct >= 30
  );
  if (trend) {
    const timeColumn = resolveColumn(trend.dimensionKey, columns) || guessTemporal(rows, columns);
    const measureColumn = resolveColumn(trend.measureKey, columns);
    // Attributed by whichever dimension the deck already thinks is the subject
    // — the first whose axis is a real column. A cross-tab's axis is a pair
    // label and a histogram's is a set of value bands; neither is something the
    // rows can be grouped by, and taking the first candidate regardless meant
    // the join went looking for a column called "Combination" and gave up.
    let ranked = null;
    let dimension = null;
    for (const f of findings) {
      if (f === trend || !f.dimensionKey || f.metrics.modalBucket) continue;
      const column = resolveColumn(f.dimensionKey, columns);
      if (!column || column === timeColumn) continue;
      ranked = f;
      dimension = column;
      break;
    }

    if (timeColumn && measureColumn && dimension) {
      const moved = attributeChange(rows, { timeColumn, measureColumn, dimension });
      // Below half, no single segment is the story and saying so would overstate
      // it; above, the movement is that segment wearing the company's name.
      if (moved && Math.abs(moved.share) >= 0.5 && moved.segments > 1) {
        const share = Math.min(100, Math.round(Math.abs(moved.share) * 100));
        const what = measurePhrase(trend.measure);
        out.push(
          share >= 95
            ? `Effectively all of the ${moved.direction} in ${what} is ${moved.segment}: the rest of the field is flat across the same period. The trend chart is a chart of one ${lowerFirst(ranked.dimension || 'segment')}.`
            : `${moved.segment} accounts for ${share}% of the ${moved.direction} in ${what}. What looks like a movement in the business is mostly a movement in one ${lowerFirst(ranked.dimension || 'segment')} — fix or explain that one and the shape of the whole chart changes.`
        );
      }
    }
  }

  // ---- Where the two dimensions disagree -----------------------------------
  //
  // Only a cross-tab holds this, and only against its own margins.
  const grid = (charts || []).find(
    (c) => c.chart_type === 'matrix' && c.secondaryYAxisKey && c.resultData?.length
  );
  if (grid && out.length < 3) {
    const residual = interactionResidual(grid.resultData, {
      rowKey: grid.xAxisKey,
      columnKey: grid.secondaryYAxisKey,
      valueKey: grid.yAxisKey,
    });
    if (residual) {
      const times = residual.ratio >= 1 ? residual.ratio : 1 / residual.ratio;
      const rounded = times >= 10 ? Math.round(times) : times.toFixed(1);
      out.push(
        residual.ratio < 1
          ? `${residual.row} is ${rounded}× weaker in ${residual.column} than its share of the two would predict — the gap is not visible in either chart alone, because each is right about its own totals.`
          : `${residual.row} in ${residual.column} runs ${rounded}× what those two shares predict on their own. That pairing is doing something the rest of the grid is not.`
      );
    }
  }

  // ---- One problem or two --------------------------------------------------
  //
  // Two outcome charts naming two different culprits are usually naming the
  // same records twice.
  const outcomes = findings.filter((f) => f.outcomeRate && f.metrics.leader);
  if (outcomes.length >= 2 && out.length < 3) {
    const [a, b] = outcomes;
    const columnA = resolveColumn(a.dimensionKey, columns);
    const columnB = resolveColumn(b.dimensionKey, columns);
    if (columnA && columnB && columnA !== columnB) {
      const overlap = segmentOverlap(rows, {
        columnA,
        valueA: a.metrics.leader,
        columnB,
        valueB: b.metrics.leader,
      });
      if (overlap && overlap.lift >= 1.5) {
        out.push(
          `${a.metrics.leader} and ${b.metrics.leader} are largely the same records — ${Math.round(overlap.overlap * 100)}% of one sits inside the other, against ${Math.round(overlap.expected * 100)}% if they were unrelated. Two charts, one population: treat it as a single problem rather than budgeting for two.`
        );
      } else if (overlap && overlap.lift <= 0.6) {
        out.push(
          `${a.metrics.leader} and ${b.metrics.leader} barely overlap — ${Math.round(overlap.overlap * 100)}% against the ${Math.round(overlap.expected * 100)}% chance alone would give. These are two separate populations with the same symptom, and one fix will not reach both.`
        );
      }
    }
  }

  return out;
}

/** The first column whose values look like ISO dates or periods. */
function guessTemporal(rows, columns) {
  for (const column of columns) {
    const sample = String(rows[0]?.[column] ?? '');
    if (/^\d{4}-\d{2}/.test(sample)) return column;
  }
  return null;
}

function reconcilePair(a, b) {
  if (!a.dimensionKey || a.dimensionKey !== b.dimensionKey) return null;
  if (!a.measureKey || a.measureKey === b.measureKey) return null;
  // Comparing a share of the top ten against a share of everything is comparing
  // two different wholes, and the sentence would be quietly false.
  if (a.metrics.sharesMeasuredAgainst !== b.metrics.sharesMeasuredAgainst) return null;
  // And a share of a set of averages is not a share of anything at all: adding
  // four category averages gives a number that is not the revenue of any
  // business, so "88% of total revenue against 62% of average revenue" compares
  // a real proportion with an invented one.
  if (!isAdditiveMeasure(a.measure) || !isAdditiveMeasure(b.measure)) return null;

  if (a.shares && b.shares) {
    // The category whose two shares disagree most. A category taking much more
    // of one measure than the other is doing something different from the rest.
    let best = null;
    for (const [label, shareA] of Object.entries(a.shares)) {
      const shareB = b.shares[label];
      if (!isNum(shareB) || shareB <= 0) continue;
      const gap = Math.abs(shareA - shareB);
      if (!best || gap > best.gap) best = { label, shareA, shareB, gap };
    }
    if (best && best.gap >= 10) {
      // Said with the larger share first whichever finding it came from, so the
      // sentence is about the category rather than about the order the charts
      // happened to be planned in.
      const [big, small, bigMeasure, smallMeasure] =
        best.shareA >= best.shareB
          ? [best.shareA, best.shareB, a.measure, b.measure]
          : [best.shareB, best.shareA, b.measure, a.measure];
      const multiple = big / small;
      const scope = a.metrics.sharesMeasuredAgainst === 'shown' ? ' of what those charts show' : '';
      return (
        `${best.label} holds ${pct(big)} of ${measurePhrase(bigMeasure)} but only ${pct(small)} of ${measurePhrase(smallMeasure)}${scope} — ` +
        `around ${multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)}× as concentrated. ` +
        `Whatever lifts ${measurePhrase(bigMeasure)} there is not simply volume, and that gap is where the margin sits.`
      );
    }
  }

  const leadA = a.metrics.leader || a.metrics.dominant;
  const leadB = b.metrics.leader || b.metrics.dominant;
  if (leadA && leadB && leadA !== leadB) {
    return (
      `${leadA} leads on ${measurePhrase(a.measure)} while ${leadB} leads on ${measurePhrase(b.measure)}, ` +
      `so the two measures point at different ${plural(String(a.dimension || 'segment').toLowerCase())} — a plan built on either chart alone backs the wrong one.`
    );
  }

  return null;
}

/**
 * One bullet for the summary: what is true, then what follows from it.
 *
 * A headline on its own is a reading — "Electronics leads at 42%" — and a deck
 * full of readings is why generated summaries feel machine-written. What was
 * missing was not length but consequence, so the second half is now derived
 * from the metrics rather than being the next descriptive sentence: it says
 * what the number means for a decision. The descriptive sentence is still the
 * fallback for a finding whose shape has no obvious consequence.
 */
function macroBullet(finding, used) {
  const head = String(finding.headline || '').trim();
  const follow = implication(finding, used) || firstSentence(finding.detail);
  if (!follow || follow.toLowerCase() === head.toLowerCase()) return head;
  return `${head} ${follow}`;
}

/**
 * The "so what" for one finding, computed rather than phrased.
 *
 * Each branch reads only numbers the analyzer already verified, so a bullet can
 * never claim more than the query supports — and a finding whose numbers do not
 * warrant a consequence gets none rather than a manufactured one.
 *
 * The branches are ordered by how much a decision hangs on each, and every one
 * the finding supports is offered rather than only the first. `used` carries
 * which kinds of consequence the summary has already drawn, so a deck with
 * three concentrated dimensions does not print the same sentence about a bad
 * quarter three times over. Repeating one rhetorical move down a summary is the
 * clearest tell that nobody wrote it: not that any bullet is wrong, but that
 * they were all produced by the same reflex.
 */
function implication(finding, used = new Set()) {
  const m = finding?.metrics || {};
  const of = m.sharesMeasuredAgainst === 'shown' ? 'the rows shown' : 'the total';
  const options = [];
  const offer = (kind, text) => {
    if (text) options.push({ kind, text });
  };

  if (m.direction === 'rising' || m.direction === 'declining') {
    // The per-period rate is measured start to end, so it only belongs in a
    // sentence about the fitted direction when the two point the same way.
    const rate =
      !m.netChangeVsTrend && isNum(m.perPeriodPct) ? ` at about ${pct(Math.abs(m.perPeriodPct))} per period` : '';
    // One caveat, not two: a series whose net change opposes its trend has
    // almost always just moved against it in the last period as well, and
    // saying so twice reads as padding.
    const caveat = m.netChangeVsTrend
      ? ` The net change over the span runs the other way, so the direction is unsettled rather than established.`
      : isNum(m.lastPeriodChangePct) && Math.sign(m.lastPeriodChangePct) !== (m.direction === 'rising' ? 1 : -1)
        ? ` The most recent period moved the other way, so confirm the turn before planning on it.`
        : '';
    offer(
      'trend',
      m.direction === 'declining'
        ? `Left alone it keeps falling${rate}, so the question is what changed rather than whether to react.${caveat}`
        : `Sustained${rate} that compounds, so targets set off the starting point will be met early and stop meaning anything.${caveat}`
    );
    // A second, different consequence for a second trend in the same deck.
    if (isNum(m.fitQualityPct)) {
      offer(
        'fit',
        m.fitQualityPct >= 60
          ? `The direction accounts for ${pct(m.fitQualityPct, 0)} of the movement, so it is steady enough to forecast from rather than a run of good or bad periods.`
          : `The direction accounts for only ${pct(m.fitQualityPct, 0)} of the movement, so most of what this chart shows is period-to-period variation and the direction is not yet something to plan on.`
      );
    }
    if (m.momentum === 'accelerating' || m.momentum === 'slowing') {
      offer(
        'momentum',
        m.momentum === 'accelerating'
          ? 'It is moving faster in the recent half than the earlier one, so the average rate understates where the next period lands.'
          : 'It is moving more slowly in the recent half than the earlier one, so the average rate overstates where the next period lands.'
      );
    }
  }
  if (m.direction === 'flat') {
    offer('flat', 'Nothing in the period moved it, so effort spent here is currently buying no change.');
  }
  if (isNum(m.correlation) && Math.abs(m.correlation) >= 0.6) {
    offer(
      'correlation',
      `It leaves ${pct(m.unexplainedPct ?? 0, 0)} of the variation unexplained, so it is a lever worth testing rather than a rule to plan on.`
    );
  }
  const share = topSharePct(m);
  if (isNum(share) && share >= CONCENTRATION_PCT) {
    const who = m.dominant || m.leader;
    offer(
      'concentration',
      // No number here. The sentence before it has just given the share, and
      // quoting it again produced "43.2% of the total" followed by "carrying
      // 43.3% of the total" in one bullet — two roundings of one figure,
      // arrived at by two paths, contradicting each other in front of the
      // reader. A consequence does not need to restate its own premise.
      `A bad quarter for ${who} is therefore a bad quarter for ${of} — that is a concentration to decide about, not a fact to note.`
    );
    // The same concentration said the other way round, for the second time it
    // comes up: what it costs to have a plan that ignores it.
    if (isNum(m.effectiveSegments) && isNum(m.segments)) {
      offer(
        'effective-segments',
        `Weighted by size the ${m.segments} segments behave like about ${m.effectiveSegments} equal ones, so a plan that treats them as ${m.segments} independent bets is buying diversification it does not have.`
      );
    }
  }
  if (isNum(m.paretoCount) && isNum(m.categories) && m.categories > 2) {
    offer(
      'pareto',
      `It takes ${m.paretoCount} of ${m.categories} to reach 80% of ${of}, so attention spread evenly across all of them is attention mostly spent in the wrong places.`
    );
  }
  if (m.leadIsReal && isNum(m.leadOverFieldSd)) {
    offer(
      'separation',
      m.leadOverFieldSd < 1
        ? 'The order is inside the ordinary variation of the field, so acting on the ranking would be acting on noise.'
        : 'The gap is wide enough that the ordering is unlikely to reverse on ordinary variation, so it is safe to plan against.'
    );
  }
  if (m.modalBucket && isNum(m.modalSharePct)) {
    offer(
      'distribution',
      m.modalSharePct >= 50
        ? 'One band holds most of the records, so an average describes the typical case well here.'
        : 'No band holds a majority, so an average sits between cases rather than describing one.'
    );
  }

  /**
   * A consequence already drawn is not drawn again.
   *
   * The fallback to `options[0]` meant that once every kind this finding could
   * offer had been used, the summary repeated one of them word for word — "the
   * gap is wide enough that the ordering is unlikely to reverse on ordinary
   * variation, so it is safe to plan against" appeared under two different
   * findings in the same summary, which is what makes a deck read as generated
   * rather than written. Saying nothing is shorter and truer: the headline
   * still carries the finding, and a reader who has been told once what a wide
   * gap means does not need telling again.
   */
  const fresh = options.find((o) => !used.has(o.kind));
  if (!fresh) return null;
  used.add(fresh.kind);
  return fresh.text;
}

/**
 * The risk card's sentence for a trend finding.
 *
 * Three shapes, because a falling series and a reversed one are not the same
 * exposure and `totalChangePct` does not mean the same thing in each. It is
 * measured start to end, so on a reversed series it runs opposite to the
 * direction — quoting it after "trending down" reported a recovery as the size
 * of a fall.
 */
/**
 * The risk card for an outcome rate: who leaves, how fast, against whom.
 *
 * Written from the same verified metrics the finding already carries, so the
 * card cannot say anything the chart underneath it does not show.
 */
/**
 * What to do about the outcome, in the direction the outcome runs.
 *
 * The ranking prose this would otherwise reuse assumes high is good — it offers
 * to "find what the leaders do differently and whether it transfers", which on
 * a churn rate means copying the segment that is leaving. The best segment is
 * the one to learn from, and on this measure the best segment is the lowest.
 */
/**
 * Is this "opportunity" just a concentration wearing a different hat?
 *
 * A leading share is an upside when nothing else is wrong and a hedge when
 * something is. Where the deck already has a risk, a card that says one segment
 * is most of the total is not the counterweight it looks like.
 */
function concentrationAsUpside(opportunity, riskSource) {
  if (!opportunity || !riskSource) return false;
  const share = topSharePct(opportunity.metrics);
  return isNum(share) && share >= CONCENTRATION_PCT;
}

function outcomeFocusLine(finding) {
  const m = finding.metrics;
  const what = String(finding.measure || 'the rate').toLowerCase();
  const dim = String(finding.dimension || 'segment').toLowerCase();
  if (!m.leader || !m.laggard) return `Work out what drives ${what} before spending against it.`;
  return (
    `Work out what keeps ${m.laggard} at ${round(m.laggardValue, 1)}% and whether any of it can be ` +
    `moved to ${m.leader} at ${round(m.leaderValue, 1)}% — that gap, not the size of any ${dim}, is where the ` +
    `${what} is decided.`
  );
}

function outcomeRiskLine(finding) {
  const m = finding.metrics;
  const what = String(finding.measure || 'the rate').toLowerCase();
  const leader = m.leader ? `${m.leader}` : 'One segment';
  const value = isNum(m.leaderValue) ? `${round(m.leaderValue, 1)}%` : null;

  if (value && m.laggard && isNum(m.laggardValue)) {
    return `${leader} has the highest ${what} at ${value} — ${round(m.leaderToLaggardRatio, 1)}x ${m.laggard} at ${round(m.laggardValue, 1)}%.`;
  }
  if (value) return `${leader} has the highest ${what}, at ${value}.`;
  return `${leader} has the highest ${what}.`;
}

function trendRiskLine(finding) {
  const m = finding.metrics;
  const what = m.endLabel ? finding.title : 'A key metric';

  if (m.netChangeVsTrend) {
    return m.direction === 'rising'
      ? `${what} rose for most of the period and then turned, ending ${pct(Math.abs(m.totalChangePct || 0))} below where it started.`
      : `${what} is still trending down, though it has recovered past where it started.`;
  }
  return `${what} is trending down (${pct(Math.abs(m.totalChangePct || 0))}).`;
}

/**
 * The opening line — what an analyst says before the bullets.
 *
 * It names the *shape* of the strongest signal rather than repeating its
 * headline, because the headline is already the first bullet and hearing the
 * same sentence twice is what makes a summary sound automated.
 */
function synthesisHeadline(ranked, rowCount) {
  const scale = rowCount ? `${rowCount.toLocaleString()} rows` : 'this data';
  const top = ranked[0];
  if (!top) return { text: `Nothing in ${scale} stands out strongly enough to act on yet.`, sourceId: null };

  const said = (text) => ({ text, sourceId: top.id });
  const m = top.metrics || {};
  if (m.direction === 'rising' || m.direction === 'declining') {
    const by = isNum(m.totalChangePct) ? ` by ${pct(Math.abs(m.totalChangePct))}` : '';
    // The measure, not the chart title. A title is a label for a picture —
    // "Total Revenue Trend Over Month" — and reading one aloud mid-sentence is
    // the surest sign a summary was assembled rather than written.
    const what = top.measure ? measurePhrase(top.measure) : lowerFirst(top.title || 'the leading measure');
    // "Growth: moved by 10.0%" while the series actually ended 10% down is the
    // same contradiction as the headline, one level up. When the net change
    // opposes the trend the story is the reversal, so that is what it says.
    if (m.netChangeVsTrend) {
      const net = isNum(m.totalChangePct) ? `${pct(Math.abs(m.totalChangePct))} ` : '';
      return said(
        `The dominant story in ${scale} is a reversal: ${what} ${m.direction === 'rising' ? 'rose' : 'fell'} for most of the period and ended ${net}${m.totalChangePct >= 0 ? 'above' : 'below'} where it started.`
      );
    }
    const word = m.direction === 'rising' ? 'growth' : 'decline';
    return said(`The dominant story in ${scale} is ${word}: ${what} moved${by} over the period covered.`);
  }
  if (isNum(m.correlation) && Math.abs(m.correlation) >= 0.6) {
    return said(`The dominant story in ${scale} is a relationship: ${m.xField} and ${m.yField} move together closely enough to be worth testing (r = ${m.correlation.toFixed(2)}).`);
  }
  if (isNum(m.leaderSharePct) && m.leaderSharePct >= CONCENTRATION_PCT) {
    return said(`The dominant story in ${scale} is concentration: ${m.leader} alone accounts for ${pct(m.leaderSharePct)} of the total.`);
  }
  if (isNum(m.dominantSharePct) && m.dominantSharePct >= CONCENTRATION_PCT) {
    return said(`The dominant story in ${scale} is concentration: ${m.dominant} holds ${pct(m.dominantSharePct)} of the mix.`);
  }
  if (m.modalBucket) {
    return said(`Most of ${scale} clusters in one band (${m.modalBucket}), so the averages hide less than they usually would.`);
  }
  return said(`Across ${scale}, the clearest signal is this: ${lowerFirst(top.headline)}`);
}

/**
 * How to refer to the measured quantity in a sentence.
 *
 * Aggregate columns are routinely called Total, Value or Amount, which produced
 * lines like "the largest share of total at 51.3% of the total". Those labels
 * carry no information, so they collapse into the phrase a person would use.
 */
function measurePhrase(measure) {
  const m = String(measure || '').trim();
  return /^(total|totals|value|values|amount|amounts|sum|count)$/i.test(m) ? 'the total' : m.toLowerCase();
}

/** The first sentence of a block of prose, or '' when there is not one. */
function firstSentence(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  const match = s.match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : s).trim();
}

const lowerFirst = (s) => {
  const t = String(s || '').trim();
  // Only when the first word is not a name or an acronym — "Electronics leads"
  // must not become "electronics leads".
  if (!t || /^[A-Z]{2,}/.test(t) || /^[A-Z][a-z]*\s(leads|makes|holds|carries)/.test(t)) return t;
  // A column name is title-cased on both words, so lowering only the first
  // produced "no ordinary contract Type resembles". A dimension name mid
  // sentence is a common noun throughout — but only where every word is a
  // plain capitalised word, so "Sales by EMEA Region" keeps its acronym.
  if (/^[A-Z][a-z]+(\s[A-Z][a-z]+)+$/.test(t)) return t.toLowerCase();
  return t.charAt(0).toLowerCase() + t.slice(1);
};

/** How much a finding's standing survives the evidence behind it. */
const EVIDENCE_WEIGHT = { strong: 1, moderate: 0.85, indicative: 0.6, thin: 0.3 };

// Rank findings by how "decision-relevant" they are (bigger deltas / stronger
// signals first) so the synthesis leads with the most important facts.
function rankFindings(perChart) {
  const score = (f) => {
    const m = f.metrics || {};
    let s = 0;
    if (isNum(m.leaderSharePct)) s += m.leaderSharePct;
    if (isNum(m.dominantSharePct)) s += m.dominantSharePct;
    if (isNum(m.totalChangePct)) s += Math.min(120, Math.abs(m.totalChangePct));
    if (isNum(m.correlation)) s += Math.abs(m.correlation) * 100;
    if (Array.isArray(m.outliers) && m.outliers.length) s += 25;
    if (m.concentration === 'high') s += 30;
    // A histogram's modal share is often the biggest number on the board while
    // being the least actionable finding on it; damp it so it doesn't crowd out
    // segment leaders and trends in the executive summary.
    if (m.modalBucket) s *= 0.35;
    // And how much the finding is worth is not just how big its number is.
    // Ranking on size alone put a four-point correlation and a two-segment
    // split at the top of summaries because the arithmetic came out large,
    // which is how a deck ends up leading on its least reliable slide.
    return s * EVIDENCE_WEIGHT[m.evidence ?? 'moderate'];
  };
  return [...perChart].sort((a, b) => score(b) - score(a));
}

function factList(metrics) {
  const out = [];
  const m = metrics || {};
  const push = (k, v) => {
    if (v === null || v === undefined || v === '') return;
    out.push(`${prettyKey(k)}: ${typeof v === 'number' ? compactNum(v) : Array.isArray(v) ? v.join(', ') : v}`);
  };
  for (const [k, v] of Object.entries(m)) {
    if (typeof v === 'object' && !Array.isArray(v) && v !== null) {
      for (const [k2, v2] of Object.entries(v)) push(`${k} ${k2}`, v2);
    } else {
      push(k, v);
    }
  }
  return out;
}

function looksTemporal(labels) {
  if (!labels || labels.length < 2) return false;
  const hits = labels.filter((l) => {
    const s = String(l).trim().toLowerCase();
    // Match date shapes positively. An earlier version rejected anything shaped
    // like "<digits>-<digits>" first, to screen out histogram buckets — which
    // also matched every ISO year-month, so "2026-01" was never seen as a date.
    // Requiring a positive match screens buckets out just as well: "1852-2578"
    // fits none of these patterns.
    return (
      /^\d{4}-\d{2}(-\d{2})?$/.test(s) ||                 // ISO year-month(-day)
      /^(19|20)\d{2}$/.test(s) ||                          // plausible 4-digit year
      /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(\s|$|[-\/])/.test(s) ||
      /^q[1-4](\s|$|[-\/'])/.test(s) ||                    // Q1, Q1-2025
      /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(s)           // 4/1, 04/01/2025
    );
  }).length;
  return hits >= Math.ceil(labels.length * 0.6);
}
