/**
 * Shape transforms for the ribbon chart and the matrix visual.
 *
 * Both components are JSX and cannot be imported by the test runner, and both
 * carry the only real logic in their file — how rows are grouped, ordered and
 * totalled. That logic lives here so it can be tested directly, following the
 * same split as `lib/waterfall.js`.
 */

/**
 * Group flat rows into periods, each holding its categories ordered by size.
 *
 * The re-ordering per period is the ribbon chart's entire point: it is what
 * turns "did the leader change?" into something visible rather than something
 * you compute by comparing bar heights across columns.
 */
export function toPeriods(rows, xKey, seriesKey, valueKey) {
  const order = [];
  const byPeriod = new Map();

  for (const row of rows || []) {
    const period = String(row?.[xKey] ?? '');
    if (!byPeriod.has(period)) {
      byPeriod.set(period, []);
      order.push(period);
    }
    byPeriod.get(period).push({
      name: String(row?.[seriesKey] ?? ''),
      value: Number(row?.[valueKey]) || 0,
    });
  }

  return order.map((period) => {
    const items = byPeriod.get(period).sort((a, b) => b.value - a.value);
    const total = items.reduce((sum, i) => sum + i.value, 0);
    let cursor = 0;
    return {
      period,
      total,
      items: items.map((item) => {
        const start = cursor;
        cursor += item.value;
        return { ...item, start, end: cursor };
      }),
    };
  });
}

/**
 * Cross-tabulate rows into a grid.
 *
 * Duplicate row/column pairs are summed rather than overwriting each other: a
 * query that returns the same cell twice is aggregated, which is what a pivot
 * table means. Returns null when there is not enough to pivot, so the component
 * can say so instead of drawing a one-column table and calling it a matrix.
 */
export function toMatrix(rows, rowKey, columnKey, valueKey) {
  if (!rows?.length || !rowKey || !columnKey || !valueKey) return null;

  const rowNames = [];
  const colNames = [];
  const cells = new Map();

  for (const row of rows) {
    const r = String(row?.[rowKey] ?? '');
    const c = String(row?.[columnKey] ?? '');
    const v = Number(row?.[valueKey]) || 0;
    if (!rowNames.includes(r)) rowNames.push(r);
    if (!colNames.includes(c)) colNames.push(c);
    const key = `${r}\u0000${c}`;
    cells.set(key, (cells.get(key) || 0) + v);
  }

  const max = Math.max(...[...cells.values()].map(Math.abs), 1);
  return { rowNames, colNames, cells, max };
}

/**
 * The key a cell is stored under.
 *
 * A NUL separator rather than a space: "North America" x "West" and "North" x
 * "America West" would otherwise collide into one cell.
 */
export function cellKey(rowName, colName) {
  return `${rowName}\u0000${colName}`;
}
