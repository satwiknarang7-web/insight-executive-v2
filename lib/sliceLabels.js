/**
 * Which slices of a pie get a label, and which do not.
 *
 * Every slice used to get one, drawn just outside the arc at that slice's own
 * angle. With five categories that reads well. With a dozen the small ones
 * bunch together at the same end of the circle — a 1% slice subtends about
 * three degrees, so three of them in a row put three labels within a few pixels
 * of each other and they overprint into an unreadable smear.
 *
 * The fix is not a smaller font, which just makes the collision illegible at a
 * smaller size. It is to label what there is room to label. A slice too thin to
 * carry a label still has its colour, its legend entry and its tooltip; what it
 * does not have is a number scrawled over its neighbour's.
 *
 * Two rules, in order:
 *
 *   1. A slice below `minShare` of the total is never labelled. A sliver's
 *      value is the least interesting number on the chart and its label is the
 *      most likely to collide.
 *   2. Of what is left, a label is dropped when it would land within `minGap`
 *      pixels of the last one kept **on the same side of the circle** — labels
 *      on the left and right never collide with each other, so they are tracked
 *      separately and a busy right-hand side does not thin out the left.
 *
 * Pure geometry: no imports, no DOM, no React.
 */

/** Below this share of the total, a slice is too thin to letter. */
export const MIN_LABEL_SHARE = 0.03;

/** Vertical room one label needs, in pixels of the chart's own coordinate space. */
export const MIN_LABEL_GAP = 15;

/**
 * Decide the labelled slices.
 *
 * Takes the values in the order the pie draws them and returns a `Set` of
 * indices to label. The angles are computed the way Recharts lays a pie out —
 * starting at 90° and sweeping clockwise — so the vertical positions here are
 * the ones the labels will actually occupy.
 *
 * @param {number[]} values      one per slice, in draw order
 * @param {object}   options
 * @param {number}   options.radius   distance from the centre the labels sit at
 * @param {number}   options.minShare slices below this share go unlabelled
 * @param {number}   options.minGap   vertical pixels required between labels
 */
export function labelledSlices(values, { radius = 100, minShare = MIN_LABEL_SHARE, minGap = MIN_LABEL_GAP } = {}) {
  const numbers = (values || []).map((v) => (Number.isFinite(Number(v)) ? Math.abs(Number(v)) : 0));
  const total = numbers.reduce((sum, v) => sum + v, 0);
  const keep = new Set();
  if (!total || numbers.length === 0) return keep;

  // A handful of slices cannot collide; skip the work and label them all.
  if (numbers.length <= 3) {
    numbers.forEach((v, i) => v > 0 && keep.add(i));
    return keep;
  }

  // Where each slice's label would sit. Recharts starts a pie at 90 degrees and
  // sweeps clockwise, so the mid-angle of slice i is 90 minus everything before
  // it, minus half of itself.
  const placed = [];
  let sweptDegrees = 0;
  for (let i = 0; i < numbers.length; i++) {
    const share = numbers[i] / total;
    const midAngle = 90 - (sweptDegrees + share * 360 / 2);
    sweptDegrees += share * 360;

    const radians = (midAngle * Math.PI) / 180;
    placed.push({
      index: i,
      share,
      // Screen y grows downward, which is why this is a minus.
      y: -radius * Math.sin(radians),
      right: Math.cos(radians) >= 0,
    });
  }

  // Biggest first, so when two labels compete for the same strip of space the
  // slice worth reading is the one that keeps its number.
  const byShare = [...placed].sort((a, b) => b.share - a.share);
  const takenLeft = [];
  const takenRight = [];

  for (const slice of byShare) {
    if (slice.share < minShare) continue;
    const taken = slice.right ? takenRight : takenLeft;
    if (taken.some((y) => Math.abs(y - slice.y) < minGap)) continue;
    taken.push(slice.y);
    keep.add(slice.index);
  }

  return keep;
}

/**
 * How many rows a legend gets.
 *
 * Two competing failures, and the cap is where they meet. A legend with no
 * limit grows until it squeezes the plot it is labelling — a vertical one
 * reached 144px on a 224px card, which is why it was pinned to a single row.
 * But a single row with `overflow: hidden` silently drops everything past it,
 * and a chart with colours in it that nothing on screen names is its own kind
 * of broken.
 *
 * So: one row while one row is enough, two when it is not, and never more —
 * past two the entries scroll rather than taking any more of the chart.
 */
export function legendRows(seriesCount, { maxRows = 2 } = {}) {
  return seriesCount <= 4 ? 1 : maxRows;
}
