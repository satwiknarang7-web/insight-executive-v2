'use client';

/**
 * A bar chart lying on its side.
 *
 * Not a cosmetic variant: a vertical column chart gives every category the same
 * narrow slot regardless of how long its name is, so "Enterprise — North
 * America" has to be rotated or cut. Turning the chart sideways gives labels a
 * whole row each, which is why this is the right default for ranked categories
 * with real names, and the column chart is right for time.
 */
import { Bar, BarChart, CartesianGrid, Cell, Label, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usePalette, useColorBy } from './palette';
import { formatNumber } from '../../lib/format';
import { chartMargin, clip, prettyLabel, axisTitleProps, legendProps } from './axis';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip flex min-w-[180px] flex-col gap-2 rounded-xl border border-white/10 p-4 shadow-2xl">
      <p className="mb-1 border-b border-white/5 pb-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
        {label}
      </p>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[11px] font-bold capitalize text-white/60">
          {String(payload[0].name).replace(/_/g, ' ')}
        </span>
        <span className="font-mono text-[11px] font-black text-white">{formatNumber(payload[0].value)}</span>
      </div>
    </div>
  );
};

/** Room for the longest category name, capped so one outlier cannot eat the plot. */
function categoryGutter(data, key) {
  const longest = (data || []).reduce((max, row) => Math.max(max, String(row?.[key] ?? '').length), 0);
  return Math.min(200, Math.max(70, Math.ceil(Math.min(longest, 26) * 6.9) + 16));
}

export default function HorizontalBarChart({
  data,
  xKey,
  yKey,
  xLabel,
  yLabel,
  compact = false,
  // One bar per legend value, grouped against each category.
  seriesKeys = null,
}) {
  const CHART_COLORS = usePalette();
  const perCategory = useColorBy() === 'category';
  if (!data?.length) return null;

  const split = Array.isArray(seriesKeys) && seriesKeys.length > 0;
  const gutter = categoryGutter(data, xKey);
  // The axes swap roles here: the category runs down the Y axis and the measure
  // along the X, so the titles swap with them.
  const categoryTitle = axisTitleProps(xLabel ?? prettyLabel(xKey), { axis: 'y' });
  const measureTitle = axisTitleProps(yLabel ?? prettyLabel(yKey), { axis: 'x' });

  return (
    <ResponsiveContainer width="100%" height="100%" debounce={120}>
      <BarChart
        data={data}
        layout="vertical"
        margin={chartMargin({ right: 24 })}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--chart-grid)"
          strokeOpacity="var(--chart-grid-opacity)"
          horizontal={false}
        />
        <XAxis
          type="number"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--chart-axis)', fontSize: 12, fontWeight: 700 }}
          tickFormatter={formatNumber}
          height={measureTitle ? 46 : 24}
        >
          {measureTitle && <Label {...measureTitle} />}
        </XAxis>
        <YAxis
          type="category"
          dataKey={xKey}
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontWeight: 700 }}
          tickFormatter={(v) => clip(v, 26)}
          width={gutter + (categoryTitle ? 22 : 0)}
          interval={0}
        >
          {categoryTitle && <Label {...categoryTitle} />}
        </YAxis>
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--veil)' }} />
        {split && <Legend {...legendProps({ seriesCount: seriesKeys.length, compact })} />}
        {split ? (
          seriesKeys.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              name={key}
              fill={CHART_COLORS[index % CHART_COLORS.length]}
              radius={[0, 4, 4, 0]}
              maxBarSize={compact ? 14 : 20}
            />
          ))
        ) : (
        <Bar dataKey={yKey} name={yKey} radius={[0, 6, 6, 0]} maxBarSize={compact ? 18 : 26}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={
                entry.isAnomaly
                  ? '#f43f5e'
                  : perCategory
                  ? CHART_COLORS[i % CHART_COLORS.length]
                  : CHART_COLORS[0]
              }
            />
          ))}
        </Bar>
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
