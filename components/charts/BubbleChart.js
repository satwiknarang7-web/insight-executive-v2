'use client';

/**
 * A bubble chart: a scatter plot where size carries a third measure.
 *
 * The size scale is deliberately by AREA, not radius. Mapping a value to radius
 * makes a bubble twice the value look four times as big, which is the classic
 * way a chart lies without anyone editing the data.
 */
import {
  CartesianGrid,
  Label,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  Cell,
} from 'recharts';
import { usePalette, useSeriesColor } from './palette';
import { formatNumber } from '../../lib/format';
import { chartMargin, prettyLabel, axisTitleProps } from './axis';

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className="chart-tooltip flex min-w-[190px] flex-col gap-1.5 rounded-xl border border-white/10 p-4 shadow-2xl">
      {row.__label && (
        <p className="mb-1 border-b border-white/5 pb-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
          {row.__label}
        </p>
      )}
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-4">
          <span className="text-[11px] font-bold capitalize text-white/60">
            {String(entry.name).replace(/_/g, ' ')}
          </span>
          <span className="font-mono text-[11px] font-black text-white">{formatNumber(entry.value)}</span>
        </div>
      ))}
    </div>
  );
};

export default function BubbleChart({ data, xKey, yKey, sizeKey, labelKey, xLabel, yLabel, compact = false }) {
  const CHART_COLORS = usePalette();
  const seriesColor = useSeriesColor();
  if (!data?.length || !xKey || !yKey) return null;

  const rows = data.map((row) => ({ ...row, __label: labelKey ? row[labelKey] : undefined }));
  const xTitle = axisTitleProps(xLabel ?? prettyLabel(xKey), { axis: 'x' });
  const yTitle = axisTitleProps(yLabel ?? prettyLabel(yKey), { axis: 'y' });

  return (
    <ResponsiveContainer width="100%" height="100%" debounce={120}>
      <ScatterChart margin={chartMargin({ right: 24 })}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--chart-grid)"
          strokeOpacity="var(--chart-grid-opacity)"
        />
        <XAxis
          type="number"
          dataKey={xKey}
          name={xKey}
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--chart-axis)', fontSize: 12, fontWeight: 700 }}
          tickFormatter={formatNumber}
          domain={['auto', 'auto']}
          height={xTitle ? 56 : 34}
        >
          {xTitle && <Label {...xTitle} />}
        </XAxis>
        <YAxis
          type="number"
          dataKey={yKey}
          name={yKey}
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--chart-axis)', fontSize: 12, fontWeight: 700 }}
          tickFormatter={formatNumber}
          domain={['auto', 'auto']}
          width={yTitle ? 78 : 56}
        >
          {yTitle && <Label {...yTitle} />}
        </YAxis>
        {/* `range` is an AREA range, so recharts scales the radius as sqrt. */}
        {sizeKey && <ZAxis type="number" dataKey={sizeKey} name={sizeKey} range={[compact ? 40 : 80, compact ? 700 : 1600]} />}
        <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3', stroke: 'var(--chart-grid)' }} />
        <Scatter data={rows} fill={CHART_COLORS[0]} fillOpacity={0.65} isAnimationActive={false}>
          {rows.map((row, i) => (
            <Cell key={i} fill={row.isAnomaly ? '#f43f5e' : seriesColor(i)} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
