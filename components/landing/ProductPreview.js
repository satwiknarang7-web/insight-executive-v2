'use client';

/**
 * The product, drawn rather than photographed: a dashboard window with KPI
 * cards, a trend drawing itself, a ranked breakdown and the assistant. Built
 * from the theme's tokens, so it is never out of date with the app and
 * follows light and dark. Decorative — the page's text says what it does.
 */

import { useEffect, useState } from 'react';
import { MessageCircle, Sparkles } from 'lucide-react';
import { motionAllowed } from '../../lib/motion';

const TREND = [32, 36, 34, 41, 39, 46, 44, 52, 49, 58, 61, 57, 66, 70, 68, 77];
const BARS = [
  ['Video', 0.92, '323K'],
  ['Paid search', 0.71, '248K'],
  ['Social', 0.48, '169K'],
  ['Display', 0.29, '101K'],
  ['Email', 0.15, '53K'],
];
const KPIS = [
  ['Revenue', 894.7, 'K', '+2.9%', true],
  ['Orders', 12.4, 'K', '+1.8%', true],
  ['Conversion', 3.1, '%', '+0.4 pts', true],
  ['Cost / order', 41.6, '', '−3.2%', true],
];

/** Counts up once on mount, so the numbers arrive like a query returning. */
function useCount(to, ms = 1200) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!motionAllowed()) {
      setV(to);
      return undefined;
    }
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(to * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return v;
}

function Kpi({ label, value, unit, delta }) {
  const v = useCount(value);
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <div className="truncate text-[9.5px] font-semibold uppercase tracking-[0.1em] text-white/45">{label}</div>
      <div className="figure mt-1 text-[19px] font-semibold text-white/90">
        {value >= 100 ? v.toFixed(1) : v.toFixed(1)}
        <span className="text-[12px] text-white/50">{unit}</span>
      </div>
      <div className="mt-1 inline-flex rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-400">{delta}</div>
    </div>
  );
}

export default function ProductPreview() {
  const w = 420;
  const h = 150;
  const max = Math.max(...TREND) * 1.1;
  const pts = TREND.map((y, i) => [(i / (TREND.length - 1)) * w, h - (y / max) * h]);
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <div className="relative" aria-hidden="true">
      {/* Glow behind the window. */}
      <div className="absolute -inset-6 rounded-[2rem] bg-[radial-gradient(60%_60%_at_60%_40%,var(--wash-a),transparent_70%)] blur-2xl" />
      <div className="card card-glow relative overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-white/8 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
          <span className="ml-3 truncate font-mono text-[10.5px] text-white/40">insight / dashboard / campaigns.csv</span>
          <span className="ml-auto hidden items-center gap-1 rounded-full border border-accent-400/30 px-2 py-0.5 text-[10px] font-semibold text-accent-300 sm:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-400" /> Live
          </span>
        </div>

        <div className="space-y-3 p-4">
          <div className="stagger grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {KPIS.map(([label, value, unit, delta]) => (
              <Kpi key={label} label={label} value={value} unit={unit} delta={delta} />
            ))}
          </div>

          <div className="grid gap-2.5 sm:grid-cols-5">
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 sm:col-span-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[11.5px] font-semibold text-white/85">Revenue over time</span>
                <span className="font-mono text-[10px] text-white/40">monthly</span>
              </div>
              <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-[120px] w-full" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="pp-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent-400)" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="var(--color-accent-400)" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="pp-line" x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0%" stopColor="var(--color-accent-400)" />
                    <stop offset="100%" stopColor="var(--accent-2)" />
                  </linearGradient>
                </defs>
                {[0.25, 0.5, 0.75].map((g) => (
                  <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} stroke="currentColor" className="text-white/10" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
                ))}
                <polygon points={area} fill="url(#pp-fill)" />
                <polyline className="pp-draw" pathLength="1" points={line} fill="none" stroke="url(#pp-line)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 sm:col-span-2">
              <span className="text-[11.5px] font-semibold text-white/85">Revenue by channel</span>
              <ul className="mt-2.5 space-y-2">
                {BARS.map(([name, v, label], i) => (
                  <li key={name} className="grid grid-cols-[64px_1fr_34px] items-center gap-2 text-[10px]">
                    <span className="truncate text-white/55">{name}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-white/6">
                      <span className="pp-bar block h-full rounded-full bg-gradient-to-r from-accent-400 to-[var(--accent-2)]" style={{ width: `${v * 100}%`, animationDelay: `${200 + i * 90}ms` }} />
                    </span>
                    <span className="text-right font-mono text-white/60">{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="anim-rise flex items-start gap-2.5 rounded-xl border border-accent-400/20 bg-accent-400/[0.06] p-3" style={{ animationDelay: '700ms' }}>
            <span className="anim-breathe flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent-400/15 text-accent-300">
              <Sparkles size={13} />
            </span>
            <p className="text-[11.5px] leading-relaxed text-white/75">
              <span className="font-semibold text-white/90">Key finding · </span>
              Video is the largest channel with 36% of revenue, 1.3× the next, Paid search.
            </p>
          </div>
        </div>
      </div>

      {/* The assistant, floating over the corner. */}
      {/* It floats: an opaque panel with no blur behind it, so the loop costs
          the compositor nothing — unlike floating the glass window itself. */}
      <div className="panel anim-float absolute -bottom-10 -left-6 hidden w-60 p-3 shadow-2xl md:block">
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-white/60">
          <MessageCircle size={12} className="text-accent-400" /> Assistant
        </div>
        <p className="anim-pop mt-1.5 rounded-lg bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-white/80" style={{ animationDelay: '900ms' }}>Filter to Email and add conversions by audience</p>
        <div className="anim-pop mt-1.5 flex gap-1.5" style={{ animationDelay: '1300ms' }}>
          <span className="rounded-md bg-accent-500 px-2 py-1 text-[10px] font-bold text-on-accent">Apply</span>
          <span className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-white/55">Discard</span>
        </div>
      </div>
    </div>
  );
}
