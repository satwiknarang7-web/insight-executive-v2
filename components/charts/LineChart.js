import React from 'react';
import { 
  LineChart as RechartsLineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Legend
} from 'recharts';
import { CHART_COLORS } from '../../lib/constants';

const yAxisFormatter = (val) => {
  if (typeof val !== 'number') return val;
  // Show integers for count-like data (no decimals for small integers)
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

export default function LineChart({ data, xKey, yKey }) {
  if (!data || data.length === 0) return null;

  const keys = Object.keys(data[0] || {});
  const projectionKey = keys.find(k => k.startsWith('Projected'));

  // Smart Y-axis domain: use integer ticks for count data
  const yValues = data.map(d => Number(d[yKey])).filter(v => !isNaN(v));
  const maxY = Math.max(...yValues);
  const allIntegers = yValues.every(v => Number.isInteger(v));
  const yDomain = allIntegers && maxY <= 20 ? [0, Math.ceil(maxY * 1.2)] : ['auto', 'auto'];
  const yTickCount = allIntegers && maxY <= 10 ? maxY + 1 : undefined;

  // Adaptive dot size
  const dotSize = data.length <= 5 ? 5 : data.length <= 15 ? 4 : 3;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RechartsLineChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 40 }}>
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
          domain={yDomain}
          width={45}
          allowDecimals={!allIntegers}
          tickCount={yTickCount}
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
        
        <Line 
          type="monotone" 
          dataKey={yKey} 
          stroke={CHART_COLORS[0]} 
          strokeWidth={3} 
          dot={data.length > 500 ? false : { r: dotSize, fill: CHART_COLORS[0], strokeWidth: 2, stroke: '#020617' }} 
          activeDot={{ r: dotSize + 2, strokeWidth: 0 }} 
          name="Actual Baseline"
          animationDuration={1500}
        />

        {projectionKey && (
          <Line 
            type="monotone" 
            dataKey={projectionKey} 
            stroke={CHART_COLORS[3]} 
            strokeWidth={2} 
            strokeDasharray="4 4"
            dot={false}
            name="Simulated Projection"
            animationDuration={2000}
          />
        )}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
