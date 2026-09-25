/**
 * The dashboard in the shape the exporters (lib/report: PDF, Word, PowerPoint)
 * read: a summary page, then one page per chart with its title, its sentence,
 * the numbers behind it and the chart's own rows.
 *
 * The rows are flattened to plain label → value pairs named the way the
 * dashboard names them, so a table in Word says "Revenue by region", not
 * "sum:revenue".
 */

import { formatPeriod, formatValue } from './format.js';

const EXPORT_TYPE = {
  line: 'line',
  area: 'area',
  stackedArea: 'area',
  column: 'bar',
  groupedColumn: 'bar',
  stackedColumn: 'bar',
  hbar: 'hbar',
  stackedBar: 'hbar',
  donut: 'donut',
  histogram: 'bar',
  scatter: 'scatter',
  heatmap: 'table',
  table: 'table',
};

function flatten(tile, measures, fields) {
  const c = tile.computed;
  if (!c?.data?.length) return { rows: [], x: null, y: null };
  const byId = new Map(measures.map((m) => [m.id, m]));
  const field = (n) => fields.find((f) => f.name === n);
  if (tile.kind === 'relationship') {
    const fx = field(tile.x);
    const fy = field(tile.y);
    return { rows: c.data.map((d) => ({ [fx?.label || tile.x]: d[tile.x], [fy?.label || tile.y]: d[tile.y] })), x: fx?.label || tile.x, y: fy?.label || tile.y };
  }
  if (tile.kind === 'distribution') return { rows: c.data.map((d) => ({ Range: d.bin, Rows: d.count })), x: 'Range', y: 'Rows' };
  if (tile.kind === 'compare') return { rows: c.data.map((d) => ({ Measure: d.measure, Value: d.value })), x: 'Measure', y: 'Value' };
  const xLabel = field(c.x)?.label || c.x;
  const keys = c.series || c.ys;
  const nameOf = (k) => (c.series ? k : byId.get(k)?.label || k);
  const rows = c.data.map((d) => {
    const row = { [xLabel]: tile.kind === 'trend' ? formatPeriod(d[c.x], tile.grain) : d[c.x] };
    for (const k of keys) row[nameOf(k)] = typeof d[k] === 'number' ? Number(d[k].toPrecision(6)) : d[k];
    return row;
  });
  return { rows, x: xLabel, y: nameOf(keys[0]) };
}

export function dashboardToDeck(board, { measures = [], fields = [], fileName = null, rowCount = null } = {}) {
  const tiles = (board?.sections || []).flatMap((s) => s.tiles);
  const storyboard = tiles.map((t) => {
    const flat = flatten(t, measures, fields);
    return {
      id: t.id,
      pageTitle: t.title,
      chart: {
        id: t.id,
        title: t.title,
        chart_type: EXPORT_TYPE[t.viz] || 'bar',
        resultData: flat.rows,
        xAxisKey: flat.x,
        yAxisKey: flat.y,
      },
      findings: {
        headline: t.insight || '',
        verifiedFacts: Object.entries(t.facts || {}).map(([k, v]) => `${k}: ${v}`),
        metrics: {},
      },
      insight_anchor: '',
    };
  });
  const bullets = board?.aiSummary?.length ? board.aiSummary : (board?.findings || []).map((f) => f.text);
  return {
    fileName,
    rowCount,
    storyboard,
    kpis: (board?.kpis || []).map((k) => ({ label: k.title, value: k.formatted, note: k.delta ? `${k.delta.text} ${k.delta.vs}` : k.subtitle || '' })),
    slideZero: {
      title: board?.subject || board?.title || 'Dashboard',
      headline: board?.headline || bullets[0] || board?.summary || '',
      macroInsights: bullets,
    },
    filter: null,
    formatValue,
  };
}
