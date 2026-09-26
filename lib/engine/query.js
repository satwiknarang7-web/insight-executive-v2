/**
 * The one way numbers are computed: a structured query run over the rows.
 *
 * Every tile, KPI and finding is a query spec, not a SQL string, so a filter
 * or an edit re-runs the same spec and a chart can never disagree with the
 * sentence under it. Pure JS, one pass over the rows, mergeable accumulators
 * (so "top 9 + Other" folds correctly for averages and ratios too).
 *
 * A measure:
 *   { id, label, type: 'count'|'agg'|'distinct'|'ratio'|'rate',
 *     field, agg: 'sum'|'avg'|'median'|'min'|'max',
 *     num, den,               // ratio: two measures (each count|agg|distinct)
 *     event: { field, value },// rate: share of rows where field = value
 *     where: [filter],        // filtered measure: Revenue where status = Paid
 *     format, scale, currency }
 *
 * A spec:
 *   { measures: [measure], by: [{ field, grain?, edges?, labels? }],
 *     filters: [filter], sort: { by: measureId | 'label', dir }, limit, other,
 *     minCount }
 *
 * A filter: { field, values: [...] } | { field, from, to } | { field, not: [...] }
 */

import { toNumber, toTime } from './fields.js';

const present = (v) => v !== null && v !== undefined && v !== '';

/* ── Time buckets ──────────────────────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, '0');

export function bucketTime(value, grain, { year = false } = {}) {
  if (year) {
    const y = toNumber(value);
    return y === null ? null : String(y);
  }
  const t = typeof value === 'number' ? value : toTime(value);
  if (t === null || t === undefined) return null;
  const d = new Date(t);
  const Y = d.getUTCFullYear();
  const M = d.getUTCMonth() + 1;
  switch (grain) {
    case 'year':
      return String(Y);
    case 'quarter':
      return `${Y}-Q${Math.floor((M - 1) / 3) + 1}`;
    case 'month':
      return `${Y}-${pad(M)}`;
    case 'week': {
      const day = (d.getUTCDay() + 6) % 7; // Monday = 0
      const m = new Date(Date.UTC(Y, M - 1, d.getUTCDate() - day));
      return `${m.getUTCFullYear()}-${pad(m.getUTCMonth() + 1)}-${pad(m.getUTCDate())}`;
    }
    case 'hour':
      return `${Y}-${pad(M)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:00`;
    case 'weekday':
      return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(d.getUTCDay() + 6) % 7];
    case 'hourOfDay':
      return pad(d.getUTCHours());
    case 'monthOfYear':
      return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][M - 1];
    default:
      return `${Y}-${pad(M)}-${pad(d.getUTCDate())}`;
  }
}

/** The natural order of cyclical buckets. */
export const CYCLE_ORDER = {
  weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  monthOfYear: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

/** Label for a numeric bin index from its edges: "10–20", "≥ 80". */
export function binLabel(edges, i, fmt = (x) => String(x)) {
  if (i === 0) return `< ${fmt(edges[0])}`;
  if (i >= edges.length) return `≥ ${fmt(edges[edges.length - 1])}`;
  return `${fmt(edges[i - 1])}–${fmt(edges[i])}`;
}

function binOf(x, edges) {
  let i = 0;
  while (i < edges.length && x >= edges[i]) i++;
  return i;
}

/* ── Filters ───────────────────────────────────────────────────────────── */

export function rowFilter(filters = []) {
  const tests = (filters || []).filter(Boolean).map((f) => {
    if (Array.isArray(f.values)) {
      const set = new Set(f.values.map(String));
      if (f.grain) return (r) => set.has(String(bucketTime(r?.[f.field], f.grain, { year: f.year })));
      return (r) => set.has(String(r?.[f.field] ?? ''));
    }
    if (Array.isArray(f.not)) {
      const set = new Set(f.not.map(String));
      return (r) => !set.has(String(r?.[f.field] ?? ''));
    }
    if (f.from !== undefined || f.to !== undefined) {
      const isTime = typeof f.from === 'string' || typeof f.to === 'string';
      const from = isTime ? (f.from ? toTime(f.from) ?? Date.parse(f.from) : -Infinity) : f.from ?? -Infinity;
      const to = isTime ? (f.to ? toTime(f.to) ?? Date.parse(f.to) : Infinity) : f.to ?? Infinity;
      return (r) => {
        const v = isTime ? toTime(r?.[f.field]) ?? toNumber(r?.[f.field]) : toNumber(r?.[f.field]);
        return v !== null && v >= from && v <= to;
      };
    }
    if (f.present) return (r) => present(r?.[f.field]);
    return () => true;
  });
  return tests.length ? (r) => tests.every((t) => t(r)) : () => true;
}

/* ── Accumulators ──────────────────────────────────────────────────────── */

function newState(m) {
  switch (m.type) {
    case 'count':
      return { n: 0 };
    case 'distinct':
      return { set: new Set() };
    case 'rate':
      return { hit: 0, n: 0 };
    case 'ratio':
      return { num: newState(m.num), den: newState(m.den) };
    default:
      return m.agg === 'median' ? { values: [], n: 0 } : { sum: 0, n: 0, min: Infinity, max: -Infinity };
  }
}

function addRow(m, st, r, where) {
  if (where && !where(r)) return;
  switch (m.type) {
    case 'count':
      st.n++;
      return;
    case 'distinct': {
      const v = r?.[m.field];
      if (present(v)) st.set.add(String(v));
      return;
    }
    case 'rate': {
      const v = r?.[m.event.field];
      if (!present(v)) return;
      st.n++;
      if (String(v) === String(m.event.value)) st.hit++;
      return;
    }
    case 'ratio':
      addRow(m.num, st.num, r, m.num._where);
      addRow(m.den, st.den, r, m.den._where);
      return;
    default: {
      const x = toNumber(r?.[m.field]);
      if (x === null) return;
      st.n++;
      if (m.agg === 'median') st.values.push(x);
      else {
        st.sum += x;
        if (x < st.min) st.min = x;
        if (x > st.max) st.max = x;
      }
    }
  }
}

function merge(m, a, b) {
  switch (m.type) {
    case 'count':
      a.n += b.n;
      return a;
    case 'distinct':
      for (const v of b.set) a.set.add(v);
      return a;
    case 'rate':
      a.hit += b.hit;
      a.n += b.n;
      return a;
    case 'ratio':
      merge(m.num, a.num, b.num);
      merge(m.den, a.den, b.den);
      return a;
    default:
      if (m.agg === 'median') {
        a.values.push(...b.values);
        a.n += b.n;
      } else {
        a.sum += b.sum;
        a.n += b.n;
        a.min = Math.min(a.min, b.min);
        a.max = Math.max(a.max, b.max);
      }
      return a;
  }
}

function valueOf(m, st) {
  switch (m.type) {
    case 'count':
      return st.n;
    case 'distinct':
      return st.set.size;
    case 'rate':
      return st.n ? st.hit / st.n : null;
    case 'ratio': {
      const d = valueOf(m.den, st.den);
      const n = valueOf(m.num, st.num);
      return d ? (n ?? 0) / d : null;
    }
    default:
      if (!st.n) return m.agg === 'sum' ? 0 : null;
      switch (m.agg) {
        case 'sum':
          return st.sum;
        case 'min':
          return st.min;
        case 'max':
          return st.max;
        case 'median': {
          const xs = st.values.sort((x, y) => x - y);
          const mid = xs.length >> 1;
          return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
        }
        default:
          return st.sum / st.n;
      }
  }
}

/** How many rows a group's value rests on — the evidence behind it. */
function supportOf(m, st) {
  switch (m.type) {
    case 'count':
      return st.n;
    case 'distinct':
      return st.set.size;
    case 'ratio':
      return supportOf(m.den, st.den);
    default:
      return st.n;
  }
}

function prepare(m) {
  const out = { ...m };
  if (m.where?.length) out._where = rowFilter(m.where);
  if (m.type === 'ratio') {
    out.num = prepare(m.num);
    out.den = prepare(m.den);
  }
  return out;
}

/* ── The query ─────────────────────────────────────────────────────────── */

/**
 * Run a spec. Returns `{ rows, keys, support }`: `rows` are plain objects
 * keyed by dimension field names and measure ids; `support[i]` is the number
 * of rows behind rows[i]'s first measure.
 */
export function runQuery(rows, spec) {
  const measures = (spec.measures || []).map(prepare);
  const by = spec.by || [];
  const keep = rowFilter(spec.filters);

  const keyOf = by.map((b) => {
    if (b.grain) return (r) => bucketTime(r?.[b.field], b.grain, { year: b.year });
    if (b.edges) {
      return (r) => {
        const x = toNumber(r?.[b.field]);
        return x === null ? null : b.labels ? b.labels[binOf(x, b.edges)] : binLabel(b.edges, binOf(x, b.edges));
      };
    }
    return (r) => {
      const v = r?.[b.field];
      return present(v) ? String(v) : null;
    };
  });

  const groups = new Map();
  const total = measures.map(newState);
  for (const r of rows) {
    if (!keep(r)) continue;
    const parts = keyOf.map((k) => k(r));
    if (parts.some((p) => p === null)) continue;
    const key = parts.join('\u0001');
    let g = groups.get(key);
    if (!g) {
      g = { parts, states: measures.map(newState) };
      groups.set(key, g);
    }
    measures.forEach((m, i) => {
      addRow(m, g.states[i], r, m._where);
      addRow(m, total[i], r, m._where);
    });
  }

  let list = [...groups.values()];
  if (spec.minCount) list = list.filter((g) => supportOf(measures[0], g.states[0]) >= spec.minCount);

  // Order: by a measure, by label, or in the dimension's natural order.
  const sort = spec.sort || (by.length && (by[0].grain || by[0].edges) ? { by: 'label', dir: 'asc' } : { by: measures[0]?.id, dir: 'desc' });
  const mi = measures.findIndex((m) => m.id === sort.by);
  const order = by[0]?.grain && CYCLE_ORDER[by[0].grain];
  const binIndex = by[0]?.edges ? (label) => (by[0].labels || by[0].edges.map((_, i) => binLabel(by[0].edges, i)).concat(binLabel(by[0].edges, by[0].edges.length))).indexOf(label) : null;
  list.sort((a, b) => {
    if (mi >= 0 && sort.by !== 'label') {
      const va = valueOf(measures[mi], a.states[mi]) ?? -Infinity;
      const vb = valueOf(measures[mi], b.states[mi]) ?? -Infinity;
      return sort.dir === 'asc' ? va - vb : vb - va;
    }
    const la = a.parts[0];
    const lb = b.parts[0];
    let c;
    if (order) c = order.indexOf(la) - order.indexOf(lb);
    else if (binIndex) c = binIndex(la) - binIndex(lb);
    else {
      const na = Number(la);
      const nb = Number(lb);
      c = Number.isFinite(na) && Number.isFinite(nb) ? na - nb : String(la).localeCompare(String(lb));
    }
    return sort.dir === 'desc' ? -c : c;
  });

  // Top N, the rest folded into "Other" (single-dimension queries only).
  if (spec.limit && list.length > spec.limit) {
    if (spec.other && by.length === 1) {
      const head = list.slice(0, spec.limit - 1);
      const rest = list.slice(spec.limit - 1);
      const folded = { parts: ['Other'], states: measures.map(newState), other: rest.length };
      for (const g of rest) measures.forEach((m, i) => merge(m, folded.states[i], g.states[i]));
      list = [...head, folded];
    } else list = list.slice(0, spec.limit);
  }

  const out = list.map((g) => {
    const row = {};
    by.forEach((b, i) => (row[b.field] = g.parts[i]));
    measures.forEach((m, i) => (row[m.id] = valueOf(m, g.states[i])));
    if (g.other) row.__other = g.other;
    return row;
  });
  return {
    rows: out,
    support: list.map((g) => (measures[0] ? supportOf(measures[0], g.states[0]) : 0)),
    groups: groups.size,
    totals: Object.fromEntries(measures.map((m, i) => [m.id, valueOf(m, total[i])])),
    totalSupport: measures[0] ? supportOf(measures[0], total[0]) : 0,
  };
}

/** One number: a measure over the (filtered) rows. */
export function measureValue(rows, measure, filters = []) {
  return runQuery(rows, { measures: [measure], by: [], filters }).rows[0]?.[measure.id] ?? null;
}

/** The raw values of one numeric field, filtered — for distributions. */
export function fieldValues(rows, field, filters = [], { limit = 200000 } = {}) {
  const keep = rowFilter(filters);
  const out = [];
  for (const r of rows) {
    if (!keep(r)) continue;
    const x = toNumber(r?.[field]);
    if (x !== null) out.push(x);
    if (out.length >= limit) break;
  }
  return out;
}

/** Point pairs for a scatter, sampled evenly to at most `max`. */
export function fieldPairs(rows, x, y, filters = [], { max = 1500, label = null, color = null, size = null } = {}) {
  const keep = rowFilter(filters);
  const all = [];
  for (const r of rows) {
    if (!keep(r)) continue;
    const a = toNumber(r?.[x]);
    const b = toNumber(r?.[y]);
    if (a === null || b === null) continue;
    const p = { [x]: a, [y]: b };
    // A bubble's size: a point with no size, or a negative one, has no circle to draw.
    if (size) {
      const s = toNumber(r?.[size]);
      if (s === null || s < 0) continue;
      p[size] = s;
    }
    if (label) p[label] = r?.[label];
    if (color) p[color] = r?.[color];
    all.push(p);
  }
  if (all.length <= max) return all;
  const step = all.length / max;
  const out = [];
  for (let i = 0; i < all.length && out.length < max; i += step) out.push(all[Math.floor(i)]);
  return out;
}
