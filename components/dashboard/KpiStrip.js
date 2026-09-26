'use client';

/**
 * The headline numbers: a value, what it is, how it moved last period, and a
 * sparkline of how it got there. Three to five of them, never a row of totals
 * nobody asked for.
 *
 * The figures count up and the sparklines draw in when the strip arrives —
 * unless `animate` is off, as it is on the printed report.
 */

import { ArrowDownRight, ArrowUpRight, Minus, X } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { usePaletteMode, useSeriesColor } from '../charts/palette';
import { useMotionAllowed } from '../../lib/motion';
import CountUp from '../motion/CountUp';

function Delta({ delta, delay = 0 }) {
  if (!delta) return null;
  const up = delta.pct > 0;
  const flat = Math.abs(delta.pct) < 0.5;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const tone =
    delta.good === null || flat
      ? 'text-white/55 bg-white/[0.05]'
      : delta.good
        ? 'text-emerald-400 bg-emerald-500/10'
        : 'text-rose-400 bg-rose-500/10';
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
      <span className={`anim-zoom inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold ${tone}`} style={{ animationDelay: `${delay}ms` }}>
        <Icon size={12} aria-hidden="true" />
        {delta.text}
      </span>
      <span className="truncate text-white/40">
        {delta.period} {delta.vs}
      </span>
    </div>
  );
}

function Spark({ points, animate }) {
  const color = useSeriesColor();
  const mode = usePaletteMode();
  if (!points?.length || points.length < 3) return null;
  return (
    <div className="pointer-events-none h-10 w-full" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Area type="monotone" dataKey="value" stroke={color(0)} strokeWidth={1.5} fill={color(0)} fillOpacity={mode === 'light' ? 0.1 : 0.14} dot={false} isAnimationActive={animate} animationBegin={250} animationDuration={1200} animationEasing="ease-out" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function KpiStrip({ kpis = [], editing = false, onRemove, animate = true }) {
  const live = useMotionAllowed() && animate;
  if (!kpis.length) return null;
  const cols = kpis.length >= 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : kpis.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
  return (
    <div className={`stagger grid grid-cols-1 gap-3 ${cols}`} data-testid="kpis">
      {kpis.map((k, i) => (
        <div key={k.id} className="card relative flex min-w-0 flex-col gap-1.5 p-4">
          {editing && onRemove && (
            <button type="button" onClick={() => onRemove(k.id)} aria-label={`Remove ${k.title}`} className="absolute right-2 top-2 rounded-md p-1 text-white/35 hover:bg-white/5 hover:text-white">
              <X size={13} />
            </button>
          )}
          <div className="line-clamp-2 pr-5 text-[11px] font-bold uppercase leading-snug tracking-[0.12em] text-white/50" title={k.title}>
            {k.title}
          </div>
          <div className="flex min-w-0 items-baseline gap-2">
            <CountUp value={k.formatted} animate={live} delay={i * 60} className="truncate font-display text-[28px] font-semibold leading-none text-white/95" />
            {k.subtitle && <span className="shrink-0 text-[11px] text-white/40">{k.subtitle}</span>}
          </div>
          <Delta delta={k.filtered ? null : k.delta} delay={500 + i * 60} />
          {!k.filtered && <Spark points={k.spark} animate={live} />}
        </div>
      ))}
    </div>
  );
}
