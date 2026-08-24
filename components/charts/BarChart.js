import React from 'react';
import { 
  BarChart as RechartsBarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  Legend
} from 'recharts';
import { CHART_COLORS } from '../../lib/constants';
import { usePalette, useColorBy } from './palette';
import { formatNumber as yAxisFormatter } from '../../lib/format';
import { xAxisGeometry, yAxisGeometry, chartMargin } from './axis';

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

export default function BarChart({ data, xKey, yKey }) {
  // Palette for this chart: a per-slide override, or the default.
  const CHART_COLORS = usePalette();
  // One colour per bar, rather than one gradient across all of them.
  const perCategory = useColorBy() === 'category';
  const gradientId = React.useId();
  const barGradient = `bar-gradient-${gradientId}`;
  if (!data || data.length === 0) return null;

  // Gutters sized to the labels actually being drawn, so long category names
  // rotate into space that exists instead of being cut off.
  const x = xAxisGeometry(data, xKey);
  const y = yAxisGeometry(data, yKey);

  return (
    <ResponsiveContainer width="100%" height="100%" debounce={120}>
      <RechartsBarChart data={data} margin={chartMargin({ bottom: x.bottom })}>
        <defs>
          <linearGradient id={barGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={1}/>
            <stop offset="100%" stopColor={CHART_COLORS[1]} stopOpacity={0.6}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.05} vertical={false} />
        <XAxis {...x.props} />
        <YAxis {...y.props} domain={[0, 'auto']} />
        <Tooltip 
          content={<CustomTooltip />} 
          cursor={{ fill: 'var(--veil)', radius: [8, 8, 0, 0] }}
          animationDuration={200}
        />
        
        <Bar 
          dataKey={yKey} 
          fill={`url(#${barGradient})`} 
          radius={[6, 6, 0, 0]} 
          maxBarSize={40}
          name={yKey}
          animationBegin={0}
          animationDuration={450}
          animationEasing="ease-out"
        >
          {data.length <= 100 && data.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={
                entry.isAnomaly
                  ? '#f43f5e'
                  : perCategory
                  ? CHART_COLORS[index % CHART_COLORS.length]
                  : `url(#${barGradient})`
              }
              stroke={entry.isAnomaly ? '#f43f5e' : 'none'}
              strokeWidth={entry.isAnomaly ? 2 : 0}
              className="transition-all duration-300 hover:opacity-80 cursor-pointer"
            />
          ))}
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
