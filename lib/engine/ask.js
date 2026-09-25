/**
 * A question in plain words, read into a dashboard tile.
 *
 * "Revenue by region", "average price by category in 2025", "how has churn
 * changed over time", "top 10 products by revenue", "price vs rating",
 * "distribution of salary", "how many orders by channel". Read against the
 * table's own fields and measures, so a question about a column the table
 * does not have is refused by name rather than answered with something else.
 *
 * Pure: the worker calls it with the reading, the measures and a lookup of
 * category values (for "in 2025", "for Enterprise").
 */

import { chooseGrain, allowedViz } from './tiles.js';

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[_\-./]+/g, ' ')
    .replace(/[^a-z0-9%\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STOP = new Set(['the', 'a', 'an', 'of', 'by', 'per', 'for', 'in', 'on', 'and', 'vs', 'versus', 'what', 'is', 'are', 'how', 'which', 'show', 'me', 'my', 'with', 'to', 'over', 'across', 'each', 'does', 'do', 'did', 'has', 'have', 'between', 'total', 'average', 'avg', 'mean', 'sum', 'number', 'count', 'many', 'much', 'top', 'bottom', 'highest', 'lowest', 'most', 'least']);

const GRAIN_WORDS = [
  [/\b(daily|per day|by day|each day)\b/, 'day'],
  [/\b(weekly|per week|by week|each week)\b/, 'week'],
  [/\b(monthly|per month|by month|each month)\b/, 'month'],
  [/\b(quarterly|per quarter|by quarter)\b/, 'quarter'],
  [/\b(yearly|annual|annually|per year|by year|each year)\b/, 'year'],
  [/\b(hour of day|time of day|by hour)\b/, 'hourOfDay'],
  [/\b(day of week|weekday|by weekday)\b/, 'weekday'],
];

/** How well a field or measure's name is mentioned in the question (0 = not at all). */
function mention(q, name) {
  const n = norm(name);
  if (!n) return 0;
  if (q.includes(n)) return n.length + 10;
  const words = n.split(' ').filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) return 0;
  const hit = words.filter((w) => new RegExp(`\\b${w}s?\\b`).test(q) || (w.endsWith('s') && new RegExp(`\\b${w.slice(0, -1)}\\b`).test(q)));
  return hit.length === words.length ? hit.join(' ').length + 5 : hit.length / words.length >= 0.5 ? hit.join(' ').length : 0;
}

/**
 * @param {string} text
 * @param {object} ds      the reading (fields with role, stats or summary)
 * @param {object[]} measures
 * @param {(field: string) => string[]} valuesOf  category values of a field
 * @returns {{ tile?: object, error?: string }}
 */
export function interpretQuestion(text, ds, measures, valuesOf = () => []) {
  const q = norm(text);
  if (!q) return { error: 'Type a question about the data.' };
  const fields = ds.fields || [];
  const dims = fields.filter((f) => f.role === 'dimension' || f.role === 'id');
  const times = fields.filter((f) => f.role === 'time');
  const nums = fields.filter((f) => f.role === 'measure');

  // Filters: a category value named in the question ("in Europe", "for Pro").
  const filters = [];
  const usedDims = new Set();
  for (const d of dims) {
    const distinct = d.stats?.distinct ?? d.distinct ?? 0;
    if (distinct > 200) continue;
    for (const v of valuesOf(d.name)) {
      const nv = norm(v);
      if (nv.length < 2) continue;
      if (new RegExp(`\\b(in|for|from|where|only|of|at)\\s+(the\\s+)?${nv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q)) {
        filters.push({ field: d.name, values: [v] });
        usedDims.add(d.name);
      }
    }
  }
  // A year named for a date column: "in 2025".
  const year = q.match(/\b(in|for|during)\s+((19|20)\d{2})\b/);
  if (year && times[0]) {
    const t = times[0];
    if (t.timeUnit === 'year') filters.push({ field: t.name, values: [year[2]] });
    else filters.push({ field: t.name, grain: 'year', values: [year[2]] });
  }

  const byMeasure = measures
    .map((m) => ({ m, s: Math.max(mention(q, m.label), m.field ? mention(q, m.field) : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  const byNum = nums.map((f) => ({ f, s: Math.max(mention(q, f.label), mention(q, f.name)) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  const byDim = dims
    .filter((d) => !usedDims.has(d.name))
    .map((d) => ({ d, s: Math.max(mention(q, d.label), mention(q, d.name)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);

  const wantsAvg = /\b(average|avg|mean|typical)\b/.test(q);
  const wantsMedian = /\bmedian\b/.test(q);
  const wantsSum = /\b(total|sum|overall)\b/.test(q);
  const wantsCount = /\b(how many|number of|count of|count)\b/.test(q);
  const wantsDistinct = /\b(unique|distinct|different)\b/.test(q);

  /** The measure asked about, honouring "average"/"total"/"how many". */
  const pickMeasure = () => {
    const f = byNum[0]?.f;
    if (f && (wantsAvg || wantsMedian || wantsSum)) {
      const agg = wantsMedian ? 'median' : wantsAvg ? 'avg' : 'sum';
      return measures.find((m) => m.type === 'agg' && m.field === f.name && m.agg === agg) || { id: `${agg}:${f.name}`, label: `${agg === 'avg' ? 'Average' : agg === 'median' ? 'Median' : 'Total'} ${f.label.toLowerCase()}`, type: 'agg', field: f.name, agg, format: f.format, scale: f.scale, additive: agg === 'sum', adhoc: true };
    }
    if (byMeasure[0]) return byMeasure[0].m;
    if (f) return measures.find((m) => m.type === 'agg' && m.field === f.name) || null;
    if (wantsCount && wantsDistinct && byDim[0]) {
      const d = byDim[0].d;
      return { id: `distinct:${d.name}`, label: `Distinct ${d.label.toLowerCase()}`, type: 'distinct', field: d.name, format: 'number', additive: false, adhoc: true };
    }
    if (wantsCount || /\b(rows|records|orders|customers|transactions|events)\b/.test(q)) return measures.find((m) => m.id === 'count') || null;
    return null;
  };

  const grainWord = GRAIN_WORDS.find(([re]) => re.test(q))?.[1];
  const wantsTime = !!grainWord || /\b(over time|trend|trending|changed|change over|growth|grown|history|timeline|monthly|weekly|daily)\b/.test(q) || times.some((t) => mention(q, t.label) > 0);

  // Relationship: two numbers "vs"/"against"/"relationship between".
  if (/\b(vs|versus|against|relationship|correlat|related|affect)\b/.test(q) && byNum.length >= 2) {
    const [a, b] = byNum;
    const y = q.indexOf(norm(a.f.label)) < q.indexOf(norm(b.f.label)) ? a.f : b.f;
    const x = y === a.f ? b.f : a.f;
    return { tile: { kind: 'relationship', x: x.name, y: y.name, measures: [], viz: 'scatter', title: `${y.label} vs ${x.label.toLowerCase()}`, filters } };
  }

  // Distribution of one number.
  if (/\b(distribution|spread|histogram|range of|how spread)\b/.test(q) && byNum[0]) {
    const f = byNum[0].f;
    return { tile: { kind: 'distribution', field: f.name, measures: [], viz: 'histogram', title: `Distribution of ${f.label.toLowerCase()}`, filters } };
  }

  const m = pickMeasure();
  if (!m) {
    const named = q.split(' ').filter((w) => w.length > 3 && !STOP.has(w)).slice(0, 3).join(', ');
    return { error: `I couldn't find a number in this table matching "${named || text}". Try one of: ${measures.slice(0, 5).map((x) => x.label).join(', ')}.` };
  }

  const top = q.match(/\b(top|bottom|best|worst|highest|lowest)\s+(\d+)\b/);
  const limit = top ? Math.min(50, Number(top[2])) : null;
  const ascending = /\b(bottom|worst|lowest|least)\b/.test(q);

  // Over time.
  if (wantsTime && times.length) {
    const t = times.find((x) => mention(q, x.label) > 0) || times[0];
    const series = byDim[0]?.d && (byDim[0].d.stats?.distinct ?? byDim[0].d.distinct) <= 12 ? byDim[0].d.name : null;
    const tile = { kind: 'trend', measures: [m.id], dim: t.name, grain: grainWord || chooseGrain(t), series, filters, title: `${m.label}${series ? ` by ${byDim[0].d.label.toLowerCase()}` : ''} over time` };
    tile.viz = allowedViz(tile, ds, [...measures, m])[0];
    return { tile, adhoc: m.adhoc ? m : null };
  }

  // By a category.
  if (byDim.length) {
    const d = byDim[0].d;
    const second = byDim[1]?.d && (byDim[1].d.stats?.distinct ?? byDim[1].d.distinct) <= 8 ? byDim[1].d : null;
    const distinct = d.stats?.distinct ?? d.distinct ?? 0;
    if (limit || distinct > 30 || d.role === 'id') {
      const tile = { kind: 'table', measures: [m.id], dim: d.name, limit: limit || 10, sortDir: ascending ? 'asc' : 'desc', viz: 'table', filters, title: `${ascending ? 'Bottom' : 'Top'} ${limit || 10} ${d.label.toLowerCase()} by ${m.label.toLowerCase()}` };
      return { tile, adhoc: m.adhoc ? m : null };
    }
    const tile = { kind: 'breakdown', measures: [m.id], dim: d.name, series: second ? second.name : null, filters, title: `${m.label} by ${d.label.toLowerCase()}${second ? ` and ${second.label.toLowerCase()}` : ''}` };
    const allowed = allowedViz(tile, ds, [...measures, m]);
    const places = allowed.includes('map') && (/\bmap\b/.test(q) || (d.stats?.distinct ?? d.distinct ?? 0) >= 5);
    tile.viz = places ? 'map' : /\b(share|split|mix|breakdown|proportion)\b/.test(q) && allowed.includes('donut') ? 'donut' : allowed.filter((v) => v !== 'map')[0];
    return { tile, adhoc: m.adhoc ? m : null };
  }

  // Just the number.
  return { tile: { kind: 'kpi', measures: [m.id], viz: 'kpi', filters, title: m.label }, adhoc: m.adhoc ? m : null };
}

/** Questions worth asking of this table, for the Ask page's suggestions. */
export function exampleQuestions(ds, measures) {
  const fields = ds.fields || [];
  const dims = fields.filter((f) => f.role === 'dimension' && (f.stats?.distinct ?? f.distinct) <= 30);
  const time = fields.find((f) => f.role === 'time');
  const m = measures.filter((x) => x.origin !== 'long');
  const out = [];
  if (m[0] && dims[0]) out.push(`${m[0].label} by ${dims[0].label.toLowerCase()}`);
  if (m[0] && time) out.push(`${m[0].label} over time`);
  const rate = m.find((x) => x.type === 'rate');
  if (rate && dims[1]) out.push(`${rate.label} by ${dims[1].label.toLowerCase()}`);
  const big = fields.find((f) => (f.role === 'dimension' || f.role === 'id') && (f.stats?.distinct ?? f.distinct) > 12);
  if (m[0] && big) out.push(`Top 10 ${big.label.toLowerCase()} by ${m[0].label.toLowerCase()}`);
  const nums = fields.filter((f) => f.role === 'measure');
  if (nums.length >= 2) out.push(`${nums[0].label} vs ${nums[1].label.toLowerCase()}`);
  if (nums[0]) out.push(`Distribution of ${nums[0].label.toLowerCase()}`);
  return [...new Set(out)].slice(0, 6);
}
