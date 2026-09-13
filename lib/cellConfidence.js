/**
 * Which cells the cleaner had to guess at.
 *
 * The engine already caps what a *finding* may claim by how good its evidence
 * is. This is the same idea one level down: some cells arrive as a judgement
 * rather than a reading, and a finding resting on a column full of judgements
 * is weaker than one resting on a column of plain numbers — however clean the
 * statistics look afterwards.
 *
 * **Uncertain means "this could be wrong", not "this was changed."** Coercing
 * `"1234"` to `1234` is unambiguous and is not recorded here; reading
 * `03/04/2024` as the 4th of March, when it could equally be the 3rd of April,
 * is. The distinction is the whole value of the signal: a flag raised on every
 * cleaned cell would be raised on nearly every cell, and would mean nothing.
 *
 * Statistical outliers are deliberately **not** recorded here either. An
 * outlier is unusual, not misread — the cleaner is entirely confident it read
 * `9,000,000` correctly — and `isAnomaly` already carries that separately.
 * Folding the two together would blunt both.
 *
 * ## Shape
 *
 * Counts per column are exact and always kept: they are what the engine reads,
 * they cost a few dozen numbers, and they are what makes a claim about a whole
 * column honest. Individual cell positions are for highlighting a grid, are
 * needed only for what is on screen, and are capped — this rides along with the
 * metrics when the dataset is structure-cloned out of the worker, and a file
 * with half a million ambiguous dates has no business putting half a million
 * entries through that. Past the cap, counting continues and positions stop.
 */

/** Why a cell is uncertain. Each is a decision the cleaner could have made differently. */
export const UNCERTAIN = {
  /** `03/04/2024` — both parts are 12 or less, so day-first and month-first both read. */
  DATE_ORDER: 'date_order',
  /** `1,234` in a column with no value proving which side of the comma is which. */
  DECIMAL_COMMA: 'decimal_comma',
  /** Blank because the row ran out of fields, not because the cell was empty. */
  SHORT_ROW: 'short_row',
  /** Number-shaped but not readable as a usable number, so the value is gone. */
  COERCED_NULL: 'coerced_null',
  /**
   * Read off a document by a model that marked it unsure.
   *
   * The only reason here that is not the cleaner's own judgement. It arrives
   * with the data rather than being derived from it — smudged handwriting, a
   * digit that could be a 3 or an 8 — and it is the reason this whole idea was
   * worth porting: the doubt survives into the findings instead of a blurred
   * figure becoming a confident number the moment it is typed out.
   */
  EXTRACTED: 'extracted',
};

/** One sentence per reason, in the voice the rest of the app reports in. */
export const REASON_TEXT = {
  [UNCERTAIN.DATE_ORDER]:
    'read month-first; the day and month are both 12 or less, so the other reading is equally valid',
  [UNCERTAIN.DECIMAL_COMMA]:
    'no value in this column proves whether its commas group digits or mark the decimal point',
  [UNCERTAIN.SHORT_ROW]: 'blank because the row ended early, not because the cell was empty',
  [UNCERTAIN.COERCED_NULL]:
    'looked like a number but did not read as a usable one, so the value was dropped',
  [UNCERTAIN.EXTRACTED]: 'read from a document by a model that marked it unsure of what it saw',
};

export const REASONS = Object.values(UNCERTAIN);

/**
 * How many individual cell positions are worth remembering.
 *
 * Sized for what a person can look at rather than for what a file can contain.
 * Nobody inspects the twenty-thousand-and-first highlighted cell, and the
 * counts — which is what any claim is made from — stay exact regardless.
 */
export const MAX_RECORDED_CELLS = 20000;

export function createConfidence() {
  return {
    /** column -> reason -> exact count, never capped. */
    byColumn: {},
    /** column -> row index -> reason, capped at MAX_RECORDED_CELLS. */
    cells: {},
    /**
     * column -> how many rows that column's counts were measured against.
     *
     * Empty for a single table, where every column shares the dataset's own row
     * count. It matters after a join: three doubtful cells in a ten-row lookup
     * table are three tenths of that column, not three two-hundredths of the
     * view it was joined into, and reading it the second way would hide the
     * worst column in the analysis behind the size of the biggest one.
     */
    rows: {},
    total: 0,
    recorded: 0,
    /** True once positions stopped being kept. Counts are still exact. */
    truncated: false,
  };
}

/**
 * Record one uncertain cell.
 *
 * Silently ignores an unknown reason rather than storing it: a typo in a call
 * site should lose one signal, not invent a category that the summary then
 * reports to a reader as though it meant something.
 */
export function noteUncertain(store, column, rowIndex, reason) {
  if (!store || !column || !REASONS.includes(reason)) return;

  const tally = (store.byColumn[column] ||= {});
  tally[reason] = (tally[reason] || 0) + 1;
  store.total++;

  if (store.recorded >= MAX_RECORDED_CELLS) {
    store.truncated = true;
    return;
  }
  const column_ = (store.cells[column] ||= {});
  // A cell already marked keeps its first reason. The first one reached it
  // first in the pipeline, which is the earlier and more fundamental doubt.
  if (column_[rowIndex] === undefined) {
    column_[rowIndex] = reason;
    store.recorded++;
  }
}

/** Why this cell is uncertain, or null. Null past the cap does not mean certain. */
export function cellReason(store, column, rowIndex) {
  return store?.cells?.[column]?.[rowIndex] ?? null;
}

/** Every reason recorded against a column, with exact counts. */
export function columnTally(store, column) {
  return store?.byColumn?.[column] || {};
}

/** How many of a column's cells are uncertain, for any reason. Exact. */
export function columnUncertainCount(store, column) {
  let total = 0;
  for (const n of Object.values(columnTally(store, column))) total += n;
  return total;
}

/**
 * The share of a column that is uncertain, 0–1.
 *
 * Zero rows reads as zero rather than as a division by nothing: a column with
 * no values has no doubtful ones either, and the alternative is a NaN that
 * propagates into an evidence tier.
 */
export function columnUncertainShare(store, column, rowCount) {
  const against = store?.rows?.[column] || rowCount;
  if (!against || against < 0) return 0;
  return Math.min(1, columnUncertainCount(store, column) / against);
}

/**
 * The worst share across the columns a finding actually rests on.
 *
 * The worst rather than the average, because a finding is only as sound as the
 * shakiest column in it: averaging a wholly guessed date column against four
 * clean numeric ones hides exactly the case worth knowing about.
 */
export function worstUncertainShare(store, columns, rowCount) {
  let worst = 0;
  for (const column of columns || []) {
    const share = columnUncertainShare(store, column, rowCount);
    if (share > worst) worst = share;
  }
  return worst;
}

/** The column contributing the worst share, and why. Null when nothing is uncertain. */
export function worstUncertainColumn(store, columns, rowCount) {
  let worst = null;
  for (const column of columns || []) {
    const share = columnUncertainShare(store, column, rowCount);
    if (share > 0 && (!worst || share > worst.share)) {
      const tally = columnTally(store, column);
      const reason = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
      worst = { column, share, reason, count: columnUncertainCount(store, column) };
    }
  }
  return worst;
}

/**
 * Everything the quality page needs, in one pass.
 *
 * Columns are ordered by how much of them is in doubt rather than by name: the
 * reader wants the worst one first, and a column that is 40% guessed matters
 * more than one alphabetically ahead of it with two bad cells.
 */
export function summarizeConfidence(store, rowCount) {
  const columns = Object.keys(store?.byColumn || {})
    .map((column) => ({
      column,
      count: columnUncertainCount(store, column),
      share: columnUncertainShare(store, column, rowCount),
      reasons: columnTally(store, column),
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.share - a.share || b.count - a.count);

  return {
    total: store?.total || 0,
    columns,
    truncated: store?.truncated === true,
  };
}

// ---------------------------------------------------------------------------
// What a finding is allowed to claim when its columns were guessed at
// ---------------------------------------------------------------------------

/**
 * How much of a column has to be a judgement before it caps the verb.
 *
 * These are judgement calls and worth naming as such. The reasoning is about
 * consequence rather than statistics: a column read by coin toss more than half
 * the time is not evidence of anything, it is a reading — so nothing built on
 * it may be called strong, moderate or even indicative. A fifth is enough to
 * stop a recommendation telling somebody to act. A twentieth is enough to stop
 * it being called strong, because "strong" is the word that ends an argument.
 *
 * Below the lowest threshold nothing is capped, but the doubt is still stated:
 * a reader deciding whether to act on a number deserves to know some of it was
 * inferred, even when it is too little to change the tier.
 */
export const UNCERTAINTY_CAPS = [
  { atLeast: 0.5, tier: 'thin' },
  { atLeast: 0.2, tier: 'indicative' },
  { atLeast: 0.05, tier: 'moderate' },
];

/** The tier a share caps a finding at, or null when it caps nothing. */
export function uncertaintyCap(share) {
  for (const rule of UNCERTAINTY_CAPS) {
    if (share >= rule.atLeast) return rule.tier;
  }
  return null;
}

/**
 * Which uncertain columns a chart actually rests on.
 *
 * Only columns that carry doubt are considered, which is usually none and
 * occasionally a handful — so this stays cheap however wide the table is.
 *
 * A chart names its source columns in three places and none of them alone is
 * enough: `dimension` and `mixOf` are set by some candidates and not others,
 * `signal` describes what the planner was looking for rather than everything
 * the query touched, and the SQL is the only thing that always names every
 * column — including the measure being summed, which is exactly the column a
 * comma convention would have ruined. Matching on the bracketed form the
 * planner emits keeps `[amount]` from matching a column called `amount_paid`.
 */
export function chartRestsOn(store, chart) {
  const candidates = Object.keys(store?.byColumn || {});
  if (!candidates.length || !chart) return [];

  const sql = typeof chart.sql === 'string' ? chart.sql : '';
  const named = new Set(
    [chart.dimension, chart.mixOf, chart.signal?.column, chart.signal?.dimension].filter(Boolean)
  );

  return candidates.filter((column) => named.has(column) || sql.includes(`[${column}]`));
}

/**
 * The doubt to carry into a finding's evidence, or null when there is none.
 *
 * `rowCount` is the source rows the chart was computed from, not the rows it
 * returned: a bar chart of six categories still rests on every row that went
 * into those six bars, and dividing by six would read a handful of bad cells as
 * the whole dataset.
 */
export function findingUncertainty(store, chart, rowCount) {
  const columns = chartRestsOn(store, chart);
  if (!columns.length) return null;

  const worst = worstUncertainColumn(store, columns, rowCount);
  if (!worst) return null;

  return {
    ...worst,
    cap: uncertaintyCap(worst.share),
    note: `${Math.round(worst.share * 100)}% of ${worst.column} ${REASON_TEXT[worst.reason]}`,
  };
}

/**
 * Merge the confidence of several tables into one store for their joined view.
 *
 * Counts add up per column, and each column remembers how many rows it was
 * measured against — see `rows` above for why that is not the view's row count.
 *
 * Cell positions are deliberately dropped. A row index means nothing after a
 * join: row 4 of a lookup table is not row 4 of the view, and may be forty rows
 * of it. The store says so with `truncated` rather than keeping positions that
 * would point at the wrong cells.
 */
export function mergeConfidence(stores) {
  const out = createConfidence();
  let any = false;

  for (const entry of stores || []) {
    const store = entry?.confidence;
    if (!store) continue;
    any = true;
    for (const [column, tally] of Object.entries(store.byColumn || {})) {
      const into = (out.byColumn[column] ||= {});
      for (const [reason, n] of Object.entries(tally)) {
        into[reason] = (into[reason] || 0) + n;
        out.total += n;
      }
      // Same column name in two tables: the larger denominator is the honest
      // one, because the counts above are now the sum of both.
      out.rows[column] = Math.max(out.rows[column] || 0, entry.rowCount || 0);
    }
  }

  if (any && out.total > 0) out.truncated = true;
  return out;
}
