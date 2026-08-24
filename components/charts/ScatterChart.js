import React from 'react';
import { 
  ScatterChart as RechartsScatterChart, 
  Scatter, 
  XAxis, 
  YAxis, 
  ZAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  Legend
} from 'recharts';
import { CHART_COLORS } from '../../lib/constants';
import { usePalette } from './palette';
import { formatNumber as yAxisFormatter } from '../../lib/format';
import { xAxisGeometry, yAxisGeometry, chartMargin } from './axis';

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="chart-tooltip border border-white/10 p-4 rounded-xl shadow-2xl flex flex-col gap-2 min-w-[180px]">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-1 border-b border-white/5 pb-2">
          {data.name || 'Data Point'}
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

export default function ScatterChart({ data, xKey, yKey }) {
  // Palette for this chart: a per-slide override, or the default.
  const CHART_COLORS = usePalette();
  if (!data || data.length === 0) return null;

  const xKeyToUse = xKey || (data[0] ? Object.keys(data[0])[0] : null);
  const yKeyToUse = yKey || (data[0] ? Object.keys(data[0])[1] : null);

  if (!xKeyToUse || !yKeyToUse) return (
    <div className="h-full flex flex-col items-center justify-center text-white/20 gap-2">
      <p className="text-[10px] uppercase tracking-widest font-black text-center">Incomplete Data Schema for Correlation</p>
    </div>
  );

  const xIsNumber = typeof data[0][xKeyToUse] === 'number';
  const yIsNumber = typeof data[0][yKeyToUse] === 'number';
  
  // Optimization: Memoize filtered data
  const { normalData, anomalyData, isTooLargeForCategories } = React.useMemo(() => {
    // If we have categories with huge datasets, we must truncate to prevent browser crash
    const limit = (!xIsNumber || !yIsNumber) ? 500 : Infinity;
    const truncatedData = data.length > limit ? data.slice(0, limit) : data;

    return {
      normalData: truncatedData.filter(d => !d.isAnomaly),
      anomalyData: truncatedData.filter(d => d.isAnomaly),
      isTooLargeForCategories: data.length > limit
    };
  }, [data, xKeyToUse, yKeyToUse, xIsNumber, yIsNumber]);

  // A numeric x axis formats as numbers and needs no rotation; a categorical
  // one gets the same measured treatment as every other chart.
  const xGeo = xIsNumber
    ? { props: {}, bottom: 44 }
    : xAxisGeometry(data, xKeyToUse);
  const yGeo = yAxisGeometry(data, yKeyToUse);

  return (
    <ResponsiveContainer width="100%" height="100%" debounce={120}>
      <RechartsScatterChart margin={chartMargin({ bottom: xGeo.bottom })}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" opacity={0.05} vertical={false} />
        <XAxis
          {...xGeo.props}
          type={xIsNumber ? 'number' : 'category'}
          dataKey={xKeyToUse}
          name={xKeyToUse}
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--chart-axis)', fontSize: 12, fontWeight: 700 }}
          tickFormatter={xIsNumber ? yAxisFormatter : xGeo.props.tickFormatter}
          domain={xIsNumber ? ['auto', 'auto'] : undefined}
          height={xGeo.bottom}
        />
        <YAxis
          {...yGeo.props}
          type={yIsNumber ? 'number' : 'category'}
          dataKey={yKeyToUse}
          name={yKeyToUse}
          domain={yIsNumber ? ['auto', 'auto'] : undefined}
        />
        <ZAxis type="number" range={[60, 400]} />
        <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3', stroke: 'var(--chart-grid)', strokeOpacity: 0.25 }} />
        <Legend 
          verticalAlign="top" 
          align="right"
          height={26}
          wrapperStyle={{ paddingBottom: '6px', paddingRight: '10px' }}
          iconType="circle" 
          iconSize={8}
          formatter={(value) => (
            <span className="text-white/60 font-black text-[10px] ml-2 uppercase tracking-widest">
              {String(value).replace(/_/g, ' ')}
            </span>
          )}
        />
        
        {/* Historical Series - Split for performance on large datasets */}
        {data.length > 1000 && xIsNumber && yIsNumber ? (
          <>
            <Scatter 
              name="Actual Baseline" 
              data={normalData} 
              fill={CHART_COLORS[4]} 
              opacity={0.5} 
            />
            <Scatter 
              name="Anomalies" 
              data={anomalyData} 
              fill="#f43f5e" 
            />
          </>
        ) : (
          <Scatter name="Actual Baseline" data={normalData} fill={CHART_COLORS[4]}>
            {normalData.length <= 1000 && normalData.map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={CHART_COLORS[index % CHART_COLORS.length]} 
                opacity={0.7}
              />
            ))}
            {anomalyData.map((entry, index) => (
              <Cell 
                key={`anomaly-${index}`} 
                fill="#f43f5e" 
                stroke="#f43f5e"
                strokeWidth={4}
                opacity={1}
              />
            ))}
          </Scatter>
        )}

        {isTooLargeForCategories && (
          <text x="50%" y="50%" textAnchor="middle" fill="var(--chart-axis)" fontSize="12" dy="-20">
            Dataset too large for categorical correlation. Showing top 500 points.
          </text>
        )}
      </RechartsScatterChart>
    </ResponsiveContainer>
  );
}
