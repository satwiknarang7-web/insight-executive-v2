/**
 * What the two plans are, and what each one may do.
 *
 * Pure and shared. The sign-up screen reads it to draw the choice, the app
 * reads it to decide what to show, and the server reads it to decide what to
 * allow — one definition rather than three that drift. Nothing here touches a
 * database or a request.
 *
 * The split is on **one thing**: whether a model may be called on this
 * account's behalf. Everything the engine computes itself — the cleaning, the
 * SQL, the statistics, the charts a person builds by hand — is free, because
 * none of it costs anything to serve and a product that hides its own
 * arithmetic behind a paywall is not a product anyone should buy.
 *
 * What is paid is the model: questions a model suggests for a table, the
 * questions asked in English, the prose, the narration. A report built from the
 * questions a reader picks is free — the catalogue that proposes them and the
 * compiler that answers them run in the browser and cost nothing to serve
 * (docs/design/question-first-reports.md, phase 3). `capabilities` below is
 * the whole contract, and `planAllows` is the only way to ask about it.
 */

export const FREE = 'free';
export const PRO = 'pro';

/** Every plan id, in the order they are offered. */
export const PLAN_IDS = [FREE, PRO];

/**
 * Capabilities a plan grants.
 *
 * `model` gates every route that can reach a language model — the thing the
 * paid plan sells. `autoAnalysis` gates the engine building a report from
 * chosen questions, the alternative to "build from scratch"; both plans have it.
 */
export const PLANS = {
  [FREE]: {
    id: FREE,
    name: 'Free',
    price: 'Free',
    cadence: '',
    tagline: 'Clean your data, pick your questions, get the report.',
    capabilities: {
      model: false,
      autoAnalysis: true,
      manualDashboard: true,
    },
    includes: [
      'Upload CSV and Excel, or connect a database',
      'Cleaning, type coercion and PII redaction',
      'A report built from the questions you pick',
      'Build charts and measures by hand',
      'Export a report, or present what you built',
    ],
    excludes: ['Questions suggested by a model', 'Questions in plain English', 'Written summaries and narration'],
  },
  [PRO]: {
    id: PRO,
    name: 'Pro',
    price: '$29',
    cadence: '/month',
    tagline: 'Everything in Free, plus the analyst that builds it for you.',
    capabilities: {
      model: true,
      autoAnalysis: true,
      manualDashboard: true,
    },
    includes: [
      'Everything in Free',
      'Questions a model suggests for each table, checked against your rows',
      'Ask questions in plain English and get a chart with its SQL',
      'Written executive summaries, critiques and narration',
      'Choose per dataset: build from scratch, or let the analyst build it',
    ],
    excludes: [],
  },
};

/** The plan a row, a token or a guess resolves to. Anything unknown is free. */
export function normalizePlan(value) {
  const id = String(value || '').trim().toLowerCase();
  return PLAN_IDS.includes(id) ? id : FREE;
}

/**
 * May this plan do this?
 *
 * The single question the rest of the codebase asks. Capability names are the
 * keys of `capabilities` above; an unknown name is refused rather than assumed,
 * so a typo closes a gate instead of opening one.
 */
export function planAllows(plan, capability) {
  const entry = PLANS[normalizePlan(plan)];
  return entry?.capabilities?.[capability] === true;
}

/** Display metadata for a plan id. Never null — an unknown id reads as free. */
export function planInfo(plan) {
  return PLANS[normalizePlan(plan)];
}

/**
 * The two ways a paid account can start a dataset.
 *
 * Offered when a dataset is loaded, not at sign-up: which one is right depends
 * on the data in front of you, and someone who wanted the analyst for last
 * quarter's exports may want to lay out this month's by hand.
 */
export const BUILD_MODES = {
  scratch: {
    id: 'scratch',
    title: 'Build from scratch',
    body: 'An empty dashboard. You choose every chart and measure. Nothing is sent to a model.',
    requires: 'manualDashboard',
  },
  assisted: {
    id: 'assisted',
    title: 'A report from your questions',
    body: 'Pick what you want to know; every chart answers one of your questions, computed from your rows.',
    requires: 'autoAnalysis',
  },
};

/** The build modes this plan may choose between. */
export function buildModesFor(plan) {
  return Object.values(BUILD_MODES).filter((mode) => planAllows(plan, mode.requires));
}
