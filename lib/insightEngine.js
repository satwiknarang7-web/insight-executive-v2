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

  const metrics = {
    leader: top.label,
    leaderValue: top.value,
    leaderSharePct: round(leaderShare),
    deltaVsAvgPct: round(deltaVsAvg),
    gapToSecondPct: gapToSecond === null ? null : round(gapToSecond),
    runnerUp: second ? second.label : null,
    laggard: bottom.label,
    laggardValue: bottom.value,
    average: round(avg),
    total: round(total),
    categories: points.length,
    paretoCount,
    paretoSharePct: round(paretoShare),
    outliers: outliers.map((o) => o.label),
  };

  const concentrated = leaderShare >= 40 || (paretoCount <= Math.max(1, points.length * 0.3));
  const headline =
    `${top.label} leads ${plural(dim.toLowerCase())} on ${measurePhrase(measure)} at ${compactNum(top.value)}` +
    (leaderShare > 0 ? `, ${pct(leaderShare)} of the total` : '') + '.';

  let detail =
    `That is ${pct(Math.abs(deltaVsAvg))} ${deltaVsAvg >= 0 ? 'above' : 'below'} the ${compactNum(avg)} average across ${points.length} ${plural(dim.toLowerCase())}` +
    (gapToSecond !== null ? `, and ${pct(Math.abs(gapToSecond))} ${gapToSecond >= 0 ? 'ahead of' : 'behind'} ${second.label}` : '') + '. ';
  if (concentrated) {
    detail += `Just ${paretoCount} of ${points.length} account for ~80% of the total — a concentrated mix. `;
  } else {
    detail += `The top ${paretoCount} of ${points.length} make up ~80%, so volume is fairly spread out. `;
  }
  if (outliers.length) {
    detail += `${outliers.map((o) => o.label).join(', ')} stand${outliers.length === 1 ? 's' : ''} out from the pack.`;
  }

  const recommendation = concentrated
    ? `Decide whether the heavy reliance on ${top.label} is a strength to double down on or a risk to diversify away from.`
    : `Look for what the leaders do differently and whether it can lift the ${bottom.label} end of the range.`;

  return { metrics, headline, detail: detail.trim(), recommendation };
}

function analyzeTrend(series, ctx) {
  const { points, valueKey } = series;
  const measure = ctx.measureLabel || prettyKey(valueKey);
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

  const metrics = {
    direction,
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
  };

  const dirWord = direction === 'flat' ? 'held roughly flat' : direction === 'rising' ? 'trended up' : 'trended down';
  const sameSpan = first.label === last.label; // single-period datasets (e.g. all one month)
  const headline = sameSpan
    ? `${measure} stayed around ${compactNum(mu)} across the ${first.label} period.`
    : `${measure} ${dirWord} from ${first.label} to ${last.label}` +
      (totalChange !== null ? `, a ${pct(Math.abs(totalChange))} ${totalChange >= 0 ? 'increase' : 'decrease'}` : '') + '.';

  let detail = '';
  if (perPeriod !== null) {
    detail += `That works out to about ${pct(Math.abs(perPeriod))} ${perPeriod >= 0 ? 'growth' : 'decline'} per period. `;
  }
  detail += `It peaked at ${compactNum(maxP.value)} (${maxP.label}) and bottomed at ${compactNum(minP.value)} (${minP.label}). `;
  detail +=
    volatility > 40
      ? `Swings are large (volatility ~${pct(volatility)} of the mean), so the trend is choppy.`
      : `The series is relatively steady (volatility ~${pct(volatility)} of the mean).`;

  const recommendation =
    direction === 'declining'
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

  const metrics = {
    dominant: top.label,
    dominantSharePct: round(topShare),
    top2SharePct: round(top2Share),
    segments: points.length,
    hhi: round(hhi, 3),
    concentration: hhi >= 0.5 ? 'high' : hhi >= 0.25 ? 'moderate' : 'low',
    total: round(total),
  };

  const headline = `${top.label} accounts for ${pct(topShare)} of ${measurePhrase(measure)}, the largest share of any ${dim.toLowerCase()}.`;
  const detail =
    `The top two ${plural(dim.toLowerCase())} together account for ${pct(top2Share)} across ${points.length} segments. ` +
    (hhi >= 0.5
      ? `Concentration is high — a few segments dominate the mix.`
      : hhi >= 0.25
      ? `Concentration is moderate — there is a clear leader but real spread.`
      : `The mix is well diversified, with no single segment dominating.`);
  const recommendation =
    hhi >= 0.5
      ? `Stress-test exposure to ${top.label}: model the impact if it dropped, and weigh diversification.`
      : `Maintain the balanced mix while watching whether ${top.label} keeps pulling ahead.`;

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
    points: Math.min(xs.length, ys.length),
  };
  const headline = `${prettyKey(xK)} and ${prettyKey(yK)} show a ${strength} ${dir} relationship (r = ${r.toFixed(2)}).`;
  const detail =
    `As ${prettyKey(xK).toLowerCase()} ${r >= 0 ? 'rises, ' + prettyKey(yK).toLowerCase() + ' tends to rise too' : 'rises, ' + prettyKey(yK).toLowerCase() + ' tends to fall'}. ` +
    `Statistically, ${prettyKey(xK).toLowerCase()} explains about ${pct(r * r * 100, 0)} of the variation in ${prettyKey(yK).toLowerCase()} — ` +
    (Math.abs(r) >= 0.6 ? 'a meaningful link worth acting on.' : 'a loose link, so treat it as a hint rather than a rule.');
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

  const metrics = {
    modalBucket: modal.label,
    modalSharePct: round(modalShare),
    buckets: points.length,
    total: round(total),
  };
  const headline = `Most records fall in the ${modal.label} band (${pct(modalShare)} of ${total}).`;
  const detail =
    `Across ${points.length} bands, ${measure.toLowerCase()} clusters around ${modal.label}. ` +
    (modalShare >= 50 ? 'The distribution is tightly concentrated there.' : 'There is a clear mode but a real spread across the range.');
  const recommendation = `Decide whether the ${modal.label} concentration is the segment to optimize for, or whether the tails carry hidden value or risk.`;
  return { metrics, headline, detail, recommendation };
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
  const ctx = {
    rows,
    xKey: chart.xAxisKey,
    yKey: chart.yAxisKey,
    measureLabel: prettyKey(series.valueKey),
    dimLabel: prettyKey(series.labelKey),
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
    if (macroInsights.length === 3) break;
  }

  // Strategic scorecard derived deterministically.
  const trend = perChart.find((f) => f.metrics.direction);
  const concentrated = perChart.find((f) => f.metrics.concentration === 'high' || f.metrics.leaderSharePct >= 40);
  // Opportunity must be a POSITIVE signal — a rising trend, a strong positive
  // relationship, or the clearest leader. Never surface a decline here.
  const opportunity =
    perChart.find((f) => f.metrics.direction === 'rising') ||
    perChart.find((f) => f.type === 'scatter' && (f.metrics.correlation || 0) >= 0.6) ||
    ranked.find(
      (f) => !f.metrics.modalBucket && (isNum(f.metrics.leaderSharePct) || isNum(f.metrics.dominantSharePct))
    ) ||
    ranked.find((f) => f.metrics.direction !== 'declining') ||
    ranked[0];

  const synthesis = {
    title: 'Executive Summary',
    headline: lede.text,
    macroInsights: macroInsights.length ? macroInsights : ['No statistically significant patterns detected in the current view.'],
    strategicScorecard: {
      focus: ranked[0]?.recommendation || 'Review the leading segments for resource allocation.',
      risk: concentrated
        ? `Concentration risk: ${concentrated.metrics.dominant || concentrated.metrics.leader} carries an outsized share.`
        : trend && trend.metrics.direction === 'declining'
        ? `${trend.metrics.endLabel ? trend.title : 'A key metric'} is trending down (${pct(Math.abs(trend.metrics.totalChangePct || 0))}).`
        : 'No single dominant concentration or downtrend risk detected.',
      opportunity: opportunity?.headline || 'Explore drivers behind the leading segment.',
    },
    rowsAnalyzed: rawRows.length || null,
    chartsAnalyzed: perChart.length,
  };

  return { perChart, synthesis };
}

/**
 * One bullet for the summary: what is true, then the first thing that follows
 * from it. A headline on its own is a reading — "Electronics leads at 42%" — and
 * a deck full of readings is why generated summaries feel machine-written. The
 * first sentence of the detail is the closest deterministic thing to a "so
 * what", so it rides along when it fits.
 */
function macroBullet(finding) {
  const head = String(finding.headline || '').trim();
  const follow = firstSentence(finding.detail);
  if (!follow || follow.toLowerCase() === head.toLowerCase()) return head;
  const joined = `${head} ${follow}`;
  return joined.length <= 240 ? joined : head;
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
    const word = m.direction === 'rising' ? 'growth' : 'decline';
    return said(`The dominant story in ${scale} is ${word}: ${lowerFirst(top.title || 'the leading measure')} moved${by} over the period covered.`);
  }
  if (isNum(m.correlation) && Math.abs(m.correlation) >= 0.6) {
    return said(`The dominant story in ${scale} is a relationship: ${m.xField} and ${m.yField} move together closely enough to be worth testing (r = ${m.correlation.toFixed(2)}).`);
  }
  if (isNum(m.leaderSharePct) && m.leaderSharePct >= 40) {
    return said(`The dominant story in ${scale} is concentration: ${m.leader} alone accounts for ${pct(m.leaderSharePct)} of the total.`);
  }
  if (isNum(m.dominantSharePct) && m.dominantSharePct >= 40) {
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
