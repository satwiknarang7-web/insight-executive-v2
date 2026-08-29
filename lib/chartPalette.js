/**
 * The colours a chart is allowed to use.
 *
 * The old palettes were six sets of eight Tailwind defaults, cycled with a
 * modulo when a chart had more series than colours. Two things were wrong with
 * that, and only one of them was taste.
 *
 * The cycling is the serious one. A donut with twelve slices drew slices one
 * and nine in the same colour, and the legend then said they were different
 * things. Colour is how a reader tells one series from another; spending the
 * same colour twice is not a cosmetic shortcut, it is the chart making a claim
 * that is false. Nothing here cycles. Past the eighth series the tail is folded
 * into a single "Other", which is a smaller lie told out loud.
 *
 * The second is that four of the six palettes were single-hue ramps — Ocean was
 * eight shades of blue-cyan, Forest eight of green — handed to charts that use
 * colour for identity. A ramp encodes *magnitude*: light to dark says "more".
 * Eight steps of one hue side by side say nothing at all, and say it in a way
 * nobody can read at a glance.
 *
 * What is here instead is one set of eight hues, stepped once for the light
 * surface and once for the dark, in orderings that were checked rather than
 * chosen. Every ordering below passes, in both themes: the OKLCH lightness band
 * and chroma floor, a CVD separation of ΔE ≥ 8 under simulated protanopia and
 * deuteranopia, a normal-vision floor of ΔE ≥ 15 on adjacent pairs, and 3:1
 * contrast against the surface behind them. All 40,320 orderings of the eight
 * were enumerated and these are six of the ones that passed — so the choice
 * between them is a choice of opening colour, and nothing else.
 */

/**
 * The eight hues, stepped per surface.
 *
 * The dark column is the same eight hues re-stepped for a dark background, not
 * a different palette — aqua, yellow, magenta and green land on the same step
 * in both, the rest lighten or darken to stay inside the band.
 */
const HUES = {
  blue: { light: '#2a78d6', dark: '#3987e5' },
  orange: { light: '#eb6834', dark: '#d95926' },
  aqua: { light: '#199e70', dark: '#199e70' },
  yellow: { light: '#c98500', dark: '#c98500' },
  magenta: { light: '#d55181', dark: '#d55181' },
  green: { light: '#008300', dark: '#008300' },
  violet: { light: '#4a3aa7', dark: '#9085e9' },
  red: { light: '#e34948', dark: '#e66767' },
};

/**
 * The orderings on offer. The order is the safety mechanism, not decoration:
 * adjacent slots are what end up beside each other in a stack, a legend or a
 * grouped bar, so the sequence is what the CVD check is run against. These six
 * were taken from the passing set, one per opening hue.
 */
const THEMES = [
  { key: 'default', name: 'Signal', order: ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red'] },
  { key: 'ocean', name: 'Ocean', order: ['aqua', 'orange', 'blue', 'yellow', 'magenta', 'green', 'violet', 'red'] },
  { key: 'ember', name: 'Ember', order: ['orange', 'blue', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red'] },
  { key: 'forest', name: 'Forest', order: ['green', 'magenta', 'yellow', 'blue', 'aqua', 'orange', 'violet', 'red'] },
  { key: 'violet', name: 'Violet', order: ['violet', 'green', 'magenta', 'yellow', 'aqua', 'orange', 'blue', 'red'] },
  { key: 'rose', name: 'Rose', order: ['magenta', 'yellow', 'aqua', 'orange', 'blue', 'green', 'violet', 'red'] },
];

const steps = (order, mode) => order.map((hue) => HUES[hue][mode]);

/** Every theme, with both its stepped sets. */
export const PALETTES = THEMES.map((t) => ({
  key: t.key,
  name: t.name,
  hues: t.order,
  light: steps(t.order, 'light'),
  dark: steps(t.order, 'dark'),
  // What the picker shows, and what a chart gets when the theme is unknown.
  colors: steps(t.order, 'dark'),
}));

export const DEFAULT_PALETTE = PALETTES[0];

/** The colours for one theme on one surface. Falls back to the default theme. */
export function paletteFor(key, mode = 'dark') {
  const theme = PALETTES.find((p) => p.key === key) || DEFAULT_PALETTE;
  return mode === 'light' ? theme.light : theme.dark;
}

/**
 * How many series a chart may colour before the rest become "Other".
 *
 * Eight is the number of hues that pass the separation checks together. A ninth
 * is not a ninth colour, because there is not a ninth colour that a reader can
 * reliably tell from the other eight.
 */
export const MAX_SERIES = 8;

/**
 * The cap for charts where any two marks can end up adjacent.
 *
 * A stacked bar or a line chart only ever puts *neighbouring* slots side by
 * side, so the check that matters is the adjacent one. A scatter, a bubble
 * chart or a map can put any two marks together, and under that harder test the
 * eight hues do not hold: only the first three clear it. Those forms should not
 * be colouring by category past three series at all.
 */
export const MAX_SCATTERED_SERIES = 3;

/** The colour for everything past the cap, and for a folded "Other". */
export const OTHER_COLOR = { light: '#6f6e6a', dark: '#8b8a84' };
export const OTHER_LABEL = 'Other';

/**
 * The colour for series `index`, or the neutral when there is no colour left.
 *
 * Deliberately not `palette[index % palette.length]`. Running out of colours is
 * information — it means this chart has more series than can be told apart —
 * and the honest way to show that is a neutral, not a repeat of slot one.
 */
export function seriesColor(palette, index, mode = 'dark') {
  const colors = palette?.length ? palette : paletteFor('default', mode);
  if (index < colors.length) return colors[index];
  return OTHER_COLOR[mode] || OTHER_COLOR.dark;
}

/**
 * Fold everything past the cap into one "Other" row.
 *
 * For the share-of-a-whole charts — a donut, a treemap, a radial — where the
 * slices must add up and dropping the tail would quietly change what the chart
 * says the total is. The rows are assumed to be ordered already, largest first,
 * which is what every query the builder writes does.
 *
 * @returns {object[]} at most `max` rows, the last one summing the rest.
 */
export function foldToOther(rows, nameKey, valueKey, max = MAX_SERIES) {
  if (!Array.isArray(rows) || rows.length <= max) return rows || [];

  const kept = rows.slice(0, max - 1);
  const tail = rows.slice(max - 1);
  const total = tail.reduce((sum, row) => {
    const n = Number(row?.[valueKey]);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);

  return [
    ...kept,
    { ...tail[0], [nameKey]: `${OTHER_LABEL} (${tail.length})`, [valueKey]: total, isOther: true },
  ];
}

/**
 * A one-hue ramp, light to dark, for values that carry an order.
 *
 * Funnel stages, size tiers, age bands: swapping two of them would change what
 * the chart means, so the colour should carry the order too rather than saying
 * "these are eight unrelated things". Drawn from the documented blue ramp; the
 * ends are trimmed so the palest step still clears 2:1 on its surface.
 */
const BLUE_RAMP = {
  // Light surface: never paler than the step that still clears 2:1 on white.
  light: ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'],
  // Dark surface: the same ramp read the other way, never darker than the step
  // that still separates from the background.
  dark: ['#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6'],
};

/**
 * How many steps of one hue a reader can actually order by eye.
 *
 * Five. The ramp has ten documented steps, but consecutive ones sit 0.047 apart
 * in lightness — below the gap at which the eye reads them as a sequence — so
 * the steps have to be taken two apart, and two apart across ten steps is five
 * of them. Six would look like a ramp and not be readable as one.
 */
export const MAX_ORDINAL = 5;

/**
 * `count` steps of the ordinal ramp, spread across the whole of it.
 *
 * Spread, not sliced: the first N steps of the ramp are too close together to
 * read as ordered. Returns null past `MAX_ORDINAL`, where a one-hue ramp stops
 * being able to do the job and the caller should colour by identity instead —
 * a funnel still carries its order in its geometry.
 */
export function ordinalRamp(count, mode = 'dark') {
  const ramp = BLUE_RAMP[mode] || BLUE_RAMP.dark;
  if (count <= 1) return [ramp[Math.floor(ramp.length / 2)]];
  if (count > MAX_ORDINAL) return null;

  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(ramp[Math.round((i / (count - 1)) * (ramp.length - 1))]);
  }
  return out;
}
