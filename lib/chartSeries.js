/**
 * Folding a split query back into rows a chart can draw.
 *
 * A chart with a legend is queried long — one row per category per series —
 * because that is what a GROUP BY returns. Recharts draws wide: one row per
 * category, one key per series. This is the fold between them, and it is its
 * own module because the ordering rule is not obvious: the SQL orders on the
 * axis so the pairs arrive contiguous, which means the order the user actually
 * asked for can only be applied here, to whole categories, once each one has a
 * total to be ordered by.
 */

/** Every series value, in the order the rows first mention them. */
function seriesOrder(rows, seriesKey) {
  const seen = [];
  for (const row of rows) {
    const name = row?.[seriesKey];
    if (name === undefined || name === null) continue;
    const label = String(name);
    if (!seen.includes(label)) seen.push(label);
  }
  return seen;
}

/**
 * @returns {{ data: object[], keys: string[] }} one row per category, one key
 * per series. A category missing a series is left absent rather than filled
 * with zero — an absent bar and a bar of height zero are different claims, and
 * only one of them is in the data.
 */
export function pivotSeries(rows, { xKey, seriesKey, yKey, sort = 'value-desc' } = {}) {
  if (!Array.isArray(rows) || !rows.length || !xKey || !seriesKey || !yKey) {
    return { data: Array.isArray(rows) ? rows : [], keys: [] };
  }

  const keys = seriesOrder(rows, seriesKey);
  const byCategory = new Map();
  const totals = new Map();

  for (const row of rows) {
    const category = row?.[xKey];
    if (category === undefined || category === null) continue;
    const label = String(category);
    if (!byCategory.has(label)) byCategory.set(label, { [xKey]: row[xKey] });

    const series = row[seriesKey];
    if (series === undefined || series === null) continue;
    const value = Number(row[yKey]);
    if (!Number.isFinite(value)) continue;
    byCategory.get(label)[String(series)] = value;
    totals.set(label, (totals.get(label) || 0) + value);
  }

  const data = [...byCategory.entries()];
  if (sort === 'value-desc') data.sort((a, b) => (totals.get(b[0]) || 0) - (totals.get(a[0]) || 0));
  else if (sort === 'value-asc') data.sort((a, b) => (totals.get(a[0]) || 0) - (totals.get(b[0]) || 0));
  else if (sort === 'category-asc') data.sort((a, b) => a[0].localeCompare(b[0]));
  else if (sort === 'category-desc') data.sort((a, b) => b[0].localeCompare(a[0]));

  return { data: data.map(([, row]) => row), keys };
}
