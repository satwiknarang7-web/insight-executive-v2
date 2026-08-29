'use client';

/**
 * A funnel: how many survive each stage of a pipeline.
 *
 * Rows are taken in the order the query returned them, not sorted by size — a
 * funnel's whole meaning is the sequence, and re-sorting it would turn "leads →
 * demos → deals" into a meaningless ranking. Each stage is labelled with its
 * conversion from the stage above, which is the number people are actually
 * looking for.
 */
import { Funnel, FunnelChart, LabelList, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { usePalette, usePaletteMode, useSeriesColor } from './palette';
import { ordinalRamp } from '../../lib/chartPalette';
import { formatNumber } from '../../lib/format';
import { clip } from './axis';

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="chart-tooltip flex min-w-[190px] flex-col gap-1.5 rounded-xl border border-white/10 p-4 shadow-2xl">
      <p className="mb-1 border-b border-white/5 pb-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
        {row.stage}
      </p>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[11px] font-bold text-white/60">Value</span>
        <span className="font-mono text-[11px] font-black text-white">{formatNumber(row.value)}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[11px] font-bold text-white/60">Of the first stage</span>
        <span className="font-mono text-[11px] font-black text-white/70">{row.ofFirst}%</span>
      </div>
      {row.fromPrev !== null && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-[11px] font-bold text-white/60">From the stage above</span>
          <span className="font-mono text-[11px] font-black text-white/70">{row.fromPrev}%</span>
        </div>
      )}
    </div>
  );
};

export default function FunnelChartView({ data, xKey, yKey }) {
  const CHART_COLORS = usePalette();
  const seriesColor = useSeriesColor();
  const mode = usePaletteMode();
  if (!data?.length) return null;

  // Funnel stages are ordinal, not nominal: swapping two of them would change
  // what the chart means. So the colour carries the order too — a single hue,
  // light to dark — rather than saying these are unrelated things. Past the
  // number of steps a reader can rank by eye the ramp stops working, and the
  // geometry is left to carry the order on its own.
  const ramp = ordinalRamp(data.length, mode);

  const first = Number(data[0]?.[yKey]) || 0;
  const rows = data.map((row, i) => {
    const value = Number(row?.[yKey]) || 0;
    const prev = i === 0 ? null : Number(data[i - 1]?.[yKey]) || 0;
    return {
      stage: String(row?.[xKey] ?? ''),
      value,
      ofFirst: first ? Math.round((value / first) * 100) : 0,
      fromPrev: prev ? Math.round((value / prev) * 100) : null,
      fill: ramp ? ramp[i] : seriesColor(i),
    };
  });

  return (
    <ResponsiveContainer width="100%" height="100%" debounce={120}>
      <FunnelChart margin={{ top: 12, right: 96, bottom: 12, left: 96 }}>
        <Tooltip content={<CustomTooltip />} />
        <Funnel dataKey="value" data={rows} isAnimationActive={false} lastShapeType="rectangle">
          {rows.map((row, i) => (
            <Cell key={i} fill={row.fill} />
          ))}
          <LabelList
            position="right"
            dataKey="stage"
            fill="var(--color-white)"
            stroke="none"
            fontSize={11}
            fontWeight={800}
            formatter={(v) => clip(v, 22)}
          />
          <LabelList
            position="left"
            dataKey="value"
            fill="var(--chart-axis)"
            stroke="none"
            fontSize={11}
            fontWeight={700}
            formatter={(v) => formatNumber(v)}
          />
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
}
