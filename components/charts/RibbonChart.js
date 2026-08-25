'use client';

/**
 * A ribbon chart: who is winning, and when that changed.
 *
 * Power BI's ribbon chart is a stacked column chart whose categories are
 * reordered every period so the largest sits on top, with ribbons connecting a
 * category's slice across periods. The reordering is the point — it turns "did
 * the leader change?" from something you compute by squinting at bar heights
 * into something you see.
 *
 * Recharts cannot do it, and the geometry is simple enough to draw directly:
 * per period, sort the categories, stack them, and join each category's band to
 * its position in the next period with a filled quadrilateral.
 */
import { useMemo, useState } from 'react';
import { usePalette } from './palette';
import { formatNumber, formatDateLabel } from '../../lib/format';
import { prettyLabel } from './axis';
import { toPeriods } from '../../lib/pivot';

const PAD = { top: 18, right: 18, bottom: 46, left: 62 };

export default function RibbonChart({ data, xKey, yKey, seriesKey, xLabel, yLabel }) {
  const CHART_COLORS = usePalette();
  const [hover, setHover] = useState(null);

  const periods = useMemo(
    () => (data?.length && seriesKey ? toPeriods(data, xKey, seriesKey, yKey) : []),
    [data, xKey, seriesKey, yKey]
  );

  const names = useMemo(() => {
    const set = new Set();
    for (const p of periods) for (const i of p.items) set.add(i.name);
    return [...set];
  }, [periods]);

  if (periods.length < 2) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-white/25">
        A ribbon chart needs a category tracked across at least two periods
      </div>
    );
  }

  const W = 900;
  const H = 420;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const maxTotal = Math.max(...periods.map((p) => p.total)) || 1;
  const colBand = plotW / periods.length;
  const colW = Math.min(78, colBand * 0.46);

  const yOf = (v) => PAD.top + plotH - (v / maxTotal) * plotH;
  const xOf = (i) => PAD.left + colBand * i + colBand / 2;
  const colorOf = (name) => CHART_COLORS[names.indexOf(name) % CHART_COLORS.length];

  return (
    <div className="h-full w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full min-w-[560px]" role="img" aria-label="Ribbon chart">
        {/* Gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={yOf(maxTotal * f)}
            y2={yOf(maxTotal * f)}
            stroke="var(--chart-grid)"
            strokeOpacity="var(--chart-grid-opacity)"
            strokeDasharray="3 3"
          />
        ))}
        {[0, 0.5, 1].map((f) => (
          <text
            key={f}
            x={PAD.left - 10}
            y={yOf(maxTotal * f)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize={11}
            fontWeight={700}
            fill="var(--chart-axis)"
          >
            {formatNumber(maxTotal * f)}
          </text>
        ))}

        {/* Ribbons: each category's band joined to its place in the next period. */}
        {periods.slice(0, -1).map((period, i) =>
          period.items.map((item) => {
            const next = periods[i + 1].items.find((n) => n.name === item.name);
            if (!next) return null;
            const x1 = xOf(i) + colW / 2;
            const x2 = xOf(i + 1) - colW / 2;
            const dim = hover && hover !== item.name;
            return (
              <path
                key={`${period.period}-${item.name}`}
                d={`M ${x1} ${yOf(item.end)} L ${x2} ${yOf(next.end)} L ${x2} ${yOf(next.start)} L ${x1} ${yOf(item.start)} Z`}
                fill={colorOf(item.name)}
                fillOpacity={dim ? 0.06 : 0.22}
              />
            );
          })
        )}

        {/* The stacked columns themselves. */}
        {periods.map((period, i) =>
          period.items.map((item) => {
            const dim = hover && hover !== item.name;
            const h = Math.max(1, yOf(item.start) - yOf(item.end));
            return (
              <rect
                key={`${period.period}-${item.name}-bar`}
                x={xOf(i) - colW / 2}
                y={yOf(item.end)}
                width={colW}
                height={h}
                rx={3}
                fill={colorOf(item.name)}
                fillOpacity={dim ? 0.2 : 1}
                onMouseEnter={() => setHover(item.name)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{`${item.name} · ${period.period}: ${formatNumber(item.value)}`}</title>
              </rect>
            );
          })
        )}

        {/* Period labels */}
        {periods.map((period, i) => (
          <text
            key={period.period}
            x={xOf(i)}
            y={H - PAD.bottom + 18}
            textAnchor="middle"
            fontSize={11}
            fontWeight={700}
            fill="var(--chart-axis)"
          >
            {String(formatDateLabel(period.period)).slice(0, 12)}
          </text>
        ))}

        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize={11} fontWeight={800} fill="var(--chart-axis)">
          {xLabel ?? prettyLabel(xKey)}
        </text>
        <text
          transform={`rotate(-90, 14, ${PAD.top + plotH / 2})`}
          x={14}
          y={PAD.top + plotH / 2}
          textAnchor="middle"
          fontSize={11}
          fontWeight={800}
          fill="var(--chart-axis)"
        >
          {yLabel ?? prettyLabel(yKey)}
        </text>

        {/* Legend */}
        {names.slice(0, 6).map((name, i) => (
          <g key={name} transform={`translate(${PAD.left + i * 128}, 8)`}>
            <rect width={9} height={9} rx={2} fill={colorOf(name)} />
            <text x={14} y={8} fontSize={10} fontWeight={700} fill="var(--chart-axis)">
              {name.slice(0, 14)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
