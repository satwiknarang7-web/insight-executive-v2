import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, Label } from 'recharts';
import { CHART_COLORS } from '../../lib/constants';
import { legendProps } from './axis';
import { usePalette, useSeriesColor } from './palette';
import { labelledSlices } from '../../lib/sliceLabels';
import { formatNumber as yAxisFormatter, formatValue } from '../../lib/format';

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const entry = payload[0];
    return (
      <div className="chart-tooltip border border-white/10 p-4 rounded-xl shadow-2xl flex flex-col gap-2 min-w-[180px]">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-1 border-b border-white/5 pb-2">
          {entry.name}
        </p>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: entry.payload?.fill || CHART_COLORS[0] }} />
            <span className="text-[11px] font-bold text-white/60 capitalize">
              {String(entry.name).replace(/_/g, ' ')}
            </span>
          </div>
          <span className="text-[11px] font-black font-mono text-white">
            {yAxisFormatter(entry.value)}
          </span>
        </div>
      </div>
    );
  }
  return null;
};

export default function DonutChart({ data, nameKey, valueKey, variant = 'donut', compact = false }) {
  const legend = legendProps({ seriesCount: (data || []).length, compact });
  const solid = variant === 'pie';
  // Palette for this chart: a per-slide override, or the default.
  const CHART_COLORS = usePalette();
  const seriesColor = useSeriesColor();

  // Which slices have room for a number beside them. Past about ten categories
  // the thin ones bunch up at one end of the circle and their labels overprint
  // each other; the ones that go unlabelled keep their colour, their legend
  // entry and their tooltip.
  const labelled = useMemo(
    () => labelledSlices((data || []).map((row) => row?.[valueKey])),
    [data, valueKey]
  );

  /**
   * Leader lines: all of them, or none.
   *
   * `labelLine` takes a props object or a boolean. It does NOT take a function
   * returning a props object — Recharts reads a function there as a render prop
   * and renders whatever comes back as a child, so returning `{ stroke, ... }`
   * threw "Objects are not valid as a React child" and took the whole chart
   * down with it. Per-slice control has to come from the `label` renderer,
   * which really is a render prop, so this stays all-or-nothing: lines when
   * every slice is labelled, and none once the crowded ones have been dropped,
   * where the remaining labels sit beside the few big arcs anyway.
   */
  const everySliceLabelled = labelled.size === (data?.length || 0);
  return (
    <ResponsiveContainer width="100%" height="100%" debounce={120}>
      <PieChart margin={{ top: 20, bottom: 20, left: 20, right: 20 }}>
        <Pie 
          data={data} 
          dataKey={valueKey} 
          nameKey={nameKey} 
          cx="50%" 
          cy="50%" 
          innerRadius={solid ? 0 : '60%'}
          outerRadius="80%"
          paddingAngle={solid ? 1 : 5}
          stroke="none"
          labelLine={
            everySliceLabelled
              ? { stroke: 'var(--chart-grid)', strokeOpacity: 0.25, strokeWidth: 1 }
              : false
          }
          label={({ cx, cy, midAngle, outerRadius, value, name, index }) => {
            // A slice with no room for a label draws none, rather than one on
            // top of its neighbour's.
            if (!labelled.has(index)) return null;

            const RADIAN = Math.PI / 180;
            const radius = outerRadius + 20;
            const xPos = cx + radius * Math.cos(-midAngle * RADIAN);
            const yPos = cy + radius * Math.sin(-midAngle * RADIAN);

            const displayValue = formatValue(value, name);

            return (
              <text
                x={xPos}
                y={yPos}
                fill="var(--chart-label)"
                textAnchor={xPos > cx ? 'start' : 'end'}
                dominantBaseline="central"
                style={{ filter: 'drop-shadow(var(--chart-label-halo))' }}
                className="text-[11px] font-black tracking-widest"
              >
                {displayValue}
              </text>
            );
          }}
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={seriesColor(index)} className="hover:brightness-110 transition-all cursor-pointer" />
          ))}
          <Label
            position="center"
            content={({ viewBox }) => {
              if (solid) return null;
              const { cx, cy } = viewBox || {};
              if (cx == null || cy == null) return null;
              const total = data.reduce((acc, curr) => acc + (Number(curr[valueKey]) || 0), 0);
              return (
                <g>
                  <text x={cx} y={cy - 6} textAnchor="middle" dominantBaseline="middle" className="fill-white font-black text-2xl drop-shadow-[0_4px_12px_rgba(45,212,191,0.4)]">
                    {yAxisFormatter(total)}
                  </text>
                  <text x={cx} y={cy + 16} textAnchor="middle" dominantBaseline="middle" className="fill-white/40 font-black text-[9px] uppercase tracking-[0.3em]">
                    Total
                  </text>
                </g>
              );
            }}
          />
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        {legend && (
          <Legend
            {...legend}
            formatter={(value) => (
              <span className="ml-1.5 text-[11px] font-bold capitalize text-white/50">
                {String(value).replace(/_/g, ' ')}
              </span>
            )}
          />
        )}
      </PieChart>
    </ResponsiveContainer>
  );
}
