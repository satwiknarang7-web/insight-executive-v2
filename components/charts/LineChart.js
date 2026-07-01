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

export default function LineChart({ data, xKey, yKey }) {
  if (!data || data.length === 0) return null;

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
          domain={yDomain}
          width={55}
          allowDecimals={!allIntegers}
          tickCount={yTickCount}
        />
        <Tooltip content={<CustomTooltip />} />
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
        
        <Line 
          type="monotone" 
          dataKey={yKey} 
          stroke={CHART_COLORS[0]} 
          strokeWidth={4} 
          dot={data.length > 200 ? false : { r: dotSize, fill: CHART_COLORS[0], strokeWidth: 2, stroke: '#020617' }} 
          activeDot={{ r: dotSize + 2, strokeWidth: 0, fill: '#fff', stroke: CHART_COLORS[0] }} 
          name="Actual Baseline"
          animationDuration={1500}
        />
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
