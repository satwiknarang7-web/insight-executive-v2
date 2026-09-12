/**
 * What this deck says that its own numbers do not support.
 *
 * `lib/critic.js` asks what is MISSING. This asks what is OVERSTATED, and they
 * are different jobs done by different evidence: the critic reads the column
 * list and notices a gap, while this reads a sentence against the metrics it
 * was written from and notices a claim that is larger than they are.
 *
 * The reason it needs doing is that every sentence in this product has two
 * authors. The engine writes one from statistics it computed, and the narrator
 * rewrites it in better prose — and prose is exactly where a claim grows. A
 * flat line became "current efforts are not moving the needle", which is a
 * statement about efforts from a dataset with no column about effort. A leader
 * 3.7 standard deviations clear of the field became a recommendation to improve
 * the categories BELOW average. Both were readable, confident, and unsupported.
 *
 * Four checks, and the first one is the load-bearing idea:
 *
 * **This engine computes no causal estimate anywhere.** Not one. Every figure
 * it produces is an aggregate, a share, a spread or a correlation. So causal
 * language in any finding is unsupported by construction — not "probably
 * wrong", not "needs care", but claiming a kind of thing nothing here measured.
 * That makes it mechanically checkable rather than a matter of taste.
 *
 * **A correlation over groups is not a correlation over records.** Sixty points
 * that are sixty averages describe how the averages move; reading them as how
 * people behave is the ecological fallacy, and the engine's significance test
 * cannot see it because the arithmetic is the same either way.
 *
 * **A share of the shown rows is not a share of the business.** The engine
 * already records which denominator it used, in `sharesMeasuredAgainst`. This
 * is just holding the sentence to it.
 *
 * **And effort pointed away from the outlier.** A finding whose own metrics say
 * one group is clear of the field, carrying a recommendation to work on the
 * rest, has inverted itself between the statistic and the sentence.
 *
 * Everything here is a question, except one repair: a recommendation that
 * inverts its own metrics is CLEARED, because it is a discrete field and
 * removing it is the one fix that needs no evidence. Nothing here rewrites a
 * sentence, because writing a better one would need to know what is true.
 */

/** Past this many questions the panel stops being read. */
const MAX_QUESTIONS = 5;

/**
 * Language that reaches OUTSIDE the data for an explanation.
 *
 * Effort, strategy, initiatives, drivers, a needle being moved: none of those
 * are columns in anybody's table, and no arithmetic here produces them. A
 * sentence naming one is describing a world the analysis never saw.
 */
const EXTERNAL_CAUSE = [
  /\bbecause of\b/i,
  /\bdue to\b/i,
  /\bas a result of\b/i,
  /\b(growth|revenue|performance|key|main|underlying) drivers?\b/i,
  /\b(efforts?|initiatives?|strateg(y|ies)|campaigns?) (are|is|were|was|have|has)\b/i,
  /\bmoving the needle\b/i,
];

/**
 * Language that attributes one figure's movement to another figure.
 *
 * Kept separate because it is sometimes RIGHT. `analyzeContribution` decomposes
 * a total's movement into the components that moved it, and on that finding
 * "driven by Electronics" is the arithmetic, not an interpretation of it. On a
 * correlation or a ranking the same words are a causal claim over an engine
 * that estimates no causes, so they are only checked where nothing decomposed
 * anything.
 */
const ATTRIBUTED_CAUSE = [
  /\bcaus(e|es|ed|ing)\b/i,
  /\bleads? to\b/i,
  /\bresults? in\b/i,
  /\bdriven by\b/i,
];

/**
 * Metrics that mean a decomposition was actually computed.
 *
 * A waterfall names its largest mover and what share of the total movement it
 * carried. Where those exist, attributing movement to a component is reading
 * the chart rather than inventing a mechanism.
 */
const decomposed = (m) =>
  Number.isFinite(m?.largestMoveSharePct) || Number.isFinite(m?.grossMovement);

/*
 * Not listed anywhere above, and that is the measurement talking.
 *
 * "dictates", "will directly drive", "will determine" read as causal and are
 * usually arithmetic here: "any change in Electronics will dictate the total"
 * over a 72.6% share says a dominant component dominates, which is nearly a
 * tautology. An earlier version of this file caught it. Run against a real
 * deck it flagged two findings and one of them was fine, and a check a reviewer
 * learns to ignore is worse than no check.
 */

/** Prose that treats a share of the shown rows as a share of everything. */
const WHOLE_CLAIM = /\bof (the )?(total|all|everything|the business|overall)\b/i;

/** A recommendation pointing work at the field rather than at the outlier. */
const AWAY_FROM_LEADER =
  /\b(below|under) (the )?average\b|\bthe (rest|others|remaining|laggards?)\b|\bbottom (\d+|half|performers?)\b/i;

/** In standard deviations of the rest — past this the leader is genuinely apart. */
const CLEAR_OUTLIER_SD = 2;

/**
 * Fields that carry an instruction rather than a description.
 *
 * `macroInsights` is here because A7 moved the strongest recommendations onto
 * the opening page, which is the one surface a senior reader is guaranteed to
 * see and, until this, the one nothing checked.
 */
const ADVICE_FIELD = new Set(['recommendation', 'insight_question', 'macroInsights']);

const norm = (s) => String(s ?? '').trim();

/**
 * Every sentence a finding puts on the page, with the metrics behind it.
 *
 * Flattened this way because the same claim can arrive from either author and
 * has to be held to the same standard: `perChart` carries the engine's wording
 * before the deck paints, and the storyboard carries the narrator's after it
 * lands. One shape means one set of checks rather than two that drift.
 */
export function passages({ findings = [], storyboard = [], slideZero = null } = {}) {
  const out = [];
  const metricsById = new Map();

  /**
   * The executive summary, which is where a claim now lives.
   *
   * A7 moved the strongest findings into a written argument on the opening
   * page, and the checks here were reading findings and slides — so a
   * recommendation that inverted its own metrics was cleared off its slide and
   * printed, intact, in the summary. The one surface a senior reader is
   * guaranteed to read was the one nothing checked.
   *
   * Carried with the metrics of the finding each bullet was built from, matched
   * by the measure it names, so the same "does the sentence agree with its own
   * numbers" test applies here as anywhere else.
   */
  for (const [i, bullet] of (slideZero?.macroInsights || []).entries()) {
    const text = norm(bullet);
    if (!text) continue;
    const source = (findings || []).find((f) => norm(f?.measure) && text.includes(norm(f.measure)));
    out.push({
      id: String(source?.id ?? `summary_${i}`),
      field: 'macroInsights',
      text,
      title: 'the executive summary',
      metrics: source?.metrics || {},
      author: 'synthesiser',
    });
  }

  for (const f of findings || []) {
    const id = String(f?.id ?? '');
    metricsById.set(id, f?.metrics || {});
    for (const [field, text] of [
      ['headline', f?.headline],
      ['detail', f?.detail],
      ['recommendation', f?.recommendation],
    ]) {
      if (norm(text)) out.push({ id, field, text: norm(text), title: norm(f?.title), metrics: f?.metrics || {}, author: 'engine' });
    }
  }

  for (const slide of storyboard || []) {
    const id = String(slide?.id ?? '');
    const metrics = slide?.findings?.metrics || metricsById.get(id) || {};
    for (const [field, text] of [
      ['insight_anchor', slide?.insight_anchor],
      ['insight_implication', slide?.insight_implication],
      ['insight_question', slide?.insight_question],
    ]) {
      if (norm(text)) {
        out.push({
          id,
          field,
          text: norm(text),
          title: norm(slide?.chart?.title || slide?.pageTitle),
          metrics,
          author: 'narrator',
        });
      }
    }
  }
  return out;
}

/**
 * Read every sentence against the numbers it was written from.
 *
 * @param {object}   input
 * @param {object[]} [input.findings]   per-chart findings, before the deck paints
 * @param {object[]} [input.storyboard] the deck, after the narrator has been over it
 * @param {number}   [input.rowCount]   rows in the dataset, for the group-vs-record test
 * @returns {{kind, id, field, severity, note, question: string|null, repair: object|null}[]}
 */
export function checkValidity({ findings = [], storyboard = [], slideZero = null, rowCount = 0 } = {}) {
  const out = [];
  // One entry per kind per finding: the same overclaim in three sentences is
  // one problem with that finding, not three. But a later passage that can be
  // REPAIRED replaces an earlier one that can only be disclosed — otherwise a
  // cause in the prose, read first, would suppress the identical cause in the
  // recommendation, which is the one the pass can actually clear.
  const seen = new Map();
  const add = (item) => {
    const dedupe = `${item.kind}:${item.id}`;
    const held = seen.get(dedupe);
    if (held) {
      if (item.repair && !held.repair) out[out.indexOf(held)] = item;
      return;
    }
    seen.set(dedupe, item);
    out.push(item);
  };

  for (const p of passages({ findings, storyboard, slideZero })) {
    const m = p.metrics || {};

    // Nothing in this engine estimates a cause, so a sentence that reaches for
    // one is claiming a kind of thing that was never computed — unless the
    // engine did decompose the movement, in which case the attribution IS the
    // arithmetic.
    const external = EXTERNAL_CAUSE.some((re) => re.test(p.text));
    const attributed = !decomposed(m) && ATTRIBUTED_CAUSE.some((re) => re.test(p.text));
    if (external || attributed) {
      // A summary bullet is not a slide field and cannot be cleared through the
      // slide whitelist, so it is disclosed like any other paragraph.
      const isRecommendation = p.field === 'recommendation' || p.field === 'insight_question';
      add({
        kind: 'causal-claim',
        id: p.id,
        field: p.field,
        severity: 'high',
        note: `"${p.title}" explains its numbers by a cause. Nothing in this analysis measured one.`,
        question:
          `"${p.title}" reads a cause into the figures — every number behind it is an aggregate or a ` +
          'correlation, and neither shows what made anything happen. Is the cause known from outside the data?',
        // A recommendation is a discrete field and clearing it costs a sentence.
        // A paragraph is not: cutting a clause out of prose leaves a sentence
        // nobody wrote, so those are disclosed and left alone.
        repair: isRecommendation ? { op: 'clear_text', id: p.id, field: p.field, why: 'it named a cause the analysis did not measure' } : null,
      });
    }

    // The engine recorded which denominator it used. This holds the sentence to it.
    if (WHOLE_CLAIM.test(p.text) && shownOnly(m.sharesMeasuredAgainst)) {
      add({
        kind: 'shown-as-whole',
        id: p.id,
        field: p.field,
        severity: 'high',
        note: `"${p.title}" says "of the total" over shares measured against ${m.sharesMeasuredAgainst}.`,
        question:
          `"${p.title}" quotes a share as a share of the total, but the shares behind it were measured ` +
          `against ${m.sharesMeasuredAgainst}. Should it say which?`,
        repair: null,
      });
    }

    // A finding whose own metrics call one group a clear outlier, recommending
    // work on the rest, has inverted itself between the statistic and the prose.
    if (
      ADVICE_FIELD.has(p.field) &&
      AWAY_FROM_LEADER.test(p.text) &&
      Number.isFinite(m.leadOverFieldSd) &&
      Math.abs(m.leadOverFieldSd) >= CLEAR_OUTLIER_SD
    ) {
      add({
        kind: 'inverted-effort',
        id: p.id,
        field: p.field,
        severity: 'high',
        note: `"${p.title}" points effort away from ${m.leader}, which its own metrics put ${m.leadOverFieldSd} standard deviations clear.`,
        question:
          `"${p.title}" recommends working on the rest of the field, while its metrics put ${m.leader} ` +
          'clear of everything else. Which of the two is the instruction?',
        repair: { op: 'clear_text', id: p.id, field: p.field, why: 'it pointed effort away from the outlier its own metrics found' },
      });
    }
  }

  out.push(...ecological({ findings, storyboard, rowCount }));
  return out;
}

/** Shares measured against something narrower than the dataset. */
function shownOnly(basis) {
  const b = norm(basis).toLowerCase();
  return !!b && /shown|top|displayed|these|listed/.test(b);
}

/**
 * A correlation whose points are groups, read as a relationship between records.
 *
 * The arithmetic is identical either way, which is why the engine's
 * significance test cannot see it: r over sixty group averages is computed the
 * same as r over sixty rows and means something entirely different. Averages
 * are smoother than the things they average, so a relationship between them is
 * routinely far stronger than the one underneath — and a reader shown a tight
 * line concludes something about people that the chart never measured.
 */
function ecological({ findings = [], storyboard = [], rowCount = 0 }) {
  const charted = new Map((storyboard || []).map((s) => [String(s?.id), s?.chart]));
  const out = [];

  for (const f of findings || []) {
    const m = f?.metrics || {};
    if (!Number.isFinite(m.correlation) || !Number.isFinite(m.points)) continue;
    // Groups, not rows: the query aggregated before it correlated.
    if (!rowCount || m.points >= rowCount) continue;
    const chart = charted.get(String(f?.id));
    const unit = norm(chart?.dimension || chart?.xAxisKey) || 'group';
    out.push({
      kind: 'ecological',
      id: String(f?.id ?? ''),
      field: 'metrics',
      severity: 'medium',
      note: `"${norm(f?.title)}" correlates ${m.points} ${unit} averages, not ${rowCount} records.`,
      question:
        `"${norm(f?.title)}" measures a relationship across ${m.points} ${unit} averages rather than across ` +
        'the records themselves. Averages move together more tightly than the things they average — does ' +
        'the relationship survive at the row level?',
      repair: null,
    });
  }
  return out;
}

/** The findings that carry a fix. */
export const scepticRepairs = (items) => (items || []).filter((i) => i.repair);

/** The findings that become questions on the deck. */
export function scepticQuestions(items) {
  return (items || [])
    .filter((i) => i.question)
    .slice(0, MAX_QUESTIONS)
    .map((i) => ({ kind: i.kind, source: 'sceptic', question: i.question, evidence: i.note ? [i.note] : [] }));
}

// ---------------------------------------------------------------------------
// The half a rule list cannot do
// ---------------------------------------------------------------------------

/** Enough to widen the list; more and the panel stops being read. */
const MAX_MODEL_QUESTIONS = 3;

/** Past this a question has stopped being a question. */
const MAX_QUESTION_LENGTH = 240;

/**
 * What the model is shown: the shape of each claim, and none of its numbers.
 *
 * It gets what the finding is ABOUT — the column it grouped by, the measure it
 * aggregated, the chart type, how many groups it drew, what the evidence tier
 * came out as, and the NAMES of the statistics behind it. Not one value.
 *
 * That is enough to notice that a rate has been compared across groups of very
 * different sizes, or that a ranking is being read as a cause, and not enough
 * to assert anything — which is the same structural guarantee the critic runs
 * under. A model with no figures in front of it has none to quote, so a digit
 * in its reply is invented and `acceptScepticQuestions` drops it.
 */
export function scepticBriefing({ findings = [], profile = null } = {}) {
  return {
    rows: profile?.rowCount || null,
    claims: (findings || []).map((f) => ({
      id: String(f?.id ?? ''),
      title: norm(f?.title),
      chart: norm(f?.type),
      grouped_by: norm(f?.dimension) || null,
      measure: norm(f?.measure) || null,
      groups: Number.isFinite(f?.metrics?.points) ? f.metrics.points : null,
      evidence: norm(f?.metrics?.evidence) || null,
      // Names only. "leadOverFieldSd" says a standard-deviation lead was
      // computed; it does not say what it was.
      statistics: Object.keys(f?.metrics || {}).filter((k) => k !== 'evidenceNotes'),
    })),
  };
}

/**
 * Keep the questions it was allowed to ask.
 *
 * Same rules the critic's model half obeys, enforced here because the author is
 * not this codebase: a question and only a question, nothing with a figure in
 * it, nothing already asked, and every survivor marked as model-written so a
 * reader can tell which doubts were measured and which were imagined.
 */
export function acceptScepticQuestions(raw, { titles = [], existing = [] } = {}) {
  if (!Array.isArray(raw)) return [];
  const asked = new Set((existing || []).map((q) => normalise(q?.question || '')));
  const out = [];

  for (const item of raw) {
    const text = typeof item === 'string' ? item : item?.question;
    const question = norm(text).replace(/\s+/g, ' ');
    if (!question || question.length > MAX_QUESTION_LENGTH) continue;
    if (!question.endsWith('?')) continue;
    if (invented(question, titles)) continue;
    const k = normalise(question);
    if (!k || asked.has(k)) continue;
    asked.add(k);
    out.push({ kind: 'overclaim', source: 'sceptic', question, evidence: [] });
    if (out.length >= MAX_MODEL_QUESTIONS) break;
  }
  return out;
}

/** A digit outside one of the titles it was shown came from nowhere. */
function invented(text, titles) {
  let rest = String(text);
  for (const t of titles) {
    if (!t) continue;
    rest = rest.split(t).join(' ');
  }
  return /\d/.test(rest);
}

const normalise = (q) => String(q).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
