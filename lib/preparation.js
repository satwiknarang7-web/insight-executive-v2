/**
 * What an analyst does to a table before charting it.
 *
 * A senior analyst handed a raw export does not open the chart menu. They read
 * the columns, derive the ones the file should have had — margin from revenue
 * and cost, month from the order date, city and state out of one address
 * field — decide which columns are noise, and name the two or three numbers the
 * business actually tracks. Everything downstream is better for it, and none
 * of it is a chart.
 *
 * This module is the guard on that judgement when a model supplies it. The
 * model is shown the table's shape and vocabulary — the same briefing the
 * semantics pass sees, no more — and returns steps and measures. Every step is
 * planned against the real column list before it is accepted, in the order the
 * model gave them, so a step that names a column that does not exist, or that
 * would only exist after a later step, is dropped with a reason. Every measure
 * is compiled by the same validator a typed one goes through. The model
 * proposes; this decides what reaches the engine.
 *
 * Then a second line: which accepted steps go into effect on their own. A step
 * that only ADDS a column changes nothing a reader has already seen, so those
 * are applied before the analysis and the charts get to use them. A step that
 * filters rows, drops a column or collapses the table changes what the numbers
 * mean, and that is offered — with the model's reason — for a person to accept
 * in Explore. `ADDITIVE_KINDS` in transforms.js is the line, and it is the same
 * line whether the proposal came from the model or was typed.
 */
import { valuesBriefing } from './valueBriefing.js';
import { claimsBriefing } from './semanticClaims.js';
import {
  ADDITIVE_KINDS,
  TRANSFORM_FIELDS,
  TRANSFORM_KINDS,
  describeTransform,
  planTransform,
} from './transforms.js';
import { validateExpression } from './measures.js';
import { uniqueMeasureName } from './measureLanguage.js';

/** How much of a model's enthusiasm survives. */
export const MAX_STEPS = 8;
export const MAX_MEASURES = 4;
const MAX_WHY = 240;
const FORMATS = new Set(['number', 'currency', 'percent']);

/**
 * What the model is shown.
 *
 * The values briefing when the worker has computed a vocabulary (it always has
 * for a loaded dataset), the bare column list otherwise. Plus what already
 * exists, so it does not propose a step that has been applied or a measure
 * that has been written.
 */
export function preparationBriefing({
  vocabulary = null,
  profile = null,
  columns = [],
  transforms = [],
  measures = [],
  fileName = '',
  rowCount = 0,
} = {}) {
  const values = vocabulary ? valuesBriefing({ vocabulary, profile }) : claimsBriefing({ profile });
  // Columns the profile does not list (a derived text column, say) are still
  // columns, and the model has to know they exist.
  const known = new Set(values.columns.map((c) => c.name));
  const extra = columns.filter((c) => !known.has(c)).map((name) => ({ name, kind: 'text', levels: null }));
  return {
    fileName,
    rowCount,
    columns: [...values.columns, ...extra],
    sample: values.sample || [],
    existingSteps: (transforms || []).filter((t) => t?.enabled !== false).map(describeTransform),
    existingMeasures: (measures || []).map((m) => ({ name: m.name, expr: m.expr })),
  };
}

const why = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_WHY);

/**
 * Keep only the fields a kind is defined to have.
 *
 * A model that writes `{ kind: "drop", column: "x", sql: "DROP TABLE" }` has
 * written a field nothing reads, and it should not travel. The whitelist is
 * the same table the briefing was written from.
 */
export function pickFields(raw) {
  const kind = String(raw?.kind || '').toLowerCase();
  if (!TRANSFORM_KINDS.includes(kind)) return null;
  const out = { kind };
  for (const field of Object.keys(TRANSFORM_FIELDS[kind] || {})) {
    if (raw[field] !== undefined) out[field] = raw[field];
  }
  return out;
}

/**
 * Accept the steps that were proposed, in order, against the real columns.
 *
 * Returns the ones that plan, with an id and the reason given for them, plus
 * the columns that exist once they have all run — which is what the measures
 * below are validated against, since a measure written over a column one of
 * its own steps creates is the whole point.
 *
 * A proposal may say where it came from. `derivedSteps.js` writes steps from
 * the vocabulary with no model involved, and they go through this same guard —
 * the difference is a word on a badge, not a weaker check.
 */
export function acceptSteps(raw, { columns = [], maxSteps = MAX_STEPS, prefix = 'ai' } = {}) {
  const proposals = Array.isArray(raw) ? raw : [];
  const steps = [];
  const skipped = [];
  let current = [...columns];

  for (const proposal of proposals) {
    if (steps.length >= maxSteps) {
      skipped.push({ proposal, reason: `Only the first ${maxSteps} steps are taken.` });
      continue;
    }
    const op = pickFields(proposal);
    if (!op) {
      skipped.push({ proposal, reason: `"${proposal?.kind}" is not a kind of step.` });
      continue;
    }
    const planned = planTransform(op, current);
    if (!planned.ok) {
      skipped.push({ proposal, reason: planned.error });
      continue;
    }
    steps.push({
      ...op,
      id: `${prefix}_${steps.length + 1}_${Date.now().toString(36)}`,
      source: proposal?.source === 'derived' ? 'derived' : 'model',
      why: why(proposal.why),
    });
    current = planned.columns;
  }

  return { steps, skipped, columns: current };
}

/**
 * Accept the measures a model proposed, against the columns its steps leave.
 */
export function acceptMeasures(raw, { columns = [], measures = [], maxMeasures = MAX_MEASURES } = {}) {
  const proposals = Array.isArray(raw) ? raw : [];
  const accepted = [];
  const skipped = [];
  const known = [...measures];

  for (const proposal of proposals) {
    if (accepted.length >= maxMeasures) {
      skipped.push({ proposal, reason: `Only the first ${maxMeasures} measures are taken.` });
      continue;
    }
    const expr = String(proposal?.expr || '').trim();
    if (!expr) {
      skipped.push({ proposal, reason: 'No formula.' });
      continue;
    }
    const checked = validateExpression(expr, { columns, measures: known, mode: 'measure' });
    if (!checked.ok) {
      skipped.push({ proposal, reason: checked.error });
      continue;
    }
    let filter = proposal?.filter ? String(proposal.filter).trim() : null;
    if (filter) {
      const f = validateExpression(filter, { columns, mode: 'filter' });
      if (!f.ok) {
        skipped.push({ proposal, reason: `Filter: ${f.error}` });
        continue;
      }
    }
    // The dimension to break it out by is optional and has to be real.
    const by = proposal?.by ? columns.find((c) => c.toLowerCase() === String(proposal.by).toLowerCase()) || null : null;

    const measure = {
      name: uniqueMeasureName(String(proposal.name || '').trim() || 'New measure', known),
      expr,
      filter,
      format: FORMATS.has(proposal?.format) ? proposal.format : 'number',
      source: 'model',
      explanation: why(proposal?.why || proposal?.explanation),
      text: why(proposal?.why || proposal?.explanation),
      by,
    };
    accepted.push(measure);
    known.push(measure);
  }

  return { measures: accepted, skipped };
}

/**
 * The whole reply, checked.
 *
 * @returns {{ steps, measures, skipped, summary, columns }}
 */
export function acceptPreparation(raw, { columns = [], measures = [], prefix = 'ai' } = {}) {
  const steps = acceptSteps(raw?.steps, { columns, prefix });
  const found = acceptMeasures(raw?.measures, { columns: steps.columns, measures });
  return {
    steps: steps.steps,
    measures: found.measures,
    skipped: [...steps.skipped, ...found.skipped],
    summary: why(raw?.summary),
    columns: steps.columns,
  };
}

/**
 * The preparation for a table, with or without a model.
 *
 * The steps this file's rules can justify from the vocabulary come first, and
 * the model's proposal follows. First, not last, for two reasons: they are all
 * additive, and `splitProposals` below stops applying at the first step that is
 * not — so behind a model's filter they would have been offered rather than
 * applied, which is the opposite of what they are for. And where both propose
 * the same column, the one that is already checked against the values wins,
 * while the duplicate is skipped by name with a reason rather than silently.
 *
 * With no model at all this is the whole preparation, which is the point: a
 * report built on a deployment holding no key still gets its month column.
 *
 * @param {object|null} model  an already-accepted proposal, or null
 * @returns {{ steps, measures, skipped, summary, columns }}
 */
export function preparationFor(model, { columns = [], measures = [], derived = [], prefix = 'ai' } = {}) {
  const proposed = [...derived.map((step) => ({ ...step, source: 'derived' })), ...(model?.steps || [])];
  const accepted = acceptPreparation(
    { steps: proposed, measures: model?.measures || [], summary: model?.summary },
    { columns, measures, prefix }
  );
  return { ...accepted, skipped: [...(model?.skipped || []), ...accepted.skipped] };
}

/**
 * Which accepted steps may go into effect without anyone being asked.
 *
 * Only the ones that add a column — and, since steps refer to each other, an
 * additive step that depends on a suggested one cannot run either. Rather than
 * chase dependencies, the split is taken at the first non-additive step: the
 * additive prefix runs, everything from that step on is suggested. The order
 * the model gave is kept in both lists.
 */
export function splitProposals(steps = []) {
  const automatic = [];
  const suggested = [];
  for (const step of steps) {
    if (!suggested.length && ADDITIVE_KINDS.includes(step.kind)) automatic.push(step);
    else suggested.push(step);
  }
  return { automatic, suggested };
}

/**
 * One line for the dashboard about what was done before the analysis ran.
 */
export function describePreparation({ applied = [], suggested = [], measures = [] } = {}) {
  const parts = [];
  if (applied.length) parts.push(`added ${applied.length} column${applied.length === 1 ? '' : 's'}`);
  if (measures.length) parts.push(`defined ${measures.length} measure${measures.length === 1 ? '' : 's'}`);
  if (suggested.length) parts.push(`suggested ${suggested.length} more step${suggested.length === 1 ? '' : 's'} for you to accept`);
  if (!parts.length) return '';
  const last = parts.pop();
  return `Before analysing, the analyst ${parts.length ? `${parts.join(', ')} and ${last}` : last}.`;
}

/* ------------------------------------------------------------------------- *
 * Ratios a model invented, measured against the rows
 * ------------------------------------------------------------------------- */

/**
 * A derived ratio has to be a ratio of something to something.
 *
 * `acceptSteps` above validates that a proposed step is well-formed against the
 * column list — the columns exist, the formula parses, nothing references a
 * column a later step creates. That is a check on grammar, and grammar is not
 * the failure mode here.
 *
 * A model asked to derive "the columns the file should have had" is given
 * `unit price from amount and quantity` as its example, and it generalises that
 * to any two numbers it can find. On a file of occupations it returned
 * `Average_Salary / Years_Experience` — "Salary Per Experience Year" — which is
 * well-formed, references two real numeric columns, compiles, runs, and is
 * meaningless. It then led the report: a histogram of it opened the deck, and a
 * correlation against it filled the second slide.
 *
 * What makes it meaningless is measurable. A ratio A/B says "how much A per
 * unit of B", and that is only a quantity when A actually accumulates over B.
 * In this file the correlation between salary and years of experience is 0.017:
 * they have nothing to do with each other, so A/B is just A scaled by an
 * unrelated random number. Its distribution is then dominated by the rows where
 * B happens to be small — median 5.9K, ninetieth percentile 26.4K, maximum
 * 149K — and the report described that artefact as a finding about pay,
 * complete with a recommendation to "design for the 1.1K-15.9K band".
 *
 * So the test is the correlation the ratio assumes, computed from the rows. A
 * denominator the numerator does not track is not a denominator.
 *
 * Deliberately permissive. This drops the ratios that are *demonstrably*
 * nothing, not the ones that are merely unusual, because a person's own formula
 * is never touched and a model's occasionally-odd but real ratio is better kept
 * than lost.
 */

/** Below this, the numerator does not track the denominator at all. */
const RATIO_CORRELATION = 0.15;

/** Rows walked to judge a ratio. Enough to settle 0.017 against 0.9. */
const RATIO_SAMPLE = 5000;

/**
 * The two columns of a formula that is nothing but one divided by another.
 *
 * Only the bare shape is read — `[A] / [B]`, with or without spaces. A formula
 * with arithmetic around the division is doing something more considered than
 * pairing two columns off, and is left alone.
 */
export function ratioParts(expr) {
  const m = /^\s*\[([^\]]+)\]\s*\/\s*\[([^\]]+)\]\s*$/.exec(String(expr ?? ''));
  return m ? { numerator: m[1], denominator: m[2] } : null;
}

/** Pearson's r between two columns, over the rows that have both. */
function correlation(rows, a, b) {
  const xs = [];
  const ys = [];
  for (const row of rows) {
    const x = Number(row?.[a]);
    const y = Number(row?.[b]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    xs.push(x);
    ys.push(y);
    if (xs.length >= RATIO_SAMPLE) break;
  }
  const n = xs.length;
  if (n < 30) return null;

  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
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
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** How often a column is zero, which is how often the ratio is undefined. */
function zeroShare(rows, column) {
  let seen = 0;
  let zero = 0;
  for (const row of rows) {
    const v = Number(row?.[column]);
    if (!Number.isFinite(v)) continue;
    seen++;
    if (v === 0) zero++;
    if (seen >= RATIO_SAMPLE) break;
  }
  return seen ? zero / seen : 0;
}

/**
 * Judge one proposed step against the rows.
 *
 * @returns {string|null} why it should be dropped, or null to keep it
 */
export function ratioObjection(step, rows) {
  if (step?.kind !== 'derive') return null;
  // A formula a person typed is theirs. This only ever judges what a model
  // volunteered, because the cost of being wrong is asymmetric: a dropped
  // suggestion is invisible, a dropped formula is a bug report.
  if (step?.source !== 'model') return null;

  const parts = ratioParts(step.expr);
  if (!parts) return null;

  const { numerator, denominator } = parts;

  // Dividing by a column that is sometimes zero produces Infinity, which then
  // sets the top of every axis it touches. `Years_Experience` reaches 0 in the
  // file this was written for.
  if (zeroShare(rows, denominator) > 0.01) {
    return `${denominator} is zero on some rows, so ${step.name} would be undefined there.`;
  }

  const r = correlation(rows, numerator, denominator);
  // Too few usable rows to judge from is not evidence against the step.
  if (r === null) return null;
  if (Math.abs(r) < RATIO_CORRELATION) {
    return (
      `${numerator} does not track ${denominator} (r = ${r.toFixed(2)}), ` +
      `so ${step.name} would measure how small ${denominator} happens to be rather than anything about ${numerator}.`
    );
  }
  return null;
}

/**
 * Split proposed steps into the ones the rows support and the ones they do not.
 *
 * @param {object[]} steps
 * @param {object[]} rows
 * @returns {{ steps: object[], skipped: {proposal: object, reason: string}[] }}
 */
export function gateRatios(steps = [], rows = []) {
  if (!rows.length) return { steps, skipped: [] };
  const kept = [];
  const skipped = [];
  for (const step of steps) {
    const objection = ratioObjection(step, rows);
    if (objection) skipped.push({ proposal: step, reason: objection });
    else kept.push(step);
  }
  return { steps: kept, skipped };
}
