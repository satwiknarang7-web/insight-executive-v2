import React from 'react';
import { 
  LineChart as RechartsLineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend,
  Label
} from 'recharts';
import { CHART_COLORS } from '../../lib/constants';
import { usePalette, useSeriesColor } from './palette';
import { formatNumber as yAxisFormatter } from '../../lib/format';
import { xAxisGeometry, yAxisGeometry, chartMargin, prettyLabel, legendProps } from './axis';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="chart-tooltip border border-white/10 p-4 rounded-xl shadow-2xl flex flex-col gap-2 min-w-[180px]">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-1 border-b border-white/5 pb-2">
          {label}
        </p>
        <div className="flex flex-col gap-1.5">
          {payload.map((entry, index) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: entry.color || entry.stroke }} />
                <span className="text-[11px] font-bold text-white/60 capitalize">
                  {entry.name.replace(/_/g, ' ')}
                </span>
              </div>
              <span className="text-[11px] font-black font-mono text-white">
                {yAxisFormatter(entry.value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export default function LineChart({
  data,
  xKey,
  yKey,
  xLabel,
  yLabel,
  compact = false,
  // Set when the tile is too short for a full axis; see xAxisGeometry.
  dense = false,
  // One line per legend value, when a legend column was chosen.
  seriesKeys = null,
}) {
  // Palette for this chart: a per-slide override, or the default.
  const CHART_COLORS = usePalette();
  const seriesColor = useSeriesColor();
  if (!data || data.length === 0) return null;

  const split = Array.isArray(seriesKeys) && seriesKeys.length > 0;

  // Smart Y-axis domain: use integer ticks for count data. A split chart holds
  // its numbers under one key per series and none under yKey at all — reading
  // yKey there left the domain at [0, -Infinity] and no line was drawn.
  const valueKeys = split ? seriesKeys : [yKey];
  const yValues = data
    .flatMap((d) => valueKeys.map((key) => Number(d[key])))
    .filter((v) => !isNaN(v));
  const maxY = yValues.length ? Math.max(...yValues) : 0;
  const allIntegers = yValues.length > 0 && yValues.every(v => Number.isInteger(v));
  const yDomain = allIntegers && maxY <= 20 ? [0, Math.ceil(maxY * 1.2)] : ['auto', 'auto'];
  const yTickCount = allIntegers && maxY <= 10 ? maxY + 1 : undefined;

  // Adaptive dot size
  const dotSize = data.length <= 5 ? 5 : data.length <= 15 ? 4 : 3;

  const x = xAxisGeometry(data, xKey, { compact, dense, title: xLabel ?? prettyLabel(xKey) });
  const y = yAxisGeometry(data, split ? seriesKeys : yKey, {
    compact,
    dense,
    title: yLabel ?? prettyLabel(yKey),
  });

  return (
    <ResponsiveContainer width="100%" height="100%" debounce={120}>
      <RechartsLineChart data={data} margin={chartMargin()}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" strokeOpacity="var(--chart-grid-opacity)" vertical={false} />
        {!x.hidden && (

          <XAxis {...x.props}>{x.title && <Label {...x.title} />}</XAxis>

        )}
        <YAxis
          {...y.props}
          domain={yDomain}
          allowDecimals={!allIntegers}
          tickCount={yTickCount}
        >
          {y.title && <Label {...y.title} />}
        </YAxis>
        <Tooltip content={<CustomTooltip />} />
        
        {split && <Legend {...legendProps({ seriesCount: seriesKeys.length, compact })} />}

        {split ? (
          seriesKeys.map((key, index) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={key}
              stroke={seriesColor(index)}
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              animationDuration={450}
              connectNulls
            />
          ))
        ) : (
        <Line 
          type="monotone" 
          dataKey={yKey} 
          stroke={CHART_COLORS[0]} 
          strokeWidth={4} 
          dot={data.length > 200 ? false : { r: dotSize, fill: CHART_COLORS[0], strokeWidth: 2, stroke: 'var(--chart-stroke)' }} 
          activeDot={{ r: dotSize + 2, strokeWidth: 0, fill: 'var(--chart-label)', stroke: CHART_COLORS[0] }} 
          name="Actual Baseline"
          animationDuration={450}
        />
        )}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
