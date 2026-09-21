/**
 * What the dataset is about, proposed by a model and verified against the rows.
 *
 * Everything else in this codebase answers questions about *shape* — which
 * column can be summed, which has the widest spread, which dimension reads
 * legibly as bars. None of it answers the question a reader actually arrives
 * with, which is what the file is a record of and what about it is worth
 * knowing. That question was being answered by `OUTCOME_RE` in
 * `measureSemantics.js`: a list of about forty English nouns — churn, medal,
 * fraud, readmitted — against which a column name either matched or did not.
 *
 * It does not survive contact with a new domain. A file whose subject is
 * `Automation_Probability_2030` matches nothing on that list, so the analysis
 * had no dependent variable, so every column became interchangeable with every
 * other, so the deck led with a record count by whichever category read best.
 * The report was arithmetically perfect and about nothing. Lengthening the list
 * fixes that file and not the next one, which is the treadmill this module
 * exists to get off.
 *
 * So the subject is asked of a model, which has read the world's column names
 * and does not need ours enumerated — and then **none of what it says is
 * believed**. Every claim is re-derived from the rows here before it can reach
 * the planner, exactly as `acceptUnitClaims` already does for units and
 * `acceptVoidClaims` for void rows. The model proposes; this file is the part
 * that checks; the engine still computes every number itself.
 *
 * What that buys, and what it deliberately does not:
 *
 *   - A claim naming a column that does not exist is dropped.
 *   - A claim about a column whose rows do not have the claimed shape — a
 *     "binary" outcome with nine levels, a "continuous" one holding text — is
 *     dropped, because the model read the name and the rows are the fact.
 *   - An outcome another column *determines* is dropped. That is the tautology
 *     guard the planner already applies to breakdowns, applied one level up:
 *     a deck led by a column restating another is a definition with a chart
 *     around it, and it scores as STRONG EVIDENCE while saying nothing.
 *   - A driver that does not measurably move the outcome is dropped, whatever
 *     the model believed about it, using the statistic that fits the pair —
 *     spread across levels, or correlation where either side is a quantity.
 *
 * A brief that loses every claim is the same object as no brief at all, and the
 * analysis proceeds exactly as it does today on the lexicon alone. That is the
 * failure mode this is designed to have: no provider, no key, a timeout or a
 * model talking nonsense all degrade to the behaviour that shipped before it.
 */

import { association, associationIsReliable, determines, outcomeGroups, outcomeSpread } from './chartSignals.js';

/** Column roles the planner understands. Anything else is dropped. */
export const ROLES = new Set([
  'outcome',
  'driver',
  'attribute',
  'identifier',
  'preAggregate',
  'rate',
  'component',
]);

/** Outcome shapes the planner can build a chart for. */
export const OUTCOME_KINDS = new Set(['binary', 'continuous', 'ordinal', 'multiclass']);

/** At most this many outcomes, however many the model offers. */
export const MAX_OUTCOMES = 2;

/** At most this many reader questions carried through to the report. */
export const MAX_QUESTIONS = 5;

/**
 * How much a driver has to move the outcome before the claim is allowed to
 * stand.
 *
 * The spread of the outcome across the driver's levels — the same measurement
 * the planner uses to decide whether that chart is worth drawing. Low, because
 * this is a floor on "has any relationship at all" rather than a threshold on
 * "is interesting": how interesting is measured later, from the rows, and that
 * measurement is the one that decides the deck. A driver only has to be worth
 * *scoring* to survive here.
 *
 * See `movesOutcome`, which picks the statistic to match the pair rather than
 * using one for all of them.
 */
const DRIVER_FLOOR = 0.05;

/** Above this many distinct values, a column is judged as a quantity. */
const MANY_LEVELS = 50;

/** The same floor for a driver judged by correlation rather than by spread. */
const DRIVER_CORRELATION = 0.1;

/**
 * Above this, one column does not predict the outcome — it restates it.
 *
 * The same constant as the planner's `restatesOutcome`, for the same reason and
 * deliberately at the very top of the range: a dimension that predicts the
 * outcome well is the best chart in the deck, and only one that *fixes* it is
 * worthless.
 */
const TAUTOLOGY = 0.99;

/** Rows sampled for every association computed here. */
const SAMPLE = 4000;

const norm = (v) => String(v ?? '').trim().toLowerCase();
const isBlank = (v) => v === null || v === undefined || v === '';

/** The distinct non-blank values of a column, as strings. */
function levelsOf(rows, column, cap = 60) {
  const seen = new Set();
  for (const row of rows) {
    const v = row?.[column];
    if (isBlank(v)) continue;
    seen.add(String(v));
    if (seen.size > cap) break;
  }
  return [...seen];
}

/** How much of a column parses as a finite number. */
function numericShare(rows, column, sample = 400) {
  let seen = 0;
  let numeric = 0;
  for (const row of rows) {
    const v = row?.[column];
    if (isBlank(v)) continue;
    seen++;
    if (typeof v === 'number' ? Number.isFinite(v) : Number.isFinite(Number(v))) numeric++;
    if (seen >= sample) break;
  }
  return seen ? numeric / seen : 0;
}

/**
 * The raw type a column holds, read from the rows rather than from the profile.
 *
 * `distinctLevels` and every other helper in this codebase stringifies, which
 * is right for comparing labels and silently wrong for building SQL: a flag
 * parsed from CSV holds the number 1, and `[col] = '1'` matches nothing. The
 * outcome expression needs the real type, so it is read once, here, while the
 * rows are in hand.
 */
function valueTypeOf(rows, column) {
  for (const row of rows) {
    const v = row?.[column];
    if (isBlank(v)) continue;
    return typeof v;
  }
  return 'string';
}

/**
 * Every column the dataset actually has, from whichever profile shape is handy.
 *
 * The profile splits columns across `measures`, `dimensions`, `keys` and
 * `temporal`, and which list a column lands in is exactly the judgement the
 * brief may disagree with — a 0-1 probability profiles as a measure and is the
 * dependent variable. So existence is checked against the union, and shape is
 * checked against the rows.
 */
function knownColumns(profile) {
  const p = profile || {};
  return new Set(
    [...(p.measures || []), ...(p.dimensions || []), ...(p.keys || []), ...(p.temporal || [])].map(String)
  );
}

/** Resolve a model's spelling of a column to the dataset's own. */
function resolveColumn(name, known) {
  const want = String(name ?? '');
  if (!want) return null;
  if (known.has(want)) return want;
  const lower = norm(want);
  for (const col of known) {
    if (norm(col) === lower) return col;
  }
  // `Average Salary` for `Average_Salary`: punctuation is the only difference
  // people and models reliably get wrong, and it is unambiguous to undo.
  const loose = lower.replace(/[^a-z0-9]+/g, '');
  for (const col of known) {
    if (norm(col).replace(/[^a-z0-9]+/g, '') === loose) return col;
  }
  return null;
}

/**
 * Does the column hold what the model said it holds?
 *
 * This is the check that matters most, because the model saw a name and a
 * handful of values and the planner is about to build the whole deck on the
 * answer. A claim that survives here is one the rows themselves support.
 *
 * @returns {{ ok: true, levels: string[] }|{ ok: false, reason: string }}
 */
function shapeFits(kind, rows, column, cardinality) {
  const distinct = cardinality?.[column] ?? levelsOf(rows, column).length;
  const levels = levelsOf(rows, column);

  if (kind === 'binary') {
    if (distinct !== 2) return { ok: false, reason: `${column} has ${distinct} distinct values, not 2.` };
    return { ok: true, levels };
  }

  if (kind === 'continuous') {
    if (numericShare(rows, column) < 0.9) {
      return { ok: false, reason: `${column} is not numeric enough to average.` };
    }
    /**
     * A numeric column with three values is an ordinal wearing numbers, and
     * averaging it produces a figure between two categories that means nothing.
     *
     * But "few distinct values" only means that relative to the table. A flat
     * cut at twelve rejected `Intelligence Index` — nine distinct scores across
     * forty-four plans, which is a genuine measurement and the column that
     * comparison table exists to rank on — while accepting a 1-to-5 rating
     * repeated over three thousand rows, which is the thing the rule was for.
     * What separates them is how much of the column's range the data explores,
     * not the count on its own.
     */
    const n = rows.length;
    const varied = distinct >= 12 || (n > 0 && distinct / n >= 0.1);
    if (distinct < 5 || !varied) {
      return {
        ok: false,
        reason: `${column} has only ${distinct} distinct values across ${n} rows — it is a category, not a quantity.`,
      };
    }
    return { ok: true, levels: [] };
  }

  // ordinal and multiclass: a handful of named levels.
  if (distinct < 2) return { ok: false, reason: `${column} has one value.` };
  if (distinct > 12) {
    return { ok: false, reason: `${column} has ${distinct} levels — too many to read as an outcome.` };
  }
  return { ok: true, levels };
}

/**
 * Is this outcome merely another column restated?
 *
 * Checked against every other column rather than against a list of names, for
 * the reason the rest of the planner avoids lexicons: the duplicate can be
 * called anything in any language, and 1.0 means one column determines the
 * other whatever either is called.
 *
 * A continuous outcome is excused. Cramer's V on a column with two thousand
 * distinct values is near 1.0 against anything with similar cardinality — it is
 * measuring uniqueness, not determination — so the test would drop every
 * continuous outcome that exists. The band chart the planner builds from one is
 * the thing that would expose a genuine restatement anyway.
 */
function restated(rows, column, kind, known) {
  if (kind === 'continuous') return null;
  for (const other of known) {
    if (other === column) continue;
    // `determines` refuses to answer from a contingency table too sparse to
    // answer from. Plain Cramer's V here reported that a column of 3,000
    // distinct salaries determined a three-level risk band, and dropped the
    // outcome the brief got right.
    if (determines(rows, column, other, { threshold: TAUTOLOGY })) return other;
  }
  return null;
}

/**
 * Which level of a categorical outcome is the event worth counting.
 *
 * For a binary outcome the model is asked outright and the answer is checked
 * against the column's own levels. For an ordinal one — Low/Medium/High — the
 * event is the level the model named as the severe end, again checked. A level
 * the model invented is not substituted for a guess: the claim is dropped,
 * because a rate of the wrong level is worse than no rate at all.
 */
function resolveEvent(claimed, levels) {
  const want = norm(claimed);
  if (!want) return null;
  return levels.find((v) => norm(v) === want) ?? null;
}

/**
 * Does this column actually move the outcome, in these rows?
 *
 * One statistic does not answer this. Cramer's V is right between two
 * categories and badly wrong when either side is continuous: a column of 600
 * distinct salaries against a probability produces a nearly empty contingency
 * table, chi-squared explodes, and V comes back well clear of any floor — so
 * `Salary` survived as a "driver" of automation risk in data where it was
 * generated at random.
 *
 * So the test matches the pair:
 *
 *   few levels, any outcome   the spread of the outcome across those levels,
 *                             which is the same measurement the planner uses to
 *                             decide whether the chart is worth drawing
 *   many levels, continuous   Pearson between the two columns
 *   many levels, categorical  Pearson against the event as a 0/1 indicator
 *
 * Deliberately a low bar. This only has to separate "has some relationship" from
 * "was generated independently"; how much of a relationship is worth a slide is
 * measured later, from the rows, and that measurement decides the deck.
 */
function movesOutcome(rows, column, outcome) {
  const levels = new Set();
  for (const row of rows) {
    const v = row?.[column];
    if (isBlank(v)) continue;
    levels.add(String(v));
    if (levels.size > MANY_LEVELS) break;
  }

  if (levels.size <= MANY_LEVELS) {
    const groups = outcomeGroups(rows, column, outcome.column, outcome.event, { kind: outcome.kind });
    if (groups.length >= 2) return outcomeSpread(groups) >= DRIVER_FLOOR;
    // Too few groups to compare is not evidence either way, and a categorical
    // pair can still be judged the old way when the table supports it.
    return associationIsReliable(rows, column, outcome.column)
      ? association(rows, column, outcome.column) >= DRIVER_FLOOR
      : false;
  }

  // A column with hundreds of levels is a quantity, whatever its type.
  const target =
    outcome.kind === 'continuous'
      ? (row) => Number(row?.[outcome.column])
      : (row) => (String(row?.[outcome.column]) === String(outcome.event) ? 1 : 0);

  const xs = [];
  const ys = [];
  for (const row of rows) {
    const x = Number(row?.[column]);
    const y = target(row);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    xs.push(x);
    ys.push(y);
  }
  const n = xs.length;
  if (n < 30) return false;

  const mx = xs.reduce((a, v) => a + v, 0) / n;
  const my = ys.reduce((a, v) => a + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return false;
  return Math.abs(sxy / Math.sqrt(sxx * syy)) >= DRIVER_CORRELATION;
}

/**
 * Verify a model's brief against the rows, and return only what survives.
 *
 * @param {object}   raw                 the model's reply, unvalidated
 * @param {object}   context
 * @param {object[]} context.rows        the analysis rows
 * @param {object}   context.profile     measures, dimensions, keys, cardinality
 * @param {object}   [context.cardinality] distinct counts, when profiled already
 * @returns {{ subject: string|null, outcomes: object[], roles: object,
 *             questions: string[], dropped: {claim: string, reason: string}[] }}
 */
export function acceptBrief(raw, { rows = [], profile = null, cardinality = null } = {}) {
  const empty = { subject: null, outcomes: [], roles: {}, questions: [], dropped: [] };
  if (!raw || typeof raw !== 'object' || !rows.length) return empty;

  const known = knownColumns(profile);
  if (!known.size) return empty;

  const sample = rows.length > SAMPLE ? rows.slice(0, SAMPLE) : rows;
  const counts = cardinality || profile?.cardinality || {};
  const dropped = [];
  const drop = (claim, reason) => dropped.push({ claim: String(claim), reason });

  /* The subject is prose and steers nothing — it is shown to the reader and
     given to the narrator as context. There is nothing in it to verify beyond
     its being a short string, so it is trimmed rather than checked. */
  const subject =
    typeof raw.subject === 'string' && raw.subject.trim() ? raw.subject.trim().slice(0, 200) : null;

  /* Outcomes: the claims with teeth. Each one that survives becomes the
     dependent variable of the whole deck, so each is checked three ways —
     the column exists, the rows have the claimed shape, and nothing else in
     the table determines it. */
  const outcomes = [];
  for (const claim of Array.isArray(raw.outcomes) ? raw.outcomes : []) {
    if (outcomes.length >= MAX_OUTCOMES) break;

    const column = resolveColumn(claim?.column, known);
    if (!column) {
      drop(claim?.column ?? 'outcome', 'No column by that name.');
      continue;
    }
    if (outcomes.some((o) => o.column === column)) continue;

    const kind = String(claim?.kind ?? '');
    if (!OUTCOME_KINDS.has(kind)) {
      drop(column, `"${kind}" is not an outcome shape.`);
      continue;
    }

    const fit = shapeFits(kind, sample, column, counts);
    if (!fit.ok) {
      drop(column, fit.reason);
      continue;
    }

    const twin = restated(sample, column, kind, known);
    if (twin) {
      drop(column, `${twin} determines it — charting one against the other restates a definition.`);
      continue;
    }

    /* Which level is counted. Continuous outcomes have none: the aggregate is
       the mean, and there is nothing to name. */
    let event = null;
    if (kind !== 'continuous') {
      event = resolveEvent(claim?.event, fit.levels);
      if (!event) {
        drop(column, `"${claim?.event}" is not one of its values.`);
        continue;
      }
    }

    outcomes.push({
      column,
      kind,
      event,
      levels: fit.levels,
      // Whether a high number is bad news, which is what the scorecard needs
      // before it calls anything a risk. The model is asked and the answer is
      // taken, because it is the one claim here with nothing in the rows to
      // check it against — and getting it wrong changes a verb, not a figure.
      highIsGood: claim?.high_is_good === true,
      valueType: valueTypeOf(sample, column),
      why: typeof claim?.why === 'string' ? claim.why.trim().slice(0, 240) : '',
    });
  }

  /* Roles. These only ever *narrow* what the planner would do — a column
     marked `identifier` stops being summed — so an unrecognised role is
     dropped rather than guessed at. A driver additionally has to earn its
     label against the outcome, measured here. */
  const roles = {};
  const outcomeCols = outcomes.map((o) => o.column);
  for (const [name, value] of Object.entries(raw.roles && typeof raw.roles === 'object' ? raw.roles : {})) {
    const column = resolveColumn(name, known);
    if (!column) {
      drop(name, 'No column by that name.');
      continue;
    }
    const role = String(value ?? '');
    if (!ROLES.has(role)) {
      drop(column, `"${role}" is not a role.`);
      continue;
    }
    if (role === 'driver') {
      if (!outcomes.length) {
        drop(column, 'Nothing to drive — no outcome survived.');
        continue;
      }
      // Measured, not believed. A model is confident about which columns
      // "should" explain an outcome and is wrong often enough that an unchecked
      // driver list would promote noise to the front of the deck.
      const moves = outcomes.some((o) => o.column !== column && movesOutcome(sample, column, o));
      if (!moves) {
        drop(column, 'Does not move the outcome in these rows.');
        continue;
      }
    }
    roles[column] = role;
  }

  /* Questions are prose for the report's framing. Nothing is computed from
     them, so they are capped and trimmed and otherwise taken as written. */
  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .filter((q) => typeof q === 'string' && q.trim())
    .slice(0, MAX_QUESTIONS)
    .map((q) => q.trim().slice(0, 200));

  return { subject, outcomes, roles, questions, dropped };
}

/** Does this brief actually say anything the planner can use? */
export function briefIsUseful(brief) {
  return Boolean(brief && (brief.outcomes?.length || Object.keys(brief.roles || {}).length));
}
