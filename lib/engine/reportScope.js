/**
 * A report of the dashboard as it is filtered.
 *
 * Tiles and KPIs already follow the filters, and their captions are rewritten
 * for them. The headline, summary and findings are written once, over all the
 * rows, so on a filtered report they would contradict the charts beside them
 * ("overall 24%" next to a 52% card). Here they are replaced by the tiles'
 * own captions, and the report says which filters it shows.
 */

const labelOf = (fields, name) => fields.find((f) => f.name === name)?.label || name;

/** "Contract type: Month-to-month; Order date: 2024-01-01 to 2024-06-30". */
export function describeFilters(filters = [], fields = []) {
  return filters
    .map((f) => {
      const label = labelOf(fields, f.field);
      if (Array.isArray(f.values) && f.values.length) return `${label}: ${f.values.join(', ')}`;
      if (f.from != null || f.to != null) return `${label}: ${f.from ?? 'start'} to ${f.to ?? 'end'}`;
      return null;
    })
    .filter(Boolean)
    .join('; ');
}

const HEDGED = /too small to be sure|not sure|could be noise|may not be real|is noise/i;

export function filteredReportBoard(board, filters = [], fields = []) {
  const note = describeFilters(filters, fields);
  if (!board || !note) return board;
  // A chart split by a filtered column has one group left ("Only one
  // contract type has data"): true, but not a finding.
  const pinned = new Set(filters.filter((f) => Array.isArray(f.values) && f.values.length === 1).map((f) => f.field));
  const seen = new Set();
  const findings = (board.sections || [])
    .flatMap((s) => s.tiles || [])
    .filter((t) => t.insight && !pinned.has(t.dim) && !seen.has(t.insight) && seen.add(t.insight))
    .map((t) => ({ text: t.insight, tileId: t.id }))
    // A caption that doubts its own gap should not lead the brief.
    .sort((a, b) => HEDGED.test(a.text) - HEDGED.test(b.text))
    .slice(0, 5);
  return {
    ...board,
    filterNote: note,
    headline: null,
    aiSummary: null,
    summary: 'Every figure below is for the filtered rows only.',
    findings,
  };
}
