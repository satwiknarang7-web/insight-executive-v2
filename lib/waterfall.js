/**
 * Waterfall geometry, kept out of the component so it can be tested.
 *
 * The component that draws this is JSX, which plain Node cannot parse — the
 * same reason `pgTypes.js` lives apart from `postgres.server.js`. The rule this
 * codebase follows is that logic worth a test does not live in a file the test
 * runner cannot import.
 */

/**
 * Turn rows into floating bars.
 *
 * `base` is the transparent pedestal a bar rests on, `delta` its visible height,
 * and `signed` the change it represents. The running total is carried forward so
 * each bar starts where the previous one finished.
 *
 * The input is read as a sequence of *changes*. A column that already holds
 * changes (it contains negatives) is taken as given; a column of levels is
 * differenced, because charting a running total as though each value were a
 * change would draw every bar from zero and mean nothing.
 */
export function buildWaterfall(rows, xKey, yKey) {
  const values = (rows || []).map((r) => Number(r?.[yKey]) || 0);
  const looksLikeDeltas = values.some((v) => v < 0);
  const deltas = looksLikeDeltas ? values : values.map((v, i) => (i === 0 ? v : v - values[i - 1]));

  const out = [];
  let running = 0;
  (rows || []).forEach((row, i) => {
    const delta = deltas[i];
    const start = running;
    running += delta;
    out.push({
      [xKey]: row[xKey],
      base: delta >= 0 ? start : running,
      delta: Math.abs(delta),
      signed: delta,
      cumulative: running,
      kind: delta >= 0 ? 'gain' : 'loss',
    });
  });

  out.push({
    [xKey]: 'Total',
    base: 0,
    delta: Math.abs(running),
    signed: running,
    cumulative: running,
    kind: 'total',
  });
  return out;
}
