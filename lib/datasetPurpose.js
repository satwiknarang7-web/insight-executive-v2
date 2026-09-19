/**
 * What the table is *for*, as opposed to what is in it.
 *
 * Everything the planner knew until now was statistics. It ranked dimensions by
 * cardinality plus a hard-coded list of English business words — `category`,
 * `brand`, `segment`, `channel`, `tier` — and it ranked measures by the width
 * of their numeric range. Neither question is "what is this file about", and on
 * a file those rules had not been written for the answers were nonsense.
 *
 * The case this was built from is a 44-row comparison of AI subscription plans.
 * Its whole point is the price columns, the benchmark scores, and two derived
 * columns — `USD per Intelligence Point`, `Intelligence per 100 USD` — that
 * exist for no other reason than to be compared. The planner charted none of
 * them. It led with `Average Context Window`, because that column is counted in
 * millions and so had the widest range in the file, and filled three more
 * slides with how many rows each vendor happened to contribute. Every number on
 * the page was arithmetically correct and the report was about nothing.
 *
 * So a model is shown the shape of the table — column names, what kind of thing
 * each holds, its levels or its range, and a handful of whole rows — and asked
 * four questions a person would ask before opening a spreadsheet:
 *
 *   - what does one row represent?
 *   - which columns would a reader actually want measured?
 *   - how would they want them broken out?
 *   - which columns are plumbing — ids, URLs, provenance, timestamps of the
 *     extract rather than of the event?
 *
 * **Nothing here computes a number, and nothing here can.** The model chooses
 * what to ask; the engine answers it, in SQL, over the reader's rows, exactly
 * as before. What comes back is a set of column names and, in `acceptPurpose`,
 * every one of them is checked against the columns that actually exist before
 * it can affect anything — the same contract `acceptUnitClaims` holds the unit
 * pass to. A name the model invented is dropped silently; a purpose with
 * nothing left in it is `null`, and `null` is today's behaviour exactly.
 *
 * Pure. No network, no DOM, no SQL — the call lives in `app/api/purpose`, and
 * the planner reads the result through `purposeRanking`.
 */

/** Caps. A briefing is a short answer to a short question, not an essay. */
export const MAX_KEY_MEASURES = 6;
export const MAX_KEY_DIMENSIONS = 6;
export const MAX_AVOID = 24;
export const MAX_QUESTIONS = 6;
const MAX_TEXT = 180;

const text = (value, max = MAX_TEXT) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * Resolve a name the model wrote to a column that exists.
 *
 * Case and spacing are forgiven because a model reading `Monthly Price USD`
 * will sometimes write `monthly price usd`, and refusing that would throw away
 * a correct answer over punctuation. Nothing else is forgiven: a name that
 * matches no column is not a column, whatever it looks like.
 */
function resolver(columns) {
  const byExact = new Map();
  const byLoose = new Map();
  for (const name of columns) {
    const key = String(name);
    byExact.set(key, key);
    const loose = key.toLowerCase().replace(/[\s_-]+/g, '');
    // First writer wins, so two columns that differ only in punctuation
    // resolve to the one declared first rather than to whichever came last.
    if (!byLoose.has(loose)) byLoose.set(loose, key);
  }
  return (raw) => {
    const name = String(raw ?? '').trim();
    if (!name) return null;
    if (byExact.has(name)) return byExact.get(name);
    return byLoose.get(name.toLowerCase().replace(/[\s_-]+/g, '')) || null;
  };
}

/** A list of column names, resolved, de-duplicated and capped, in order. */
function columnList(raw, resolve, cap) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    // Accept both a bare name and `{ column: name }`, because a model asked for
    // a list of columns produces both and the difference is not interesting.
    const resolved = resolve(entry && typeof entry === 'object' ? entry.column ?? entry.name : entry);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Check what the model said against the table it was shown.
 *
 * Returns `null` when there is nothing usable left, which the planner reads as
 * "no purpose" and handles by behaving exactly as it did before this existed.
 * That is the important property: this pass can fail, time out, be switched
 * off, or answer nonsense, and the analysis is the one that shipped yesterday.
 */
export function acceptPurpose(raw, { columns = [] } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Array.isArray(columns) || columns.length === 0) return null;

  const resolve = resolver(columns);

  const keyMeasures = columnList(raw.keyMeasures ?? raw.measures, resolve, MAX_KEY_MEASURES);
  const keyDimensions = columnList(raw.keyDimensions ?? raw.dimensions, resolve, MAX_KEY_DIMENSIONS);

  /**
   * A column cannot be both the point and the plumbing.
   *
   * When the model contradicts itself, the specific pick wins over the bulk
   * list: naming a column as a key measure is a deliberate choice, while
   * `avoid` is where the ids and the URLs are swept. Reading it the other way
   * lets one careless entry in a long list delete the best chart in the deck.
   */
  const named = new Set([...keyMeasures, ...keyDimensions]);
  const avoid = columnList(raw.avoid ?? raw.ignore, resolve, MAX_AVOID).filter((c) => !named.has(c));

  const subject = text(raw.subject ?? raw.grain);
  const questions = Array.isArray(raw.questions)
    ? raw.questions.map((q) => text(q)).filter(Boolean).slice(0, MAX_QUESTIONS)
    : [];

  // A purpose that names no column changes nothing the planner does, and a
  // sentence on its own is not worth carrying through four layers to display
  // nowhere.
  if (!keyMeasures.length && !keyDimensions.length && !avoid.length) return null;

  return { subject, keyMeasures, keyDimensions, avoid, questions };
}

/**
 * How strongly the purpose pushes on a column, by position in its list.
 *
 * The planner's own scores run about -5 to +5 — three points for a readable
 * number of levels, two for matching its word list, minus five for looking like
 * an identifier. These are deliberately larger than that band. The point is not
 * to nudge a ranking the statistics already decided; it is that on a file the
 * word list has never heard of, the statistics are not evidence about what
 * matters and should lose.
 *
 * `avoid` is the most decisive of the three because it is the cheapest to be
 * right about: a URL column, an as-of date, a source citation. Getting one of
 * those onto a slide is the most obviously broken thing a report can do.
 */
const PICK_TOP = 8;
const PICK_FLOOR = 3;
const AVOID_PENALTY = -14;

/** The purpose as lookups, built once per plan rather than per candidate. */
export function purposeRanking(purpose) {
  const rank = (list) => new Map((list || []).map((column, i) => [column, i]));
  return {
    measure: rank(purpose?.keyMeasures),
    dimension: rank(purpose?.keyDimensions),
    avoid: new Set(purpose?.avoid || []),
    subject: purpose?.subject || '',
  };
}

/**
 * What this column is worth, given what the file is for.
 *
 * `kind` is 'measure' or 'dimension' — a column can be named as one and not the
 * other, and a measure the reader cares about is not automatically a sensible
 * thing to group by.
 */
export function purposeScore(ranking, column, kind) {
  if (!ranking) return 0;
  if (ranking.avoid.has(column)) return AVOID_PENALTY;
  const order = kind === 'measure' ? ranking.measure : ranking.dimension;
  if (!order.has(column)) return 0;
  // First pick is worth the most, and the fall-off is one point per place so
  // that a list of six still separates its ends.
  return Math.max(PICK_FLOOR, PICK_TOP - order.get(column));
}

/** Is this column one the purpose says to keep off the report entirely? */
export function purposeAvoids(ranking, column) {
  return !!ranking?.avoid?.has(column);
}

/**
 * Order a list of measures by what the file is for, then by whatever the
 * caller was using before.
 *
 * `fallback` is the existing comparator, so a file the purpose pass says
 * nothing about is ordered exactly as it is today.
 */
export function orderByPurpose(columns, ranking, kind, fallback) {
  return [...columns].sort((a, b) => {
    const byPurpose = purposeScore(ranking, b, kind) - purposeScore(ranking, a, kind);
    if (byPurpose) return byPurpose;
    return fallback ? fallback(a, b) : 0;
  });
}
