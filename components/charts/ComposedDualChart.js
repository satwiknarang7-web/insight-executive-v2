import React, { useMemo } from 'react';
import { 
  ComposedChart, 
  Bar, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  Cell,
  Label
} from 'recharts';
import { CHART_COLORS } from '../../lib/constants';
import { usePalette } from './palette';
import { formatDateLabel, formatNumber as yAxisFormatter } from '../../lib/format';
import { xAxisGeometry, yAxisGeometry, chartMargin, clip, prettyLabel, legendProps } from './axis';

const CustomXAxisTick = ({ x, y, payload, rotated }) => {
  const value = payload.value;
  const label = formatDateLabel(value);
  // The reserved gutter was always computed as if the label were rotated, but
  // the text was drawn flat and centred — so long labels ran into each other.
  // Now it actually rotates when the gutter says it should.
  const display = clip(label, 30);

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={rotated ? 4 : 16}
        transform={rotated ? 'rotate(-35)' : undefined}
        textAnchor={rotated ? 'end' : 'middle'}
        fill="var(--chart-axis)"
        fontSize={12}
        fontWeight={700}
      >
        <title>{value}</title>
        {display}
      </text>
    </g>
  );
};

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
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: entry.color || entry.fill }} />
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

export default function ComposedDualChart({ data, xKey, yKey, lineKey, xLabel, yLabel, compact = false }) {
  const legend = legendProps({ seriesCount: 2, compact });
  // Palette for this chart: a per-slide override, or the default.
  const CHART_COLORS = usePalette();
  const gradientId = React.useId();
  const composedGradient = `composed-primary-${gradientId}`;

  // Everything down to the early return runs on every render, empty data
  // included, because the three useMemo calls below are hooks.
  //
  // They used to sit after `if (!data || data.length === 0) return null`, so an
  // empty render called two hooks and a populated one called five. A chart that
  // arrives empty and then fills — a re-run, or changing what it measures in the
  // Studio — changes its hook count between renders, and React answers that with
  // "Rendered more hooks than during the previous render" and unmounts the tree.
  const rows = Array.isArray(data) ? data : [];
  const keys = Object.keys(rows[0] || {});
  const actualLineKey = lineKey || keys.find(k => k !== xKey && k !== yKey && typeof rows[0][k] === 'number');

  const processedData = rows;

  const xGeo = useMemo(
    () => xAxisGeometry(processedData, xKey, { compact, title: xLabel ?? prettyLabel(xKey) }),
    [processedData, xKey, xLabel, compact]
  );
  const yLeft = useMemo(
    () => yAxisGeometry(processedData, yKey, { compact, title: yLabel ?? prettyLabel(yKey) }),
    [processedData, yKey, yLabel, compact]
  );
  const yRight = useMemo(
    () => yAxisGeometry(processedData, actualLineKey, { compact, title: prettyLabel(actualLineKey) }),
    [processedData, actualLineKey, compact]
  );

  // Every hook has now run. Past this point it is safe to leave early.
  if (rows.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height="100%" debounce={120}>
      <ComposedChart data={processedData} margin={chartMargin({ legend: true })}>
        <defs>
          <linearGradient id={composedGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={1}/>
            <stop offset="100%" stopColor={CHART_COLORS[1]} stopOpacity={0.6}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" strokeOpacity="var(--chart-grid-opacity)" vertical={false} />
        <XAxis
          dataKey={xKey}
          axisLine={false}
          tickLine={false}
          tick={<CustomXAxisTick rotated={xGeo.rotated} />}
          interval={xGeo.props.interval}
          height={xGeo.bottom}
        >
          {xGeo.title && <Label {...xGeo.title} />}
        </XAxis>
        <YAxis 
          yAxisId="left"
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: 'var(--chart-axis)', fontSize: 12, fontWeight: 700 }} 
          stroke="var(--chart-grid)"
          opacity={0.3} 
          tickFormatter={yAxisFormatter} 
          domain={['auto', 'auto']}
          width={yLeft.width}
        />
        <YAxis 
          yAxisId="right" 
          orientation="right" 
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: CHART_COLORS[2], fontSize: 12, fontWeight: 700 }} 
          stroke="var(--chart-grid)"
          opacity={0.3} 
          tickFormatter={yAxisFormatter} 
          domain={['auto', 'auto']}
          width={yRight.width}
        />
        <Tooltip 
          content={<CustomTooltip />} 
          cursor={{ fill: 'var(--veil)', radius: [8, 8, 0, 0] }}
          animationDuration={200}
        />
        {legend && (
          <Legend
            {...legend}
            formatter={(value) => (
              <span className="ml-1.5 text-[10px] font-black uppercase tracking-widest text-white/60">
                {String(value).replace(/_/g, ' ')}
              </span>
            )}
          />
        )}
        <Bar 
          yAxisId="left" 
          dataKey={yKey} 
          fill={`url(#${composedGradient})`} 
          radius={[6, 6, 0, 0]} 
          maxBarSize={40}
          animationDuration={450}
        />
        
        {actualLineKey && (
          <Line 
            yAxisId="right" 
            type="monotone" 
            dataKey={actualLineKey} 
            stroke={CHART_COLORS[2]} 
            strokeWidth={4} 
            dot={{ r: 4, fill: CHART_COLORS[2], strokeWidth: 2, stroke: 'var(--chart-stroke)' }}
            activeDot={{ r: 6, fill: 'var(--chart-label)', stroke: CHART_COLORS[2], strokeWidth: 2 }}
            animationDuration={450}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
