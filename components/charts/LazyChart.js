'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { ChartPalette } from './palette';
import { renameCategories } from '../../lib/chartLabels';

// Recharts is ~120KB of the client bundle. Loading it on demand keeps the
// upload page, the data table and the quality report free of it entirely.
const DynamicChart = dynamic(() => import('./DynamicChart'), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

function ChartSkeleton() {
  return (
    <div className="flex h-full w-full items-end gap-2 p-4" aria-hidden>
      {[45, 70, 35, 85, 55, 65].map((h, i) => (
        <div key={i} className="flex-1 animate-pulse rounded-t bg-white/5" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

/**
 * Mounts a chart only once it is scrolled near the viewport. A dashboard with
 * eight charts otherwise builds eight full SVG trees on first paint, which is
 * the single most expensive thing on the page.
 */
/**
 * The height below which a chart drops its category axis to keep its plot.
 *
 * Two hundred pixels is roughly a card title, an axis gutter and enough plot to
 * read a shape from. Below it something has to give, and the labels are the
 * part already written above the chart.
 */
const DENSE_BELOW = 200;

export default function LazyChart({
  data,
  type,
  xKey,
  yKey,
  secondaryYKey,
  seriesKey = null,
  seriesSort = 'value-desc',
  colors = null,
  labels = null,
  colorBy = 'series',
  eager = false,
  xLabel = null,
  yLabel = null,
  compact = false,
}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(eager);

  /**
   * How much room this chart actually got.
   *
   * The slide cannot know: it lays out a grid and the tile is whatever is left
   * after the header, the cards and the scorecard have taken theirs. So the
   * chart measures its own box and drops what will not fit — below about two
   * hundred pixels the category labels go, because a plot with no area is not a
   * chart and a card titled "Total Amount by Category" has already named them.
   *
   * Measured rather than passed down, so every caller gets it: the dashboard
   * grid, the report page, a thumbnail in a list, and any future one.
   */
  const [dense, setDense] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setDense(el.clientHeight > 0 && el.clientHeight < DENSE_BELOW);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Renaming happens here rather than at each call site so the axis, the legend
  // and the tooltip all show the user's wording from one place.
  const shown = useMemo(() => renameCategories(data, xKey, labels), [data, xKey, labels]);

  useEffect(() => {
    if (eager || visible) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [eager, visible]);

  if (!data || data.length === 0) {
    return (
      <div ref={ref} className="flex h-full flex-col items-center justify-center gap-3 text-white/20">
        <Activity size={28} strokeWidth={1.2} />
        <p className="text-[10px] font-black uppercase tracking-[0.25em]">No data points</p>
      </div>
    );
  }

  return (
    <div ref={ref} className="h-full w-full">
      {visible ? (
        <ChartPalette colors={colors} colorBy={colorBy}>
          <DynamicChart
            data={shown}
            type={type}
            xKey={xKey}
            yKey={yKey}
            secondaryYKey={secondaryYKey}
            dense={dense}
            seriesKey={seriesKey}
            seriesSort={seriesSort}
            xLabel={xLabel}
            yLabel={yLabel}
            compact={compact}
          />
        </ChartPalette>
      ) : (
        <ChartSkeleton />
      )}
    </div>
  );
}
