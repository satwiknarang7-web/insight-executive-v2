'use client';

/**
 * Draws one dashboard tile from the data the engine computed for it.
 *
 * The chart type is the tile's `viz`, which the engine only ever sets to one
 * the data allows (lib/engine/tiles.js `allowedViz`), so nothing here quietly
 * swaps it for something else. Every chart fills its container, never scrolls
 * sideways, and keeps its labels inside the tile: long category names are cut
 * with an ellipsis and shown in full in the tooltip.
 *
 * Charts draw themselves in — bars grow, lines trace, donuts sweep — and move
 * between states when a filter changes, as the Motion setting promises. Not
 * under reduced motion, and never when `animate` is false: a printed or
 * exported chart has to be caught finished, not half way up.
 */

import { useId, useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { formatPeriod, formatTick, formatValue } from '../../lib/engine/format';
import { MAP_VIZ } from '../../lib/engine/tiles';
import { useMotionAllowed } from '../../lib/motion';
import CountUp from '../motion/CountUp';
import { usePaletteMode, useSeriesColor } from '../charts/palette';
import GeoMap from './GeoMap';

const INK = {
  dark: { text: '#d4d4d8', strong: '#fafafa', muted: '#8b8b93', grid: 'rgba(255,255,255,0.08)', surface: '#141416', cursor: 'rgba(255,255,255,0.05)', glass: 'rgba(20,20,22,0.9)', border: 'rgba(255,255,255,0.14)' },
  light: { text: '#44403c', strong: '#1c1917', muted: '#78716c', grid: 'rgba(28,25,23,0.07)', surface: '#ffffff', cursor: 'rgba(28,25,23,0.04)', glass: 'rgba(255,255,255,0.95)', border: 'rgba(28,25,23,0.12)' },
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
/**
 * The series names as pills. A bar filled with a gradient reports its colour
 * as `url(#…)`, which means nothing to an HTML dot — every stacked, grouped
 * and combo legend showed blank swatches. `colors` gives the real colour per
 * series name, and a url colour is never used as a background.
 */
function PillLegend({ payload = [], ink, colors = null }) {
  const swatch = (p) => colors?.[p.value] || (String(p.color || '').startsWith('url(') ? ink.muted : p.color);
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5">
      {payload.map((p) => (
        <li key={p.value} className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]" style={{ border: `1px solid ${ink.border}`, color: ink.text }}>
          <span className="h-2 w-2 rounded-full" style={{ background: swatch(p) }} />
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

/**
 * One rectangle of a treemap. Recharts hands it the box and the datum; the
 * colour, the dimming and the click come in from the chart. Labelled only
 * where the label fits, since the tooltip names every box anyway.
 */
function TreemapBox({ x, y, width, height, name, value, partColor, dim, pick, fmt, ink }) {
  if (!name || width <= 0 || height <= 0) return null;
  const roomy = width > 70 && height > 38;
  return (
    <g style={{ cursor: pick ? 'pointer' : 'default' }} onClick={pick ? () => pick(name) : undefined}>
      <rect x={x} y={y} width={width} height={height} rx={6} fill={partColor(name)} fillOpacity={0.85 * dim(name)} stroke={ink.surface} strokeWidth={3} />
      {roomy && (
        <>
          <text x={x + 10} y={y + 20} fill="#ffffff" fontSize={12} fontWeight={600} style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
            {clip(name, Math.floor((width - 16) / 7))}
          </text>
          <text x={x + 10} y={y + 36} fill="#ffffff" fillOpacity={0.85} fontSize={11}>
            {fmt(value)}
          </text>
        </>
      )}
    </g>
  );
}

export default function TileChart({ tile, measures = [], fields = [], height = 280, onSelect = null, selected = [], animate = true }) {
  const mode = usePaletteMode();
  const live = useMotionAllowed() && animate;
  // One timing for every mark, so a board of mixed charts moves as one piece.
  // Several series start one after another rather than all at once.
  const anim = (i = 0, ms = 900) =>
    live ? { isAnimationActive: true, animationBegin: 80 + i * 90, animationDuration: ms, animationEasing: 'ease-out' } : { isAnimationActive: false };
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
        <CountUp value={c.formatted ?? fmt(c.value)} animate={live} className="font-display text-[44px] font-semibold leading-none text-white/95" />
        <span className="text-[12px] text-white/45">from {Number(c.support || 0).toLocaleString('en-US')} rows</span>
      </div>
    );
  }
  const isSelected = (v) => selected?.includes(String(v));
  const click = onSelect && tile.dim && tile.kind === 'breakdown' ? (d) => d && onSelect(tile.dim, d[tile.dim]) : null;

  /* KPI-like single value is handled by KpiCard; tables are HTML. */
  if (viz === 'table') return <DataTable tile={tile} data={data} byId={byId} field={field} height={height} color={color(0)} />;
  if (MAP_VIZ.includes(viz) && field(tile.dim)?.map?.code) {
    const variant = viz === 'bubbleMap' ? 'bubble' : viz === 'shapeMap' ? 'shape' : 'filled';
    return <GeoMap tile={tile} code={field(tile.dim).map.code} data={data} m={m} height={height} mode={mode} ink={ink} onSelect={onSelect && tile.dim ? onSelect : null} selected={selected} variant={variant} />;
  }
  if (viz === 'heatmap') return <Heatmap tile={tile} data={data} byId={byId} field={field} height={height} mode={mode} ink={ink} />;
  if (viz === 'cards') return <NumberCards tile={tile} data={data} m={m} fmt={fmt} ink={ink} onSelect={click ? (name) => onSelect(tile.dim, name) : null} isSelected={isSelected} anySelected={!!selected?.length} />;

  // A profile: scores around a circle. Several measures of one survey, or one
  // measure across a handful of categories.
  if (viz === 'radar') {
    const points =
      tile.kind === 'compare'
        ? data.map((d) => ({ axis: d.measure, value: d.value, id: d.id }))
        : data.filter((d) => d[c.x] !== 'Other').map((d) => ({ axis: String(d[c.x]), value: d[c.ys[0]] }));
    return (
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart data={points} outerRadius="72%" margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
          <PolarGrid stroke={ink.grid} />
          <PolarAngleAxis dataKey="axis" tick={{ fill: ink.muted, fontSize: 11 }} tickFormatter={(v) => clip(v, 16)} />
          <PolarRadiusAxis tick={false} axisLine={false} domain={[0, 'auto']} />
          <Tooltip content={<TooltipBox ink={ink} fmtValue={(v, _k, p) => fmt(v, byId.get(p?.payload?.id) || m)} />} />
          <Radar dataKey="value" name={m?.label || 'Value'} stroke={color(0)} strokeWidth={2} fill={color(0)} fillOpacity={0.28} dot={{ r: 3, fill: color(0), stroke: ink.surface, strokeWidth: 1.5 }} {...anim(0, 900)} />
        </RadarChart>
      </ResponsiveContainer>
    );
  }

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
          <Bar dataKey={yKey} name={tile.kind === 'distribution' ? 'Rows' : 'Score'} fill={`url(#${uid}-b)`} stroke={color(0)} strokeOpacity={0.9} strokeWidth={0} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} {...anim()} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (viz === 'scatter' || viz === 'bubble') {
    const fx = field(tile.x);
    const fy = field(tile.y);
    // A bubble's third number is its area, not its radius, so a value twice
    // as large looks twice as large.
    const fs = viz === 'bubble' && tile.size ? field(tile.size) : null;
    const ms_ = fs ? { format: fs.format, scale: fs.scale } : null;
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
          {fs ? <ZAxis type="number" dataKey={tile.size} name={fs.label} range={[24, 900]} /> : <ZAxis range={[46, 46]} />}
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
                  {fs && <div>{fs.label}: <b>{formatValue(p[tile.size], ms_)}</b></div>}
                  {tile.color && <div>{field(tile.color)?.label}: {String(p[tile.color])}</div>}
                </div>
              );
            }}
          />
          {series.length > 1 && <Legend verticalAlign="top" align="left" content={<PillLegend ink={ink} />} />}
          {series.map((s, i) => (
            <Scatter key={s.name} name={s.name} data={s.data} fill={color(i)} fillOpacity={fs ? 0.5 : 0.78} stroke={ink.surface} strokeWidth={1.5} {...anim(i, 700)} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  if (viz === 'donut' || viz === 'pie') {
    const hole = viz === 'donut';
    const yKey = c.ys[0];
    const pieData = data.filter((d) => typeof d[yKey] === 'number' && d[yKey] > 0).map((d) => ({ name: String(d[c.x]), value: d[yKey] }));
    const total = pieData.reduce((s, d) => s + d.value, 0);
    // Colour by name, not by size, so a category keeps its colour across charts and filters.
    const order = pieData.map((d) => d.name).filter((n) => n !== 'Other').sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    const sliceColor = (name) => (name === 'Other' ? ink.muted : color(order.indexOf(name)));
    return (
      <div className="flex h-full w-full flex-col items-center gap-3 sm:flex-row" style={{ minHeight: height }}>
        <div className="relative h-[200px] w-full max-w-[220px] shrink-0">
          {hole && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: ink.muted }}>Total</span>
              <CountUp value={fmt(total)} animate={live} className="figure text-[20px] font-semibold" style={{ color: ink.strong }} />
            </div>
          )}
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={hole ? '64%' : 0} outerRadius="94%" paddingAngle={hole ? 2 : 1} cornerRadius={hole ? 4 : 2} stroke={ink.surface} strokeWidth={2} {...anim(0, 1000)} onClick={click ? (d) => onSelect(tile.dim, d.name) : undefined}>
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

  // A few categories as arcs, longest outside, coloured by name like the donut.
  if (viz === 'radial') {
    const yKey = c.ys[0];
    const bars = data
      .filter((d) => typeof d[yKey] === 'number' && d[yKey] >= 0)
      .map((d) => ({ name: String(d[c.x]), value: d[yKey] }))
      .sort((a, b) => a.value - b.value);
    const order = bars.map((d) => d.name).filter((n) => n !== 'Other').sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    const barColor = (name) => (name === 'Other' ? ink.muted : color(order.indexOf(name)));
    const ranked = [...bars].reverse();
    return (
      <div className="flex h-full w-full flex-col items-center gap-3 sm:flex-row" style={{ minHeight: height }}>
        <div className="h-[220px] w-full max-w-[240px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart data={bars.map((d) => ({ ...d, fill: barColor(d.name) }))} innerRadius="22%" outerRadius="100%" startAngle={90} endAngle={-270} barCategoryGap="18%">
              <PolarAngleAxis type="number" domain={[0, Math.max(...bars.map((d) => d.value), 0) || 1]} tick={false} />
              <RadialBar dataKey="value" background={{ fill: ink.grid }} cornerRadius={6} onClick={click ? (d) => onSelect(tile.dim, d.name) : undefined} cursor={click ? 'pointer' : 'default'} {...anim(0, 1000)}>
                {bars.map((d) => (
                  <Cell key={d.name} fill={barColor(d.name)} opacity={selected?.length && !isSelected(d.name) ? 0.35 : 1} />
                ))}
              </RadialBar>
              <Tooltip content={<TooltipBox ink={ink} fmtValue={(v) => fmt(v)} />} />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
        <ul className="w-full min-w-0 flex-1 space-y-1.5">
          {ranked.map((d) => (
            <li key={d.name} className="flex items-center gap-2 text-[12px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: barColor(d.name) }} />
              <span className="min-w-0 flex-1 truncate" style={{ color: ink.text }} title={d.name}>{d.name}</span>
              <span className="w-20 shrink-0 text-right font-mono" style={{ color: ink.strong }}>{fmt(d.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // The leading part against the whole: a half dial filled to its share.
  if (viz === 'gauge') {
    const yKey = c.ys[0];
    const parts = data.filter((d) => typeof d[yKey] === 'number' && d[yKey] > 0);
    const total = parts.reduce((s, d) => s + d[yKey], 0);
    const lead = parts.filter((d) => d[c.x] !== 'Other').sort((a, b) => b[yKey] - a[yKey])[0];
    if (!lead || !total) return <Empty height={height}>Nothing to measure against.</Empty>;
    const share = lead[yKey] / total;
    const dial = [
      { name: String(lead[c.x]), value: lead[yKey] },
      { name: 'The rest', value: total - lead[yKey] },
    ];
    return (
      <div className="flex w-full flex-col items-center" style={{ minHeight: Math.min(height, 240) }}>
        <div className="relative h-[170px] w-full max-w-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={dial} dataKey="value" nameKey="name" cx="50%" cy="88%" startAngle={180} endAngle={0} innerRadius="120%" outerRadius="165%" stroke="none" {...anim(0, 1100)}>
                <Cell fill={color(0)} />
                <Cell fill={ink.grid} />
              </Pie>
              <Tooltip content={<TooltipBox ink={ink} fmtValue={(v) => `${fmt(v)} · ${Math.round((v / total) * 100)}%`} />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-x-0 bottom-1 flex flex-col items-center">
            <span className="figure text-[30px] font-semibold leading-none" style={{ color: ink.strong }}>{Math.round(share * 100)}%</span>
          </div>
        </div>
        <p className="mt-2 max-w-[320px] text-center text-[12px]" style={{ color: ink.text }}>
          <b style={{ color: ink.strong }}>{String(lead[c.x])}</b> is {fmt(lead[yKey])} of {fmt(total)}
        </p>
      </div>
    );
  }

  // How a total is built: each part (or period) steps up from where the last
  // one ended, then a final column shows the total itself.
  if (viz === 'waterfall') {
    const yKey = c.ys[0];
    let running = 0;
    const steps = data
      .filter((d) => typeof d[yKey] === 'number')
      .map((d) => {
        const v = d[yKey];
        const from = running;
        running += v;
        return { label: d[c.x], base: Math.min(from, running), size: Math.abs(v), value: v, end: running, up: v >= 0 };
      });
    steps.push({ label: 'Total', base: Math.min(0, running), size: Math.abs(running), value: running, end: running, up: running >= 0, total: true });
    const tick = (v) => (v === 'Total' ? v : clip(grain ? formatTick(v, grain) : v, 12));
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={steps} margin={{ top: 8, right: 16, bottom: 4, left: 4 }} barCategoryGap="18%">
          <CartesianGrid stroke={ink.grid} strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="label" {...axis} tickFormatter={tick} interval={steps.length > 14 ? 'preserveStartEnd' : 0} minTickGap={4} />
          <YAxis {...axis} width={56} tickFormatter={(v) => fmt(v)} />
          <Tooltip
            cursor={{ fill: ink.cursor, radius: 6 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload;
              return (
                <div className="rounded-xl px-3 py-2.5 text-[12px] shadow-2xl backdrop-blur-md" style={{ background: ink.glass, color: ink.text, border: `1px solid ${ink.border}` }}>
                  <div className="mb-1 font-semibold" style={{ color: ink.strong }}>{p.total ? 'Total' : labelX(p.label)}</div>
                  {!p.total && <div>{p.value >= 0 ? 'Adds' : 'Takes away'} <b>{fmt(Math.abs(p.value))}</b></div>}
                  <div>{p.total ? '' : 'Running total '}<b>{fmt(p.end)}</b></div>
                </div>
              );
            }}
          />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="size" stackId="w" radius={[4, 4, 4, 4]} {...anim(0, 900)}>
            {steps.map((s, i) => (
              <Cell key={`${s.label}-${i}`} fill={s.total ? ink.muted : s.up ? color(0) : '#e0605e'} fillOpacity={s.total ? 0.8 : 0.9} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // Which series leads in each period: every series' rank over time, first at
  // the top, so a crossing line is the lead changing hands.
  if (viz === 'ribbon' && c.series) {
    const keys = c.series.filter((k) => k !== 'Other');
    const ranked = data.map((d) => {
      const order = keys.filter((k) => typeof d[k] === 'number').sort((a, b) => d[b] - d[a]);
      const row = { [c.x]: d[c.x], __values: d };
      order.forEach((k, i) => (row[k] = i + 1));
      return row;
    });
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={ranked} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={ink.grid} strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey={c.x} {...axis} tickFormatter={tickX} minTickGap={16} interval="preserveStartEnd" />
          <YAxis {...axis} width={36} reversed domain={[1, Math.max(1, keys.length)]} allowDecimals={false} ticks={keys.map((_, i) => i + 1)} tickFormatter={(v) => `#${v}`} />
          <Tooltip
            cursor={{ stroke: ink.muted, strokeDasharray: '4 4', strokeWidth: 1 }}
            content={<TooltipBox ink={ink} fmtLabel={labelX} fmtValue={(v, k, p) => `#${v} · ${fmt(p?.payload?.__values?.[k], m)}`} />}
          />
          <Legend verticalAlign="top" align="left" content={<PillLegend ink={ink} />} />
          {keys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} name={k} stroke={color(i)} strokeWidth={3} dot={{ r: 3.5, strokeWidth: 2, stroke: ink.surface, fill: color(i) }} activeDot={{ r: 5 }} connectNulls {...anim(i, 1100)} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // Two measures on one axis: columns for the first, a line for the second,
  // each on its own scale (left and right) since they are rarely in one unit.
  if (viz === 'combo' && c.ys.length === 2) {
    const [a, b] = c.ys;
    const ma = byId.get(a);
    const mb = byId.get(b);
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <defs>
            <Fade id={`${uid}-c`} color={color(0)} from={1} to={0.62} />
          </defs>
          <CartesianGrid stroke={ink.grid} strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey={c.x} {...axis} tickFormatter={(v) => (grain ? tickX(v) : clip(v, 12))} interval={data.length > 14 ? 'preserveStartEnd' : 0} minTickGap={4} />
          <YAxis yAxisId="a" {...axis} width={56} tickFormatter={(v) => fmt(v, ma)} />
          <YAxis yAxisId="b" orientation="right" {...axis} width={56} tickFormatter={(v) => fmt(v, mb)} />
          <Tooltip cursor={{ fill: ink.cursor, radius: 6 }} content={<TooltipBox ink={ink} fmtLabel={labelX} fmtValue={(v, k) => fmt(v, byId.get(k))} />} />
          <Legend verticalAlign="top" align="left" content={<PillLegend ink={ink} colors={{ [ma?.label || a]: color(0), [mb?.label || b]: color(1) }} />} />
          <Bar yAxisId="a" dataKey={a} name={ma?.label || a} fill={`url(#${uid}-c)`} radius={[4, 4, 0, 0]} {...anim(0)} onClick={click || undefined} cursor={click ? 'pointer' : 'default'} />
          <Line yAxisId="b" type="monotone" dataKey={b} name={mb?.label || b} stroke={color(1)} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 2, stroke: ink.surface, fill: color(1) }} connectNulls {...anim(1, 1100)} />
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  // Parts of a whole, as areas or as narrowing stages. Both are drawn from the
  // same positive values, coloured by name like the donut so a category keeps
  // its colour from one chart to the next.
  if (viz === 'treemap' || viz === 'funnel') {
    const yKey = c.ys[0];
    const parts = data
      .filter((d) => typeof d[yKey] === 'number' && d[yKey] > 0)
      .map((d) => ({ name: String(d[c.x]), value: d[yKey] }))
      .sort((a, b) => b.value - a.value);
    const total = parts.reduce((t, d) => t + d.value, 0);
    const order = parts.map((d) => d.name).filter((n) => n !== 'Other').sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    const partColor = (name) => (name === 'Other' ? ink.muted : color(order.indexOf(name)));
    const dim = (name) => (selected?.length && !isSelected(name) ? 0.35 : 1);
    const pick = click ? (name) => onSelect(tile.dim, name) : null;
    const share = (v) => `${fmt(v)} · ${Math.round((v / total) * 100)}%`;

    if (viz === 'treemap') {
      return (
        <ResponsiveContainer width="100%" height={height}>
          <Treemap data={parts} dataKey="value" nameKey="name" aspectRatio={4 / 3} content={<TreemapBox partColor={partColor} dim={dim} pick={pick} fmt={fmt} ink={ink} />} {...anim(0, 900)}>
            <Tooltip content={<TooltipBox ink={ink} fmtValue={(v) => share(v)} />} />
          </Treemap>
        </ResponsiveContainer>
      );
    }

    // A funnel narrows from the largest stage, one hue fading as it goes.
    const stages = parts.map((d, i) => ({ ...d, fill: color(0), fillOpacity: (1 - (i / Math.max(1, parts.length)) * 0.55) * dim(d.name) }));
    return (
      <ResponsiveContainer width="100%" height={height}>
        <FunnelChart margin={{ top: 8, right: 130, bottom: 8, left: 8 }}>
          <Tooltip content={<TooltipBox ink={ink} fmtValue={(v) => share(v)} />} />
          <Funnel data={stages} dataKey="value" nameKey="name" stroke={ink.surface} strokeWidth={2} onClick={pick ? (d) => pick(d.name) : undefined} cursor={pick ? 'pointer' : 'default'} {...anim(0, 900)}>
            {stages.map((d) => (
              <Cell key={d.name} fill={d.fill} fillOpacity={d.fillOpacity} />
            ))}
            <LabelList position="right" dataKey="name" fill={ink.text} stroke="none" fontSize={12} />
            <LabelList position="center" dataKey="value" fill="#ffffff" stroke="none" fontSize={12} fontWeight={600} formatter={(v) => fmt(v)} />
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
    );
  }

  // Everything with an x axis: trend lines/areas/columns, breakdown bars, stacks.
  const series = c.series || c.ys;
  const multi = !!c.series || c.ys.length > 1;
  const nameOf = (k) => (c.series ? k : byId.get(k)?.label || k);
  const valueFmt = (v, k) => fmt(v, c.series ? m : byId.get(k) || m);
  const overall = c.totals && m && !m.additive ? c.totals[m.id] : null;
  const seriesColor = (k, i) => (k === 'Other' ? ink.muted : color(i));
  const legendColors = Object.fromEntries(series.map((k, i) => [nameOf(k), seriesColor(k, i)]));
  const legend = multi ? <Legend verticalAlign="top" align="left" content={<PillLegend ink={ink} colors={legendColors} />} /> : null;
  const lineish = viz === 'line' || viz === 'area' || viz === 'stackedArea';
  const tooltip = (
    <Tooltip
      cursor={lineish ? { stroke: ink.muted, strokeDasharray: '4 4', strokeWidth: 1 } : { fill: ink.cursor, radius: 6 }}
      content={<TooltipBox ink={ink} fmtLabel={labelX} fmtValue={(v, k) => valueFmt(v, k)} />}
    />
  );

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
              <Line key={k} type="monotone" dataKey={k} name={nameOf(k)} stroke={seriesColor(k, i)} strokeWidth={2} strokeLinecap="round" dot={data.length <= 16 && !multi ? { r: 3, strokeWidth: 2, stroke: ink.surface, fill: seriesColor(k, i) } : false} activeDot={{ r: 5, strokeWidth: 2, stroke: ink.surface }} connectNulls {...anim(i, 1200)} />
            ) : (
              <Area key={k} type="monotone" dataKey={k} name={nameOf(k)} stroke={seriesColor(k, i)} strokeWidth={2} fill={`url(#${uid}-a${i})`} fillOpacity={1} stackId={viz === 'stackedArea' ? 's' : undefined} activeDot={{ r: 5, strokeWidth: 2, stroke: ink.surface }} connectNulls {...anim(i, 1100)} />
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
            {...anim(stacked ? 0 : i)}
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
function DataTable({ tile, data, byId, field, height, color }) {
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
                    // The chart palette's colour, not the accent: a ranking is a
                    // chart drawn as a table, and it has to match the bars beside
                    // it whichever colour theme is on (Solar made it amber-brown
                    // next to green charts).
                    <span
                      className="anim-grow-x absolute inset-y-1.5 right-0 origin-right rounded-md"
                      style={{
                        width: `${Math.round((Math.abs(r[m.id] || 0) / max) * 100)}%`,
                        background: `linear-gradient(to left, ${color}4d, ${color}0f)`,
                        animationDelay: `${Math.min(i, 12) * 40}ms`,
                      }}
                    />
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

/**
 * A short list of values as numbers: one card per category, largest first,
 * with its share of the total where the measure adds up.
 */
function NumberCards({ tile, data, m, fmt, ink, onSelect, isSelected, anySelected }) {
  const c = tile.computed;
  const yKey = c.ys[0];
  const cards = data.filter((d) => typeof d[yKey] === 'number');
  const total = m?.additive ? cards.reduce((s, d) => s + d[yKey], 0) : null;
  return (
    <div className="grid w-full gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
      {cards.map((d) => {
        const name = String(d[c.x]);
        return (
          <button
            key={name}
            type="button"
            onClick={onSelect ? () => onSelect(name) : undefined}
            className="rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
            style={{ borderColor: ink.border, opacity: anySelected && !isSelected(name) ? 0.45 : 1, cursor: onSelect ? 'pointer' : 'default' }}
          >
            <div className="truncate text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: ink.muted }} title={name}>{name}</div>
            <div className="figure mt-1 text-[20px] font-semibold leading-tight" style={{ color: ink.strong }}>{fmt(d[yKey])}</div>
            {total ? <div className="mt-0.5 text-[11px]" style={{ color: ink.muted }}>{Math.round((d[yKey] / total) * 100)}% of the total</div> : null}
          </button>
        );
      })}
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
    return `rgba(25,158,112,${a})`;
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
