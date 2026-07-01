import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { CHART_COLORS } from '../../lib/constants';
import { formatNumber as yAxisFormatter } from '../../lib/format';

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const entry = payload[0];
    return (
      <div className="bg-slate-950/90 backdrop-blur-xl border border-white/10 p-4 rounded-xl shadow-2xl flex flex-col gap-2 min-w-[180px]">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-1 border-b border-white/5 pb-2">
          {entry.payload?.name || 'Segment'}
        </p>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: entry.payload?.fill || CHART_COLORS[0] }} />
            <span className="text-[11px] font-bold text-white/60 capitalize">
              Value
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

const CustomizedContent = (props) => {
  const { root, depth, x, y, width, height, index, payload, name, value } = props;

  // Map the color based on the index from the constants
  const fill = CHART_COLORS[index % CHART_COLORS.length];

  // Do not render text if the box is too small
  if (width < 40 || height < 20) {
    return <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#020617" strokeWidth={1} />;
  }

  // Adaptive sizing
  const isLarge = width > 120 && height > 80;
  const isMedium = width > 80 && height > 40;
  
  const fontSize = isLarge ? 14 : isMedium ? 11 : 9;
  const maxChars = isLarge ? 25 : isMedium ? 15 : 10;

  const truncate = (str, len) => {
    if (!str) return '';
    return str.length > len ? `${str.substring(0, len - 3)}...` : str;
  };

  const displayName = truncate(name, maxChars);
  const displayValue = yAxisFormatter(value);

  return (
    <g className="group/treemap-cell">
      <rect 
        x={x} 
        y={y} 
        width={width} 
        height={height} 
        fill={fill} 
        stroke="#020617" 
        strokeWidth={1} 
        className="hover:brightness-110 transition-all cursor-pointer"
      />
      
      {/* Label Container */}
      <foreignObject x={x + 4} y={y + 4} width={width - 8} height={height - 8} className="pointer-events-none">
        <div className="w-full h-full flex flex-col items-center justify-center text-center overflow-hidden">
          <span 
            className="font-black uppercase tracking-[0.15em] text-slate-950 drop-shadow-[0_1px_1px_rgba(255,255,255,0.3)] leading-tight"
            style={{ fontSize: `${fontSize}px` }}
          >
            {displayName}
          </span>
          {isMedium && (
            <span 
              className="font-mono font-black text-slate-900/80 drop-shadow-[0_1px_1px_rgba(255,255,255,0.2)] mt-2"
              style={{ fontSize: `${fontSize + 2}px` }}
            >
              {displayValue}
            </span>
          )}
        </div>
      </foreignObject>
    </g>
  );
};

export default function TreemapChart({ data, nameKey, dataKey }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <Treemap
        data={data}
        dataKey={dataKey}
        nameKey={nameKey}
        stroke="#020617"
        content={<CustomizedContent />}
        animationDuration={1500}
      >
        <Tooltip content={<CustomTooltip />} />
      </Treemap>
    </ResponsiveContainer>
  );
}
