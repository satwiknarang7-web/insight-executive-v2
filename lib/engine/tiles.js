/**
 * A dashboard tile: what it shows (an encoding), how it is drawn (a viz), and
 * the data it computes to. The planner and the editor both produce tiles, and
 * both may only draw a tile in a way its data supports — `allowedViz` is the
 * one list, so the editor never offers a chart it would have to quietly
 * replace with another.
 *
 * A tile:
 *   {
 *     id, title, subtitle,
 *     kind:     'kpi' | 'trend' | 'breakdown' | 'matrix' | 'distribution' | 'relationship' | 'table',
 *     viz:      see VIZ,
 *     measures: [measureId, ...],   // trend/breakdown/matrix/kpi/table
 *     dim, grain,                   // trend: time field + grain; breakdown: category field
 *     series,                       // split by (trend/breakdown), or columns (matrix)
 *     field,                        // distribution
 *     x, y, color,                  // relationship (fields)
 *     sort: 'value' | 'label', limit, filters: [],
 *     w, h,                         // grid size (12 columns, row units)
 *     insight,                      // caption (from insights.js)
 *   }
 */

import { runQuery, fieldValues, fieldPairs, binLabel } from './query.js';
import { formatValue } from './format.js';
import { niceEdges } from './stats.js';

export const VIZ = {
  kpi: 'Number',
  map: 'Map',
  line: 'Line',
  area: 'Area',
  column: 'Columns',
  hbar: 'Bars',
  stackedColumn: 'Stacked columns',
  stackedBar: 'Stacked bars',
  groupedColumn: 'Grouped columns',
  stackedArea: 'Stacked area',
  donut: 'Donut',
  treemap: 'Treemap',
  funnel: 'Funnel',
  heatmap: 'Heatmap',
  histogram: 'Histogram',
  scatter: 'Scatter',
  table: 'Table',
};

export const MAX_BARS = 12;
export const MAX_SERIES = 6;

/** Grain that gives a readable number of points over a span of days. */
export function chooseGrain(field) {
  if (!field) return 'month';
  if (field.timeUnit === 'year') return 'year';
  const days = field.stats?.spanDays ?? field.spanDays ?? 0;
  const hasTime = field.stats?.hasTime ?? field.hasTime;
  // Never finer than the data is recorded: monthly figures drawn by week are
  // mostly empty weeks.
  const gap = field.stats?.gapDays ?? field.gapDays ?? 0;
  const floor = gap >= 360 ? 'year' : gap >= 85 ? 'quarter' : gap >= 27 ? 'month' : gap >= 6 ? 'week' : null;
  const pick = (g) => (floor && GRAINS.indexOf(g) < GRAINS.indexOf(floor) ? floor : g);
  if (floor) {
    const g = days <= 92 ? 'day' : days <= 550 ? 'week' : days <= 2200 ? 'month' : days <= 5000 ? 'quarter' : 'year';
    return pick(g);
  }
  if (days <= 3 && hasTime) return 'hour';
  if (days <= 92) return 'day';
  if (days <= 550) return 'week';
  if (days <= 2200) return 'month';
  if (days <= 5000) return 'quarter';
  return 'year';
}

export const GRAINS = ['hour', 'day', 'week', 'month', 'quarter', 'year'];

/** Grains that make sense for a time field (from a few points to a few hundred). */
export function grainsFor(field) {
  if (!field) return [];
  if (field.timeUnit === 'year') return ['year'];
  const days = field.stats?.spanDays ?? field.spanDays ?? 0;
  const hasTime = field.stats?.hasTime ?? field.hasTime;
  const per = { hour: 1 / 24, day: 1, week: 7, month: 30.4, quarter: 91, year: 365 };
  const gap = field.stats?.gapDays ?? field.gapDays ?? 0;
  const minPer = gap >= 360 ? 365 : gap >= 85 ? 91 : gap >= 27 ? 30.4 : gap >= 6 ? 7 : 0;
  return GRAINS.filter((g) => {
    if (g === 'hour' && !hasTime) return false;
    if (per[g] < minPer) return false;
    const pts = days / per[g];
    return pts >= 3 && pts <= 800;
  });
}

const measureById = (measures, id) => measures.find((m) => m.id === id) || null;

/** A field from a full reading (byName) or the page's summary (fields list). */
export function fieldOf(ds, name) {
  return ds?.byName?.[name] || ds?.fields?.find((f) => f.name === name) || null;
}

/**
 * Every viz this tile's encoding can be drawn as, best first. Built from what
 * the data holds (how many categories, whether the measure adds up, whether
 * values can be negative), not from a fixed menu.
 */
export function allowedViz(tile, ds, measures, { levels = null } = {}) {
  const ms = (tile.measures || []).map((id) => measureById(measures, id)).filter(Boolean);
  const m = ms[0];
  const additive = ms.length === 1 && m?.additive;
  switch (tile.kind) {
    case 'kpi':
      return ['kpi'];
    case 'distribution':
      return ['histogram'];
    case 'compare':
      return ['hbar', 'column', 'table'];
    case 'relationship':
      return ['scatter'];
    case 'table':
      return ['table'];
    case 'matrix':
      return ['heatmap', 'table'];
    case 'trend': {
      if (!tile.series) {
        const out = ['line', 'column', 'table'];
        if (additive) out.splice(1, 0, 'area');
        return ms.length > 1 ? ['line', 'table'] : out;
      }
      return additive ? ['line', 'stackedArea', 'stackedColumn', 'table'] : ['line', 'table'];
    }
    case 'breakdown': {
      const f = fieldOf(ds, tile.dim);
      const n = levels ?? f?.stats?.distinct ?? f?.distinct ?? 99;
      const ordered = f?.ordinal || f?.kind === 'number';
      if (tile.series) {
        const out = [];
        if (additive) out.push('stackedBar', 'stackedColumn');
        out.push('groupedColumn', 'heatmap', 'table');
        return out;
      }
      const out = ordered ? ['column', 'hbar'] : ['hbar', 'column'];
      if (additive && n >= 2 && n <= 6 && !m?.negative) out.push('donut');
      // Parts of a whole drawn as area: many categories are fine, since each
      // rectangle carries its own label, but a negative part has no area.
      if (additive && n >= 2 && !m?.negative) out.push('treemap');
      // Stages narrowing from the largest down. A funnel of forty stages is a
      // bar chart drawn badly, so it stops at eight.
      if (additive && n >= 2 && n <= 8 && !m?.negative) out.push('funnel');
      // A column of places can be drawn where they are.
      if (f?.map && ms.length === 1) out.push('map');
      if (ms.length > 1) return ['heatmap', 'groupedColumn', 'table'];
      out.push('table');
      return out;
    }
    default:
      return ['table'];
  }
}

/** Is a viz valid for a tile? The planner and editor both ask. */
export function isAllowed(tile, ds, measures, viz, ctx) {
  return allowedViz(tile, ds, measures, ctx).includes(viz);
}

/**
 * Compute a tile's data under the dashboard filters.
 *
 * Returns { data, x, ys, series, labels, meta } in a shape the renderer can
 * draw directly: `data` rows keyed by `x` and measure ids (or series values).
 */
export function computeTile(rows, tile, ds, measures, filters = []) {
  const all = [...(filters || []), ...(tile.filters || [])];
  const ms = (tile.measures || []).map((id) => measureById(measures, id)).filter(Boolean);
  const m = ms[0];

  if (tile.kind === 'kpi') {
    const q = runQuery(rows, { measures: ms, by: [], filters: all });
    return { data: q.rows, value: q.rows[0]?.[m?.id] ?? null, formatted: formatValue(q.rows[0]?.[m?.id] ?? null, m || {}), support: q.totalSupport };
  }

  if (tile.kind === 'compare') {
    // Several measures side by side: one bar each.
    const q = runQuery(rows, { measures: ms, by: [], filters: all });
    const data = ms.map((x) => ({ measure: x.label, id: x.id, value: q.rows[0]?.[x.id] ?? null })).sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
    return { data, x: 'measure', ys: ['value'], raw: q.rows };
  }

  if (tile.kind === 'distribution') {
    const f = ds.byName[tile.field];
    const values = fieldValues(rows, tile.field, all);
    const edges = tile.edges || niceEdges(values, 14);
    const fmt = (v) => formatValue(v, { format: f?.format, scale: f?.scale, currency: '' });
    const labels = [...edges.map((_, i) => binLabel(edges, i, fmt)), binLabel(edges, edges.length, fmt)];
    const counts = new Array(labels.length).fill(0);
    for (const v of values) {
      let i = 0;
      while (i < edges.length && v >= edges[i]) i++;
      counts[i]++;
    }
    // Drop empty tails so a long tail does not squash the shape.
    let lo = 0;
    let hi = counts.length - 1;
    while (lo < hi && counts[lo] === 0) lo++;
    while (hi > lo && counts[hi] === 0) hi--;
    const data = labels.slice(lo, hi + 1).map((label, i) => ({ bin: label, count: counts[lo + i] }));
    return { data, x: 'bin', ys: ['count'], values, edges };
  }

  if (tile.kind === 'relationship') {
    const data = fieldPairs(rows, tile.x, tile.y, all, { max: 1500, label: tile.label || null, color: tile.color || null });
    return { data, x: tile.x, ys: [tile.y] };
  }

  if (tile.kind === 'table') {
    // One row per entity (or group): the dimension and every measure.
    const q = runQuery(rows, {
      measures: ms,
      by: [{ field: tile.dim }],
      filters: all,
      sort: { by: m?.id, dir: tile.sortDir || 'desc' },
      limit: tile.limit || 10,
    });
    return { data: q.rows, x: tile.dim, ys: ms.map((x) => x.id), support: q.support, groups: q.groups };
  }

  const dimField = ds.byName[tile.dim];
  const byDim =
    tile.kind === 'trend'
      ? { field: tile.dim, grain: tile.grain || chooseGrain(dimField), year: dimField?.timeUnit === 'year' }
      : tile.edges
        ? { field: tile.dim, edges: tile.edges, labels: tile.labels }
        : { field: tile.dim };

  if (!tile.series) {
    const sort = tile.kind === 'trend' || tile.sort === 'label' || dimField?.ordinal || dimField?.kind === 'number' ? { by: 'label', dir: 'asc' } : { by: m?.id, dir: 'desc' };
    const q = runQuery(rows, {
      measures: ms,
      by: [byDim],
      filters: all,
      sort,
      limit: tile.kind === 'trend' || tile.viz === 'map' ? 0 : tile.limit || MAX_BARS,
      other: tile.kind !== 'trend' && tile.viz !== 'map' && m?.additive,
      minCount: tile.minCount || 0,
    });
    return { data: q.rows, x: tile.dim, ys: ms.map((x) => x.id), support: q.support, groups: q.groups, totals: q.totals };
  }

  // Split by a series: keep the top series by the measure, pivot wide.
  const top = runQuery(rows, { measures: [m], by: [{ field: tile.series }], filters: all, sort: { by: m.id, dir: 'desc' } });
  // Which series are kept is by size; their order (and so their colour) is by
  // name, so a country is the same colour in every chart.
  const keep = top.rows
    .slice(0, tile.seriesLimit || MAX_SERIES)
    .map((r) => String(r[tile.series]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const rest = top.rows.length > keep.length;
  const q = runQuery(rows, { measures: [m], by: [byDim, { field: tile.series }], filters: all });
  const wide = new Map();
  for (const r of q.rows) {
    const k = String(r[tile.dim]);
    if (!wide.has(k)) wide.set(k, { [tile.dim]: r[tile.dim] });
    const s = keep.includes(String(r[tile.series])) ? String(r[tile.series]) : 'Other';
    if (s === 'Other' && !m.additive) continue;
    const row = wide.get(k);
    row[s] = (row[s] ?? 0) + (r[m.id] ?? 0);
  }
  const series = rest && m.additive ? [...keep, 'Other'] : keep;
  let data = [...wide.values()];
  if (tile.kind === 'trend' || dimField?.ordinal) data.sort((a, b) => String(a[tile.dim]).localeCompare(String(b[tile.dim]), undefined, { numeric: true }));
  else {
    const totals = runQuery(rows, { measures: [m], by: [{ field: tile.dim }], filters: all, sort: { by: m.id, dir: 'desc' }, limit: tile.limit || MAX_BARS });
    const order = totals.rows.map((r) => String(r[tile.dim]));
    data = data.filter((r) => order.includes(String(r[tile.dim]))).sort((a, b) => order.indexOf(String(a[tile.dim])) - order.indexOf(String(b[tile.dim])));
  }
  return { data, x: tile.dim, ys: series, series, seriesField: tile.series, measure: m.id };
}
