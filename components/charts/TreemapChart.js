import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { CHART_COLORS } from '../../lib/constants';

const yAxisFormatter = (val) => {
  if (typeof val !== 'number') return val;
  const formattedNum = Math.abs(val) >= 1000000 ? (val / 1000000).toFixed(1) + 'M' : 
                       Math.abs(val) >= 1000 ? (val / 1000).toFixed(1) + 'K' : 
                       Number(val.toFixed(2));
  return formattedNum;
};

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
  const { root, depth, x, y, width, height, index, payload, name } = props;

  // Map the color based on the index from the constants
  const fill = CHART_COLORS[index % CHART_COLORS.length];

  // Do not render text if the box is too small
  if (width < 50 || height < 20) {
    return <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#020617" strokeWidth={1} />;
  }

  // More aggressive truncation and adaptive font size
  const isLarge = width > 150 && height > 60;
  const isMedium = width > 100 && height > 40;
  
  let fontSize = 11;
  let maxChars = 15;
  
  if (!isLarge) {
    fontSize = 9;
    maxChars = 10;
  }
  if (!isMedium) {
    fontSize = 8;
    maxChars = 6;
  }

  const displayName = name && name.length > maxChars 
    ? name.substring(0, maxChars - 3) + '...' 
    : name;

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#020617" strokeWidth={1} />
      {width > 30 && height > 15 && (
        <text 
          x={x + width / 2} 
          y={y + height / 2 + (fontSize / 3)} 
          textAnchor="middle" 
          fill="#020617" 
          fontSize={fontSize} 
          fontWeight="bold"
          className="uppercase tracking-tighter"
        >
          {displayName}
        </text>
      )}
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
        isAnimationActive={false}
      >
        <Tooltip content={<CustomTooltip />} />
      </Treemap>
    </ResponsiveContainer>
  );
}
