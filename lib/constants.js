/**
 * The default chart colours.
 *
 * Kept as a named export because a handful of modules import it directly and
 * because the print route renders with no palette provider at all — but the
 * values now come from `chartPalette`, where they are validated rather than
 * chosen. What used to live here was twelve Tailwind defaults whose rose and
 * emerald sat 5.6 apart under deuteranopia, which is to say indistinguishable
 * to the most common form of colour blindness.
 *
 * Prefer `usePalette()` / `useSeriesColor()` in a component: they follow the
 * light or dark surface, and they do not cycle.
 */
export { DEFAULT_PALETTE } from './chartPalette';
import { DEFAULT_PALETTE } from './chartPalette';

export const CHART_COLORS = DEFAULT_PALETTE.dark;
