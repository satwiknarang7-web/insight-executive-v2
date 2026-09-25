'use client';

/**
 * A choropleth: each region shaded by its value on one hue, light to dark in
 * five steps (quantiles, so a skewed measure still spreads across the scale),
 * regions with no data left neutral. Beside it, the total and the regions
 * ranked — the map shows where, the list shows how much.
 *
 * Shapes load on demand (lib/geo/maps/<code>.json); names are matched with
 * lib/geo/match.js, the same matcher that decided the column was a map.
 */

import { useEffect, useMemo, useState } from 'react';
import { formatValue } from '../../lib/engine/format';
import { regionIds } from '../../lib/geo/match';

const STEPS = 5;
// One hue (the palette's aqua), stepped for each surface.
const RAMP = {
  dark: ['#1d5a44', '#1f7a5a', '#23996f', '#3cb988', '#7dd8b3'],
  light: ['#79c4a5', '#4fae88', '#2f9570', '#1b7756', '#0b5a40'],
};
const NO_DATA = { dark: 'rgba(255,255,255,0.07)', light: 'rgba(28,25,23,0.07)' };

const cache = new Map();
function loadMap(code) {
  if (!cache.has(code)) cache.set(code, import(`../../lib/geo/maps/${code}.json`).then((m) => m.default || m));
  return cache.get(code);
}

export default function GeoMap({ tile, code, data, m, height, mode, ink, onSelect, selected = [] }) {
  const [shape, setShape] = useState(null);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    let live = true;
    if (code) loadMap(code).then((s) => live && setShape(s)).catch(() => live && setShape(false));
    return () => {
      live = false;
    };
  }, [code]);

  const yKey = m?.id;
  const { byRegion, unmatched, ranked, edges, total } = useMemo(() => {
    const byRegion = new Map();
    const unmatched = [];
    for (const row of data) {
      const v = row[yKey];
      if (typeof v !== 'number') continue;
      const ids = regionIds(code, row[tile.dim]);
      if (!ids.length) {
        unmatched.push(String(row[tile.dim]));
        continue;
      }
      for (const id of ids) {
        const cur = byRegion.get(id);
        // Two names for one shape (Ladakh within Jammu and Kashmir): totals add.
        byRegion.set(id, { value: cur && m?.additive ? cur.value + v : v, label: cur ? `${cur.label} + ${row[tile.dim]}` : String(row[tile.dim]) });
      }
    }
    const ranked = data.filter((r) => typeof r[yKey] === 'number').sort((a, b) => b[yKey] - a[yKey]);
    const vals = [...byRegion.values()].map((x) => x.value).sort((a, b) => a - b);
    const edges = Array.from({ length: STEPS - 1 }, (_, i) => vals[Math.floor(((i + 1) / STEPS) * (vals.length - 1))]);
    const total = m?.additive ? ranked.reduce((s, r) => s + r[yKey], 0) : tile.computed?.totals?.[yKey];
    return { byRegion, unmatched, ranked, edges, total };
  }, [data, yKey, code, tile.dim, m, tile.computed]);

  const ramp = RAMP[mode] || RAMP.dark;
  const stepOf = (v) => edges.filter((e) => v > e).length;
  const fillOf = (id) => {
    const r = byRegion.get(id);
    return r ? ramp[stepOf(r.value)] : NO_DATA[mode] || NO_DATA.dark;
  };
  const fmt = (v) => formatValue(v, m || {});
  const max = ranked[0]?.[yKey] || 1;
  const isSel = (label) => selected?.includes(String(label));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(240px,1fr)]" style={{ minHeight: height }}>
      <div className="relative min-w-0">
        {shape === null && <div className="ld-skeleton h-full min-h-[260px] w-full rounded-xl" />}
        {shape === false && <p className="text-[13px] text-white/40">The map could not be loaded.</p>}
        {shape && (
          <svg viewBox={shape.viewBox} className="h-auto max-h-[460px] w-full" role="img" aria-label={`${tile.title}, shaded by value`}>
            {shape.locations.map((l) => {
              const r = byRegion.get(l.id);
              const dim = selected?.length && r && !isSel(r.label);
              return (
                <path
                  key={l.id}
                  d={l.path}
                  fill={fillOf(l.id)}
                  stroke={hover?.id === l.id ? ink.strong : ink.surface}
                  strokeWidth={hover?.id === l.id ? 1.6 : 0.6}
                  vectorEffect="non-scaling-stroke"
                  opacity={dim ? 0.35 : 1}
                  style={{ cursor: r && onSelect ? 'pointer' : 'default', transition: 'opacity 150ms' }}
                  onMouseEnter={(e) => setHover({ id: l.id, name: l.name, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
                  onMouseMove={(e) => setHover((h) => h && { ...h, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => r && onSelect && onSelect(tile.dim, r.label.split(' + ')[0])}
                />
              );
            })}
          </svg>
        )}
        {hover && (
          <div
            className="pointer-events-none absolute z-10 rounded-xl px-3 py-2 text-[12px] shadow-2xl backdrop-blur-md"
            style={{ left: Math.min(hover.x + 14, 9999), top: hover.y + 14, background: ink.glass, border: `1px solid ${ink.border}`, color: ink.text }}
          >
            <div className="font-semibold" style={{ color: ink.strong }}>{hover.name}</div>
            {byRegion.get(hover.id) ? (
              <div className="mt-0.5 font-mono tabular-nums">
                {fmt(byRegion.get(hover.id).value)}
                <span className="ml-2" style={{ color: ink.muted }}>
                  #{ranked.findIndex((r) => regionIds(code, r[tile.dim]).includes(hover.id)) + 1} of {ranked.length}
                </span>
              </div>
            ) : (
              <div style={{ color: ink.muted }}>No data</div>
            )}
          </div>
        )}
        {/* Legend: the five steps with their ranges. */}
        {shape && byRegion.size > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px]" style={{ color: ink.muted }}>
            <span className="flex overflow-hidden rounded-md">
              {ramp.map((c) => (
                <span key={c} className="h-2.5 w-7" style={{ background: c }} />
              ))}
            </span>
            <span className="font-mono tabular-nums">
              {fmt(Math.min(...[...byRegion.values()].map((x) => x.value)))} – {fmt(Math.max(...[...byRegion.values()].map((x) => x.value)))}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: NO_DATA[mode] || NO_DATA.dark }} /> no data
            </span>
            <span className="ml-auto">Map: {shape.source} · {shape.license}</span>
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="rounded-xl border px-4 py-3" style={{ borderColor: ink.border }}>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em]" style={{ color: ink.muted }}>{shape?.name || tile.map}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[12px]" style={{ color: ink.muted }}>{m?.label}</span>
            <span className="figure text-[20px] font-semibold" style={{ color: ink.strong }}>{total != null ? fmt(total) : '—'}</span>
          </div>
        </div>
        <ol className="mt-3 space-y-1.5">
          {ranked.slice(0, 10).map((r, i) => (
            <li key={String(r[tile.dim])}>
              <button
                type="button"
                onClick={() => onSelect && onSelect(tile.dim, r[tile.dim])}
                className="grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12px] transition-colors hover:bg-white/[0.04]"
                style={{ opacity: selected?.length && !isSel(r[tile.dim]) ? 0.45 : 1 }}
              >
                <span className="font-mono text-[10.5px]" style={{ color: ink.muted }}>{i + 1}</span>
                <span className="relative min-w-0">
                  <span className="absolute inset-y-0 left-0 rounded-md" style={{ width: `${(r[yKey] / max) * 100}%`, background: 'rgba(25,158,112,0.16)' }} />
                  <span className="relative block truncate px-1.5 py-0.5" style={{ color: ink.text }}>{String(r[tile.dim])}</span>
                </span>
                <span className="font-mono tabular-nums" style={{ color: ink.strong }}>{fmt(r[yKey])}</span>
              </button>
            </li>
          ))}
        </ol>
        {ranked.length > 10 && <p className="mt-2 px-1.5 text-[11px]" style={{ color: ink.muted }}>and {ranked.length - 10} more</p>}
        {unmatched.length > 0 && (
          <p className="mt-3 rounded-lg px-2 py-1.5 text-[11px]" style={{ color: ink.muted, border: `1px dashed ${ink.border}` }}>
            Not on the map: {unmatched.slice(0, 4).join(', ')}
            {unmatched.length > 4 ? ` and ${unmatched.length - 4} more` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
