import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { CHART_COLORS } from '../../lib/constants';

const yAxisFormatter = (val) => {
  if (typeof val !== 'number') return val;
  const formattedNum = Math.abs(val) >= 1000000 ? (val / 1000000).toFixed(1) + 'M' : 
                       Math.abs(val) >= 1000 ? (val / 1000).toFixed(1) + 'K' : 
                       Number(val.toFixed(2));
  return formattedNum;
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

export default function RadarUIChart({ data, nameKey }) {
  // Radar charts usually show multiple variables for a single subject or compare subjects across variables.
  // Here we assume data is formatted as [{ subject: 'Math', A: 120, B: 110, fullMark: 150 }, ...]
  const keys = Object.keys(data[0] || {}).filter(k => k !== nameKey && typeof data[0][k] === 'number');

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
        <PolarGrid stroke="#ffffff" opacity={0.05} />
        <PolarAngleAxis dataKey={nameKey} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }} />
        <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} />
        <Tooltip content={<CustomTooltip />} />
        <Legend 
          verticalAlign="top" 
          align="right"
          wrapperStyle={{ paddingBottom: '20px', paddingRight: '10px' }}
          iconType="circle" 
          iconSize={8}
          formatter={(value) => (
            <span className="text-white/40 font-black uppercase tracking-[0.2em] text-[9px] ml-2">
              {String(value).replace(/_/g, ' ')}
            </span>
          )}
        />
        {keys.map((key, index) => (
          <Radar
            key={key}
            name={key}
            dataKey={key}
            stroke={CHART_COLORS[index % CHART_COLORS.length]}
            fill={CHART_COLORS[index % CHART_COLORS.length]}
            fillOpacity={0.2}
          />
        ))}
      </RadarChart>
    </ResponsiveContainer>
  );
}
