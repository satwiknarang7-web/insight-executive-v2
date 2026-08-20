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
import { formatNumber as yAxisFormatter, truncateLabel as truncateTick } from '../../lib/format';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-950/90 backdrop-blur-xl border border-white/10 p-4 rounded-xl shadow-2xl flex flex-col gap-2 min-w-[180px]">
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
  const gradientId = React.useId();
  const barGradient = `bar-gradient-${gradientId}`;
  if (!data || data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height="100%" debounce={120}>
      <RechartsBarChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 40 }}>
        <defs>
          <linearGradient id={barGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={1}/>
            <stop offset="100%" stopColor={CHART_COLORS[1]} stopOpacity={0.6}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff" opacity={0.05} vertical={false} />
        <XAxis 
          dataKey={xKey} 
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 700 }} 
          tickFormatter={truncateTick}
          interval="preserveStartEnd"
          height={50}
        />
        <YAxis 
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 700 }} 
          tickFormatter={yAxisFormatter}
          domain={[0, 'auto']}
          width={55}
        />
        <Tooltip 
          content={<CustomTooltip />} 
          cursor={{ fill: 'rgba(255,255,255,0.05)', radius: [8, 8, 0, 0] }} 
          animationDuration={200}
        />
        <Legend 
          verticalAlign="top" 
          align="right"
          wrapperStyle={{ paddingBottom: '40px', paddingRight: '10px' }}
          iconType="circle" 
          iconSize={8}
          formatter={(value) => (
            <span className="text-white/60 font-black text-[10px] ml-2 uppercase tracking-widest">
              {String(value).replace(/_/g, ' ')}
            </span>
          )}
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
              fill={entry.isAnomaly ? '#f43f5e' : `url(#${barGradient})`} 
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
