'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { ChartPalette } from './palette';

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
export default function LazyChart({ data, type, xKey, yKey, secondaryYKey, colors = null, eager = false }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(eager);

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
        <ChartPalette colors={colors}>
          <DynamicChart data={data} type={type} xKey={xKey} yKey={yKey} secondaryYKey={secondaryYKey} />
        </ChartPalette>
      ) : (
        <ChartSkeleton />
      )}
    </div>
  );
}
