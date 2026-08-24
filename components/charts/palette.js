'use client';

/**
 * The colour palette a chart draws with.
 *
 * Nine chart components each imported `CHART_COLORS` directly, which made a
 * per-chart palette impossible without threading a prop through every one of
 * them (and through `LazyChart` and `DynamicChart` on the way). A context keeps
 * the components unchanged apart from swapping one import for one hook, and
 * falls back to the default palette when no provider is present — which is what
 * the PDF print route and any bare render get.
 */
import { createContext, useContext, useMemo } from 'react';
import { CHART_COLORS } from '../../lib/constants';

const PaletteCtx = createContext(CHART_COLORS);
/**
 * How a single-series chart spends its palette.
 *
 * 'series' — one colour (a gradient of the first two) for every bar, because
 * the bars are one measure and colour would be saying nothing.
 * 'category' — a colour per bar, for when the categories are the point and the
 * user wants to choose each one.
 */
const ColorByCtx = createContext('series');

/** The colours the current chart should use. Never empty. */
export function usePalette() {
  const palette = useContext(PaletteCtx);
  return palette?.length ? palette : CHART_COLORS;
}

/** Whether this chart paints per category rather than per series. */
export function useColorBy() {
  return useContext(ColorByCtx);
}

/**
 * Scope a palette to a subtree. `colors` may be a partial list — the default
 * palette backfills the rest, so overriding just the first two series does not
 * leave the remaining ones undefined.
 */
export function ChartPalette({ colors, colorBy = 'series', children }) {
  const value = useMemo(() => {
    if (!colors?.length) return CHART_COLORS;
    return CHART_COLORS.map((fallback, i) => colors[i] || fallback);
  }, [colors]);

  return (
    <PaletteCtx.Provider value={value}>
      <ColorByCtx.Provider value={colorBy}>{children}</ColorByCtx.Provider>
    </PaletteCtx.Provider>
  );
}

/**
 * Preset palettes offered in the colour editor. Each is ordered so the first
 * two colours carry the most weight — they are what a single-series bar or a
 * gradient uses.
 */
export const PALETTES = [
  { key: 'default', name: 'Signal', colors: CHART_COLORS },
  {
    key: 'ocean',
    name: 'Ocean',
    colors: ['#0ea5e9', '#22d3ee', '#2dd4bf', '#38bdf8', '#0284c7', '#14b8a6', '#67e8f9', '#0891b2'],
  },
  {
    key: 'ember',
    name: 'Ember',
    colors: ['#f97316', '#f43f5e', '#fbbf24', '#ef4444', '#fb923c', '#e11d48', '#fcd34d', '#dc2626'],
  },
  {
    key: 'forest',
    name: 'Forest',
    colors: ['#10b981', '#84cc16', '#14b8a6', '#4ade80', '#059669', '#a3e635', '#2dd4bf', '#65a30d'],
  },
  {
    key: 'violet',
    name: 'Violet',
    colors: ['#8b5cf6', '#a855f7', '#6366f1', '#c084fc', '#7c3aed', '#818cf8', '#d8b4fe', '#4f46e5'],
  },
  {
    key: 'mono',
    name: 'Mono',
    colors: ['#64748b', '#94a3b8', '#475569', '#cbd5e1', '#334155', '#e2e8f0', '#1e293b', '#f1f5f9'],
  },
];
