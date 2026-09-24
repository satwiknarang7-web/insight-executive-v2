/**
 * The smallest and largest of a list, in one pass.
 *
 * `Math.max(...values)` passes every value as an argument, and an engine only
 * has so much stack for arguments: somewhere past a hundred thousand values it
 * throws "Maximum call stack size exceeded". A column of a 250,000-row file is
 * well past that, and the question card showed the error instead of questions.
 * Anything that can be as long as the table goes through here.
 *
 * Non-numbers are skipped. An empty list gives { min: Infinity, max: -Infinity },
 * which is what Math.min() and Math.max() give.
 */
export function extent(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** max − min: how far a list runs. */
export const spanOf = (values) => {
  const { min, max } = extent(values);
  return max - min;
};
