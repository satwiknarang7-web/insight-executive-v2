import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { CHART_COLORS } from '../../lib/constants';
import { legendProps } from './axis';
import { usePalette, useSeriesColor } from './palette';
import { formatNumber as yAxisFormatter } from '../../lib/format';

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

export default function RadarUIChart({ data, nameKey, compact = false }) {
  const legend = legendProps({ seriesCount: 2, compact });
  // Palette for this chart: a per-slide override, or the default.
  const CHART_COLORS = usePalette();
  const seriesColor = useSeriesColor();
  // Radar charts usually show multiple variables for a single subject or compare subjects across variables.
  // Here we assume data is formatted as [{ subject: 'Math', A: 120, B: 110, fullMark: 150 }, ...]
  const keys = Object.keys(data[0] || {}).filter(k => k !== nameKey && typeof data[0][k] === 'number');

  return (
    <ResponsiveContainer width="100%" height="100%" debounce={120}>
      <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
        <PolarGrid stroke="var(--chart-web)" />
        <PolarAngleAxis dataKey={nameKey} tick={{ fill: 'var(--chart-axis)', fontSize: 12, fontWeight: 700 }} />
        <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={{ fill: 'var(--chart-axis)', fontSize: 12, fontWeight: 700 }} axisLine={false} />
        <Tooltip content={<CustomTooltip />} />
        {legend && (
          <Legend
            {...legend}
            formatter={(value) => (
              <span className="ml-1.5 text-[10px] font-black uppercase tracking-widest text-white/60">
                {String(value).replace(/_/g, ' ')}
              </span>
            )}
          />
        )}
        {keys.map((key, index) => (
          <Radar
            key={key}
            name={key}
            dataKey={key}
            stroke={seriesColor(index)}
            fill={seriesColor(index)}
            fillOpacity={0.3}
            strokeWidth={3}
            animationDuration={450}
          />
        ))}
      </RadarChart>
    </ResponsiveContainer>
  );
}
