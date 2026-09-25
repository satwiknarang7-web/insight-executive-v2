/**
 * What each chart says, in one or two sentences an analyst would put under it
 * — the size of the effect, what it is compared with, and a plain "this
 * doesn't matter" when that is the finding. Every sentence is built from
 * numbers computed here, and each insight carries those numbers (`facts`) so a
 * language model rewriting it can be checked against them.
 *
 * An insight: { text, score, facts: { label: value } , tone: 'up'|'down'|'flat'|'neutral' }
 * `score` ranks findings for the Key findings panel: effect size × how central
 * the measure is × how sure the data is.
 */

import { toNumber } from './fields.js';
import { formatChange, formatPeriod, formatPoints, formatTimes, formatValue, list, lower, plural } from './format.js';
import { correlation, countToShare, groupEffect, linearTrend, mean, proportionTest, quantile, sd, spearman } from './stats.js';
import { rowFilter } from './query.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fv = (v, m, o) => formatValue(v, m, o);
const pctOf = (x) => `${Math.round(x * 100)}%`;

/* ── Trend ─────────────────────────────────────────────────────────────── */

/**
 * A partial last period — the current month three days in — reads as a
 * collapse. It is left off the numbers and said once.
 */
function completePoints(data, x, y, support = []) {
  const pts = data.map((r, i) => ({ label: r[x], value: r[y], n: support[i] ?? null })).filter((p) => isNum(p.value));
  if (pts.length >= 4 && pts[pts.length - 1].n !== null) {
    const med = quantile(
      pts.slice(0, -1).map((p) => p.n),
      0.5
    );
    if (med && pts[pts.length - 1].n < 0.85 * med) return { pts: pts.slice(0, -1), partial: pts[pts.length - 1] };
  }
  return { pts, partial: null };
}

export function trendInsight({ data, x, ys, support }, m, { grain, noun } = {}) {
  const y = ys[0];
  const { pts, partial } = completePoints(data, x, y, support);
  if (pts.length < 3) return { text: `Only ${pts.length} ${grain || 'period'}s of data — too few to call a trend.`, score: 0, facts: {} };
  const vals = pts.map((p) => p.value);
  const k = pts.length >= 8 ? 3 : 1;
  const start = mean(vals.slice(0, k));
  const end = mean(vals.slice(-k));
  const change = start ? ((end - start) / Math.abs(start)) * 100 : null;
  const { r2 } = linearTrend(vals);
  const cv = mean(vals) ? (sd(vals) / Math.abs(mean(vals))) * 100 : 0;
  const peak = pts.reduce((a, b) => (b.value > a.value ? b : a));
  const low = pts.reduce((a, b) => (b.value < a.value ? b : a));
  const first = formatPeriod(pts[0].label, grain);
  const last = formatPeriod(pts[pts.length - 1].label, grain);
  const name = m.label;
  const isRate = m.format === 'percent';
  const delta = isRate ? formatPoints(end - start, m) : formatChange(change);

  const facts = { start: fv(start, m), end: fv(end, m), change: delta, peak: fv(peak.value, m), peakAt: formatPeriod(peak.label, grain) };
  const parts = [];
  let tone = 'flat';
  let score = 0;
  const avgWord = k > 1 ? ` (${k}-${grain} averages)` : '';
  if (change !== null && Math.abs(change) >= 5 && r2 >= 0.25) {
    tone = change > 0 ? 'up' : 'down';
    parts.push(`${name} ${change > 0 ? 'rose' : 'fell'} ${delta.replace(/^[+−]/, '')} from ${first} to ${last}${avgWord}, from ${fv(start, m)} to ${fv(end, m)}.`);
    score = Math.min(1, Math.abs(change) / 50) * (0.5 + r2 / 2);
  } else if (change !== null && Math.abs(change) >= 10) {
    tone = change > 0 ? 'up' : 'down';
    parts.push(`${name} ended ${delta.replace(/^[+−]/, '')} ${change > 0 ? 'higher' : 'lower'} than it started (${first} → ${last}), but the path is uneven.`);
    score = Math.min(1, Math.abs(change) / 80) * 0.5;
  } else {
    parts.push(`${name} shows no sustained trend from ${first} to ${last}: it stays between ${fv(low.value, m)} and ${fv(peak.value, m)}.`);
    score = 0.15;
  }
  // Peak/trough when the series swings.
  if (cv >= 15 && pts.length >= 6) {
    parts.push(`Peak ${fv(peak.value, m)} in ${formatPeriod(peak.label, grain)}; low ${fv(low.value, m)} in ${formatPeriod(low.label, grain)}.`);
    score += 0.05;
  }
  // Latest period against the one before and, monthly, a year earlier.
  if (pts.length >= 4) {
    const a = pts[pts.length - 1];
    const b = pts[pts.length - 2];
    const yoy = grain === 'month' && pts.length >= 13 ? pts[pts.length - 13] : grain === 'quarter' && pts.length >= 5 ? pts[pts.length - 5] : null;
    const pop = b.value ? ((a.value - b.value) / Math.abs(b.value)) * 100 : null;
    const yo = yoy?.value ? ((a.value - yoy.value) / Math.abs(yoy.value)) * 100 : null;
    const bits = [];
    if (isNum(pop) && Math.abs(pop) >= 1) bits.push(`${isRate ? formatPoints(a.value - b.value, m) : formatChange(pop)} vs the previous ${grain}`);
    if (isNum(yo) && Math.abs(yo) >= 1) bits.push(`${isRate ? formatPoints(a.value - yoy.value, m) : formatChange(yo)} year on year`);
    if (bits.length) {
      parts.push(`Latest ${grain} (${formatPeriod(a.label, grain)}): ${fv(a.value, m)}, ${bits.join(', ')}.`);
      facts.latest = fv(a.value, m);
      if (isNum(yo) && Math.abs(yo) >= 15) score += 0.15;
    }
  }
  if (partial) parts.push(`${formatPeriod(partial.label, grain)} is incomplete and left out.`);
  return { text: parts.join(' '), score: score * (m.importance ? Math.min(1, m.importance / 90) : 0.8), facts, tone };
}

/* ── Breakdown ─────────────────────────────────────────────────────────── */

/** Row-level values of a measure, grouped by a field — for significance. */
function groupedValues(rows, m, dim, filters, limit = 30000) {
  if (m.type !== 'agg') return null;
  const keep = rowFilter(filters);
  const where = m.where?.length ? rowFilter(m.where) : () => true;
  const groups = new Map();
  let n = 0;
  const step = Math.max(1, Math.floor(rows.length / limit));
  for (let i = 0; i < rows.length; i += step) {
    const r = rows[i];
    if (!keep(r) || !where(r)) continue;
    const x = toNumber(r?.[m.field]);
    const k = r?.[dim];
    if (x === null || k === null || k === undefined || k === '') continue;
    const key = String(k);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
    n++;
  }
  return n ? groups : null;
}

export function breakdownInsight({ data, x, ys, support, totals }, m, { rows, filters, dimLabel, ds, numericDim = false } = {}) {
  const y = ys[0];
  const pts = data.filter((r) => isNum(r[y]) && r[x] !== 'Other');
  if (pts.length < 2) return { text: `Only one ${lower(dimLabel)} has data.`, score: 0, facts: {} };
  const dimWord = lower(dimLabel);
  const dimPlural = plural(dimWord);
  // A numeric split names its group with the field: "tenure months ≥ 54".
  const nameOf = (r) => (numericDim ? `${dimWord} ${r[x]}` : String(r[x]));
  const top = pts.reduce((a, b) => (b[y] > a[y] ? b : a));
  const bottom = pts.reduce((a, b) => (b[y] < a[y] ? b : a));
  const facts = { top: nameOf(top), topValue: fv(top[y], m), bottom: nameOf(bottom), bottomValue: fv(bottom[y], m) };

  // Parts that subtract — refunds against sales — are not shares of anything.
  if (m.additive && pts.some((r) => r[y] < 0)) {
    const pos = pts.filter((r) => r[y] > 0).sort((a, b) => b[y] - a[y]);
    const neg = pts.filter((r) => r[y] < 0).sort((a, b) => a[y] - b[y]);
    const gross = pos.reduce((s2, r) => s2 + r[y], 0);
    const lost = neg.reduce((s2, r) => s2 + r[y], 0);
    return {
      text: `${list(neg.map(nameOf))} ${neg.length > 1 ? 'take' : 'takes'} ${fv(Math.abs(lost), m)} off ${fv(gross, m)} from ${list(pos.slice(0, 3).map(nameOf))} — ${pctOf(Math.abs(lost) / (gross || 1))} of the gross, leaving ${fv(gross + lost, m)} net.`,
      score: Math.min(1, Math.abs(lost) / (gross || 1) * 3) * 0.9,
      facts: { ...facts, net: fv(gross + lost, m), lost: fv(Math.abs(lost), m) },
      tone: 'neutral',
    };
  }
  const nGroups = data.length + (data.find((r) => r[x] === 'Other')?.__other || 0) - (data.find((r) => r[x] === 'Other') ? 1 : 0);

  if (m.additive) {
    const total = totals?.[m.id] ?? data.reduce((s, r) => s + (r[y] || 0), 0);
    if (!total) return { text: `${m.label} is zero in every ${dimWord}.`, score: 0, facts };
    const share = top[y] / total;
    const k80 = countToShare(data.filter((r) => r[x] !== 'Other').map((r) => r[y]), 0.8);
    const even = 1 / Math.max(2, nGroups);
    facts.topShare = pctOf(share);
    const parts = [];
    let score;
    const minShare = Math.min(...pts.map((r) => r[y] / total));
    if (share < even * 1.35 && minShare > even * 0.7 && nGroups <= 12) {
      const lo = Math.min(...pts.map((r) => r[y] / total));
      parts.push(`${m.label} is spread evenly across the ${nGroups} ${dimPlural} (${pctOf(lo)}–${pctOf(share)} each); no single ${dimWord} dominates.`);
      score = 0.12;
    } else {
      parts.push(`${nameOf(top)} is the largest ${dimWord} with ${pctOf(share)} of ${lower(m.label)} (${fv(top[y], m)})`);
      const second = [...pts].sort((a, b) => b[y] - a[y])[1];
      if (second && second[y] > 0) parts[0] += `, ${formatTimes(top[y] / second[y])} the next, ${nameOf(second)}.`;
      else parts[0] += '.';
      if (nGroups >= 6 && k80 <= Math.ceil(nGroups * 0.35)) parts.push(`${k80} of ${nGroups} ${dimPlural} make up 80% of the total.`);
      score = Math.min(1, (share - even) / (1 - even) + 0.2);
    }
    // Is the gap about volume or about value per row? The per-row mean says.
    const groups = rows ? groupedValues(rows, m, x, filters) : null;
    if (groups && groups.size >= 2 && m.type === 'agg') {
      const eff = groupEffect([...groups.values()]);
      const means = [...groups.entries()].map(([k, xs]) => [k, mean(xs), xs.length]).filter((g) => g[2] >= 5);
      if (eff.p < 0.01 && eff.eta2 >= 0.03 && means.length >= 2) {
        const hi = means.reduce((a, b) => (b[1] > a[1] ? b : a));
        const lo = means.reduce((a, b) => (b[1] < a[1] ? b : a));
        parts.push(`Per ${ds?.noun?.one || 'row'}, ${hi[0]} averages ${fv(hi[1], m)} against ${fv(lo[1], m)} for ${lo[0]}.`);
        score += 0.1;
      }
    }
    return { text: parts.join(' '), score: score * Math.min(1, (m.importance || 70) / 90), facts, tone: 'neutral' };
  }

  // Averages, rates and ratios: how far apart are the groups, and is it real?
  const overall = totals?.[m.id];
  const isRate = m.format === 'percent';
  const gap = top[y] - bottom[y];
  const times = bottom[y] > 0 ? top[y] / bottom[y] : null;
  let p = 1;
  let eta2 = 0;
  // One value per group (a country's population in 2025): a description,
  // not a sample, so there is nothing to test.
  const single = support && support.every((n) => n <= 1);
  if (single) {
    p = 0;
    eta2 = 1;
  } else if (m.type === 'rate' && support) {
    const sTop = support[data.indexOf(top)];
    const sBot = support[data.indexOf(bottom)];
    p = proportionTest(Math.round(top[y] * sTop), sTop, Math.round(bottom[y] * sBot), sBot);
    eta2 = Math.abs(gap);
  } else {
    const groups = rows ? groupedValues(rows, m, x, filters) : null;
    if (groups) ({ eta2, p } = groupEffect([...groups.values()]));
    else {
      p = support && Math.min(...support) >= 20 ? 0.04 : 0.5;
      eta2 = overall ? Math.abs(gap / overall) / 4 : 0;
    }
  }
  const rel = overall ? Math.abs(gap) / Math.abs(overall) : times ? times - 1 : 0;
  facts.overall = fv(overall, m);
  const negative = bottom[y] < 0;
  const cmp = isRate
    ? `${formatPoints(gap, m).replace(/^\+/, '')} above`
    : times && times >= 1.15 && !negative
      ? `${formatTimes(times)}`
      : negative
        ? 'against'
        : `${formatChange(((top[y] - bottom[y]) / Math.abs(bottom[y] || 1)) * 100).replace(/^\+/, '')} above`;
  if (rel < 0.05 || (p >= 0.05 && rel < 0.25)) {
    return {
      text: `${m.label} barely differs by ${dimWord}: from ${fv(bottom[y], m)} (${nameOf(bottom)}) to ${fv(top[y], m)} (${nameOf(top)})${isNum(overall) ? `, ${fv(overall, m)} overall` : ''}. ${dimLabel} doesn't explain it.`,
      score: 0.05,
      facts,
      tone: 'flat',
    };
  }
  if (p >= 0.05) {
    return {
      text: `${m.label} ranges from ${fv(bottom[y], m)} (${nameOf(bottom)}) to ${fv(top[y], m)} (${nameOf(top)}), but the groups are too small to be sure the gap is real.`,
      score: 0.07,
      facts,
      tone: 'flat',
    };
  }
  const phrase = `${nameOf(top)} has the highest ${lower(m.label)} at ${fv(top[y], m)}, ${cmp} ${nameOf(bottom)} (${fv(bottom[y], m)})`;
  const tail = isNum(overall) && !single ? `; overall it is ${fv(overall, m)}.` : '.';
  return {
    text: `${phrase}${tail}`,
    score: Math.min(1, rel) * (0.6 + Math.min(0.4, eta2 * 4)) * Math.min(1, (m.importance || 70) / 90),
    facts,
    tone: 'neutral',
  };
}

/* ── Drivers of an outcome ─────────────────────────────────────────────── */

export function driverInsight(computed, m, ctx) {
  const ins = breakdownInsight(computed, m, ctx);
  return { ...ins, score: ins.score * 1.2 };
}

/* ── Distribution ──────────────────────────────────────────────────────── */

export function distributionInsight({ values }, f, m) {
  if (!values || values.length < 10) return { text: 'Too few values to describe the spread.', score: 0, facts: {} };
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const med = quantile(values, 0.5);
  const p95 = quantile(values, 0.95);
  const mx = Math.max(...values);
  const avg = mean(values);
  const fmt = (v) => fv(v, m);
  const parts = [`Half of all values sit between ${fmt(q1)} and ${fmt(q3)}, with a median of ${fmt(med)}.`];
  let score = 0.15;
  if (avg > med * 1.25 && mx > p95 * 1.5) {
    parts.push(`A long upper tail (top value ${fmt(mx)}) pulls the average up to ${fmt(avg)}, so the median is the better typical figure.`);
    score = 0.3;
  } else if (avg < med * 0.8) {
    parts.push(`A tail of low values drags the average down to ${fmt(avg)}.`);
    score = 0.25;
  }
  return { text: parts.join(' '), score, facts: { median: fmt(med), q1: fmt(q1), q3: fmt(q3), max: fmt(mx) }, tone: 'neutral' };
}

/* ── Relationship ──────────────────────────────────────────────────────── */

export function relationshipInsight({ data }, fx, fy, mx, my) {
  const xs = data.map((d) => d[fx.name]);
  const ys = data.map((d) => d[fy.name]);
  const { r, n } = correlation(xs, ys);
  const rs = spearman(xs, ys).r;
  const strength = Math.abs(r) >= 0.7 ? 'strongly' : Math.abs(r) >= 0.4 ? 'clearly' : 'weakly';
  if (Math.abs(r) < 0.2 && Math.abs(rs) < 0.2) {
    return { text: `${fy.label} does not move with ${lower(fx.label)} (r = ${r.toFixed(2)} over ${n} points).`, score: 0.05, facts: { r: r.toFixed(2) } };
  }
  const mxv = mean(xs);
  const myv = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mxv) * (ys[i] - myv);
    sxx += (xs[i] - mxv) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  const unit = quantile(xs, 0.75) - quantile(xs, 0.25) || sd(xs);
  const step = Number(unit.toPrecision(1));
  const parts = [`Higher ${lower(fx.label)} goes ${strength} with ${r > 0 ? 'higher' : 'lower'} ${lower(fy.label)} (r = ${r.toFixed(2)}, ${n} points).`];
  if (step && Math.abs(r) >= 0.3) parts.push(`Each +${fv(step, mx)} in ${lower(fx.label)} comes with about ${slope * step >= 0 ? '+' : '−'}${fv(Math.abs(slope * step), my)} in ${lower(fy.label)}.`);
  parts.push('This is association, not proof of cause.');
  return { text: parts.join(' '), score: Math.min(1, Math.abs(r)) * 0.8, facts: { r: r.toFixed(2) }, tone: 'neutral' };
}

/* ── Ranking table ─────────────────────────────────────────────────────── */

export function tableInsight({ data, x, ys, groups }, m, { dimLabel, totals } = {}) {
  const y = ys[0];
  if (!data.length) return { text: '', score: 0, facts: {} };
  const lead = data[0];
  const parts = [`${lead[x]} leads on ${lower(m.label)} with ${fv(lead[y], m)}.`];
  let score = 0.1;
  if (m.additive && totals?.[m.id]) {
    const share = data.reduce((s, r) => s + (r[y] || 0), 0) / totals[m.id];
    if (groups > data.length) {
      parts.push(`The top ${data.length} of ${groups} ${plural(lower(dimLabel))} account for ${pctOf(share)} of the total.`);
      score = share > 0.5 ? 0.35 : 0.2;
    }
  }
  return { text: parts.join(' '), score, facts: { leader: String(lead[x]) }, tone: 'neutral' };
}

/* ── Several measures side by side (survey items) ──────────────────────── */

export function compareInsight({ raw }, ms) {
  const vals = ms.map((m) => ({ m, v: raw?.[0]?.[m.id] })).filter((x) => isNum(x.v));
  if (vals.length < 2) return { text: '', score: 0, facts: {} };
  const hi = vals.reduce((a, b) => (b.v > a.v ? b : a));
  const lo = vals.reduce((a, b) => (b.v < a.v ? b : a));
  return {
    text: `${hi.m.label} scores highest (${fv(hi.v, hi.m)}) and ${lower(lo.m.label)} lowest (${fv(lo.v, lo.m)}) — the gap to close first.`,
    score: 0.4,
    facts: { high: hi.m.label, low: lo.m.label },
    tone: 'neutral',
  };
}

/* ── Series comparison over time ───────────────────────────────────────── */

export function seriesTrendInsight({ data, x, series }, m, { grain, seriesLabel } = {}) {
  const read = series
    .filter((s) => s !== 'Other')
    .map((s) => {
      const pts = data.map((r) => r[s]).filter(isNum);
      if (pts.length < 3) return null;
      const k = pts.length >= 8 ? 3 : 1;
      const a = mean(pts.slice(0, k));
      const b = mean(pts.slice(-k));
      return { s, a, b, change: a ? ((b - a) / Math.abs(a)) * 100 : null };
    })
    .filter((r) => r && isNum(r.change));
  if (read.length < 2) return { text: '', score: 0, facts: {} };
  const up = [...read].sort((p, q) => q.change - p.change);
  const first = formatPeriod(data[0]?.[x], grain);
  const last = formatPeriod(data[data.length - 1]?.[x], grain);
  const spread = up[0].change - up[up.length - 1].change;
  const text =
    spread < 10
      ? `All ${read.length} ${plural(lower(seriesLabel))} moved together from ${first} to ${last} (${formatChange(up[up.length - 1].change)} to ${formatChange(up[0].change)}).`
      : `${up[0].s} grew fastest (${formatChange(up[0].change)} from ${first} to ${last}); ${up[up.length - 1].s} ${up[up.length - 1].change < 0 ? 'fell' : 'grew slowest'} (${formatChange(up[up.length - 1].change)}).`;
  return { text, score: Math.min(1, spread / 100) * 0.6, facts: { fastest: up[0].s }, tone: 'neutral' };
}

/* ── KPI ───────────────────────────────────────────────────────────────── */

export function kpiDelta(points, m, grain) {
  const pts = points.filter((p) => isNum(p.value));
  if (pts.length < 2) return null;
  const a = pts[pts.length - 1];
  const b = pts[pts.length - 2];
  if (!isNum(b.value) || b.value === 0) return null;
  const isRate = m.format === 'percent';
  const pct = ((a.value - b.value) / Math.abs(b.value)) * 100;
  return {
    text: isRate ? formatPoints(a.value - b.value, m) : formatChange(pct),
    good: m.polarity === 0 ? null : (pct > 0) === (m.polarity > 0),
    vs: `vs ${formatPeriod(b.label, grain)}`,
    period: formatPeriod(a.label, grain),
    pct,
  };
}
