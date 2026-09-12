/**
 * What the data actually contains, for the agents that need to see it.
 *
 * Until now every model call in this codebase was shown column names and
 * nothing else. That made a strong guarantee cheap — a model with no figures in
 * front of it cannot quote one, so any digit in its reply was invented and
 * rejectable mechanically — and it made the agents blind in a way that cost
 * real findings. `measureUnits` guesses at currency from a lexicon that only
 * speaks English. `voidRows` recognises `Cancelled` and `Returned` and not
 * `Annulé`, `Storniert`, `RTO`, or `COD Failed`. No amount of cleverness about
 * column NAMES closes that, because the answer is in the values.
 *
 * So this is the primitive for showing them. Two decisions shape it.
 *
 * **Vocabulary beats rows.** Fifty raw records tell a model less about a status
 * column than the twenty distinct values that column actually holds, and cost
 * far more tokens to say it. So the briefing leads with, for each low-cardinality
 * dimension, its distinct values and how often each occurs — which is exactly
 * the shape of evidence needed to say "these two mean the row did not stand" or
 * "this column is amounts in mixed currencies".
 *
 * **Breadth beats depth.** A handful of whole rows still goes, because seeing one
 * complete record tells a model how the table is shaped in a way no per-column
 * summary does. They are taken on a stride across the whole table rather than
 * off the top, because the first fifty rows of a sorted export are one region,
 * one month, or one customer.
 *
 * High-cardinality columns are left out entirely. Twenty-five order IDs teach a
 * model nothing and are the part of a table most likely to be personal.
 */

/** Above this many distinct values, a column is an identifier to a reader too. */
const MAX_LEVELS = 40;

/** How many of a column's values are worth listing, most common first. */
const TOP_VALUES = 25;

/** Whole records, for shape. Few, because vocabulary carries the information. */
const SAMPLE_ROWS = 8;

/** Rows to walk when counting values. Enough to be representative, bounded. */
const SCAN_ROWS = 20000;

const norm = (s) => String(s ?? '').trim();

/**
 * The distinct values of each categorical column, and the range of each numeric one.
 *
 * @param {object[]} rows    the analysis view
 * @param {object}   profile dimensions, measures and cardinality
 * @returns {{dimensions: object, measures: object, sample: object[], scanned: number}}
 */
export function valueVocabulary(rows = [], profile = null, { maxLevels = MAX_LEVELS } = {}) {
  if (!rows?.length) return { dimensions: {}, measures: {}, sample: [], scanned: 0 };

  const cardinality = profile?.cardinality || {};
  const dimensions = (profile?.dimensions || []).filter(
    (d) => !cardinality[d] || cardinality[d] <= maxLevels
  );
  const measures = profile?.measures || [];

  // A stride across the whole table, not its first page. A sorted export's
  // opening rows are one region or one month, and a vocabulary built from them
  // is a description of that slice rather than of the data.
  const stride = Math.max(1, Math.floor(rows.length / SCAN_ROWS));
  const counts = new Map(dimensions.map((d) => [d, new Map()]));
  const numbers = new Map(measures.map((m) => [m, []]));
  let scanned = 0;

  for (let i = 0; i < rows.length; i += stride) {
    const row = rows[i];
    if (!row) continue;
    scanned += 1;
    for (const d of dimensions) {
      const value = norm(row[d]);
      if (!value) continue;
      const bucket = counts.get(d);
      bucket.set(value, (bucket.get(value) || 0) + 1);
    }
    for (const m of measures) {
      const n = Number(row[m]);
      if (Number.isFinite(n)) numbers.get(m).push(n);
    }
  }

  const out = { dimensions: {}, measures: {}, sample: strideSample(rows), scanned };

  for (const [column, bucket] of counts) {
    if (!bucket.size || bucket.size > maxLevels) continue;
    out.dimensions[column] = [...bucket.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_VALUES)
      .map(([value, count]) => ({ value, count, sharePct: round((count / scanned) * 100) }));
  }

  for (const [column, values] of numbers) {
    if (values.length < 2) continue;
    values.sort((a, b) => a - b);
    out.measures[column] = {
      min: round(values[0]),
      median: round(values[Math.floor(values.length / 2)]),
      max: round(values[values.length - 1]),
      // Negatives change what a total means, and a model reading a column of
      // amounts should know the column can go below zero.
      negatives: values[0] < 0,
    };
  }

  return out;
}

const round = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

/** A few whole records, spread across the table rather than taken off the top. */
function strideSample(rows) {
  const step = Math.max(1, Math.floor(rows.length / SAMPLE_ROWS));
  const out = [];
  for (let i = 0; i < rows.length && out.length < SAMPLE_ROWS; i += step) out.push(rows[i]);
  return out;
}

/**
 * The vocabulary as a briefing, small enough to send.
 *
 * Ordered by what a model can act on: the categorical vocabulary first, because
 * that is where a status, a currency code or a segment name lives; then the
 * numeric ranges; then the whole rows last, as context rather than evidence.
 */
export function valuesBriefing({ vocabulary = null, profile = null } = {}) {
  if (!vocabulary) return { columns: [], sample: [] };
  const cardinality = profile?.cardinality || {};

  return {
    columns: [
      ...Object.entries(vocabulary.dimensions || {}).map(([name, values]) => ({
        name,
        kind: 'category',
        levels: cardinality[name] || values.length,
        values,
      })),
      ...Object.entries(vocabulary.measures || {}).map(([name, range]) => ({
        name,
        kind: 'number',
        levels: cardinality[name] || null,
        range,
      })),
      // Columns with too many levels to list still exist and still matter to a
      // model working out what the table is about.
      ...(profile?.dimensions || [])
        .filter((d) => !(vocabulary.dimensions || {})[d])
        .map((name) => ({ name, kind: 'category', levels: cardinality[name] || null, values: null })),
    ],
    sample: vocabulary.sample || [],
  };
}
