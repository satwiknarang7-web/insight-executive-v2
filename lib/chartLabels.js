/**
 * Renaming the categories a chart draws.
 *
 * The labels on an axis come straight out of the query — "Month-to-month",
 * "Two year" — which is right for an audit trail and often wrong for an
 * audience. Renaming one is a presentation choice, so it is stored as a map
 * from the queried value to the shown one and applied at render time. The
 * result rows themselves are never rewritten: the numbers on screen have to
 * keep tracing back to the query printed underneath them, and a chart whose
 * data had been edited could not honestly claim that.
 *
 * Keying by the original value is also what lets a rename survive a re-run —
 * the query produces "Month-to-month" again, and the map still knows what the
 * user decided to call it.
 */

/**
 * Apply a rename map to the category column of a result set.
 *
 * Returns the original array when nothing changes, so a chart that renames
 * nothing does not re-render on every pass.
 */
export function renameCategories(rows, key, labels) {
  if (!labels || !key || !Array.isArray(rows) || !rows.length) return rows;

  const map = new Map(
    Object.entries(labels)
      .filter(([, to]) => typeof to === 'string' && to.trim())
      .map(([from, to]) => [from, to.trim()])
  );
  if (!map.size) return rows;

  let changed = false;
  const next = rows.map((row) => {
    const from = String(row?.[key] ?? '');
    const to = map.get(from);
    if (to === undefined || to === from) return row;
    changed = true;
    return { ...row, [key]: to };
  });

  return changed ? next : rows;
}

/**
 * The categories of a chart that are worth offering to rename.
 *
 * Numeric axes are excluded: a scatter of price against units has no category
 * names to change, and offering to rename "4.5" would only invite someone to
 * make the chart disagree with its own query. The cap keeps a 240-point series
 * from rendering 240 text fields in the editor.
 */
export function editableCategories(rows, key, limit = 12) {
  if (!key || !Array.isArray(rows)) return [];

  const seen = [];
  for (const row of rows) {
    const value = row?.[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    // A numeric-looking string is a bucket bound or a date, not a name.
    if (value.trim() !== '' && isFinite(Number(value))) continue;
    if (seen.includes(value)) continue;
    seen.push(value);
    if (seen.length >= limit) break;
  }
  return seen;
}
