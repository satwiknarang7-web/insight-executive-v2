import React from 'react';
import { AreaChart as RechartsAreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Label, Legend } from 'recharts';
import { formatNumber as yAxisFormatter, formatAxisLabel } from '../../lib/format';
import { xAxisGeometry, yAxisGeometry, chartMargin, prettyLabel, legendProps } from './axis';
import { usePalette, useSeriesColor } from './palette';
import { isAdditiveMeasure } from '../../lib/insightEngine';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="chart-tooltip border border-accent-500/20 px-4 py-3 rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.6)] flex flex-col gap-2 min-w-[170px]">
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-accent-400/80 mb-0.5">
          {formatAxisLabel(label)}
        </p>
        <div className="flex flex-col gap-1.5">
          {payload.map((entry, index) => (
            <div key={index} className="flex items-center justify-between gap-5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color || entry.stroke, boxShadow: `0 0 8px ${entry.color || entry.stroke}` }} />
                <span className="text-[11px] font-semibold text-white/50 capitalize">{entry.name.replace(/_/g, ' ')}</span>
              </div>
              <span className="text-[12px] font-black font-mono text-white">{yAxisFormatter(entry.value)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export default function AreaChart({
  data,
  xKey,
  yKey,
  xLabel,
  yLabel,
  compact = false,
  // Set when the tile is too short for a full axis; see xAxisGeometry.
  dense = false,
  // Split by a legend the areas stack, because the thing worth reading off a
  // split area chart is the total and how its mix changes underneath — but
  // only where a total means anything. See `stack` below.
  seriesKeys = null,
}) {
  // Palette for this chart: a per-slide override, or the default.
  const CHART_COLORS = usePalette();
  const seriesColor = useSeriesColor();
  const id = React.useId();
  const fillId = `area-fill-${id}`;
  if (!data || data.length === 0) return null;

  const x = xAxisGeometry(data, xKey, { compact, dense, title: xLabel ?? prettyLabel(xKey) });
  const split = Array.isArray(seriesKeys) && seriesKeys.length > 0;
  // Stacking is addition drawn on a screen, so it is only legitimate when the
  // measure adds up. "Average Price by Month, split by Region" stacked four
  // averages into a band whose height is a quantity that does not exist — the
  // same mistake `pipeline.enforceChartDiversity` already refuses to make when
  // it gates share charts on `isAdditiveMeasure`. A non-additive split is drawn
  // as overlapping bands instead, which compares the series without inventing
  // a total.
  const stack = split && isAdditiveMeasure(yKey);
  const y = yAxisGeometry(data, split ? seriesKeys : yKey, {
    compact,
    dense,
    title: yLabel ?? prettyLabel(yKey),
  });

  return (
    <ResponsiveContainer width="100%" height="100%" debounce={120}>
      <RechartsAreaChart data={data} margin={chartMargin({ right: 18 })}>
        <defs>
          {/*
            * One hue, fading out. The fill used to run slot 0 into slot 1 and
            * the stroke slot 0 into slot 2, so a single series wore three
            * categorical identities — the colours that are supposed to tell
            * one series from another, spent on one. A fade to transparent
            * under the line is the conventional area fill; the hue does not
            * change along the way.
            */}
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.28} />
            <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--chart-grid)" strokeOpacity="var(--chart-grid-opacity)" vertical={false} />
        {!x.hidden && (

          <XAxis {...x.props} tickMargin={10}>{x.title && <Label {...x.title} />}</XAxis>

        )}
        <YAxis {...y.props} domain={['auto', 'auto']} tickMargin={8}>{y.title && <Label {...y.title} />}</YAxis>
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: CHART_COLORS[0], strokeWidth: 1, strokeDasharray: '4 4', strokeOpacity: 0.4 }} />
        {split && <Legend {...legendProps({ seriesCount: seriesKeys.length, compact })} />}

        {split ? (
          seriesKeys.map((key, index) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={key}
              stackId={stack ? 'series' : undefined}
              stroke={seriesColor(index)}
              strokeWidth={2}
              fill={seriesColor(index)}
              fillOpacity={stack ? 0.35 : 0.18}
              dot={false}
              animationDuration={450}
            />
          ))
        ) : (
        <Area
          type="monotone"
          dataKey={yKey}
          stroke={CHART_COLORS[0]}
          strokeWidth={2}
          fill={`url(#${fillId})`}
          dot={false}
          activeDot={{ r: 5, fill: 'var(--chart-label)', stroke: CHART_COLORS[0], strokeWidth: 3 }}
          name="Actual Baseline"
          animationDuration={450}
          animationEasing="ease-out"
        />
        )}
      </RechartsAreaChart>
    </ResponsiveContainer>
  );
}
