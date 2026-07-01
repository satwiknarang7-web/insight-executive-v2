import React from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, Label } from 'recharts';
import { CHART_COLORS } from '../../lib/constants';
import { formatNumber as yAxisFormatter, formatValue } from '../../lib/format';

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const entry = payload[0];
    return (
      <div className="bg-slate-950/90 backdrop-blur-xl border border-white/10 p-4 rounded-xl shadow-2xl flex flex-col gap-2 min-w-[180px]">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-1 border-b border-white/5 pb-2">
          {entry.name}
        </p>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: entry.payload?.fill || CHART_COLORS[0] }} />
            <span className="text-[11px] font-bold text-white/60 capitalize">
              {String(entry.name).replace(/_/g, ' ')}
            </span>
          </div>
          <span className="text-[11px] font-black font-mono text-white">
            {yAxisFormatter(entry.value)}
          </span>
        </div>
      </div>
    );
  }
  return null;
};

export default function DonutChart({ data, nameKey, valueKey }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart margin={{ top: 20, bottom: 20, left: 20, right: 20 }}>
        <Pie 
          data={data} 
          dataKey={valueKey} 
          nameKey={nameKey} 
          cx="50%" 
          cy="50%" 
          innerRadius="60%" 
          outerRadius="80%" 
          paddingAngle={5} 
          stroke="none"
          labelLine={{ stroke: 'rgba(255, 255, 255, 0.2)', strokeWidth: 1 }}
          label={({ cx, cy, midAngle, outerRadius, value, name }) => {
            const RADIAN = Math.PI / 180;
            const radius = outerRadius + 20; 
            const xPos = cx + radius * Math.cos(-midAngle * RADIAN);
            const yPos = cy + radius * Math.sin(-midAngle * RADIAN);

            const displayValue = formatValue(value, name);

            return (
              <text 
                x={xPos} 
                y={yPos} 
                fill="#ffffff" 
                textAnchor={xPos > cx ? 'start' : 'end'} 
                dominantBaseline="central" 
                className="text-[11px] font-black tracking-widest drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)]"
              >
                {displayValue}
              </text>
            );
          }}
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} className="hover:brightness-110 transition-all cursor-pointer" />
          ))}
          <Label
            position="center"
            content={({ viewBox }) => {
              const { cx, cy } = viewBox || {};
              if (cx == null || cy == null) return null;
              const total = data.reduce((acc, curr) => acc + (Number(curr[valueKey]) || 0), 0);
              return (
                <g>
                  <text x={cx} y={cy - 6} textAnchor="middle" dominantBaseline="middle" className="fill-white font-black text-2xl drop-shadow-[0_4px_12px_rgba(45,212,191,0.4)]">
                    {yAxisFormatter(total)}
                  </text>
                  <text x={cx} y={cy + 16} textAnchor="middle" dominantBaseline="middle" className="fill-white/40 font-black text-[9px] uppercase tracking-[0.3em]">
                    Total
                  </text>
                </g>
              );
            }}
          />
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend 
          layout="vertical" 
          verticalAlign="middle" 
          align="right"
          iconType="circle" 
          iconSize={8}
          wrapperStyle={{ paddingLeft: '20px', lineHeight: '2.2em' }}
          formatter={(value) => (
            <span className="text-white/50 font-bold text-[11px] ml-2 capitalize">
              {String(value).replace(/_/g, ' ')}
            </span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
