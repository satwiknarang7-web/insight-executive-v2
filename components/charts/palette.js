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
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_PALETTE, paletteFor, seriesColor as pickColor } from '../../lib/chartPalette';

const PaletteCtx = createContext(null);
const ModeCtx = createContext('dark');

/**
 * Which surface the charts are being drawn on.
 *
 * The palette is stepped per surface — the same eight hues, lightened or
 * darkened to stay inside the readable band and to keep 3:1 against the
 * background. A single set of hexes cannot do both, so the theme has to reach
 * the chart, and the theme lives in an attribute on <html> rather than in
 * React. Observed rather than read once, so switching theme repaints the
 * charts instead of leaving them coloured for the surface they are no longer on.
 */
function useThemeMode() {
  const [mode, setMode] = useState('dark');

  useEffect(() => {
    const read = () =>
      setMode(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return mode;
}
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
  const mode = useContext(ModeCtx);
  return palette?.length ? palette : paletteFor('default', mode);
}

/** Which surface the current chart is on: 'light' or 'dark'. */
export function usePaletteMode() {
  return useContext(ModeCtx);
}

/**
 * The colour for series `index` — the neutral once the palette runs out.
 *
 * Every chart used to write `COLORS[i % COLORS.length]`, which meant series one
 * and series nine were drawn the same colour while the legend insisted they
 * were different things. This never repeats.
 */
export function useSeriesColor() {
  const palette = usePalette();
  const mode = useContext(ModeCtx);
  return useMemo(() => (index) => pickColor(palette, index, mode), [palette, mode]);
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
  const mode = useThemeMode();
  const value = useMemo(() => {
    const base = paletteFor('default', mode);
    if (!colors?.length) return base;
    return base.map((fallback, i) => colors[i] || fallback);
  }, [colors, mode]);

  return (
    <ModeCtx.Provider value={mode}>
      <PaletteCtx.Provider value={value}>
        <ColorByCtx.Provider value={colorBy}>{children}</ColorByCtx.Provider>
      </PaletteCtx.Provider>
    </ModeCtx.Provider>
  );
}

export { PALETTES, DEFAULT_PALETTE } from '../../lib/chartPalette';
