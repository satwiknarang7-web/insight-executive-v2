import React from 'react';
import { 
  RadialBarChart as RechartsRadialBarChart, 
  RadialBar, 
  Legend, 
  ResponsiveContainer, 
  Tooltip,
  PolarAngleAxis
} from 'recharts';
import { CHART_COLORS } from '../../lib/constants';
import { usePalette } from './palette';
import { formatNumber } from '../../lib/format';

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="chart-tooltip border border-white/10 p-4 rounded-xl shadow-2xl flex flex-col gap-2 min-w-[150px]">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-1 border-b border-white/5 pb-2">
          {data.name}
        </p>
        <div className="flex items-center justify-between gap-4">
          <span className="text-[11px] font-bold text-white/60">Value</span>
          <span className="text-[11px] font-black font-mono text-white">
            {formatNumber(data.value)}
          </span>
        </div>
      </div>
    );
  }
  return null;
};

export default function RadialBarChart({ data, nameKey, valueKey }) {
  // Palette for this chart: a per-slide override, or the default.
  const CHART_COLORS = usePalette();
  if (!data || data.length === 0) return null;

  // Transform data for RadialBarChart if necessary
  const chartData = data.map((item, index) => ({
    name: item[nameKey],
    value: item[valueKey],
    fill: CHART_COLORS[index % CHART_COLORS.length],
  })).slice(0, 8); // Limit to 8 for visual clarity

  return (
    <ResponsiveContainer width="100%" height="100%" debounce={120}>
      <RechartsRadialBarChart 
        cx="50%" 
        cy="50%" 
        innerRadius="20%" 
        outerRadius="80%" 
        barSize={10} 
        data={chartData}
        startAngle={180}
        endAngle={-180}
      >
        <PolarAngleAxis
          type="number"
          domain={[0, 'auto']}
          angleAxisId={0}
          tick={false}
        />
        <RadialBar
          minAngle={15}
          background={{ fill: 'rgba(255,255,255,0.05)' }}
          clockWise
          dataKey="value"
          cornerRadius={10}
          animationDuration={450}
        />
        <Legend 
          iconSize={8} 
          layout="vertical" 
          verticalAlign="middle" 
          align="right"
          wrapperStyle={{
            paddingLeft: '40px',
          }}
          formatter={(value) => (
            <span className="text-white/60 font-black text-[10px] ml-2 uppercase tracking-widest">
              {value}
            </span>
          )}
        />
      </RechartsRadialBarChart>
    </ResponsiveContainer>
  );
}
