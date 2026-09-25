'use client';

/**
 * Draws one dashboard tile from the data the engine computed for it.
 *
 * The chart type is the tile's `viz`, which the engine only ever sets to one
 * the data allows (lib/engine/tiles.js `allowedViz`), so nothing here quietly
 * swaps it for something else. Every chart fills its container, never scrolls
 * sideways, and keeps its labels inside the tile: long category names are cut
 * with an ellipsis and shown in full in the tooltip.
 */

import { useId, useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { formatPeriod, formatTick, formatValue } from '../../lib/engine/format';
import { usePaletteMode, useSeriesColor } from '../charts/palette';

const INK = {
  dark: { text: '#cbd5e1', strong: '#f1f5f9', muted: '#8391aa', grid: 'rgba(148,163,214,0.10)', surface: '#0d111c', cursor: 'rgba(148,163,214,0.06)', glass: 'rgba(13,17,28,0.88)', border: 'rgba(148,163,214,0.20)' },
  light: { text: '#334155', strong: '#0f172a', muted: '#64748b', grid: 'rgba(15,23,42,0.07)', surface: '#ffffff', cursor: 'rgba(15,23,42,0.04)', glass: 'rgba(255,255,255,0.94)', border: 'rgba(15,23,42,0.12)' },
};

/** A vertical fade of one colour, for areas and bars. */
function Fade({ id, color, from = 0.9, to = 0.55, horizontal = false }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2={horizontal ? '1' : '0'} y2={horizontal ? '0' : '1'}>
      <stop offset="0%" stopColor={color} stopOpacity={horizontal ? to : from} />
      <stop offset="100%" stopColor={color} stopOpacity={horizontal ? from : to} />
    </linearGradient>
  );
}

/** The legend as small pills above the plot. Identity is colour plus the name. */
function PillLegend({ payload = [], ink }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5">
      {payload.map((p) => (
        <li key={p.value} className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]" style={{ border: `1px solid ${ink.border}`, color: ink.text }}>
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.value}
        </li>
      ))}
    </ul>
  );
}

const clip = (s, n) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** The reference line's label, outside the plot, with a halo in the surface colour. */
function OverallLabel({ viewBox, text, ink, side }) {
  if (!viewBox) return null;
  const common = { fill: ink.muted, fontSize: 10, stroke: ink.surface, strokeWidth: 3, paintOrder: 'stroke', strokeLinejoin: 'round' };
  if (side === 'top') {
    return (
      <text x={viewBox.x} y={viewBox.y - 6} textAnchor="middle" {...common}>
        {text}
      </text>
    );
  }
  return (
    <text x={viewBox.x + viewBox.width + 6} y={viewBox.y} dominantBaseline="middle" textAnchor="start" {...common}>
      {text}
    </text>
  );
}

function TooltipBox({ active, payload, label, fmtLabel, fmtValue, ink }) {
  if (!active || !payload?.length) return null;
  // Several series: largest first, so the reading order matches the chart's.
  const rows = payload.length > 1 ? [...payload].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)) : payload;
  return (
    <div className="rounded-xl px-3 py-2.5 text-[12px] shadow-2xl backdrop-blur-md" style={{ background: ink.glass, color: ink.text, border: `1px solid ${ink.border}`, minWidth: 150, maxWidth: 280 }}>
      {label !== undefined && label !== null && (
        <div className="mb-1.5 border-b pb-1.5 text-[11px] font-semibold" style={{ color: ink.strong, borderColor: ink.border }}>
          {fmtLabel ? fmtLabel(label) : label}
        </div>
      )}
      <div className="space-y-1">
        {rows.map((p) => (
          <div key={`${p.dataKey}-${p.name}`} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: p.color || p.payload?.fill }} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="font-mono font-semibold tabular-nums" style={{ color: ink.strong }}>{fmtValue(p.value, p.dataKey, p)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TileChart({ tile, measures = [], fields = [], height = 280, onSelect = null, selected = [] }) {
  const mode = usePaletteMode();
  const color = useSeriesColor();
  const ink = INK[mode] || INK.dark;
  const uid = useId().replace(/:/g, '');
  const c = tile.computed;
  const byId = useMemo(() => new Map(measures.map((m) => [m.id, m])), [measures]);
  const field = (name) => fields.find((f) => f.name === name);
  const m = byId.get(tile.measures?.[0]) || null;
  const fmt = (v, mm = m) => formatValue(v, mm || {});
  const grain = tile.kind === 'trend' ? tile.grain : null;
  const tickX = (v) => (grain ? formatTick(v, grain) : clip(v, 14));
  const labelX = (v) => (grain ? formatPeriod(v, grain) : v);
  const axis = { stroke: ink.grid, tick: { fill: ink.muted, fontSize: 11 }, tickLine: false, axisLine: false, tickMargin: 8 };

  if (!c) return <Empty height={height}>{tile.error ? `Could not compute: ${tile.error}` : 'No data'}</Empty>;
  const data = c.data || [];
  if (!data.length) return <Empty height={height}>No rows match the filters.</Empty>;

  const viz = tile.viz;
  if (viz === 'kpi') {
    return (
      <div className="flex flex-col items-start justify-center gap-1" style={{ minHeight: Math.min(height, 160) }}>
        <span className="font-display text-[44px] font-semibold leading-none text-white/95">{c.formatted ?? fmt(c.value)}</span>
        <span className="text-[12px] text-white/45">from {Number(c.support || 0).toLocaleString('en-US')} rows</span>
      </div>
    );
  }
  const isSelected = (v) => selected?.includes(String(v));
  const click = onSelect && tile.dim && tile.kind === 'breakdown' ? (d) => d && onSelect(tile.dim, d[tile.dim]) : null;

  /* KPI-like single value is handled by KpiCard; tables are HTML. */
  if (viz === 'table') return <DataTable tile={tile} data={data} byId={byId} field={field} height={height} />;
  if (viz === 'heatmap') return <Heatmap tile={tile} data={data} byId={byId} field={field} height={height} mode={mode} ink={ink} />;

  // Several measures side by side (survey items), or a histogram: one series of bars.
  if (tile.kind === 'compare' || tile.kind === 'distribution') {
    const xKey = c.x;
    const yKey = c.ys[0];
    const valueFmt = tile.kind === 'distribution' ? (v) => `${Math.round(v).toLocaleString('en-US')} ${v === 1 ? 'row' : 'rows'}` : (v, _k, p) => fmt(v, byId.get(p?.payload?.id) || m);
    const horizontal = viz === 'hbar';
    const labelW = horizontal ? Math.min(160, Math.max(60, Math.max(...data.map((d) => String(d[xKey]).length)) * 6.5)) : 0;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 16, bottom: 4, left: 4 }} barCategoryGap={tile.kind === 'distribution' ? 1 : '22%'}>
          <CartesianGrid stroke={ink.grid} strokeDasharray="3 4" vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" {...axis} tickFormatter={(v) => valueFmt(v)} />
              <YAxis type="category" dataKey={xKey} {...axis} width={labelW} tickFormatter={(v) => clip(v, Math.floor(labelW / 6.5))} interval={0} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} {...axis} tickFormatter={(v) => clip(v, 12)} interval="preserveStartEnd" minTickGap={8} />
              <YAxis {...axis} width={48} tickFormatter={(v) => (tile.kind === 'distribution' ? formatValue(v, {}) : valueFmt(v))} />
            </>
          )}
          <defs>
            <Fade id={`${uid}-b`} color={color(0)} horizontal={horizontal} />
          </defs>
          <Tooltip cursor={{ fill: ink.cursor, radius: 6 }} content={<TooltipBox ink={ink} fmtValue={(v, k, p) => valueFmt(v, k, p)} />} />
          <Bar dataKey={yKey} name={tile.kind === 'distribution' ? 'Rows' : 'Score'} fill={`url(#${uid}-b)`} stroke={color(0)} strokeOpacity={0.9} strokeWidth={0} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (viz === 'scatter') {
    const fx = field(tile.x);
    const fy = field(tile.y);
    const mx = { format: fx?.format, scale: fx?.scale };
    const my = { format: fy?.format, scale: fy?.scale };
    const groups = tile.color ? [...new Set(data.map((d) => String(d[tile.color] ?? '')))].sort().slice(0, 3) : null;
    const series = groups && groups.length <= 3 ? groups.map((g) => ({ name: g, data: data.filter((d) => String(d[tile.color]) === g) })) : [{ name: fy?.label || tile.y, data }];
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 18, left: 4 }}>
          <CartesianGrid stroke={ink.grid} strokeDasharray="3 4" />
          <XAxis type="number" dataKey={tile.x} name={fx?.label} {...axis} tickFormatter={(v) => formatValue(v, mx)} label={{ value: fx?.label, position: 'insideBottom', offset: -10, fill: ink.muted, fontSize: 11 }} domain={['auto', 'auto']} />
          <YAxis type="number" dataKey={tile.y} name={fy?.label} {...axis} width={56} tickFormatter={(v) => formatValue(v, my)} domain={['auto', 'auto']} />
          <ZAxis range={[46, 46]} />
          <Tooltip
            cursor={{ strokeDasharray: '3 3', stroke: ink.muted }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload;
              return (
                <div className="rounded-xl px-3 py-2.5 text-[12px] shadow-2xl backdrop-blur-md" style={{ background: ink.glass, color: ink.text, border: `1px solid ${ink.border}` }}>
                  {tile.label && p[tile.label] !== undefined && <div className="mb-1 font-bold">{String(p[tile.label])}</div>}
                  <div>{fx?.label}: <b>{formatValue(p[tile.x], mx)}</b></div>
                  <div>{fy?.label}: <b>{formatValue(p[tile.y], my)}</b></div>
                  {tile.color && <div>{field(tile.color)?.label}: {String(p[tile.color])}</div>}
                </div>
              );
            }}
          />
          {series.length > 1 && <Legend verticalAlign="top" align="left" content={<PillLegend ink={ink} />} />}
          {series.map((s, i) => (
            <Scatter key={s.name} name={s.name} data={s.data} fill={color(i)} fillOpacity={0.78} stroke={ink.surface} strokeWidth={1.5} isAnimationActive={false} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  if (viz === 'donut') {
    const yKey = c.ys[0];
    const pieData = data.filter((d) => typeof d[yKey] === 'number' && d[yKey] > 0).map((d) => ({ name: String(d[c.x]), value: d[yKey] }));
    const total = pieData.reduce((s, d) => s + d.value, 0);
    // Colour by name, not by size, so a category keeps its colour across charts and filters.
    const order = pieData.map((d) => d.name).filter((n) => n !== 'Other').sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    const sliceColor = (name) => (name === 'Other' ? ink.muted : color(order.indexOf(name)));
    return (
      <div className="flex h-full w-full flex-col items-center gap-3 sm:flex-row" style={{ minHeight: height }}>
        <div className="relative h-[200px] w-full max-w-[220px] shrink-0">
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: ink.muted }}>Total</span>
            <span className="figure text-[20px] font-semibold" style={{ color: ink.strong }}>{fmt(total)}</span>
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="94%" paddingAngle={2} cornerRadius={4} stroke={ink.surface} strokeWidth={2} isAnimationActive={false} onClick={click ? (d) => onSelect(tile.dim, d.name) : undefined}>
                {pieData.map((d, i) => (
                  <Cell key={d.name} fill={sliceColor(d.name)} opacity={selected?.length && !isSelected(d.name) ? 0.35 : 1} cursor={click ? 'pointer' : 'default'} />
                ))}
              </Pie>
              <Tooltip content={<TooltipBox ink={ink} fmtValue={(v) => `${fmt(v)} · ${Math.round((v / total) * 100)}%`} />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="w-full min-w-0 flex-1 space-y-1.5">
          {pieData.map((d, i) => (
            <li key={d.name} className="flex items-center gap-2 text-[12px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: sliceColor(d.name) }} />
              <span className="min-w-0 flex-1 truncate text-white/75" title={d.name}>{d.name}</span>
              <span className="shrink-0 font-mono text-white/60">{Math.round((d.value / total) * 100)}%</span>
              <span className="w-16 shrink-0 text-right font-mono text-white/85">{fmt(d.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Everything with an x axis: trend lines/areas/columns, breakdown bars, stacks.
  const series = c.series || c.ys;
  const multi = !!c.series || c.ys.length > 1;
  const nameOf = (k) => (c.series ? k : byId.get(k)?.label || k);
  const valueFmt = (v, k) => fmt(v, c.series ? m : byId.get(k) || m);
  const overall = c.totals && m && !m.additive ? c.totals[m.id] : null;
  const legend = multi ? <Legend verticalAlign="top" align="left" content={<PillLegend ink={ink} />} /> : null;
  const lineish = viz === 'line' || viz === 'area' || viz === 'stackedArea';
  const tooltip = (
    <Tooltip
      cursor={lineish ? { stroke: ink.muted, strokeDasharray: '4 4', strokeWidth: 1 } : { fill: ink.cursor, radius: 6 }}
      content={<TooltipBox ink={ink} fmtLabel={labelX} fmtValue={(v, k) => valueFmt(v, k)} />}
    />
  );
  const seriesColor = (k, i) => (k === 'Other' ? ink.muted : color(i));

  if (viz === 'line' || viz === 'area' || viz === 'stackedArea') {
    const Chart = viz === 'line' ? LineChart : AreaChart;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <Chart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <defs>
            {series.map((k, i) => (
              <Fade key={k} id={`${uid}-a${i}`} color={seriesColor(k, i)} from={viz === 'stackedArea' ? 0.7 : multi ? 0.18 : 0.32} to={viz === 'stackedArea' ? 0.45 : 0} />
            ))}
          </defs>
          <CartesianGrid stroke={ink.grid} strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey={c.x} {...axis} tickFormatter={tickX} minTickGap={16} interval="preserveStartEnd" />
          <YAxis {...axis} width={56} tickFormatter={(v) => valueFmt(v, series[0])} />
          {tooltip}
          {legend}
          {series.map((k, i) =>
            viz === 'line' ? (
              <Line key={k} type="monotone" dataKey={k} name={nameOf(k)} stroke={seriesColor(k, i)} strokeWidth={2} strokeLinecap="round" dot={data.length <= 16 && !multi ? { r: 3, strokeWidth: 2, stroke: ink.surface, fill: seriesColor(k, i) } : false} activeDot={{ r: 5, strokeWidth: 2, stroke: ink.surface }} connectNulls isAnimationActive={false} />
            ) : (
              <Area key={k} type="monotone" dataKey={k} name={nameOf(k)} stroke={seriesColor(k, i)} strokeWidth={2} fill={`url(#${uid}-a${i})`} fillOpacity={1} stackId={viz === 'stackedArea' ? 's' : undefined} activeDot={{ r: 5, strokeWidth: 2, stroke: ink.surface }} connectNulls isAnimationActive={false} />
            )
          )}
        </Chart>
      </ResponsiveContainer>
    );
  }

  // Bars.
  const horizontal = viz === 'hbar' || viz === 'stackedBar';
  const stacked = viz === 'stackedBar' || viz === 'stackedColumn';
  const longest = Math.max(...data.map((d) => String(d[c.x] ?? '').length));
  const labelW = horizontal ? Math.min(170, Math.max(56, longest * 6.6 + 8)) : 0;
  const barH = horizontal ? Math.max(height, Math.min(data.length * 30 + 40, 520)) : height;
  const fieldX = field(c.x);
  const xFmt = (v) => {
    if (grain) return tickX(v);
    if (fieldX?.kind === 'number' && fieldX?.role === 'measure' && !tile.edges) return formatValue(Number(v), fieldX);
    return v;
  };
  // The "Overall" line's label sits outside the plot — beside it on columns,
  // above it on bars — so no bar can ever cover it.
  const showOverall = overall !== null && overall !== undefined && !multi;
  const overallText = showOverall ? `Overall ${valueFmt(overall, series[0])}` : '';
  const margin = {
    top: showOverall && horizontal ? 20 : 8,
    right: showOverall && !horizontal ? Math.min(120, overallText.length * 5.6 + 12) : 20,
    bottom: 4,
    left: 4,
  };
  return (
    <ResponsiveContainer width="100%" height={barH}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={margin} barCategoryGap="24%" barGap={2}>
        <defs>
          {series.map((k, i) => (
            <Fade key={k} id={`${uid}-b${i}`} color={seriesColor(k, i)} horizontal={horizontal} from={1} to={stacked ? 0.85 : 0.62} />
          ))}
          <Fade id={`${uid}-other`} color={ink.muted} horizontal={horizontal} from={0.9} to={0.55} />
        </defs>
        <CartesianGrid stroke={ink.grid} strokeDasharray="3 4" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...axis} tickFormatter={(v) => valueFmt(v, series[0])} />
            <YAxis type="category" dataKey={c.x} {...axis} width={labelW} interval={0} tickFormatter={(v) => clip(xFmt(v), Math.floor((labelW - 8) / 6.6))} />
          </>
        ) : (
          <>
            <XAxis dataKey={c.x} {...axis} tickFormatter={(v) => clip(xFmt(v), 12)} interval={data.length > 14 ? 'preserveStartEnd' : 0} minTickGap={4} />
            <YAxis {...axis} width={56} tickFormatter={(v) => valueFmt(v, series[0])} />
          </>
        )}
        {tooltip}
        {legend}
        {showOverall && (
          horizontal ? (
            <ReferenceLine x={overall} stroke={ink.muted} strokeDasharray="4 3" label={<OverallLabel text={overallText} ink={ink} side="top" />} />
          ) : (
            <ReferenceLine y={overall} stroke={ink.muted} strokeDasharray="4 3" label={<OverallLabel text={overallText} ink={ink} side="right" />} />
          )
        )}
        {series.map((k, i) => (
          <Bar
            key={k}
            dataKey={k}
            name={nameOf(k)}
            fill={`url(#${uid}-b${i})`}
            stackId={stacked ? 's' : undefined}
            stroke={stacked ? ink.surface : undefined}
            strokeWidth={stacked ? 1.5 : 0}
            radius={stacked ? (i === series.length - 1 ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0) : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            isAnimationActive={false}
            onClick={click || undefined}
            cursor={click ? 'pointer' : 'default'}
          >
            {!multi &&
              data.map((d) => (
                <Cell key={String(d[c.x])} fill={d[c.x] === 'Other' ? `url(#${uid}-other)` : `url(#${uid}-b${i})`} opacity={selected?.length && !isSelected(d[c.x]) ? 0.35 : 1} />
              ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function Empty({ children, height }) {
  return (
    <div className="flex items-center justify-center text-[13px] text-white/40" style={{ height }}>
      {children}
    </div>
  );
}

/** A ranking as a table: the dimension, then each measure, with bars on the first. */
function DataTable({ tile, data, byId, field, height }) {
  const ms = (tile.measures || []).map((id) => byId.get(id)).filter(Boolean);
  const first = ms[0];
  const max = Math.max(...data.map((r) => Math.abs(r[first?.id] || 0)), 0) || 1;
  return (
    <div className="w-full overflow-auto" style={{ maxHeight: data.length <= 12 ? undefined : Math.max(height, 420) }}>
      <table className="w-full min-w-[420px] text-left text-[12px]">
        <thead className="sticky top-0 z-10 bg-[var(--surface)] text-[10px] uppercase tracking-[0.1em] text-white/45">
          <tr>
            <th className="w-8 py-2 pr-2 font-bold">#</th>
            <th className="py-2 pr-3 font-bold">{field(tile.dim)?.label || tile.dim}</th>
            {ms.map((m) => (
              <th key={m.id} className="py-2 pl-3 text-right font-bold">{m.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={`${r[tile.dim]}-${i}`} className="border-t border-white/6 transition-colors hover:bg-white/[0.03]">
              <td className="py-2 pr-2 font-mono text-white/35">{i + 1}</td>
              <td className="max-w-[220px] truncate py-2 pr-3 font-semibold text-white/85" title={String(r[tile.dim])}>{String(r[tile.dim])}</td>
              {ms.map((m, j) => (
                <td key={m.id} className="relative py-2 pl-3 text-right font-mono text-white/80">
                  {j === 0 && (
                    <span className="absolute inset-y-1.5 right-0 rounded-md bg-gradient-to-l from-accent-400/25 to-accent-400/5" style={{ width: `${Math.round((Math.abs(r[m.id] || 0) / max) * 100)}%` }} />
                  )}
                  <span className="relative">{formatValue(r[m.id], m)}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Rows × columns, one colour ramp: survey scores by group, a measure by two splits. */
function Heatmap({ tile, data, byId, field, height, mode, ink }) {
  const c = tile.computed;
  const cols = c.series ? c.series : c.ys;
  const colLabel = (k) => (c.series ? k : byId.get(k)?.label || k);
  const mFor = (k) => (c.series ? byId.get(tile.measures?.[0]) : byId.get(k)) || {};
  const vals = data.flatMap((r) => cols.map((k) => r[k])).filter((v) => typeof v === 'number');
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const shade = (v) => {
    if (typeof v !== 'number' || hi === lo) return 'transparent';
    const t = (v - lo) / (hi - lo);
    const a = 0.08 + t * 0.8;
    return mode === 'light' ? `rgba(42,120,214,${a})` : `rgba(57,135,229,${a})`;
  };
  // Ink that stays readable on the darkest cells.
  const cellInk = (v) => (typeof v === 'number' && hi !== lo && (v - lo) / (hi - lo) > 0.6 ? '#ffffff' : ink.text);
  return (
    <div className="w-full overflow-auto" style={{ maxHeight: Math.max(height, 380) }}>
      <table className="w-full border-separate border-spacing-[3px] text-[11px]">
        <thead>
          <tr>
            <th className="sticky left-0 bg-[var(--surface)] px-2 py-1.5 text-left font-bold text-white/45">{field(tile.dim)?.label || tile.dim}</th>
            {cols.map((k) => (
              <th key={k} className="max-w-[90px] truncate px-1 py-1.5 text-center font-semibold text-white/55" title={colLabel(k)}>{colLabel(k)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={String(r[tile.dim])}>
              <td className="sticky left-0 max-w-[160px] truncate bg-[var(--surface)] px-2 py-1.5 font-semibold text-white/80" title={String(r[tile.dim])}>{String(r[tile.dim])}</td>
              {cols.map((k) => (
                <td key={k} className="rounded-md px-1 py-2 text-center font-mono tabular-nums transition-transform hover:scale-[1.04]" style={{ background: shade(r[k]), color: cellInk(r[k]) }} title={`${r[tile.dim]} · ${colLabel(k)}: ${formatValue(r[k], mFor(k))}`}>
                  {formatValue(r[k], mFor(k))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
