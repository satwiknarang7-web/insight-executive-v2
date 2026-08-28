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
 * Pure module: no imports, no side effects. Safe to unit-test in isolation.
 */

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

/** Pearson correlation coefficient. Returns null if undefined. */
export function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  const r = num / Math.sqrt(dx * dy);
  return Math.max(-1, Math.min(1, r));
}

function correlationStrength(r) {
  const a = Math.abs(r);
  if (a >= 0.8) return 'very strong';
  if (a >= 0.6) return 'strong';
  if (a >= 0.4) return 'moderate';
  if (a >= 0.2) return 'weak';
  return 'little to no';
}

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
  const sorted = [...points].sort((a, b) => b.value - a.value);
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

  const outliers = detectOutliers(points);
  const belowAverage = points.filter((p) => p.value < avg).length;
  // How many times the leader the laggard is. More legible than a percentage
  // once the gap is large: "nine times" lands where "800% ahead" does not.
  const spread = bottom.value > 0 ? top.value / bottom.value : null;
  const basis = shareBasis(ctx, points.length);

  const metrics = {
    leader: top.label,
    leaderValue: top.value,
    leaderSharePct: round(leaderShare),
    // Which denominator the shares above were computed against. A LIMIT-ed
    // result cannot speak for rows it never saw.
    sharesMeasuredAgainst: basis.of,
    deltaVsAvgPct: round(deltaVsAvg),
    gapToSecondPct: gapToSecond === null ? null : round(gapToSecond),
    runnerUp: second ? second.label : null,
    laggard: bottom.label,
    laggardValue: bottom.value,
    leaderToLaggardRatio: spread === null ? null : round(spread, 1),
    average: round(avg),
    belowAverage,
    total: round(total),
    categories: points.length,
    paretoCount,
    paretoSharePct: round(paretoShare),
    outliers: outliers.map((o) => o.label),
  };

  const concentrated = leaderShare >= CONCENTRATION_PCT || paretoCount <= Math.max(1, points.length * 0.3);
  const headline =
    `${top.label} leads ${plural(dim.toLowerCase())} on ${measurePhrase(measure)} at ${compactNum(top.value)}` +
    (leaderShare > 0 ? `, ${pct(leaderShare)} of ${basis.phrase}` : '') + '.';

  const parts = [];
  parts.push(
    `That is ${pct(Math.abs(deltaVsAvg))} ${deltaVsAvg >= 0 ? 'above' : 'below'} the ${compactNum(avg)} average across ${points.length} ${plural(dim.toLowerCase())}` +
      (gapToSecond !== null
        ? `, and ${pct(Math.abs(gapToSecond))} ${gapToSecond >= 0 ? 'ahead of' : 'behind'} ${second.label}`
        : '') +
      '.'
  );
  // The shape of the distribution, not just its top. A leader means one thing
  // when the field is even behind it and another when the field has collapsed.
  if (spread !== null && spread >= 2) {
    parts.push(
      `${top.label} is ${spread >= 10 ? Math.round(spread) : spread.toFixed(1)}\u00d7 ${bottom.label} at the other end, and ${belowAverage} of ${points.length} sit below the average \u2014 the field is top-heavy rather than evenly matched.`
    );
  } else if (points.length > 2) {
    parts.push(
      `${belowAverage} of ${points.length} sit below the average, so the range is tight and the lead is narrow.`
    );
  }
  parts.push(
    concentrated
      ? `Just ${paretoCount} of ${points.length} account for about 80% of ${basis.phrase} \u2014 a concentrated mix, so movement in those few decides the number.`
      : `It takes ${paretoCount} of ${points.length} to reach about 80% of ${basis.phrase}, so no single ${dim.toLowerCase()} moves the number on its own.`
  );
  if (outliers.length) {
    parts.push(
      `${outliers.map((o) => o.label).join(', ')} sit outside the normal range for this set \u2014 worth checking whether that is real or a data problem.`
    );
  }
  if (basis.caveat) parts.push(basis.caveat);

  const recommendation = concentrated
    ? `Decide whether the reliance on ${top.label} is a strength to press or an exposure to hedge, and model what ${basis.of === 'shown' ? 'the number' : 'the total'} looks like if it slips.`
    : `Find what the leaders do differently and whether it transfers \u2014 lifting the ${belowAverage} below average is worth more here than pushing ${top.label} further ahead.`;

  return { metrics, headline, detail: parts.join(' '), recommendation };
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

  // Linear regression slope sign for robust direction (less noisy than endpoints).
  const slope = linregSlope(vals);
  const direction =
    Math.abs(slope) < (Math.abs(mu) * 0.005 || 1e-9) ? 'flat' : slope > 0 ? 'rising' : 'declining';

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

  const metrics = {
    direction,
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
    volatilityPct: round(volatility),
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

  const detailParts = [];
  if (perPeriod !== null) {
    detailParts.push(
      // Named for the basis it was measured on. This is a start-to-end rate, so
      // on a series that turned late it runs opposite to the fitted direction —
      // and "That works out to" read as a restatement of the trend rather than
      // a second measurement of it.
      `Measured start to end that is about ${pct(Math.abs(perPeriod))} ${perPeriod >= 0 ? 'growth' : 'decline'} per period, compounded across ${periods} ${periods === 1 ? 'interval' : 'intervals'}.`
    );
  }
  detailParts.push(
    `It peaked at ${compactNum(maxP.value)} (${maxP.label}) and bottomed at ${compactNum(minP.value)} (${minP.label}), a range of ${compactNum(maxP.value - minP.value)}.`
  );
  detailParts.push(
    volatility > 40
      ? `Swings are large \u2014 volatility is about ${pct(volatility)} of the mean \u2014 so any single period is a poor guide to the next one, and the direction matters more than the latest number.`
      : `The series is steady, with volatility around ${pct(volatility)} of the mean, so the direction is worth reading as signal rather than noise.`
  );
  // What the most recent period did, which is the part a reader acts on and the
  // part an average over the whole span hides.
  if (lastStep !== null && points.length > 2) {
    const withTrend =
      (lastStep >= 0 && direction === 'rising') || (lastStep < 0 && direction === 'declining');
    detailParts.push(
      `The last period ${lastStep >= 0 ? 'rose' : 'fell'} ${pct(Math.abs(lastStep))} on the one before, ${
        direction === 'flat'
          ? 'against an otherwise flat series'
          : withTrend
            ? 'continuing the trend'
            : 'breaking the trend \u2014 worth confirming before it is read as a turning point'
      }.`
    );
  }
  const detail = detailParts.join(' ');

  const recommendation = netAgainstTrend
    ? // Neither the trend nor the latest number is the thing to act on yet —
      // which of the two is real is the open question, and acting on the wrong
      // one is the expensive mistake here.
      `Establish whether ${last.label} is a turning point or a one-off before planning on either the trend or the latest figure.`
    : direction === 'declining'
      ? `Identify what changed around ${minP.label} and whether the decline is structural or seasonal before it compounds.`
      : direction === 'rising'
      ? `Confirm the drivers behind the rise are repeatable, and set targets off the current run-rate rather than the starting point.`
      : `Find out why ${measure.toLowerCase()} is stuck flat and what lever would break it out of the range.`;

  return { metrics, headline, detail: detail.trim(), recommendation };
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

  // The long end of the mix: everything outside the top two.
  const rest = sorted.slice(2);
  const tail = {
    count: rest.length,
    sharePct: total > 0 ? round((rest.reduce((s, p) => s + p.value, 0) / total) * 100) : 0,
    first: rest.length ? rest[0].label : null,
  };
  const basis = shareBasis(ctx, points.length);

  const metrics = {
    dominant: top.label,
    dominantSharePct: round(topShare),
    top2SharePct: round(top2Share),
    tailSegments: tail.count,
    tailSharePct: tail.sharePct,
    segments: points.length,
    hhi: round(hhi, 3),
    concentration: hhi >= 0.5 ? 'high' : hhi >= 0.25 ? 'moderate' : 'low',
    sharesMeasuredAgainst: basis.of,
    total: round(total),
  };

  // One leader carrying this much of the total is a concentrated mix whatever
  // the tail does, so it is not described as balanced anywhere downstream.
  const concentrated = hhi >= 0.5 || topShare >= CONCENTRATION_PCT;

  const headline = `${top.label} accounts for ${pct(topShare)} of ${basis.phrase}, the largest share of any ${dim.toLowerCase()}.`;

  const detailParts = [
    `The top two ${plural(dim.toLowerCase())} together carry ${pct(top2Share)} across ${points.length} segments.`,
  ];
  if (tail.count > 0) {
    detailParts.push(
      `The remaining ${tail.count} ${tail.count === 1 ? 'segment carries' : 'segments carry'} ${pct(tail.sharePct)} between them, so most of the mix is decided before you reach ${tail.first}.`
    );
  }
  detailParts.push(
    concentrated
      ? `One ${dim.toLowerCase()} dominates: ${top.label} alone carries ${pct(topShare)}, which means the headline number is largely a report on ${top.label}.`
      : hhi >= 0.25
        ? 'Concentration is moderate \u2014 there is a clear leader, but enough spread that no one segment sets the result.'
        : 'The mix is well diversified, with no single segment dominating, so a shock to any one of them is absorbable.'
  );
  if (basis.caveat) detailParts.push(basis.caveat);

  const recommendation = concentrated
    ? `Stress-test the exposure to ${top.label}: model what ${measurePhrase(measure)} looks like if it fell by a quarter, and decide whether that is a risk worth carrying.`
    : `Keep the balance while watching whether ${top.label} keeps pulling ahead \u2014 it is the only segment currently able to change the shape of this mix.`;

  return { metrics, headline, detail: detailParts.join(' '), recommendation };
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
      metrics: { correlation: null, note: 'insufficient or constant data' },
      headline: `Not enough variation to measure a relationship between ${prettyKey(xK)} and ${prettyKey(yK)}.`,
      detail: 'At least three varying points on both axes are needed for a reliable correlation.',
      recommendation: `Gather more granular records before reading a relationship into ${prettyKey(xK)} and ${prettyKey(yK)}.`,
    };
  }

  const strength = correlationStrength(r);
  const dir = r > 0 ? 'positive' : 'negative';
  const metrics = {
    correlation: round(r, 2),
    rSquaredPct: round(r * r * 100),
    strength,
    direction: dir,
    xField: prettyKey(xK),
    yField: prettyKey(yK),
    unexplainedPct: round(100 - r * r * 100),
    points: Math.min(xs.length, ys.length),
  };
  const points = Math.min(xs.length, ys.length);
  const headline = `${prettyKey(xK)} and ${prettyKey(yK)} show a ${strength} ${dir} relationship (r = ${r.toFixed(2)}).`;
  const detail =
    `As ${prettyKey(xK).toLowerCase()} rises, ${prettyKey(yK).toLowerCase()} tends to ${r >= 0 ? 'rise too' : 'fall'}. ` +
    `${prettyKey(xK)} accounts for about ${pct(r * r * 100, 0)} of the variation in ${prettyKey(yK).toLowerCase()}, ` +
    `which leaves ${pct(100 - r * r * 100, 0)} coming from something else. ` +
    (Math.abs(r) >= 0.6
      ? `Across ${points} points that is a strong enough link to plan against, though it says the two move together \u2014 not that one causes the other.`
      : `Across ${points} points that is a loose link: treat it as a hint worth testing, not a rule to act on.`) +
    (points < 12
      ? ` With only ${points} points, one unusual row could move this figure noticeably.`
      : '');
  const recommendation =
    Math.abs(r) >= 0.6
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

  const metrics = {
    modalBucket: modal.label,
    modalSharePct: round(modalShare),
    secondBucket: second ? second.label : null,
    topTwoBandsSharePct: round(topTwoShare),
    thinBands: sparse,
    buckets: points.length,
    total: round(total),
  };
  const headline = `Most records fall in the ${modal.label} band \u2014 ${pct(modalShare)} of ${total}.`;
  const detailParts = [
    `Across ${points.length} bands, ${measure.toLowerCase()} clusters around ${modal.label}${
      second ? `, with ${second.label} next at ${pct((second.value / (total || 1)) * 100)}` : ''
    }.`,
  ];
  detailParts.push(
    modalShare >= 50
      ? `Over half the records sit in one band, so an average over the whole set describes the typical record well and hides very little.`
      : `The top two bands hold ${pct(topTwoShare)} between them, so there is a clear mode but a real spread \u2014 an average will sit between bands rather than in one.`
  );
  if (sparse > 0) {
    detailParts.push(
      `${sparse} ${sparse === 1 ? 'band holds' : 'bands hold'} under 5% of records each; those tails are where unusual cases live.`
    );
  }
  const recommendation = `Decide whether the ${modal.label} band is the case to design for, or whether the ${sparse || 'outer'} thin ${sparse === 1 ? 'band carries' : 'bands carry'} value or risk that the bulk hides.`;
  return { metrics, headline, detail: detailParts.join(' '), recommendation };
}

function analyzeMultiMetric(series, ctx) {
  // radar / composed: a small set of categories scored on several measures.
  const { points, numericKeys, labelKey } = series;
  const rows = ctx.rows || [];
  const dim = ctx.dimLabel || prettyKey(labelKey);
  const perMetric = {};
  for (const k of numericKeys.slice(0, 4)) {
    const ranked = rows
      .map((r) => ({ label: String(r[labelKey] ?? ''), value: toNum(r[k]) }))
      .filter((p) => isNum(p.value))
      .sort((a, b) => b.value - a.value);
    if (ranked.length) perMetric[prettyKey(k)] = ranked[0].label;
  }
  const leaders = Object.entries(perMetric);
  const allSame = leaders.length > 1 && leaders.every(([, v]) => v === leaders[0][1]);

  const metrics = { metricLeaders: perMetric, allRoundLeader: allSame ? leaders[0][1] : null, categories: points.length };
  const headline = allSame
    ? `${leaders[0][1]} leads on every measure tracked.`
    : `No single ${dim.toLowerCase()} wins across the board — leadership is split by metric.`;
  const detail = leaders.map(([m, who]) => `${who} leads on ${m.toLowerCase()}`).join('; ') + '.';
  const recommendation = allSame
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
export function analyzeChart(chart) {
  const rows = chart?.resultData;
  if (!rows || rows.length === 0) return null;

  const series = extractSeries(rows, { xKey: chart.xAxisKey, yKey: chart.yAxisKey });
  if (!series || series.points.length === 0) return null;

  const type = String(chart.chart_type || 'bar').toLowerCase();
  const cut = truncation(chart, rows.length);
  const ctx = {
    rows,
    xKey: chart.xAxisKey,
    yKey: chart.yAxisKey,
    measureLabel: prettyKey(series.valueKey),
    dimLabel: prettyKey(series.labelKey),
    // Whether these rows are the whole set or the top of it. Every share the
    // analyzers compute depends on the answer.
    limited: cut.limited,
    limit: cut.limit,
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
  } else if (isCompositionType) {
    // Composition charts describe part-to-whole, even if the labels look temporal.
    analysis = analyzeComposition(series, ctx);
  } else if (isTemporal) {
    // Requires genuinely chronological labels — a line drawn over unordered
    // categories is not a trend, and describing it as one invents a direction.
    analysis = analyzeTrend(series, ctx);
  } else {
    analysis = analyzeRanking(series, ctx);
  }

  // A short, flat list of "facts" the LLM is allowed to cite verbatim.
  const verifiedFacts = factList(analysis.metrics);

  return {
    id: chart.id,
    title: chart.title,
    type,
    metrics: analysis.metrics,
    headline: analysis.headline,
    detail: analysis.detail,
    recommendation: analysis.recommendation,
    verifiedFacts,
  };
}

/**
 * Analyze the whole storyboard: per-chart findings plus a dataset-level synthesis.
 *
 * @param {Array} charts - executed charts with resultData
 * @param {Array} rawRows - the full cleaned dataset (optional, for dataset stats)
 * @returns {Object} { perChart: [...], synthesis: {...} }
 */
export function analyzeStoryboard(charts, rawRows = []) {
  const perChart = (charts || []).map((c) => analyzeChart(c)).filter(Boolean);

  // Dataset-level synthesis: surface the 3 most decision-relevant findings.
  const ranked = rankFindings(perChart);
  // Two charts over the same dimension can produce word-for-word identical
  // headlines; showing one takeaway three times is worse than showing two.
  const lede = synthesisHeadline(ranked, rawRows.length);
  const macroInsights = [];
  const seenHeadlines = new Set();
  for (const f of ranked) {
    // The opening line is built from the top finding, so that finding does not
    // also open the bullets — unless it is the only one there is.
    if (perChart.length > 1 && f.id === lede.sourceId) continue;
    const key = f.headline.trim().toLowerCase();
    if (seenHeadlines.has(key)) continue;
    seenHeadlines.add(key);
    macroInsights.push(macroBullet(f));
    if (macroInsights.length === 4) break;
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
  const riskSource = concentrated || trendRisk;
  const notTheRisk = (f) => !riskSource || f.id !== riskSource.id;

  // Written here rather than inline in the card, because the falling case has
  // two shapes and a nested ternary in the middle of a returned object is where
  // the wrong one gets picked. `totalChangePct` is a start-to-end figure: on a
  // series still trending down but already recovered past its opening value it
  // is a rise, and quoting it after "trending down" reports the recovery as the
  // size of the fall.
  const riskLine = concentrated
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
    caveats,
    macroInsights: macroInsights.length ? macroInsights : ['No statistically significant patterns detected in the current view.'],
    strategicScorecard: {
      focus: ranked[0]?.recommendation || 'Review the leading segments for resource allocation.',
      // Empty when the data shows no risk. A card that says "no risk detected"
      // is a slot being filled rather than a finding, and it reads as a
      // contradiction next to a focus and an opportunity built on the same
      // concentration. Nothing to report is better reported by saying nothing.
      risk: riskLine,
      opportunity: opportunity?.headline || '',
    },
    rowsAnalyzed: rawRows.length || null,
    chartsAnalyzed: perChart.length,
  };

  return { perChart, synthesis };
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
function macroBullet(finding) {
  const head = String(finding.headline || '').trim();
  const follow = implication(finding) || firstSentence(finding.detail);
  if (!follow || follow.toLowerCase() === head.toLowerCase()) return head;
  return `${head} ${follow}`;
}

/**
 * The "so what" for one finding, computed rather than phrased.
 *
 * Each branch reads only numbers the analyzer already verified, so a bullet can
 * never claim more than the query supports — and a finding whose numbers do not
 * warrant a consequence gets none rather than a manufactured one.
 */
function implication(finding) {
  const m = finding?.metrics || {};
  const of = m.sharesMeasuredAgainst === 'shown' ? 'the rows shown' : 'the total';

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
    return m.direction === 'declining'
      ? `Left alone it keeps falling${rate}, so the question is what changed rather than whether to react.${caveat}`
      : `Sustained${rate} that compounds, so targets set off the starting point will be met early and stop meaning anything.${caveat}`;
  }
  if (m.direction === 'flat') {
    return 'Nothing in the period moved it, so effort spent here is currently buying no change.';
  }
  if (isNum(m.correlation) && Math.abs(m.correlation) >= 0.6) {
    return `It leaves ${pct(m.unexplainedPct ?? 0, 0)} of the variation unexplained, so it is a lever worth testing rather than a rule to plan on.`;
  }
  const share = topSharePct(m);
  if (isNum(share) && share >= CONCENTRATION_PCT) {
    const who = m.dominant || m.leader;
    return `${who} carrying ${pct(share)} of ${of} means a bad quarter there is a bad quarter overall — that is a concentration to decide about, not a fact to note.`;
  }
  if (isNum(m.paretoCount) && isNum(m.categories) && m.categories > 2) {
    return `It takes ${m.paretoCount} of ${m.categories} to reach 80% of ${of}, so attention spread evenly across all of them is attention mostly spent in the wrong places.`;
  }
  if (m.modalBucket && isNum(m.modalSharePct)) {
    return m.modalSharePct >= 50
      ? 'One band holds most of the records, so an average describes the typical case well here.'
      : 'No band holds a majority, so an average sits between cases rather than describing one.';
  }
  return null;
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
    const what = lowerFirst(top.title || 'the leading measure');
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
  return t.charAt(0).toLowerCase() + t.slice(1);
};

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
    return s;
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
