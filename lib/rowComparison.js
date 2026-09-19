/**
 * Tables whose rows are the answer.
 *
 * Every chart this planner builds is an aggregate: group by a column, sum or
 * average a measure, rank the groups. That is the right shape for a table of
 * events — orders, visits, sessions — where one row is a thing that happened
 * and the reader wants to know how the things add up.
 *
 * It is the wrong shape for a table of candidates. A comparison of AI
 * subscription plans has forty-four rows and forty-four distinct plans, and the
 * report it produced was "Average Monthly Price USD by Product": ChatGPT's
 * Free, Go, Plus, Pro, two Business seats and Enterprise averaged into one bar.
 * There is no such plan. Nobody can buy the average of a free tier and an
 * enterprise contract, and a reader trying to decide what to buy was shown ten
 * numbers that describe none of their options.
 *
 * The distinguishing fact is checkable and has nothing to do with the subject:
 * `Product` and `Plan Name` together are distinct on every row. A column that
 * is unique per row cannot be grouped — grouping by it returns the rows back —
 * so a table that HAS such a label is a list of things rather than a record of
 * events, and the things themselves are what to show.
 *
 * What this module does NOT do is decide that the aggregates are worthless.
 * "Intelligence Index by Flagship Model" is a real question about this file,
 * and a slicer by audience is how a buyer narrows it. The row-level charts are
 * added and scored alongside the rest; on a table like this they win because
 * they are the ones carrying the spread.
 *
 * Pure. No SQL, no DOM.
 */

/** Above this, the rows are a log and the groups are the story. */
export const MAX_COMPARISON_ROWS = 200;

/** How much of a label has to be distinct before it names the rows. */
const UNIQUE_ENOUGH = 0.95;

/** And how much of it has to be filled in, since a blank names nothing. */
const COMPLETE_ENOUGH = 0.95;

/** At most two columns: "Product · Plan Name" is a label, three is a sentence. */
const MAX_LABEL_COLUMNS = 2;

/** Longer than this and it is a description, not a name. */
const MAX_LABEL_CHARS = 40;

/** A time column with this many distinct values is a series, not a stamp. */
const SERIES_PERIODS = 3;

const isUrl = (v) => /^(https?:)?\/\//i.test(String(v ?? ''));

/** The columns that could name a row: short, filled in, and not plumbing. */
function labelCandidates(rows, profile) {
  const out = [];
  for (const column of profile.dimensions || []) {
    if ((profile.temporal || []).includes(column)) continue;
    const distinct = profile.cardinality?.[column] || 0;
    // One value names nothing; a boolean flag names nothing either.
    if (distinct < 2) continue;

    let filled = 0;
    let urls = 0;
    let chars = 0;
    for (const row of rows) {
      const v = row?.[column];
      if (v === null || v === undefined || v === '') continue;
      filled++;
      chars += String(v).length;
      if (isUrl(v)) urls++;
    }
    if (filled < rows.length * COMPLETE_ENOUGH) continue;
    if (urls > 0) continue;
    if (chars / Math.max(1, filled) > MAX_LABEL_CHARS) continue;

    out.push({ column, distinct });
  }
  // Most distinct first: the column closest to naming the rows on its own is
  // the one to build from, and the second is only there to break its ties.
  return out.sort((a, b) => b.distinct - a.distinct);
}

const keyOf = (row, columns) => columns.map((c) => String(row?.[c] ?? '')).join(' · ');

function distinctCount(rows, columns) {
  const seen = new Set();
  for (const row of rows) seen.add(keyOf(row, columns));
  return seen.size;
}

/**
 * The smallest set of columns that names each row once.
 *
 * Returns `null` when no combination of two gets there, which is the ordinary
 * case for a table of events and means nothing changes.
 */
export function chooseRowLabel(rows, profile) {
  if (!Array.isArray(rows) || rows.length < 4) return null;
  const candidates = labelCandidates(rows, profile);
  if (!candidates.length) return null;

  const enough = rows.length * UNIQUE_ENOUGH;

  // One column, if one will do.
  for (const { column, distinct } of candidates) {
    if (distinct >= enough) return { columns: [column], distinct };
  }

  if (MAX_LABEL_COLUMNS < 2) return null;

  /**
   * Otherwise a pair, and the pair is built around the most distinct column.
   *
   * `Plan Name` gets twenty-eight of forty-four on its own — "Free" and "Pro"
   * repeat across vendors — and `Product` finishes it. Pairing from the most
   * distinct column down means the second column is the smallest thing that
   * completes the name rather than an arbitrary partner.
   */
  let best = null;
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const columns = order([candidates[i].column, candidates[j].column], rows);
      const distinct = distinctCount(rows, columns);
      if (distinct < enough) continue;
      // Prefer the pair whose parts are smallest: the fewest levels between
      // them is the least arbitrary reading of "what names this row".
      const cost = candidates[i].distinct + candidates[j].distinct;
      if (!best || cost < best.cost) best = { columns, distinct, cost };
    }
  }
  return best ? { columns: best.columns, distinct: best.distinct } : null;
}

/**
 * General before specific — which is the order they were written in.
 *
 * The label is read as a name: "OpenAI · Pro", not "Pro · OpenAI". Ranking the
 * two columns by how many levels they have gets it right only by luck, and on a
 * table with five vendors and five tiers it is a coin toss. File order is the
 * one signal that is neither arbitrary nor a guess: whoever built the table put
 * `Provider`, then `Product`, then `Plan Name`, in that order, because that is
 * how the thing is named.
 *
 * Read from a row rather than from the profile. The profile the browser worker
 * passes down is a reduced one that carries no `keys`, so asking it for file
 * order silently returned "not found" for both columns and left them in
 * whatever order they were tried — which is how the shipped chart came out
 * "Dedicated instance · Cohere".
 */
function order(columns, rows) {
  const keys = Object.keys(rows?.[0] || {});
  const at = (c) => {
    const i = keys.indexOf(c);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...columns].sort((a, b) => at(a) - at(b));
}

/**
 * Is this a table of candidates rather than a record of events?
 *
 * Three things, all read from the data:
 *
 *   - a label names every row, so there is nothing to group by;
 *   - the file is short enough that its rows are the subject, not a sample of
 *     one — past a couple of hundred, a unique key is a transaction id and the
 *     reader wants the groups;
 *   - nothing moves through time. A column of dates with a series in it means
 *     the rows are observations, and the trend is the finding whatever else is
 *     unique about them.
 */
export function comparisonTable(rows, profile) {
  if (!Array.isArray(rows) || rows.length > MAX_COMPARISON_ROWS) return null;

  const timed = (profile?.temporal || []).some((t) => (profile?.cardinality?.[t] || 0) >= SERIES_PERIODS);
  if (timed) return null;

  const label = chooseRowLabel(rows, profile);
  if (!label) return null;

  return { ...label, rowCount: rows.length };
}
