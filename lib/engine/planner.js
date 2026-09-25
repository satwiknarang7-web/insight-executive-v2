/**
 * The dashboard an analyst would build for this table.
 *
 * Not a menu of the charts the column types permit. The planner lists the
 * analyses an analyst would consider for this shape of table — the trend of
 * the number the table is kept for, where it comes from, what drives the
 * outcome, how the things compare, what moves together — computes each one,
 * scores it by what the data actually shows (effect size × how central the
 * measure is), and keeps a balanced set: a few headline numbers, one hero
 * chart, the breakdowns and drivers that say something, and a detail table.
 *
 * Every tile's chart type comes from `allowedViz`, so nothing is proposed that
 * the data cannot draw.
 *
 * `hints` (optional, from a language model — see app/api/understand) can name
 * the primary measure, the key dimensions and what the table is about; they
 * re-rank what the rows already support and cannot add anything the rows do
 * not.
 */

import { readDataset } from './fields.js';
import { buildMeasures } from './measures.js';
import { binLabel, runQuery, fieldPairs } from './query.js';
import { allowedViz, chooseGrain, computeTile, MAX_BARS } from './tiles.js';
import { formatChange, formatPeriod, formatValue, lower, plural } from './format.js';
import { correlation, niceEdges } from './stats.js';
import {
  breakdownInsight,
  compareInsight,
  distributionInsight,
  driverInsight,
  kpiDelta,
  relationshipInsight,
  seriesTrendInsight,
  tableInsight,
  trendInsight,
} from './insights.js';
import { measureDependence } from '../chartSignals.js';

const CAP = (s) => s.charAt(0).toUpperCase() + s.slice(1);

let seq = 0;
const nextId = (p) => `${p}-${(++seq).toString(36)}`;

/** A designed comparison: its result is the finding even when it is "no difference". */
const EXPERIMENT = /\b(variant|arm|treatment|cohort|experiment|test group|condition|control group|ab group)\b/i;

/** Dimensions worth splitting by, best first. */
function splitDims(ds, { max = 30 } = {}) {
  return ds.fields
    .filter((f) => f.role === 'dimension' && !f.alias && f.stats.distinct >= 2 && f.stats.distinct <= max && f.stats.fill >= 0.5 && (!ds.long || f.name !== ds.long.by))
    .sort((a, b) => {
      const score = (f) => (EXPERIMENT.test(f.name) ? -2 : 0) + (f.stats.distinct >= 3 && f.stats.distinct <= 12 ? 0 : f.stats.distinct === 2 ? 1 : 2) + (f.outcome ? 3 : 0);
      return score(a) - score(b);
    });
}

/** Dimensions of the "which ones" kind — products, reps, campaigns. */
function entityDims(ds) {
  return ds.fields.filter((f) => f.role === 'dimension' && f.stats.distinct > 12 && f.stats.distinct <= 5000 && f.stats.fill >= 0.5);
}

/**
 * The number the table is kept for. In a log of events it is the money total
 * (else the other totals, else the count); in a table of things it is the
 * outcome's rate, else the price, else the first score; a sensor feed with
 * nothing to add is its main reading.
 */
function primaryMeasure(ds, measures, hints) {
  const usable = measures.filter((m) => !m.local && m.origin !== 'long' && !(m.type === 'agg' && (ds.byName[m.field]?.stats.fill ?? 1) < 0.5));
  if (hints?.primary) {
    const h = usable.find((m) => m.field === hints.primary || m.id === hints.primary);
    if (h) return h;
  }
  const rate = usable.find((m) => m.type === 'rate');
  const money = usable.find((m) => m.type === 'agg' && m.format === 'currency');
  const sums = usable.filter((m) => m.type === 'agg' && m.agg === 'sum');
  const avgs = usable.filter((m) => m.type === 'agg' && m.agg !== 'sum');
  if (ds.shape === 'entities' || ds.shape === 'survey') return rate || money || avgs[0] || usable[0];
  if (rate && !money) return rate;
  return (money?.agg === 'sum' ? money : null) || sums[0] || (ds.shape === 'series' || ds.shape === 'panel' ? avgs[0] : null) || usable[0];
}

/** Does each level of `dim` hold a range of `field` no other level reaches? */
function bandsOf(rows, field, dim) {
  const ranges = new Map();
  for (const r of rows) {
    const v = r?.[field];
    const k = r?.[dim];
    if (typeof v !== 'number' || k === null || k === undefined || k === '') continue;
    const g = ranges.get(k) || [Infinity, -Infinity];
    ranges.set(k, [Math.min(g[0], v), Math.max(g[1], v)]);
  }
  if (ranges.size < 2) return false;
  const sorted = [...ranges.values()].sort((a, b) => a[0] - b[0]);
  return sorted.every((g, i) => i === 0 || g[0] >= sorted[i - 1][1]);
}

/** The last complete period's key, for a level (stock on hand) read at a point. */
function latestBucket(rows, time, grain) {
  const q = runQuery(rows, { measures: [{ id: 'n', type: 'count' }], by: [{ field: time.name, grain, year: time.timeUnit === 'year' }] });
  const pts = q.rows;
  if (!pts.length) return null;
  const med = [...pts.slice(0, -1)].map((p) => p.n).sort((a, b) => a - b)[(pts.length - 1) >> 1] || 0;
  const last = pts[pts.length - 1];
  return pts.length > 2 && last.n < 0.85 * med ? pts[pts.length - 2][time.name] : last[time.name];
}

/** Regular sampling: every period has about as many rows. Counting them says nothing. */
function uniformCounts(rows, ds, grain) {
  if (!ds.time) return true;
  const f = ds.byName[ds.time];
  const q = runQuery(rows, { measures: [{ id: 'n', type: 'count' }], by: [{ field: ds.time, grain, year: f.timeUnit === 'year' }] });
  const xs = q.rows.slice(0, -1).map((r) => r.n);
  if (xs.length < 3) return true;
  const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length);
  return mu ? sd / mu < 0.12 : true;
}

/** The column that names each row of a table of things. */
function nameColumn(ds) {
  if (ds.key?.length === 1 && ds.byName[ds.key[0]]?.kind === 'text') {
    const k = ds.byName[ds.key[0]];
    // An opaque id (CUST-10672) is a worse label than a name beside it.
    const named = ds.fields.find((f) => f !== k && f.kind === 'text' && /\b(name|title)\b/i.test(f.name) && f.stats.distinct >= 0.8 * ds.rowCount);
    return named || k;
  }
  const NAMEY = /\b(name|title|plan|product|model|item|company|brand|job|role|team|player|country|city|school|store|campaign|course|book|movie|song|app|vendor|provider)\b/i;
  const NOISE = /\b(note|notes|description|desc|comment|comments|remark|remarks|text|basis|details|summary)\b/i;
  const texts = ds.fields.filter((f) => (f.role === 'dimension' || f.role === 'id') && f.kind === 'text' && f.stats.fill > 0.9 && f.stats.avgLength < 40 && !NOISE.test(f.name));
  const score = (f) => (NAMEY.test(f.name) ? 2 : 0) + Math.min(1, f.stats.distinct / Math.max(1, ds.rowCount)) * 2;
  return texts.sort((a, b) => score(b) - score(a))[0] || null;
}

/** Bin edges for a numeric driver, with readable labels. */
function quartileBands(rows, f, m) {
  const values = rows.map((r) => r?.[f.name]).filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (values.length < 20) return null;
  const q = [0.25, 0.5, 0.75].map((p) => values[Math.floor(p * (values.length - 1))]);
  const edges = [...new Set(q)].filter((e) => e > values[0]);
  if (edges.length < 2) return null;
  const fmt = (v) => formatValue(v, { format: f.format, scale: f.scale, currency: '' });
  const labels = [...edges.map((_, i) => binLabel(edges, i, fmt)), binLabel(edges, edges.length, fmt)];
  return { edges, labels };
}

/**
 * Does a number almost perfectly separate the outcome (AUC ≥ 0.95)? Then it
 * is how the outcome was recorded — refunds are the negative amounts, "improved"
 * is the week-12 score — not something that drives it.
 */
function defines(rows, field, event) {
  const pos = [];
  const neg = [];
  const step = Math.max(1, Math.floor(rows.length / 4000));
  for (let i = 0; i < rows.length; i += step) {
    const r = rows[i];
    const x = r?.[field];
    const o = r?.[event.field];
    if (typeof x !== 'number' || o === null || o === undefined || o === '') continue;
    (String(o) === String(event.value) ? pos : neg).push(x);
  }
  if (pos.length < 5 || neg.length < 5) return false;
  const all = [...pos.map((x) => [x, 1]), ...neg.map((x) => [x, 0])].sort((a, b) => a[0] - b[0]);
  let rank = 0;
  let sumPos = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && all[j + 1][0] === all[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (all[k][1]) sumPos += avg;
    rank = j + 1;
    i = j + 1;
  }
  const auc = (sumPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
  return rank > 0 && (auc >= 0.95 || auc <= 0.05);
}

/** A tile computed and captioned. */
function make(rows, ds, measures, tile, insightFn) {
  const computed = computeTile(rows, tile, ds, measures, []);
  const insight = insightFn ? insightFn(computed) : { text: '', score: 0, facts: {} };
  return { ...tile, insight: insight.text, facts: insight.facts, score: insight.score, tone: insight.tone || 'neutral' };
}

/* ── KPIs ──────────────────────────────────────────────────────────────── */

function kpiTiles(rows, ds, measures, hints, primary) {
  const time = ds.time ? ds.byName[ds.time] : null;
  const grain = time ? chooseGrain(time) : null;
  const regular = uniformCounts(rows, ds, grain);
  let pool = measures.filter(
    (m) =>
      m.origin !== 'long' &&
      !m.local &&
      !(m.origin === 'field' && ds.byName[m.field]?.stats.fill < 0.5) &&
      !(m.id === 'count' && regular && ds.shape !== 'entities' && ds.shape !== 'survey' && ds.time) &&
      !(m.type === 'ratio' && m.den?.type === 'count' && ds.shape !== 'events')
  );
  if (ds.survey) {
    // A survey's headline: how many answered, and the best and worst question.
    const items = ds.survey.map((f) => measures.find((m) => m.field === f)).filter(Boolean);
    const scored = items.map((m) => ({ m, v: runQuery(rows, { measures: [m], by: [] }).rows[0]?.[m.id] })).sort((a, b) => b.v - a.v);
    pool = [measures.find((m) => m.id === 'count'), scored[0]?.m, scored[scored.length - 1]?.m].filter(Boolean);
  }
  if (ds.long) {
    // Different units in one column: no total means anything. Say what is in it.
    const ent = splitDims(ds)[0];
    const out = [
      { id: nextId('kpi'), kind: 'kpi', viz: 'kpi', measures: [], title: CAP(plural(lower(ds.byName[ds.long.by].label))), formatted: String(ds.long.levels.length), subtitle: 'quantities' },
    ];
    if (ent) out.push({ id: nextId('kpi'), kind: 'kpi', viz: 'kpi', measures: [], title: CAP(plural(lower(ent.label))), formatted: String(ent.stats.distinct), subtitle: '' });
    if (time) out.push({ id: nextId('kpi'), kind: 'kpi', viz: 'kpi', measures: [], title: 'Period', formatted: `${time.kind === 'date' ? new Date(time.stats.min).getUTCFullYear() : time.stats.min}–${time.kind === 'date' ? new Date(time.stats.max).getUTCFullYear() : time.stats.max}`, subtitle: '' });
    return out;
  }
  const preferred = [ds.survey ? null : primary, ...(hints?.primary ? pool.filter((m) => m.field === hints.primary || m.id === hints.primary) : [])].filter(Boolean);
  const picked = [];
  for (const m of [...preferred, ...pool]) {
    if (picked.length >= 4) break;
    if (m.id === 'count' && ds.shape === 'entities' && picked.length >= 3) continue;
    if (picked.some((p) => p.id === m.id)) continue;
    // One figure per field: the total or the average, not both.
    if (m.field && picked.some((p) => p.field === m.field)) continue;
    picked.push(m);
  }
  return picked.map((m) => {
    const value = runQuery(rows, { measures: [m], by: [] }).rows[0]?.[m.id] ?? null;
    let spark = null;
    let delta = null;
    if (time && grain) {
      const q = runQuery(rows, { measures: [m], by: [{ field: time.name, grain, year: time.timeUnit === 'year' }] });
      const pts = q.rows.map((r, i) => ({ label: r[time.name], value: r[m.id], n: q.support[i] }));
      // Leave a partial last period off the comparison.
      const med = pts.length > 3 ? [...pts.slice(0, -1)].map((p) => p.n).sort((a, b) => a - b)[(pts.length - 1) >> 1] : 0;
      const full = pts.length > 3 && pts[pts.length - 1].n < 0.85 * med ? pts.slice(0, -1) : pts;
      if (full.length >= 3) {
        spark = full.map((p) => ({ label: p.label, value: p.value }));
        const d = kpiDelta(full, m, grain);
        if (d) delta = { ...d, latest: formatValue(full[full.length - 1].value, m) };
      }
    }
    // A level is read at the latest period, not summed over all of them.
    const shown = m.level && spark?.length ? spark[spark.length - 1].value : value;
    return {
      id: nextId('kpi'),
      kind: 'kpi',
      viz: 'kpi',
      measures: [m.id],
      title: m.label,
      value: shown,
      formatted: formatValue(shown, m),
      spark,
      delta,
      grain,
      subtitle: m.level && spark?.length ? `latest ${grain}` : ds.shape === 'entities' && m.type === 'agg' && m.agg === 'avg' ? `per ${ds.noun.one}` : m.type === 'agg' && m.agg === 'sum' ? 'total' : '',
    };
  });
}

/* ── Candidates ────────────────────────────────────────────────────────── */

/** Peak against trough of a daily or weekly cycle. */
function cycleInsight({ data, x, ys }, m, word) {
  const y = ys[0];
  const pts = data.filter((r) => typeof r[y] === 'number');
  if (pts.length < 3) return { text: '', score: 0 };
  const hi = pts.reduce((a, b) => (b[y] > a[y] ? b : a));
  const lo = pts.reduce((a, b) => (b[y] < a[y] ? b : a));
  const mean = pts.reduce((a, b) => a + b[y], 0) / pts.length;
  const swing = mean ? (hi[y] - lo[y]) / Math.abs(mean) : 0;
  const at = (r) => (word === 'hour of day' ? `${r[x]}:00` : r[x]);
  if (swing < 0.1) return { text: `${m.label} is flat across the ${word} (${formatValue(lo[y], m)}–${formatValue(hi[y], m)}).`, score: 0.05 };
  return {
    text: `${m.label} peaks at ${at(hi)} (${formatValue(hi[y], m)}) and is lowest at ${at(lo)} (${formatValue(lo[y], m)}) — a ${Math.round(swing * 100)}% swing across the ${word}.`,
    score: Math.min(1, swing) * 0.7,
  };
}

function candidates(rows, ds, measures, hints, primary) {
  const out = [];
  const time = ds.time ? ds.byName[ds.time] : null;
  const grain = time ? chooseGrain(time) : null;
  const dims = splitDims(ds);
  const hintDims = new Set(hints?.dimensions || []);
  dims.sort((a, b) => hintDims.has(b.name) - hintDims.has(a.name));
  const usable = measures.filter((m) => !m.local && m.origin !== 'long');
  const outcomeRates = usable.filter((m) => m.type === 'rate');
  const totals = usable.filter((m) => m.additive && m.type === 'agg');
  const averages = usable.filter((m) => (m.type === 'agg' && m.agg !== 'sum') || m.type === 'ratio');
  const countM = measures.find((m) => m.id === 'count');
  const regular = uniformCounts(rows, ds, grain);
  const push = (c) => c && out.push(c);
  const numericDim = (d) => ds.byName[d]?.kind === 'number';
  // A split that is a banding of the measure explains it perfectly and says nothing.
  const tautology = (m, d) => (m.type === 'agg' && bandsOf(rows, m.field, d)) || (m.type === 'rate' && m.event.field === d);
  const breakdownViz = (tile, m, computed) => {
    const allowed = allowedViz(tile, ds, measures, { levels: computed?.data?.length });
    const vals = (computed?.data || []).map((r) => r[m.id]).filter((v) => typeof v === 'number');
    const neg = vals.some((v) => v < 0);
    const total = vals.reduce((a, b) => a + b, 0);
    const topShare = total > 0 ? Math.max(...vals) / total : 1;
    if (allowed.includes('donut') && !neg && vals.length <= 5 && topShare < 0.75) return 'donut';
    return allowed.filter((v) => v !== 'donut')[0];
  };

  // 1. Trends — the hero of any table in time.
  if (time && grain && !ds.long) {
    const points = runQuery(rows, { measures: [countM], by: [{ field: time.name, grain, year: time.timeUnit === 'year' }] }).rows.length;
    if (points >= 4) {
      const trendMeasures = [primary, ...outcomeRates.slice(0, 1), ...usable.filter((m) => m.type === 'ratio').slice(0, 1), ...totals.slice(0, 2), ...averages.slice(0, 2), regular ? null : countM];
      const seen = new Set();
      trendMeasures.forEach((m, i) => {
        if (!m || seen.has(m.id)) return;
        if (m.id === 'count' && regular) return;
        if (m.type === 'agg' && (ds.byName[m.field]?.stats.fill ?? 1) < 0.5 && m !== primary) return;
        seen.add(m.id);
        const tile = { id: nextId('t'), kind: 'trend', measures: [m.id], dim: time.name, grain, title: `${m.label} over time`, section: 'trend' };
        tile.viz = m.additive ? 'area' : 'line';
        push({ ...make(rows, ds, measures, tile, (c) => trendInsight(c, m, { grain, noun: ds.noun })), weight: m === primary ? 2.2 : 1 - i * 0.1, role: m === primary ? 'hero' : 'trend', measure: m.id });
      });
      // The primary split by its most telling dimension, over time.
      const splitDim = dims.find((d) => d.stats.distinct >= 2 && d.stats.distinct <= 6 && !d.outcome && d.kind !== 'number');
      if (splitDim && primary && (primary.additive || primary.type === 'rate' || primary.type === 'agg')) {
        const tile = { id: nextId('t'), kind: 'trend', measures: [primary.id], dim: time.name, grain, series: splitDim.name, title: `${primary.label} by ${lower(splitDim.label)} over time`, section: 'trend', viz: 'line' };
        push({ ...make(rows, ds, measures, tile, (c) => seriesTrendInsight(c, primary, { grain, seriesLabel: splitDim.label })), weight: 0.9, role: 'trend', measure: primary.id, dim: `${splitDim.name}@t` });
      }
    }
  }

  // 1b. Cycles: when in the day, which day of the week.
  if (time && time.kind === 'date' && primary && !ds.long) {
    const cycles = [];
    if (time.stats.hasTime && (time.stats.spanDays || 0) >= 2) cycles.push(['hourOfDay', 'hour of day']);
    if ((time.stats.spanDays || 0) >= 21 && (time.stats.gapDays ?? 1) <= 1) cycles.push(['weekday', 'day of week']);
    for (const [g, word] of cycles) {
      const m = primary.additive && !primary.level ? (ds.shape === 'events' ? countM : primary) : primary;
      if (!m) continue;
      const tile = { id: nextId('y'), kind: 'trend', measures: [m.id], dim: time.name, grain: g, title: `${m.label} by ${word}`, section: 'trend', viz: 'column' };
      push({ ...make(rows, ds, measures, tile, (c) => cycleInsight(c, m, word)), weight: 0.9, role: 'cycle', measure: m.id, dim: `${time.name}@${g}` });
    }
  }

  // 2. Outcome drivers: the rate by every split, strongest first.
  for (const [oi, rate] of outcomeRates.entries()) {
    const outcomeField = rate.event.field;
    for (const d of dims.filter((x) => x.name !== outcomeField && !x.outcome)) {
      const tile = { id: nextId('d'), kind: 'breakdown', measures: [rate.id], dim: d.name, title: `${rate.label} by ${lower(d.label)}`, section: 'drivers', minCount: 5 };
      tile.viz = allowedViz(tile, ds, measures)[0];
      const made = make(rows, ds, measures, tile, (c) => driverInsight(c, rate, { rows, dimLabel: d.label, ds, numericDim: numericDim(d.name) }));
      // The arms of an experiment are the point of the table, whatever they show.
      if (EXPERIMENT.test(d.name)) made.score = Math.max(made.score, 0.9);
      push({ ...made, weight: 1.3 - oi * 0.3, role: EXPERIMENT.test(d.name) ? 'experiment' : 'driver', section: EXPERIMENT.test(d.name) ? 'experiment' : 'drivers', measure: rate.id, dim: d.name });
    }
    // Numbers as drivers: banded into quartiles, or as they are when they are a small scale.
    for (const f of ds.fields.filter((x) => x.role === 'measure' && !x.local && x.stats.fill >= 0.5 && !defines(rows, x.name, rate.event)).slice(0, 10)) {
      if (f.ordinal || f.stats.distinct <= 8) {
        const tile = { id: nextId('d'), kind: 'breakdown', measures: [rate.id], dim: f.name, title: `${rate.label} by ${lower(f.label)}`, section: 'drivers', sort: 'label', viz: 'column', minCount: 5 };
        push({ ...make(rows, ds, measures, tile, (c) => driverInsight(c, rate, { rows, dimLabel: f.label, ds, numericDim: true })), weight: 1.2 - oi * 0.3, role: 'driver', measure: rate.id, dim: f.name });
        continue;
      }
      const bands = quartileBands(rows, f);
      if (!bands) continue;
      const tile = { id: nextId('d'), kind: 'breakdown', measures: [rate.id], dim: f.name, edges: bands.edges, labels: bands.labels, title: `${rate.label} by ${lower(f.label)}`, section: 'drivers', sort: 'label', viz: 'column', minCount: 5 };
      const made = make(rows, ds, measures, tile, (c) => driverInsight(c, rate, { rows, dimLabel: f.label, ds, numericDim: true }));
      // A number that nearly decides the outcome is usually how it was defined
      // (week-12 score → "improved"), not what drives it.
      const vals = computeTile(rows, tile, ds, measures).data.map((r) => r[rate.id]).filter((v) => typeof v === 'number');
      if (vals.length >= 2 && Math.max(...vals) - Math.min(...vals) >= 0.75) continue;
      push({ ...made, weight: 1.2 - oi * 0.3, role: 'driver', measure: rate.id, dim: f.name });
    }
  }

  // 3. Where the totals come from.
  if (ds.shape !== 'entities' && ds.shape !== 'survey' && !ds.long) {
    const sharers = [primary, ...totals.filter((m) => m.id !== primary?.id).slice(0, 2), regular ? null : countM].filter((m) => m?.additive);
    sharers.forEach((m, mi) => {
      for (const d of dims.filter((x) => !x.outcome && !tautology(m, x.name) && !(m.id === 'count' && ds.key?.includes(x.name))).slice(0, 5)) {
        const latest = m.level && time ? latestBucket(rows, time, grain) : null;
        const tile = { id: nextId('b'), kind: 'breakdown', measures: [m.id], dim: d.name, title: `${m.label} by ${lower(d.label)}${latest ? `, ${formatPeriod(latest, grain)}` : ''}`, section: 'breakdown', filters: latest ? [{ field: time.name, grain, values: [latest], year: time.timeUnit === 'year' }] : [] };
        const made = make(rows, ds, measures, tile, (c) => breakdownInsight(c, m, { rows, dimLabel: d.label, ds, numericDim: numericDim(d.name) }));
        made.viz = breakdownViz(tile, m, computeTile(rows, tile, ds, measures));
        if (tile.filters.length) made.insight = breakdownInsight(computeTile(rows, tile, ds, measures), m, { rows, filters: tile.filters, dimLabel: d.label, ds }).text;
        push({ ...made, weight: 1 - mi * 0.25, role: 'share', measure: m.id, dim: d.name });
      }
    });
  }

  // 4. How things compare on the averages, rates and ratios.
  averages
    .filter((m) => m.type !== 'agg' || ((ds.byName[m.field]?.stats.fill ?? 1) >= 0.3 && !ds.byName[m.field]?.ordinal) || ds.shape === 'survey')
    .filter((m) => !(ds.survey && m.type === 'agg' && ds.survey.includes(m.field)))
    .slice(0, 8)
    .forEach((m, mi) => {
      for (const d of dims.filter((x) => x.name !== m.field && !x.outcome && !tautology(m, x.name)).slice(0, 5)) {
        const tile = { id: nextId('c'), kind: 'breakdown', measures: [m.id], dim: d.name, title: `${m.label} by ${lower(d.label)}`, section: 'compare', minCount: 3 };
        tile.viz = allowedViz(tile, ds, measures).filter((v) => v !== 'donut')[0];
        push({ ...make(rows, ds, measures, tile, (c) => breakdownInsight(c, m, { rows, dimLabel: d.label, ds, numericDim: numericDim(d.name) })), weight: (m === primary ? 1.1 : 0.9) - mi * 0.05, role: 'compare', measure: m.id, dim: d.name });
      }
    });

  // 5. A survey: every item side by side, then who answers differently.
  if (ds.survey) {
    const items = ds.survey.map((f) => measures.find((m) => m.field === f && m.type === 'agg')).filter(Boolean);
    const tile = { id: nextId('s'), kind: 'compare', measures: items.map((m) => m.id), title: 'Average score by question', section: 'overview', viz: 'hbar' };
    push({ ...make(rows, ds, measures, tile, (c) => compareInsight(c, items)), weight: 2.2, role: 'hero' });
    for (const d of dims.slice(0, 2)) {
      const t2 = { id: nextId('s'), kind: 'breakdown', measures: items.map((m) => m.id), dim: d.name, title: `Scores by ${lower(d.label)}`, section: 'compare', viz: 'heatmap' };
      const eff = items.map((m) => breakdownInsight(computeTile(rows, { ...t2, measures: [m.id] }, ds, measures), m, { rows, dimLabel: d.label, ds })).sort((a, b) => b.score - a.score)[0];
      push({ ...make(rows, ds, measures, t2, () => ({ text: eff?.score > 0.1 ? eff.text : `Answers barely differ by ${lower(d.label)} on any question.`, score: Math.max(0.2, eff?.score || 0) })), weight: 1.1, role: 'matrix', dim: d.name });
    }
  }

  // 6. Distributions of the numbers that describe the things.
  if (ds.shape === 'entities' || ds.shape === 'survey') {
    for (const m of averages.filter((x) => x.type === 'agg' && !ds.byName[x.field]?.ordinal && !x.local).slice(0, 3)) {
      const f = ds.byName[m.field];
      if (!f || f.stats.distinct < 10) continue;
      const tile = { id: nextId('h'), kind: 'distribution', field: f.name, measures: [m.id], title: `Distribution of ${lower(f.label)}`, section: 'distribution', viz: 'histogram' };
      push({ ...make(rows, ds, measures, tile, (c) => distributionInsight(c, f, m)), weight: m === primary ? 0.9 : 0.7, role: 'distribution', measure: m.id });
    }
  }

  // 7. The measures that move together (row level), unless one restates the other.
  const numeric = ds.fields.filter((f) => f.role === 'measure' && !f.local && f.stats.fill >= 0.5 && !f.ordinal && f.stats.distinct >= 8).slice(0, 12);
  const pairs = [];
  let searched = 0;
  for (let i = 0; i < numeric.length; i++) {
    for (let j = i + 1; j < numeric.length; j++) {
      const pts = fieldPairs(rows, numeric[i].name, numeric[j].name, [], { max: 3000 });
      if (pts.length < 20) continue;
      searched++;
      const { r, p } = correlation(pts.map((d) => d[numeric[i].name]), pts.map((d) => d[numeric[j].name]));
      if (Math.abs(r) < 0.3 || Math.abs(r) > 0.98) continue;
      pairs.push({ a: numeric[i], b: numeric[j], r, p });
    }
  }
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  const cols = ds.fields.map((f) => f.name);
  let related = 0;
  const usedInScatter = new Set();
  for (const pr of pairs) {
    if (related >= 2) break;
    if (pr.p * Math.max(1, searched) >= 0.01) continue;
    // Two scatters of the same column say the same thing twice.
    if (usedInScatter.has(pr.a.name) && usedInScatter.has(pr.b.name)) continue;
    if (measureDependence(rows.slice(0, 5000), pr.a.name, pr.b.name, cols).dependent) continue;
    // The input on x (price, tenure, sqft), the result on y.
    const [fx, fy] = (primary?.field === pr.a.name || pr.a.agg === 'sum') && pr.b.agg !== 'sum' ? [pr.b, pr.a] : [pr.a, pr.b];
    const mx = measures.find((m) => m.field === fx.name) || { format: fx.format, scale: fx.scale };
    const my = measures.find((m) => m.field === fy.name) || { format: fy.format, scale: fy.scale };
    const labelField = nameColumn(ds)?.name || null;
    const colorField = dims.find((d) => d.stats.distinct <= 6 && d.kind !== 'number')?.name || null;
    const tile = { id: nextId('r'), kind: 'relationship', x: fx.name, y: fy.name, label: labelField, color: colorField, measures: [], title: `${fy.label} vs ${lower(fx.label)}`, section: 'relationships', viz: 'scatter' };
    push({ ...make(rows, ds, measures, tile, (c) => relationshipInsight(c, fx, fy, mx, my)), weight: 0.85, role: 'relationship' });
    usedInScatter.add(pr.a.name);
    usedInScatter.add(pr.b.name);
    related++;
  }

  // 8. The detail: which things lead.
  const rankBy = primary && primary.type !== 'rate' && primary.id !== 'count' ? primary : usable.find((m) => m.type === 'agg' && m.format === 'currency') || usable.find((m) => m.type === 'agg');
  const entity = ds.shape === 'entities' || ds.shape === 'survey' ? nameColumn(ds) : entityDims(ds)[0];
  // Ranking opaque ids (P-1078) by age tells nobody anything; ranking
  // customers by what they spent does.
  const opaque = entity && /^[A-Z]{0,5}[-_ ]?\d{2,}$/i.test(String(entity.stats.top?.[0]?.[0] ?? ''));
  if (entity && rankBy && ds.shape !== 'survey' && !(opaque && ds.shape === 'entities')) {
    const isThings = ds.shape === 'entities' && ds.key?.length === 1 && ds.key[0] === entity.name;
    const tableMeasures = [
      rankBy,
      ...usable.filter((m) => m.id !== rankBy.id && m.type !== 'rate' && !(isThings && m.id === 'count') && (m.type !== 'agg' || (ds.byName[m.field]?.stats.fill ?? 1) >= 0.5)).slice(0, 4),
    ];
    const tile = { id: nextId('x'), kind: 'table', measures: tableMeasures.map((m) => m.id), dim: entity.name, limit: 10, title: `Top ${plural(lower(entity.label))} by ${lower(rankBy.label.replace(/^Avg /, ''))}`, section: 'detail', viz: 'table' };
    const tot = runQuery(rows, { measures: [rankBy], by: [] }).totals;
    push({ ...make(rows, ds, measures, tile, (c) => tableInsight(c, rankBy, { dimLabel: entity.label, totals: tot })), weight: 0.8, role: 'table' });
  }

  // 9a. A long table whose quantities share a scale (Budget, Actual): side by side.
  if (ds.long?.shared) {
    const vf = ds.byName[ds.long.value];
    const total = { ...measures.find((m) => m.origin === 'long'), id: `sum:${vf.name}`, label: vf.label, where: undefined, agg: vf.agg === 'sum' ? 'sum' : 'avg', additive: vf.agg === 'sum', origin: 'field' };
    if (!measures.some((m) => m.id === total.id)) measures.push(total);
    const levels = ds.long.levels;
    const by = ds.long.by;
    const byLabel = ds.byName[by].label;
    const totals = runQuery(rows, { measures: [total], by: [{ field: by }] }).rows;
    const [a, b] = totals.length >= 2 ? [...totals].sort((p, q) => levels.indexOf(p[by]) - levels.indexOf(q[by])) : [];
    const gapText = (x, y) => (x && y && y[total.id] ? `${x[by]} is ${formatChange(((x[total.id] - y[total.id]) / Math.abs(y[total.id])) * 100).replace(/^([+−])/, (s2) => (s2 === '+' ? '' : '−'))} ${x[total.id] >= y[total.id] ? 'above' : 'below'} ${y[by]} overall (${formatValue(x[total.id], total)} vs ${formatValue(y[total.id], total)}).` : '');
    const actualish = totals.find((r) => /actual|real|outturn/i.test(r[by])) || b;
    const planish = totals.find((r) => /budget|plan|target|forecast/i.test(r[by])) || a;
    if (time) {
      const g = chooseGrain(time);
      const tile = { id: nextId('l'), kind: 'trend', measures: [total.id], dim: time.name, grain: g, series: by, title: `${total.label} by ${lower(byLabel)} over time`, section: 'trend', viz: 'line' };
      push({ ...make(rows, ds, measures, tile, () => ({ text: gapText(actualish, planish), score: 0.8 })), weight: 2, role: 'hero', measure: total.id });
    }
    for (const d of dims.slice(0, 3)) {
      const tile = { id: nextId('l'), kind: 'breakdown', measures: [total.id], dim: d.name, series: by, title: `${total.label} by ${lower(d.label)} and ${lower(byLabel)}`, section: 'compare', viz: 'groupedColumn' };
      push({
        ...make(rows, ds, measures, tile, (c) => {
          const gaps = c.data.map((r) => ({ k: r[d.name], gap: r[planish?.[by]] ? (r[actualish?.[by]] - r[planish[by]]) / Math.abs(r[planish[by]]) : null })).filter((g2) => typeof g2.gap === 'number').sort((p, q) => Math.abs(q.gap) - Math.abs(p.gap));
          if (!gaps.length || !actualish || !planish) return { text: '', score: 0.2 };
          const g0 = gaps[0];
          return { text: `The largest gap between ${actualish[by]} and ${planish[by]} is ${g0.k}: ${formatChange(g0.gap * 100)}.`, score: Math.min(1, Math.abs(g0.gap) * 3) };
        }),
        weight: 1,
        role: 'compare',
        measure: total.id,
        dim: d.name,
      });
    }
    return out;
  }

  // 9. A long table: each quantity on its own.
  if (ds.long) {
    const levels = measures.filter((m) => m.origin === 'long').slice(0, 6);
    const ent = dims[0];
    levels.forEach((m, i) => {
      if (time) {
        const lines = ent && ent.stats.distinct <= 8 ? ent.name : null;
        if (!lines && m.local) return;
        const g = chooseGrain(time);
        const tile = { id: nextId('l'), kind: 'trend', measures: [m.id], dim: time.name, grain: g, series: lines, title: `${m.label}${lines ? ` by ${lower(ent.label)}` : ''}`, section: 'trend', viz: 'line' };
        push({
          ...make(rows, ds, measures, tile, (c) => (lines ? seriesTrendInsight(c, m, { grain: g, seriesLabel: ent.label }) : trendInsight(c, m, { grain: g }))),
          weight: 1.3 - i * 0.1,
          role: i === 0 ? 'hero' : 'trend',
          measure: m.id,
        });
      }
      if (ent && !m.local) {
        // The latest period only: a population summed over twelve years is nobody's.
        const g = time ? chooseGrain(time) : null;
        const latest = time ? runQuery(rows, { measures: [m], by: [{ field: time.name, grain: g, year: time.timeUnit === 'year' }], sort: { by: 'label', dir: 'desc' }, limit: 1 }).rows[0]?.[time.name] : null;
        const filters = latest ? [{ field: time.name, grain: g, values: [latest], year: time.timeUnit === 'year' }] : [];
        const tile = { id: nextId('l'), kind: 'breakdown', measures: [m.id], dim: ent.name, filters, title: `${m.label} by ${lower(ent.label)}${latest ? `, ${formatPeriod(latest, g)}` : ''}`, section: 'compare', viz: 'hbar' };
        push({ ...make(rows, ds, measures, tile, (c) => breakdownInsight(c, m, { rows, filters, dimLabel: ent.label, ds })), weight: 0.9 - i * 0.1, role: 'compare', measure: m.id, dim: ent.name });
      }
    });
  }

  return out;
}

/* ── Selection and layout ──────────────────────────────────────────────── */

const SECTION_TITLES = {
  trend: 'Over time',
  drivers: 'What drives it',
  breakdown: 'Where it comes from',
  compare: 'How they compare',
  overview: 'Overview',
  experiment: 'The experiment',
  distribution: 'Spread',
  relationships: 'What moves together',
  detail: 'Detail',
};

function select(cands, ds, { budget = 8 } = {}) {
  const ranked = cands.map((c) => ({ ...c, rank: (c.score || 0) * (c.weight || 1) + (c.role === 'hero' ? 1 : 0) })).sort((a, b) => b.rank - a.rank);
  const picked = [];
  const perMeasure = new Map();
  const perPair = new Set();
  const perRole = new Map();
  const roleCap = { experiment: 2, hero: 1, trend: 2, cycle: 1, driver: 4, share: 3, compare: 3, distribution: 2, relationship: 2, table: 1, matrix: 1 };
  for (const c of ranked) {
    if (picked.length >= budget) break;
    if ((c.score || 0) < 0.1 && c.role !== 'hero' && c.role !== 'table') continue;
    const role = c.role;
    if ((perRole.get(role) || 0) >= (roleCap[role] ?? 2)) continue;
    const pair = `${c.measure}|${c.dim}`;
    if (c.dim && perPair.has(pair)) continue;
    if (c.measure && (perMeasure.get(c.measure) || 0) >= 3) continue;
    // The hero is a trend of the primary; a second trend of the same measure split adds.
    picked.push(c);
    perRole.set(role, (perRole.get(role) || 0) + 1);
    if (c.dim) perPair.add(pair);
    if (c.measure) perMeasure.set(c.measure, (perMeasure.get(c.measure) || 0) + 1);
  }
  // Too little said something: fill up to four with the best of the rest,
  // one per measure and split, so a thin table still gets a dashboard.
  const floor = Math.min(6, budget);
  if (picked.length < floor) {
    for (const c of ranked) {
      if (picked.length >= floor) break;
      if ((perRole.get(c.role) || 0) >= (roleCap[c.role] ?? 2) + 1) continue;
      if (picked.includes(c) || (c.dim && perPair.has(`${c.measure}|${c.dim}`))) continue;
      picked.push(c);
      perRole.set(c.role, (perRole.get(c.role) || 0) + 1);
      if (c.dim) perPair.add(`${c.measure}|${c.dim}`);
    }
  }
  return picked;
}

function layout(tiles) {
  const order = ['experiment', 'overview', 'trend', 'drivers', 'breakdown', 'compare', 'relationships', 'distribution', 'detail'];
  const bySection = new Map();
  for (const t of tiles) {
    const s = t.role === 'hero' ? 'hero' : t.section || 'compare';
    if (!bySection.has(s)) bySection.set(s, []);
    bySection.get(s).push(t);
  }
  const sections = [];
  const hero = bySection.get('hero') || [];
  if (hero.length) sections.push({ id: 'hero', title: '', tiles: hero.map((t) => ({ ...t, w: 12, h: 5 })) });
  for (const s of order) {
    const ts = bySection.get(s);
    if (!ts?.length) continue;
    // Stronger findings first within a section.
    ts.sort((a, b) => (b.rank || 0) - (a.rank || 0));
    const sized = ts.map((t, i) => {
      if (t.kind === 'table') return { ...t, w: 12, h: 5 };
      if (t.viz === 'heatmap') return { ...t, w: 12, h: 5 };
      // An odd one out at the end of a section takes the full row.
      const w = ts.length % 2 === 1 && i === ts.length - 1 ? 12 : 6;
      return { ...t, w, h: 4 };
    });
    sections.push({ id: s, title: SECTION_TITLES[s], tiles: sized });
  }
  return sections;
}

/** The one-paragraph summary at the top, from the strongest findings. */
function summarise(ds, tiles, kpis) {
  const time = ds.time ? ds.byName[ds.time] : null;
  const span = time?.stats.min !== undefined && time.kind === 'date' ? ` from ${new Date(time.stats.min).toISOString().slice(0, 10)} to ${new Date(time.stats.max).toISOString().slice(0, 10)}` : time?.timeUnit === 'year' ? ` from ${time.stats.min} to ${time.stats.max}` : '';
  const lead = `${ds.rowCount.toLocaleString('en-US')} ${ds.noun.many}${span}.`;
  return lead;
}

/**
 * Build the dashboard. `rows` are the cleaned rows; `options.overrides` are
 * the reader's field corrections; `options.custom` their measures;
 * `options.hints` a model's reading, if any.
 */
export function buildDashboard(rows, { name = 'dataset', overrides = {}, custom = [], hints = null, budget = 8 } = {}) {
  seq = 0;
  const ds = readDataset(rows, { name, overrides });
  const measures = buildMeasures(rows, ds, { custom });
  if (!rows.length || !measures.length) {
    return { version: 2, ds: summaryOf(ds), measures, kpis: [], sections: [], findings: [], summary: 'This table has no numbers or categories to chart.' };
  }
  const primary = primaryMeasure(ds, measures, hints);
  const kpis = kpiTiles(rows, ds, measures, hints, primary);
  const cands = candidates(rows, ds, measures, hints, primary);
  const picked = select(cands, ds, { budget });
  const sections = layout(picked);
  const findings = picked
    .filter((t) => t.insight && (t.score || 0) >= 0.1)
    .sort((a, b) => (b.score || 0) * (b.weight || 1) - (a.score || 0) * (a.weight || 1))
    .slice(0, 5)
    .map((t) => ({ text: t.insight, tileId: t.id, score: t.score }));
  return {
    version: 2,
    generatedAt: Date.now(),
    title: CAP(ds.noun.many),
    ds: summaryOf(ds),
    measures,
    kpis,
    sections,
    findings,
    summary: summarise(ds, picked, kpis),
    filters: suggestedFilters(ds),
    candidates: cands.length,
  };
}

/** The slicers an analyst would put on top: time, then 2–3 key splits. */
function suggestedFilters(ds) {
  const out = [];
  if (ds.time) out.push({ field: ds.time, kind: 'time' });
  for (const d of splitDims(ds, { max: 50 }).slice(0, 3)) out.push({ field: d.name, kind: 'category' });
  return out;
}

/** What the UI needs of the reading (no row data). */
export function summaryOf(ds) {
  return {
    name: ds.name,
    rowCount: ds.rowCount,
    shape: ds.shape,
    noun: ds.noun,
    time: ds.time,
    key: ds.key,
    long: ds.long,
    outcomes: ds.outcomes,
    fields: ds.fields.map((f) => ({
      name: f.name,
      label: f.label,
      kind: f.kind,
      role: f.role,
      agg: f.agg,
      format: f.format,
      scale: f.scale,
      ordinal: f.ordinal,
      outcome: f.outcome,
      timeUnit: f.timeUnit || null,
      why: f.why,
      distinct: f.stats.distinct,
      fill: f.stats.fill,
      spanDays: f.stats.spanDays ?? null,
      hasTime: !!f.stats.hasTime,
      min: f.stats.min ?? null,
      max: f.stats.max ?? null,
      overridden: !!f.overridden,
    })),
  };
}

export { readDataset, buildMeasures, computeTile, allowedViz, MAX_BARS };
