import React from 'react';
import { AreaChart as RechartsAreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { CHART_COLORS } from '../../lib/constants';

const yAxisFormatter = (val) => {
  if (typeof val !== 'number') return val;
  const formattedNum = Math.abs(val) >= 1000000 ? (val / 1000000).toFixed(1) + 'M' : 
                       Math.abs(val) >= 1000 ? (val / 1000).toFixed(1) + 'K' : 
                       Number(val.toFixed(2));
  return formattedNum;
};

const truncateTick = (tick) => {
  if (typeof tick !== 'string') return tick;
  return tick.length > 15 ? `${tick.substring(0, 12)}...` : tick;
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
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: entry.color || entry.stroke }} />
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

export default function AreaChart({ data, xKey, yKey }) {
  const gradientId = React.useId();
  const primaryGradient = `area-primary-${gradientId}`;
  const projGradient = `area-proj-${gradientId}`;
  if (!data || data.length === 0) return null;

  // Identify projected data points
  const projectionKey = Object.keys(data[0] || {}).find(k => k.startsWith('Projected'));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RechartsAreaChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 40 }}>
        <defs>
          <linearGradient id={primaryGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={CHART_COLORS[1]} stopOpacity={0.6}/>
            <stop offset="95%" stopColor={CHART_COLORS[1]} stopOpacity={0.05}/>
          </linearGradient>
          <linearGradient id={projGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#FBBF24" stopOpacity={0.4}/>
            <stop offset="95%" stopColor="#FBBF24" stopOpacity={0.05}/>
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
          height={80}
        />
        <YAxis 
          domain={['auto', 'auto']}
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }} 
          tickFormatter={yAxisFormatter} 
          width={45}
        />
        <Tooltip content={<CustomTooltip />} />
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
        
        {/* Baseline Area */}
        <Area 
          type="monotone" 
          dataKey={yKey} 
          stroke={CHART_COLORS[1]} 
          strokeWidth={3} 
          fill={`url(#${primaryGradient})`} 
          dot={data.length > 500 ? false : { r: 3, fill: CHART_COLORS[1], strokeWidth: 2, stroke: '#020617' }} 
          activeDot={{ r: 6, fill: '#fff', stroke: CHART_COLORS[1], strokeWidth: 2 }} 
          name="Actual Baseline"
          animationDuration={1500}
        />

        {/* Projected Area */}
        {projectionKey && (
          <Area 
            type="monotone" 
            dataKey={projectionKey} 
            stroke="#FBBF24" 
            strokeWidth={2} 
            strokeDasharray="5 5"
            fill={`url(#${projGradient})`} 
            dot={false}
            name="Projected Scenario"
            animationDuration={2000}
          />
        )}
      </RechartsAreaChart>
    </ResponsiveContainer>
  );
}
