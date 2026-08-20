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
  Cell
} from 'recharts';
import { CHART_COLORS } from '../../lib/constants';
import { formatNumber as yAxisFormatter } from '../../lib/format';

const CustomXAxisTick = ({ x, y, payload }) => {
  const value = payload.value;
  // Truncate logic: Max label length at 150px height is roughly 150 / (6 * 0.707) = 35 chars
  const isTruncated = value && String(value).length > 35;
  const displayValue = isTruncated ? `${String(value).substring(0, 32)}...` : value;

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={20}
        textAnchor="middle"
        fill="#94a3b8"
        fontSize={12}
        fontWeight={700}
        textAnchor="middle"
      >
        <title>{value}</title>
        {displayValue}
      </text>
    </g>
  );
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

export default function ComposedDualChart({ data, xKey, yKey, lineKey }) {
  const gradientId = React.useId();
  const composedGradient = `composed-primary-${gradientId}`;
  if (!data || data.length === 0) return null;

  const keys = Object.keys(data[0] || {});
  const actualLineKey = lineKey || keys.find(k => k !== xKey && k !== yKey && typeof data[0][k] === 'number');

  const processedData = data;

  const dynamicXAxisHeight = useMemo(() => {
    if (!processedData || processedData.length === 0) return 30;
    
    let maxLabelLength = 0;
    for (let i = 0; i < processedData.length; i++) {
      const len = String(processedData[i][xKey] || '').length;
      if (len > maxLabelLength) maxLabelLength = len;
    }
    
    const calculatedHeight = (maxLabelLength * 6 * 0.707) + 20; 
    return Math.min(Math.max(calculatedHeight, 30), 150);
  }, [processedData, xKey]);


  return (
    <ResponsiveContainer width="100%" height="100%" debounce={120}>
      <ComposedChart data={processedData} margin={{ top: 20, right: 10, left: 0, bottom: dynamicXAxisHeight - 20 }}>
        <defs>
          <linearGradient id={composedGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={1}/>
            <stop offset="100%" stopColor={CHART_COLORS[1]} stopOpacity={0.6}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff" opacity={0.05} vertical={false} />
        <XAxis 
          dataKey={xKey} 
          axisLine={false} 
          tickLine={false} 
          tick={<CustomXAxisTick />}
          interval="preserveStartEnd" 
          height={dynamicXAxisHeight} 
        />
        <YAxis 
          yAxisId="left"
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 700 }} 
          stroke="#ffffff" 
          opacity={0.3} 
          tickFormatter={yAxisFormatter} 
          domain={['auto', 'auto']}
          width={55}
        />
        <YAxis 
          yAxisId="right" 
          orientation="right" 
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: CHART_COLORS[2], fontSize: 12, fontWeight: 700 }} 
          stroke="#ffffff" 
          opacity={0.3} 
          tickFormatter={yAxisFormatter} 
          domain={['auto', 'auto']}
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
            dot={{ r: 4, fill: CHART_COLORS[2], strokeWidth: 2, stroke: '#020617' }}
            activeDot={{ r: 6, fill: '#fff', stroke: CHART_COLORS[2], strokeWidth: 2 }}
            animationDuration={450}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
