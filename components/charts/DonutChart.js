import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, Label } from 'recharts';
import { CHART_COLORS } from '../../lib/constants';
import { legendProps } from './axis';
import { usePalette, useSeriesColor } from './palette';
import { labelledSlices } from '../../lib/sliceLabels';
import { formatNumber as yAxisFormatter, formatValue } from '../../lib/format';

/**
 * The ring, and the room around it.
 *
 * A donut on a dashboard is drawn at whatever size the tile it landed in has,
 * and the tiles are not all the same shape. The numbers below are what keeps
 * one readable at every one of them.
 *
 * **The margin is small.** It was 20px on every side, which is breathing room
 * on a 400px square and 38% of the height of a tile 104px tall — a ring with
 * two-thirds of its height spent on margin and legend has no radius left, and
 * at the bottom of that scale Recharts drew no sectors at all. The room the
 * labels need is taken out of the radius instead, where it is proportional.
 *
 * **The labels sit at a ratio of the ring, not a fixed distance from it.** They
 * were placed 20px outside the arc whatever the arc measured. On a big chart
 * that is a comfortable gap; on a small one it is further than the whole
 * remaining plot, so every label landed outside the circle, on top of the
 * legend and on top of the other labels. `outerRadius` is 80% of the radius
 * available, so the band outside the arc is a quarter of it and this puts the
 * text in the middle of that band, at every size.
 */
const MARGIN = { top: 6, bottom: 6, left: 16, right: 16 };

/** Where a label sits, as a multiple of the arc it belongs to. */
const LABEL_RADIUS_RATIO = 1.125;

/**
 * Under this radius, nothing is written outside the ring.
 *
 * Half the band outside the arc is `0.125 × outerRadius`, and a line of 11px
 * text needs about 6 of those pixels above and below its baseline. Below this
 * the label would have to sit outside the plot to be drawn at all — so the ring
 * keeps the whole tile, and the slices are named by the legend and the tooltip,
 * which is what they are there for.
 */
const MIN_LABELLED_RADIUS = 46;

/** And under this there is no room in the hole for the total. */
const MIN_CENTRED_RADIUS = 58;

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const entry = payload[0];
    return (
      <div className="chart-tooltip border border-white/10 p-4 rounded-xl shadow-2xl flex flex-col gap-2 min-w-[180px]">
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

export default function DonutChart({
  data,
  nameKey,
  valueKey,
  variant = 'donut',
  compact = false,
  // Cross-filtering: a slice is a category, so a click on one is a filter.
  onSelect = null,
  selected = null,
}) {
  // Required: on a share chart the colour is the only name a slice has, so the
  // legend survives a compact tile where a bar chart's would not.
  const legend = legendProps({ seriesCount: (data || []).length, compact, required: true });
  const solid = variant === 'pie';
  // Palette for this chart: a per-slide override, or the default.
  const CHART_COLORS = usePalette();
  const seriesColor = useSeriesColor();

  /**
   * How big the ring is going to be, worked out the way Recharts will.
   *
   * The label decisions all depend on it — whether there is room to letter the
   * slices at all, and how far apart two labels would land — and none of that
   * can be answered from a percentage. `ResponsiveContainer` knows the box but
   * does not hand it down, so it is measured here.
   *
   * An estimate, deliberately: the ring is still drawn from percentages, so
   * Recharts owns the geometry and this only decides what is written beside it.
   * A few pixels out moves a threshold slightly; it cannot misplace an arc.
   */
  const boxRef = useRef(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const measured = box.width > 0 && box.height > 0;
  const outerRadius = useMemo(() => {
    const plotWidth = box.width - MARGIN.left - MARGIN.right;
    const plotHeight = box.height - MARGIN.top - MARGIN.bottom - (legend?.height || 0);
    return Math.max(0, Math.min(plotWidth, plotHeight) / 2) * 0.8;
  }, [box.width, box.height, legend?.height]);

  /**
   * Room outside the ring for a line of text, and room inside it for the total.
   *
   * Unmeasured — no `ResizeObserver`, a first paint, a test renderer — both are
   * allowed. The thresholds exist to stop a cramped chart writing on itself,
   * and a chart whose size is unknown is not known to be cramped; refusing to
   * label one would make the missing observer the reason a full-page donut had
   * no numbers on it.
   */
  const showLabels = !measured || outerRadius >= MIN_LABELLED_RADIUS;
  const showTotal = !solid && (!measured || outerRadius >= MIN_CENTRED_RADIUS);

  // Which slices have room for a number beside them. Past about ten categories
  // the thin ones bunch up at one end of the circle and their labels overprint
  // each other; the ones that go unlabelled keep their colour, their legend
  // entry and their tooltip. Measured at the radius the labels will really sit
  // at — against a fixed guess, a small ring's labels were tested for
  // collisions they were far too close together to have.
  const labelled = useMemo(
    () => {
      if (!showLabels) return new Set();
      const values = (data || []).map((row) => row?.[valueKey]);
      // Unmeasured, `labelledSlices` keeps its own default radius.
      return measured
        ? labelledSlices(values, { radius: outerRadius * LABEL_RADIUS_RATIO })
        : labelledSlices(values);
    },
    [data, valueKey, showLabels, measured, outerRadius]
  );

  /**
   * Leader lines: all of them, or none.
   *
   * `labelLine` takes a props object or a boolean. It does NOT take a function
   * returning a props object — Recharts reads a function there as a render prop
   * and renders whatever comes back as a child, so returning `{ stroke, ... }`
   * threw "Objects are not valid as a React child" and took the whole chart
   * down with it. Per-slice control has to come from the `label` renderer,
   * which really is a render prop, so this stays all-or-nothing: lines when
   * every slice is labelled, and none once the crowded ones have been dropped,
   * where the remaining labels sit beside the few big arcs anyway.
   */
  const everySliceLabelled = labelled.size > 0 && labelled.size === (data?.length || 0);
  return (
    <div ref={boxRef} className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%" debounce={120}>
        <PieChart margin={MARGIN}>
          <Pie
            // The click handler belongs on the series, not on the Cell.
            //
            // A Cell's props reach the rendered shape, but Recharts routes
            // pointer events through its own layer: an `onClick` on a Cell is
            // simply never called, which is a silent failure rather than an
            // error — the bar highlights, the cursor is a pointer, and nothing
            // happens. The series-level handler is given the datum that was
            // clicked, which is what a filter needs anyway.
            onClick={onSelect ? (entry) => onSelect(entry?.payload?.[nameKey] ?? entry?.[nameKey]) : undefined}
            cursor={onSelect ? 'pointer' : undefined}
            // One duration across the filterable charts, so a filter looks like
            // one movement rather than each tile easing at its own speed.
            // Recharts interpolates from the bars that were there, which is what
            // makes a filter readable: the height that changed is the answer.
            animationBegin={0}
            animationDuration={420}
            animationEasing="ease-out"
            data={data}
            dataKey={valueKey}
            nameKey={nameKey}
            cx="50%" 
            cy="50%" 
            innerRadius={solid ? 0 : '60%'}
            outerRadius="80%"
            paddingAngle={solid ? 1 : 5}
            stroke="none"
            labelLine={
              everySliceLabelled
                ? { stroke: 'var(--chart-grid)', strokeOpacity: 0.25, strokeWidth: 1 }
                : false
            }
            label={({ cx, cy, midAngle, outerRadius: arc, value, name, index }) => {
              // A slice with no room for a label draws none, rather than one on
              // top of its neighbour's.
              if (!labelled.has(index)) return null;

              const RADIAN = Math.PI / 180;
              // From the arc Recharts actually drew, so the text lands in the
              // band outside it however small the ring came out.
              const radius = arc * LABEL_RADIUS_RATIO;
              const xPos = cx + radius * Math.cos(-midAngle * RADIAN);
              const yPos = cy + radius * Math.sin(-midAngle * RADIAN);

              const displayValue = formatValue(value, name);

              return (
                <text
                  x={xPos}
                  y={yPos}
                  fill="var(--chart-label)"
                  textAnchor={xPos > cx ? 'start' : 'end'}
                  dominantBaseline="central"
                  style={{ filter: 'drop-shadow(var(--chart-label-halo))' }}
                  className="text-[11px] font-black tracking-widest"
                >
                  {displayValue}
                </text>
              );
            }}
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={seriesColor(index)}
                opacity={selected == null || String(entry?.[nameKey]) === String(selected) ? 1 : 0.28}
                className="hover:brightness-110 transition-all cursor-pointer"
              />
            ))}
            <Label
              position="center"
              content={({ viewBox }) => {
                // A ring whose hole is smaller than the number would be a number
                // with the ring drawn through it.
                if (!showTotal) return null;
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
          {legend && (
            <Legend
              {...legend}
              formatter={(value) => (
                <span className="ml-1.5 text-[11px] font-bold capitalize text-white/50">
                  {String(value).replace(/_/g, ' ')}
                </span>
              )}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
