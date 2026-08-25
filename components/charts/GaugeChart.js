'use client';

/**
 * A gauge: one value against the range it could have been.
 *
 * A gauge with no target is a number in a circle — it tells you nothing a card
 * would not tell you better. So the arc is always drawn against a maximum, and
 * where none is supplied the sum of the series is used, which makes the needle
 * read as "this category's share of the whole".
 */
import { usePalette } from './palette';
import { formatNumber } from '../../lib/format';
import { prettyLabel } from './axis';

const START = 220; // degrees, sweeping clockwise to 320 (a 260° arc)
const SWEEP = 260;

const polar = (cx, cy, r, deg) => {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

/** An SVG arc path from `fromDeg` to `toDeg`. */
function arc(cx, cy, r, fromDeg, toDeg) {
  const a = polar(cx, cy, r, fromDeg);
  const b = polar(cx, cy, r, toDeg);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

export default function GaugeChart({ data, xKey, yKey, target = null, label = null }) {
  const CHART_COLORS = usePalette();
  if (!data?.length) return null;

  const values = data.map((r) => Number(r?.[yKey]) || 0);
  const value = values[0];
  const max = target ?? values.reduce((s, v) => s + v, 0) ?? 0;
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;

  const W = 320;
  const H = 210;
  const cx = W / 2;
  const cy = H - 46;
  const r = 96;
  const end = START + SWEEP * share;
  const caption = label ?? String(data[0]?.[xKey] ?? prettyLabel(yKey));

  return (
    <div className="flex h-full w-full items-center justify-center">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full max-w-[380px]" role="img" aria-label={`Gauge: ${caption}`}>
        <path d={arc(cx, cy, r, START, START + SWEEP)} fill="none" stroke="var(--chart-grid)" strokeOpacity={0.25} strokeWidth={18} strokeLinecap="round" />
        {share > 0 && (
          <path d={arc(cx, cy, r, START, end)} fill="none" stroke={CHART_COLORS[0]} strokeWidth={18} strokeLinecap="round" />
        )}
        <text x={cx} y={cy - 16} textAnchor="middle" fontSize={30} fontWeight={900} fill="var(--color-white)">
          {formatNumber(value)}
        </text>
        <text x={cx} y={cy + 8} textAnchor="middle" fontSize={11} fontWeight={800} fill="var(--chart-axis)">
          {Math.round(share * 100)}% of {formatNumber(max)}
        </text>
        <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fontWeight={800} fill="var(--chart-axis)" letterSpacing="0.12em">
          {String(caption).slice(0, 30).toUpperCase()}
        </text>
      </svg>
    </div>
  );
}
