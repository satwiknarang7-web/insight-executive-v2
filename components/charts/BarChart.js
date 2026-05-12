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

const yAxisFormatter = (val) => {
  if (typeof val !== 'number') return val;
  if (Number.isInteger(val) && Math.abs(val) < 100) return val;
  const formattedNum = Math.abs(val) >= 1000000 ? (val / 1000000).toFixed(1) + 'M' : 
                       Math.abs(val) >= 1000 ? (val / 1000).toFixed(1) + 'K' : 
                       Number(val.toFixed(2));
  return formattedNum;
};

const truncateTick = (tick) => {
  if (tick && typeof tick === 'string' && tick.length > 15) {
     return `${tick.substring(0, 12)}...`;
  }
  return tick;
};

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
                  {entry.name.replace('Projected ', 'Simulated ').replace(/_/g, ' ')}
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
  const projGradient = `bar-proj-gradient-${gradientId}`;
  if (!data || data.length === 0) return null;

  const keys = Object.keys(data[0] || {});
  const projectionKey = keys.find(k => k.startsWith('Projected'));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RechartsBarChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 40 }}>
        <defs>
          <linearGradient id={barGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS[0]} stopOpacity={0.8}/>
            <stop offset="95%" stopColor={CHART_COLORS[0]} stopOpacity={0.2}/>
          </linearGradient>
          <linearGradient id={projGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS[3]} stopOpacity={0.6}/>
            <stop offset="95%" stopColor={CHART_COLORS[3]} stopOpacity={0.1}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff" opacity={0.03} vertical={false} />
        <XAxis 
          dataKey={xKey} 
          axisLine={false} 
          tickLine={false} 
          tick={{ angle: -45, textAnchor: 'end', fill: '#94a3b8', fontSize: 10, fontWeight: 500 }} 
          tickFormatter={truncateTick}
          interval={0}
          height={100}
        />
        <YAxis 
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }} 
          tickFormatter={yAxisFormatter}
          domain={['auto', 'auto']}
          width={45}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <Legend 
          verticalAlign="top" 
          align="right"
          wrapperStyle={{ paddingBottom: '30px', paddingRight: '10px' }}
          iconType="circle" 
          iconSize={8}
          formatter={(value) => (
            <span className="text-white/50 font-bold text-[11px] ml-2 capitalize">
              {String(value).replace('Projected ', 'Simulated ').replace(/_/g, ' ')}
            </span>
          )}
        />
        
        <Bar 
          dataKey={yKey} 
          fill={`url(#${barGradient})`} 
          radius={[4, 4, 0, 0]} 
          maxBarSize={32}
          name="Actual Baseline"
        >
          {data.length <= 1000 && data.map((entry, index) => (
            <Cell 
              key={`cell-${index}`} 
              fill={entry.isAnomaly ? '#f43f5e' : `url(#${barGradient})`} 
              stroke={entry.isAnomaly ? '#f43f5e' : 'none'}
              strokeWidth={entry.isAnomaly ? 2 : 0}
            />
          ))}
        </Bar>

        {projectionKey && (
          <Bar 
            dataKey={projectionKey} 
            fill={`url(#${projGradient})`} 
            radius={[4, 4, 0, 0]} 
            maxBarSize={32}
            name="Simulated Projection"
            stroke={CHART_COLORS[3]}
            strokeDasharray="4 4"
            animationDuration={2000}
          />
        )}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
