'use client';

/**
 * A waterfall: how a running total got from its first value to its last.
 *
 * Recharts has no waterfall, and it does not need one — the trick is two
 * stacked bars per row, where the lower one is invisible and exists only to
 * float the visible one at the right height. That is the whole implementation.
 *
 * The contribution of each step is what is drawn, so the input is read as a
 * sequence of *changes*: a column of deltas if the values look like deltas
 * (they contain negatives), and otherwise the period-on-period difference of a
 * running series. A final "Total" bar, anchored back at zero, closes it.
 */
import { Bar, BarChart, CartesianGrid, Cell, Label, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usePalette } from './palette';
import { formatNumber } from '../../lib/format';
import { chartMargin, prettyLabel, xAxisGeometry, yAxisGeometry } from './axis';
import { buildWaterfall } from '../../lib/waterfall';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="chart-tooltip flex min-w-[190px] flex-col gap-1.5 rounded-xl border border-white/10 p-4 shadow-2xl">
      <p className="mb-1 border-b border-white/5 pb-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
        {label}
      </p>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[11px] font-bold text-white/60">{row.kind === 'total' ? 'Total' : 'Change'}</span>
        <span className="font-mono text-[11px] font-black text-white">
          {row.signed >= 0 ? '+' : '−'}
          {formatNumber(Math.abs(row.signed))}
        </span>
      </div>
      {row.kind !== 'total' && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-[11px] font-bold text-white/60">Running total</span>
          <span className="font-mono text-[11px] font-black text-white/70">{formatNumber(row.cumulative)}</span>
        </div>
      )}
    </div>
  );
};

const TONE = {
  gain: 'var(--color-emerald-400)',
  loss: 'var(--color-rose-400)',
};

export default function WaterfallChart({ data, xKey, yKey, xLabel, yLabel, compact = false, dense = false }) {
  const CHART_COLORS = usePalette();
  if (!data?.length) return null;

  const rows = buildWaterfall(data, xKey, yKey);
  const x = xAxisGeometry(rows, xKey, { compact, dense, title: xLabel ?? prettyLabel(xKey) });
  const y = yAxisGeometry(rows, 'cumulative', {
    compact,
    dense, title: yLabel ?? prettyLabel(yKey) });

  return (
    <ResponsiveContainer width="100%" height="100%" debounce={120}>
      <BarChart data={rows} margin={chartMargin()} stackOffset="sign">
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--chart-grid)"
          strokeOpacity="var(--chart-grid-opacity)"
          vertical={false}
        />
        {!x.hidden && (

          <XAxis {...x.props}>{x.title && <Label {...x.title} />}</XAxis>

        )}
        <YAxis {...y.props}>{y.title && <Label {...y.title} />}</YAxis>
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--veil)' }} />
        {/* The pedestal. Present only to lift the bar above it. */}
        <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="delta" stackId="w" radius={[4, 4, 0, 0]} maxBarSize={44}>
          {rows.map((row, i) => (
            <Cell key={i} fill={row.kind === 'total' ? CHART_COLORS[0] : TONE[row.kind]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
