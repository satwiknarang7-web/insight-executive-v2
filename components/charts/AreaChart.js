import React from 'react';
import { AreaChart as RechartsAreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatNumber as yAxisFormatter, formatAxisLabel } from '../../lib/format';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-950/80 backdrop-blur-2xl border border-accent-500/20 px-4 py-3 rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.6)] flex flex-col gap-2 min-w-[170px]">
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-accent-400/80 mb-0.5">
          {formatAxisLabel(label)}
        </p>
        <div className="flex flex-col gap-1.5">
          {payload.map((entry, index) => (
            <div key={index} className="flex items-center justify-between gap-5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color || entry.stroke, boxShadow: `0 0 8px ${entry.color || entry.stroke}` }} />
                <span className="text-[11px] font-semibold text-white/50 capitalize">{entry.name.replace(/_/g, ' ')}</span>
              </div>
              <span className="text-[12px] font-black font-mono text-white">{yAxisFormatter(entry.value)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export default function AreaChart({ data, xKey, yKey }) {
  const id = React.useId();
  const fillId = `area-fill-${id}`;
  const strokeId = `area-stroke-${id}`;
  const glowId = `area-glow-${id}`;
  if (!data || data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height="100%" debounce={120}>
      <RechartsAreaChart data={data} margin={{ top: 24, right: 18, left: 4, bottom: 26 }}>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.35} />
            <stop offset="55%" stopColor="#0ea5e9" stopOpacity={0.12} />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
          </linearGradient>
          <linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#2dd4bf" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
          <filter id={glowId} x="-20%" y="-60%" width="140%" height="220%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <CartesianGrid strokeDasharray="4 6" stroke="#ffffff" strokeOpacity={0.04} vertical={false} />
        <XAxis
          dataKey={xKey}
          axisLine={false}
          tickLine={false}
          tickMargin={12}
          tick={{ fill: '#64748b', fontSize: 11, fontWeight: 700 }}
          tickFormatter={formatAxisLabel}
          interval="preserveStartEnd"
          minTickGap={28}
          height={34}
        />
        <YAxis
          domain={['auto', 'auto']}
          axisLine={false}
          tickLine={false}
          tickMargin={8}
          width={48}
          tick={{ fill: '#64748b', fontSize: 11, fontWeight: 700 }}
          tickFormatter={yAxisFormatter}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#2dd4bf', strokeWidth: 1, strokeDasharray: '4 4', strokeOpacity: 0.4 }} />
        <Area
          type="monotone"
          dataKey={yKey}
          stroke={`url(#${strokeId})`}
          strokeWidth={3}
          fill={`url(#${fillId})`}
          filter={`url(#${glowId})`}
          dot={false}
          activeDot={{ r: 5, fill: '#fff', stroke: '#2dd4bf', strokeWidth: 3 }}
          name="Actual Baseline"
          animationDuration={450}
          animationEasing="ease-out"
        />
      </RechartsAreaChart>
    </ResponsiveContainer>
  );
}
