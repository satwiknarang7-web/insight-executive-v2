/**
 * Rows the data itself says did not happen.
 *
 * A table with an `Order_Status` column holding `Cancelled` and `Returned` is
 * telling you which of its rows are not revenue. On a 250,000-row export, 25,000
 * of them — 10.2%, ₹602M — sat inside every Total Amount figure in a finished
 * report: inside the headline, inside every share, inside the trend, inside the
 * category ranking. Not filtered and not flagged.
 *
 * That is not a presentation defect and no later sentence repairs it. A measure
 * summed across void rows has the wrong name, and everything derived from it
 * inherits the error silently, because the arithmetic is perfect throughout.
 *
 * **Detection and exclusion are separate on purpose.** Deciding that a cancelled
 * order is not revenue is a decision about what somebody means by their own
 * measure. This module can make it, and does, because the alternative — a total
 * that quietly includes refunds — is wrong in a way nobody can see. But it is
 * made once, in one place, stated in the decisions notice with the count and the
 * share, and it never touches the dataset: Explore, Ask and the SQL console all
 * still see every row. What changes is what the ANALYSIS aggregates.
 *
 * What is deliberately not done here is deleting anything. The excluded rows are
 * counted and reported, so the exclusion is a figure on the page rather than a
 * quiet subtraction — and the share of orders that were cancelled or returned is
 * usually a finding in its own right, on a column that otherwise goes unread.
 */

/**
 * Values that mean the row did not stand.
 *
 * Deliberately exact matches, not substrings: `Returned` is void and `Return
 * Requested` is not, `Cancelled` is void and `Cancellation Window` is a column
 * name. A status this module cannot read is left alone, which is the safe
 * direction — an unrecognised status keeps today's behaviour.
 */
const VOID_STATUS = /^(cancell?ed|returned|refunded|void(ed)?|failed|charge ?back|chargeback|rejected|declined)$/i;

/** A column likely to record what became of a row. */
const STATUS_COLUMN = /(^|[^a-z])(status|state|outcome|disposition)([^a-z]|$)/i;

/**
 * Below this share, void rows are a rounding error rather than a premise.
 *
 * The threshold exists so a handful of test rows in somebody's export does not
 * trigger a notice about the integrity of their revenue. Above it, the
 * exclusion changes figures a reader would otherwise quote.
 */
const MIN_VOID_SHARE = 0.01;

/**
 * A status column can only be void-marked if most of its rows are NOT void.
 *
 * A column where four fifths of the values read as cancelled is not a status
 * column at all — it is a category that happens to share vocabulary, and
 * excluding most of the table on that reading would be catastrophic and silent.
 */
const MAX_VOID_SHARE = 0.6;

const norm = (s) => String(s ?? '').trim();

/**
 * Which rows the data marks as not having stood, and what that is worth.
 *
 * Returns null when there is no status column, when nothing in it reads as
 * void, when too little of the table is void to matter, or when so much of it
 * is that the column cannot be a status at all.
 *
 * @param {object[]} rows    the analysis view
 * @param {object}   profile columns and their roles
 * @returns {{column, levels, rows, sharePct, measures}|null}
 */
export function detectVoidRows(rows = [], profile = null, claimed = null) {
  const dimensions = profile?.dimensions || [];
  const measures = profile?.measures || [];
  if (!rows?.length || !measures.length) return null;

  // The lexicon finds the column by its name; a claim names it outright, which
  // is how a status column called `Bestellstatus` or `estado` is reached at all.
  const column = norm(claimed?.column) && dimensions.includes(norm(claimed.column))
    ? norm(claimed.column)
    : dimensions.find((d) => STATUS_COLUMN.test(norm(d)));
  if (!column) return null;

  const extra = norm(claimed?.column) === column ? claimed?.values || [] : [];
  let voided = 0;
  const levels = new Set();
  for (const row of rows) {
    const value = norm(row?.[column]);
    if (value && isVoid(value, extra)) {
      voided += 1;
      levels.add(value);
    }
  }

  const share = voided / rows.length;
  if (!voided || share < MIN_VOID_SHARE || share > MAX_VOID_SHARE) return null;

  return {
    column,
    levels: [...levels].sort(),
    rows: voided,
    sharePct: Math.round(share * 1000) / 10,
    measures,
    // Which of the values came from the lexicon and which from a model reading
    // the column's vocabulary. A reader deciding whether to trust an exclusion
    // is owed that difference, and it is the first thing to check when a total
    // looks lower than expected.
    claimed: [...levels].filter((v) => !VOID_STATUS.test(v)).sort(),
  };
}

/**
 * The rows an analysis should aggregate, and what it left out.
 *
 * One pass, and the original array is never mutated — the caller keeps the full
 * table, which is what Explore, Ask and any hand-written query go on reading.
 *
 * When nothing is detected this returns the same array it was given, by
 * identity, so a table with no status column costs nothing and behaves exactly
 * as it did before this file existed.
 */
export function excludeVoidRows(rows = [], profile = null, claimed = null, { include = false } = {}) {
  const found = detectVoidRows(rows, profile, claimed);
  if (!found) return { rows, excluded: null };

  // Asked to keep them, the detection still runs and still reports. That is the
  // whole value of the choice being a choice: a reader who decides a cancelled
  // order belongs in their total gets their total, and gets told what is in it.
  // Silence here would put the original bug back, with a preference attached.
  if (include) {
    return { rows, excluded: { ...found, kept: rows.length, total: rows.length, applied: false } };
  }

  // `found.levels` is the authority, not the patterns: it is what was actually
  // counted, so what is removed and what was reported can never disagree.
  const void_ = new Set(found.levels.map((v) => v.toLowerCase()));
  const kept = rows.filter((row) => !void_.has(norm(row?.[found.column]).toLowerCase()));
  return {
    rows: kept,
    excluded: { ...found, kept: kept.length, total: rows.length, applied: true },
  };
}

/**
 * How the exclusion should be described to a reader.
 *
 * Written here rather than at each call site so the dashboard notice, the
 * report and the argument all say the same thing — the figure that was removed
 * has to be as legible as the figures that remain, or the exclusion is just a
 * quieter version of the bug.
 */
export function describeExclusion(excluded) {
  if (!excluded) return '';
  const { rows, sharePct, levels, column, kept, applied = true } = excluded;

  // Kept in, the sentence has to be the louder one. This is the state the
  // original bug was in, and somebody who chose it should be told what their
  // totals now contain rather than reassured that a choice was respected.
  if (!applied) {
    return (
      `${rows.toLocaleString()} rows (${sharePct}% of the table) are marked ` +
      `${levels.join(' or ')} in ${column} and are counted in every total, average and share below, ` +
      'because you asked for them. Those figures are not revenue.'
    );
  }

  return (
    `${rows.toLocaleString()} rows (${sharePct}% of the table) are marked ` +
    `${levels.join(' or ')} in ${column}, and are left out of every total, average and share below. ` +
    `The figures describe the remaining ${kept.toLocaleString()} rows. ` +
    'Every row is still there in Explore, Ask and the SQL console.'
  );
}

// ---------------------------------------------------------------------------
// What the lexicon cannot read
// ---------------------------------------------------------------------------

/**
 * The regex above knows English. Somebody's table says otherwise.
 *
 * `Annule`, `Storniert`, `RTO`, `COD Failed`, `Devuelto`, `Retour client`: each
 * of these means the row did not stand, and none of them match. A lexicon is
 * right about the files it was written for and will be wrong about somebody's,
 * and the failure is the expensive kind — a total silently including refunds,
 * arithmetically perfect throughout.
 *
 * That gap is what showing a model the VALUES closes, and nothing about column
 * names can. It is given the distinct values of the status column and asked
 * which of them mean the row did not stand.
 *
 * Three things make it safe to act on.
 *
 * **Measurement wins.** A value the lexicon already caught is not up for
 * discussion in either direction: the model cannot clear it and cannot relabel
 * it. The model only ever ADDS.
 *
 * **A claimed value has to exist.** Checked against the vocabulary the model was
 * shown, so a plausible-sounding status that is not in the column is dropped
 * rather than excluding nothing and reporting that it did.
 *
 * **And being wrong is bounded and visible.** A wrong claim removes rows that
 * should have counted, which makes totals too low — disclosed on the deck with
 * the count, the share and the values by name, so a reader can see exactly what
 * was taken out and put it back. Today's behaviour, by contrast, is a total
 * that is too high for a reason nothing on the page mentions. Both directions
 * are wrong; only one of them is legible.
 */

/** More claimed void values than this on one column is a model pattern-matching. */
const MAX_CLAIMS = 8;

/** A status value is a word or two. Longer is prose, and prose is not a status. */
const MAX_VALUE_LENGTH = 40;

/**
 * Keep the claims that name a value the column actually holds.
 *
 * @param {unknown} raw whatever the route parsed out of the reply
 * @param {object}  context
 * @param {string}  context.column   the status column the claims are about
 * @param {string[]} context.present the distinct values that column actually has
 * @returns {string[]} values to treat as void, over and above the lexicon
 */
export function acceptVoidClaims(raw, { columns = [] } = {}) {
  const column = norm(raw?.column);
  if (!column || !Array.isArray(raw?.values)) return null;

  // The column must be one the model was actually shown the values of.
  const shown = (columns || []).find((c) => norm(c?.name) === column && Array.isArray(c?.values));
  if (!shown) return null;

  const exists = new Map(shown.values.map((v) => [norm(v?.value).toLowerCase(), norm(v?.value)]));
  const values = [];

  for (const item of raw.values) {
    const value = norm(typeof item === 'string' ? item : item?.value);
    if (!value || value.length > MAX_VALUE_LENGTH) continue;
    const actual = exists.get(value.toLowerCase());
    // A status the column does not contain would exclude nothing while
    // reporting that it had.
    if (!actual || values.includes(actual)) continue;
    values.push(actual);
    if (values.length >= MAX_CLAIMS) break;
  }

  // Claiming that every value is void is not a reading of a status column.
  if (!values.length || values.length >= exists.size) return null;
  return { column, values };
}

/** Whether a value reads as void, by the lexicon or by an accepted claim. */
const isVoid = (value, claimed) => VOID_STATUS.test(value) || claimed.includes(value);

/**
 * The exclusion as a decisions-notice entry.
 *
 * It belongs in the same panel as the withheld columns and the negative
 * amounts, because it is the same kind of statement: something was decided on
 * the reader's behalf and the figures changed as a result. A tenth of a table
 * leaving every total is the largest of those decisions this app makes, so it
 * is not dismissible.
 */
export function exclusionNotice(excluded, action = null) {
  if (!excluded) return [];
  const applied = excluded.applied !== false;
  return [
    {
      // Two kinds, because they are not the same statement. One reports a
      // decision that made the figures narrower and safer; the other reports
      // that a reader chose to put a tenth of the table back into their
      // revenue, which is the state the original bug was in and belongs where
      // a capped table goes — loud, and not dismissible.
      kind: applied ? 'rows-excluded' : 'rows-included',
      column: excluded.column,
      message: describeExclusion(excluded),
      // Named separately so the panel can say which values a model read and
      // which the engine recognised on its own.
      claimed: excluded.claimed || [],
      action: action || null,
    },
  ];
}
