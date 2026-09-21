/**
 * What a number in this dataset actually *means*.
 *
 * The planner used to see a joined table as a bag of numeric columns and pick
 * whichever had the widest spread. That is fine until a dimension table joins
 * in, and then it is quietly catastrophic: `customers.Total_Spent` is a
 * lifetime total that repeats on every one of that customer's order rows, so
 * summing it across the fact table multiplies each customer's spend by their
 * order count. On a real 250k-row store export that produced a headline of
 * 34.3B against a true figure of 4.74B — a 7.2x overstatement, with the actual
 * revenue column sitting unused in the same table.
 *
 * The cure is not a longer list of banned names. It is knowing where a column
 * came from. `lib/dataModel.js` already records provenance for every column in
 * the joined view, and marks each source table as a fact or a dimension; this
 * module turns that into the one distinction the planner needs:
 *
 *   additive      — a fact measure. SUM means something.
 *   preAggregate  — someone else's SUM, arriving from a dimension table. It may
 *                   be averaged at its own grain and must never be summed here.
 *   rate          — a price, score or percentage. Average it, never sum it.
 *   identifier    — a key. Count it, distinctly; never aggregate it.
 *
 * The second half of the file uses those roles to derive the measures an
 * analyst would have written by hand — order value, discount rate, basket size
 * — so that the automatic report can talk about the business rather than about
 * whichever column happened to have the largest numbers.
 */

import { repetitionReason } from './dataGrain.js';
import { detectDenomination } from './measureUnits.js';

/** Names that mean "already aggregated by someone else". */
const PRE_AGGREGATE_RE = /(^|[\s_-])(total|sum|count|num|number|qty|orders|spent|lifetime|ltv|ytd|mtd|cumulative|running)([\s_-]|$)|^(total|avg|average|mean|min|max)[\s_-]/i;

/** Names that are a rate, price or score: averaging is the only honest aggregate. */
const RATE_RE = /(per[\s_-]?capita|\bper\b|ratio|percent|\bpct\b|\brate\b|\baverage\b|\bavg\b|\bmean\b|\bmedian\b|\bindex\b|\bscore\b|\brating\b|\bnps\b|\bgrowth\b|price|\bcost\b|\bweight\b|\bage\b)/i;

/**
 * The only aggregate that is honest for a column, judged from its name alone.
 *
 * The full classification needs the whole table — what repeats, what is
 * denominated, what the grain is — and the chart builder has none of that when
 * it seeds a form. What it does have is the name, and the name is enough to
 * separate "a quantity you can add up" from "a price, a rate or a score, where
 * adding is a category error". Shared with `classifyColumns` so there is one
 * definition of that line rather than two that drift.
 */
export function honestAggregate(column) {
  return RATE_RE.test(String(column ?? '')) ? 'AVG' : 'SUM';
}

/** Names that identify a row rather than measure it. */
const IDENTIFIER_RE = /(^|[\s_-])(id|key|code|uuid|guid|pincode|zip|postcode|phone|number)([\s_-]|$)|_id$|^id$/i;

/** Money-ish column names, used to pick the measure a business cares about. */
const MONEY_RE = /(revenue|sales|amount|value|spend|spent|price|cost|charge|billing|turnover|gmv)/i;

/** A part of a larger amount: these make sense as a share of something else. */
const COMPONENT_RE = /(discount|shipping|freight|tax|fee|commission|refund|coupon|surcharge)/i;

/** Quantity-ish names, for basket size. */
const QUANTITY_RE = /(quantity|qty|units|items|pieces|count)/i;

/** Columns whose levels describe an outcome, and the levels that are failures. */
const STATUS_RE = /(status|outcome|result|disposition|state$|stage)/i;
const NEGATIVE_LEVEL_RE = /^(cancel|return|refund|fail|reject|churn|lost|abandon|void|declin)/i;

const br = (name) => `[${name}]`;
const norm = (s) => String(s ?? '').toLowerCase();

/**
 * Classify every column of the joined view.
 *
 * `provenance` and `roles` come from the data model. When they are absent — a
 * single-sheet upload — every column is treated as belonging to the fact table,
 * which is exactly right: there is nothing else for it to belong to.
 */
export function classifyColumns({
  profile,
  provenance = {},
  roles = {},
  cardinality = {},
  rowCount = 0,
  repeatedAt = {},
  denominatedBy = null,
} = {}) {
  const numeric = profile?.measures || [];
  const categorical = profile?.dimensions || [];
  const byColumn = {};
  // Derived from names and cardinality alone, so it is cheap enough to work out
  // here when a caller has not already done it.
  // Measured first, claimed second. `denominatedBy` used to REPLACE the
  // detection rather than extend it, which would have let a model claim
  // overrule a column the lexicon had already settled. It fills gaps now: what
  // was found in the table wins every collision.
  const units = { ...(denominatedBy || {}), ...detectDenomination({ profile, cardinality }) };

  const sourceOf = (col) => {
    const table = provenance?.[col]?.table || null;
    return { table, role: table ? roles[table] || 'fact' : 'fact' };
  };

  for (const col of numeric) {
    const { table, role } = sourceOf(col);
    const distinct = cardinality[col] || 0;
    let kind;
    let why;

    if (IDENTIFIER_RE.test(col) || (rowCount > 8 && distinct >= 0.95 * rowCount)) {
      kind = 'identifier';
      why = 'identifies a row rather than measuring one';
    } else if (role === 'dimension') {
      // The important rule. A number arriving from a dimension table repeats
      // once per fact row, so summing it counts the same value many times.
      kind = PRE_AGGREGATE_RE.test(col) ? 'preAggregate' : 'attribute';
      why = `comes from ${table}, which joins one row to many — summing it would double count`;
    } else if (repeatedAt[col]) {
      // The same rule, reached without provenance. A file that was joined
      // before it was uploaded has no dimension table left to point at, but the
      // repetition it caused is still measurable: `lib/dataGrain.js` finds the
      // coarser group each value is constant within. Treating that as the same
      // kind is the point — everything downstream already refuses to sum,
      // average, bucket or correlate an attribute, and none of it needs to know
      // whether the evidence came from a join or from the rows.
      kind = PRE_AGGREGATE_RE.test(col) ? 'preAggregate' : 'attribute';
      why = repetitionReason(repeatedAt[col]);
    } else if (units[col]) {
      // Not a statement about the measure, but about the rows: they are not in
      // a common unit, so every aggregate that combines them is adding unlike
      // quantities. Averaging is no safer than summing here, which is why this
      // is its own kind rather than a rate.
      kind = 'denominated';
      why = units[col].why;
    } else if (RATE_RE.test(col)) {
      kind = 'rate';
      why = 'a price, rate or score: averaging is the only honest aggregate';
    } else if (PRE_AGGREGATE_RE.test(col)) {
      kind = 'additive';
      why = 'a fact-table total';
    } else {
      kind = 'additive';
      why = 'a fact-table quantity';
    }
    byColumn[col] = { kind, table, tableRole: role, why };
  }

  for (const col of categorical) {
    const { table, role } = sourceOf(col);
    byColumn[col] = {
      kind: IDENTIFIER_RE.test(col) ? 'identifier' : 'category',
      table,
      tableRole: role,
      why: null,
    };
  }

  const of = (kind) => Object.keys(byColumn).filter((c) => byColumn[c].kind === kind);
  return {
    byColumn,
    additive: of('additive'),
    preAggregate: of('preAggregate'),
    attribute: of('attribute'),
    denominated: of('denominated'),
    rates: of('rate'),
    identifiers: of('identifier'),
    categories: of('category'),
  };
}

/**
 * The column that identifies one transaction.
 *
 * Needed for anything "per order": the fact table has one row per line item or
 * per order, and only a distinct count of its key tells you which.
 */
export function grainKey({ columns = [], provenance = {}, roles = {}, cardinality = {}, rowCount = 0 } = {}) {
  const fromFact = (col) => {
    const table = provenance?.[col]?.table;
    return !table || (roles[table] || 'fact') === 'fact';
  };
  const candidates = columns.filter(
    (c) => fromFact(c) && /(^|[\s_-])(order|invoice|transaction|receipt|booking|ticket)([\s_-]|$)|order_?id/i.test(c) && IDENTIFIER_RE.test(c)
  );
  if (!candidates.length) return null;
  // The key closest to one-per-row is the transaction; a coarser one is a batch.
  return candidates.sort((a, b) => (cardinality[b] || 0) - (cardinality[a] || 0))[0] || null;
}

/** Pick the money column a business would call revenue. */
function primaryMoney(additive, cardinality) {
  const money = additive.filter((c) => MONEY_RE.test(c) && !COMPONENT_RE.test(c));
  if (!money.length) return null;
  // "total_amount" beats "unit_price" beats "amount": prefer the one whose name
  // says it is the whole of a transaction.
  const score = (c) => (/(total|amount|revenue|gmv|turnover)/i.test(c) ? 2 : 0) + (/value/i.test(c) ? 1 : 0);
  return [...money].sort((a, b) => score(b) - score(a))[0];
}

/**
 * Derive the measures an analyst would have written.
 *
 * Every one is expressed in the same SQL the manual measure builder produces,
 * so they compile, validate and render through exactly the same path — these
 * are not a special kind of chart, they are measures the app happened to write
 * for you.
 *
 * Durations are deliberately absent. A delivery time is the obvious next one
 * here, and alasql has no date arithmetic: `DATEDIFF` does not parse and
 * casting to DATE and subtracting yields zero. Shipping a measure that silently
 * returns 0 would be worse than not offering it.
 */
export function deriveMeasures(context = {}) {
  const {
    profile, provenance = {}, roles = {}, cardinality = {}, rowCount = 0, sample = [],
    repeatedAt = {},
  } = context;
  const columns = context.columns || [...(profile?.measures || []), ...(profile?.dimensions || [])];
  // Derived measures divide and multiply the same columns the charts use, so
  // they need the same veto. Without it a repeated country-level figure came
  // back as "Tax Revenue Rate" — SUM of a value counted once per athlete over
  // SUM of another — after the charts had already stopped summing it.
  const classes = classifyColumns({ profile, provenance, roles, cardinality, rowCount, repeatedAt });
  const { additive } = classes;

  const out = [];
  const seen = new Set();
  const push = (m) => {
    const key = m.expr.replace(/\s+/g, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ filter: null, source: 'auto', ...m });
  };

  const grain = grainKey({ columns, provenance, roles, cardinality, rowCount });
  const money = primaryMoney(additive, cardinality);

  // How many transactions, as distinct from how many rows.
  if (grain) {
    push({
      name: 'Orders',
      expr: `COUNT(DISTINCT ${br(grain)})`,
      format: 'number',
      why: `distinct ${grain} — the row count would count line items, not orders`,
    });
  }

  // The metric this kind of dataset is about.
  if (money && grain) {
    push({
      name: 'Average Order Value',
      expr: `SUM(${br(money)}) / COUNT(DISTINCT ${br(grain)})`,
      format: 'currency',
      why: `${money} per distinct ${grain}`,
    });
  }

  // Components as a share of the whole: discount, shipping, tax, fees.
  if (money) {
    for (const part of additive.filter((c) => COMPONENT_RE.test(c) && c !== money)) {
      push({
        name: `${titleOf(part)} Rate`,
        expr: `SUM(${br(part)}) / SUM(${br(money)}) * 100`,
        format: 'percent',
        why: `${part} as a share of ${money}`,
        parts: { kind: 'ratio', numerator: part, denominator: money },
      });
    }
  }

  // Basket size.
  const quantity = additive.find((c) => QUANTITY_RE.test(c) && !MONEY_RE.test(c));
  if (quantity && grain) {
    push({
      name: 'Units per Order',
      expr: `SUM(${br(quantity)}) / COUNT(DISTINCT ${br(grain)})`,
      format: 'number',
      why: `${quantity} per distinct ${grain}`,
    });
  }

  // How often the process fails, from a status column's own levels.
  for (const col of classes.categories.filter((c) => STATUS_RE.test(c))) {
    const levels = distinctLevels(sample, col);
    if (!levels.length || levels.length > 12) continue;
    const bad = levels.filter((v) => NEGATIVE_LEVEL_RE.test(norm(v)));
    if (!bad.length || bad.length === levels.length) continue;
    const list = bad.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(', ');
    push({
      // Named after the levels it counts, not the column: "Order Status Rate"
      // says nothing, while "Cancelled or Returned Rate" is the metric.
      name: `${titleOf(bad.slice(0, 2).join(' or '))} Rate`,
      expr: `SUM(CASE WHEN ${br(col)} IN (${list}) THEN 1 ELSE 0 END) * 100.0 / COUNT(*)`,
      format: 'percent',
      why: `share of rows where ${col} is ${bad.join(' or ')}`,
      // What the measure is made of, so the planner can work out from the rows
      // how much it moves across a dimension instead of taking it on trust.
      // Without this a derived measure carries a fixed score and wins or loses
      // on the order these blocks happen to run in.
      parts: { kind: 'levelShare', column: col, levels: bad.map((v) => String(v)) },
    });
  }

  // How many distinct people, which a row count never answers.
  for (const col of classes.identifiers.concat(classes.categories)) {
    if (!/(customer|client|user|account|member|patient|student)/i.test(col)) continue;
    if (!IDENTIFIER_RE.test(col)) continue;
    push({
      name: 'Customers',
      expr: `COUNT(DISTINCT ${br(col)})`,
      format: 'number',
      why: `distinct ${col}`,
    });
    break;
  }

  return out;
}

/** The distinct values of a column in a sample, as strings. */
function distinctLevels(sample, col) {
  const set = new Set();
  for (const row of sample || []) {
    const v = row?.[col];
    if (v === null || v === undefined || v === '') continue;
    set.add(String(v));
    if (set.size > 40) break;
  }
  return [...set];
}

const titleOf = (s) =>
  String(s || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Names that mean "this column is what happened", not "this is an attribute".
 *
 * `STATUS_RE` above catches a column called `Order_Status` whose levels say
 * `Cancelled`. It catches nothing at all in a file called churn_sample.csv,
 * where the column is named `Churn` and its levels are `Yes` and `No` — and a
 * deck built from that file went out reporting average monthly charge by plan
 * tier without mentioning retention once. The dataset exists to answer who
 * leaves; the analysis never asked.
 */
const OUTCOME_RE =
  /^(churn(ed)?|attrition|exited?|left|lost|cancell?ed|closed|returned|refunded|defaulted|converted|renewed|retained|active|subscribed|survived|responded|clicked|clicks|purchased|fraud(ulent)?|deceased|readmitted|lostdeal|won|win|winner|medal(l?ed)?|award(ed)?|success(ful)?|passed|failed|approved|admitted|accepted|rejected|hired|qualified|completed|enrolled|attended|delivered)$/i;

/**
 * Affixes that say "this column is a flag", carrying no meaning of their own.
 *
 * A prepared dataset almost never names its label bare. It arrives as
 * `Medal_Binary`, `is_churned`, `fraud_flag`, `readmitted_yn`, `target` — the
 * noun that matters wrapped in a word that only says "this is a 0/1 column".
 * Matching the bare noun alone missed every one of them: on a 202,616-row
 * athlete export the label was `Medal_Binary`, the planner classified it as a
 * binary and dropped it before planning, and the deck that came out was six
 * charts of record counts with nothing about who wins.
 *
 * Stripping the wrapper first keeps the rule where it was — the name still has
 * to say the column is a result — while letting it read the names datasets
 * actually use.
 */
const OUTCOME_AFFIX_RE = /^(is|has|was|did|had)[\s_-]+|[\s_-]+(flag|binary|bin|yn|ind|indicator|label|target)$/gi;

/** The outcome noun inside a flag name: `Medal_Binary` -> `medal`. */
const outcomeStem = (col) => {
  const spaced = String(col).replace(/[\s_-]+/g, '_');
  return spaced.replace(OUTCOME_AFFIX_RE, '').replace(/_/g, '').toLowerCase();
};

/** Two-level columns whose levels are themselves a yes/no. */
const AFFIRMATIVE = /^(y|yes|true|t|1|churn(ed)?|left|exited?|lost|cancell?ed|positive|active|won)$/i;
const NEGATIVE = /^(n|no|false|f|0|stayed|retained|kept|current|negative|inactive|lost)$/i;

/**
 * The column that records what happened, and which of its two levels is the
 * event worth counting.
 *
 * Deliberately narrow. A dataset has one outcome or none, and guessing wrongly
 * is worse than not guessing: every chart in the deck would then be built
 * around a column that is merely another attribute. So the name has to say so
 * outright, and the column has to be a genuine two-level flag.
 *
 * @returns {{ column: string, event: string, levels: string[], positive: boolean }|null}
 */
export function outcomeColumn({ columns = [], sample = [], cardinality = {} } = {}) {
  for (const col of columns) {
    const bare = String(col).replace(/[\s_-]+/g, '_');
    const stem = outcomeStem(col);
    if (!OUTCOME_RE.test(bare) && !OUTCOME_RE.test(bare.replace(/_/g, '')) && !OUTCOME_RE.test(stem)) {
      continue;
    }

    const levels = distinctLevels(sample, col);
    // Two levels, or a two-level column whose sample happened to catch one.
    if (levels.length !== 2) continue;
    if (cardinality[col] && cardinality[col] > 2) continue;

    // Which level is the event. When the levels are a plain yes/no, the
    // affirmative one is; when the column is named for the thing that is good
    // (`active`, `retained`, `renewed`), the event is the other one.
    const yes = levels.find((v) => AFFIRMATIVE.test(norm(v)));
    const no = levels.find((v) => NEGATIVE.test(norm(v)) && v !== yes);
    if (!yes || !no) continue;

    // The level counted is always the affirmative one, so the metric's name and
    // its value never disagree: a column called `Active` yields an active rate,
    // not a rate of inactivity wearing the word "active". What changes is
    // whether a high number is good news — which is what the scorecard needs to
    // know before it calls anything a risk.
    // Whether a high number is good news, which is what the scorecard needs
    // before it calls anything a risk. Read off the stem, so `Medal_Binary` is
    // as legible as `won` — a medal rate climbing is not an exposure.
    const highIsGood =
      /^(active|retained|renewed|survived|subscribed|won|win|winner|medal(l?ed)?|award(ed)?|success(ful)?|passed|approved|admitted|accepted|hired|qualified|completed|enrolled|attended|delivered|converted|responded|purchased|clicked)$/i.test(
        stem
      ) || /^(active|retained|renewed|survived|subscribed|isactive|won|converted|responded)$/i.test(bare.replace(/_/g, ''));
    // `distinctLevels` stringifies, so `event` is always text and cannot say
    // what the column actually holds. The raw type has to be read here, while
    // the rows are still in hand, or the SQL below compares a number to a
    // quoted string and quietly matches nothing.
    let valueType = 'string';
    for (const row of sample) {
      const v = row?.[col];
      if (v === null || v === undefined || v === '') continue;
      valueType = typeof v;
      break;
    }
    return { column: col, event: yes, other: no, levels, highIsGood, valueType };
  }
  return null;
}

/** The rate of the event, as a percentage, in SQL the engine can run. */
export function outcomeRateExpression(outcome) {
  // The literal has to match the column's type, not just its text. A flag
  // parsed from CSV holds the NUMBER 1, and `[Medal_Binary] = '1'` matches
  // nothing — every group comes back 0.0% and the chart draws a row of empty
  // bars with no error anywhere. A quoted level is right for 'Yes'; it is
  // silently wrong for every numeric flag, which is most of them.
  const v = outcome.event;
  const literal =
    outcome.valueType === 'number' && v !== '' && isFinite(Number(v))
      ? String(Number(v))
      : outcome.valueType === 'boolean'
        ? String(v).toUpperCase()
        // Unknown or textual: quote it, which is what this always did and is
        // right for every categorical outcome.
        : `'${String(v).replace(/'/g, "''")}'`;
  return `SUM(CASE WHEN ${br(outcome.column)} = ${literal} THEN 1 ELSE 0 END) * 100.0 / COUNT(*)`;
}

/**
 * What to call the rate.
 *
 * The column name is not always the noun. A column called `Churned` produced
 * "Churned Rate", which appeared in the card, the chart title and the axis of
 * every slide — a past participle where English wants the noun. The handful of
 * shapes that actually occur are listed rather than guessed at, because a
 * general de-inflector would turn `Lost` into `Loss` and `Active` into
 * something nobody asked for.
 */
const RATE_NOUN = [
  [/^churn(ed)?$/i, 'Churn'],
  [/^exited?$/i, 'Exit'],
  [/^cancell?ed$/i, 'Cancellation'],
  [/^returned$/i, 'Return'],
  [/^refunded$/i, 'Refund'],
  [/^defaulted$/i, 'Default'],
  [/^converted$/i, 'Conversion'],
  [/^renewed$/i, 'Renewal'],
  [/^retained$/i, 'Retention'],
  [/^subscribed$/i, 'Subscription'],
  [/^responded$/i, 'Response'],
  [/^readmitted$/i, 'Readmission'],
  [/^survived$/i, 'Survival'],
  [/^clicked|clicks$/i, 'Click'],
  [/^purchased$/i, 'Purchase'],
  [/^attrition$/i, 'Attrition'],
  [/^medal(l?ed)?$/i, 'Medal'],
  [/^(won|win|winner)$/i, 'Win'],
  [/^award(ed)?$/i, 'Award'],
  [/^success(ful)?$/i, 'Success'],
  [/^passed$/i, 'Pass'],
  [/^failed$/i, 'Failure'],
  [/^approved$/i, 'Approval'],
  [/^admitted$/i, 'Admission'],
  [/^accepted$/i, 'Acceptance'],
  [/^rejected$/i, 'Rejection'],
  [/^hired$/i, 'Hire'],
  [/^qualified$/i, 'Qualification'],
  [/^completed$/i, 'Completion'],
  [/^enrolled$/i, 'Enrolment'],
  [/^attended$/i, 'Attendance'],
  [/^delivered$/i, 'Delivery'],
  [/^fraud(ulent)?$/i, 'Fraud'],
];

export function outcomeRateName(outcome) {
  const raw = String(outcome.column).replace(/[\s_-]+/g, ' ').trim();
  for (const [re, noun] of RATE_NOUN) if (re.test(raw)) return `${noun} Rate`;
  // The flag wrapper is not part of the metric's name. `Medal_Binary` is read
  // as an outcome by its stem, so it has to be *named* by its stem too —
  // otherwise the chart title, the axis and the card all say "Medal Binary
  // Rate", which tells the reader about the file's column naming rather than
  // about the thing being measured.
  const stem = outcomeStem(outcome.column);
  for (const [re, noun] of RATE_NOUN) if (re.test(stem)) return `${noun} Rate`;
  const base = titleOf(raw);
  return /rate$/i.test(base) ? base : `${base} Rate`;
}

/* ------------------------------------------------------------------------- *
 * The outcome, in the shapes datasets actually record it
 * ------------------------------------------------------------------------- */

/**
 * `outcomeColumn` above answers one question well and three not at all.
 *
 * It requires a two-level flag whose name is on a list of English nouns. That
 * is right for `Churn`, `Medal_Binary` and `is_fraud`, and it is the whole
 * reason a file about which jobs get automated by 2030 produced a report about
 * record counts per risk band: `Automation_Probability_2030` is a continuous
 * probability, which the flag test rejects on shape before the name is even
 * considered, and `Risk_Category` has three levels, which it rejects too.
 *
 * Datasets record what happened in four shapes, not one:
 *
 *   binary      a flag.        The rate of the event.
 *   continuous  a probability, a score, a duration, an amount. Its mean.
 *   ordinal     Low/Medium/High. The share sitting at the severe end.
 *   multiclass  named classes with no order. The share of the named class.
 *
 * All four reduce to the same thing downstream — one number per group, compared
 * across groups — so generalising costs the planner nothing beyond knowing
 * which aggregate to write. `outcomeAggregate` is that knowledge, in one place,
 * so the SQL, the axis label and the number format cannot disagree.
 *
 * Detection is not generalised, deliberately. There is no shape that
 * distinguishes the outcome of this dataset from its other numeric columns:
 * `AI_Exposure_Index`, `Tech_Growth_Factor` and `Automation_Probability_2030`
 * are all continuous, all 0-1, all in the same table, and only one of them is
 * what the file is *for*. That is a question about meaning and it is asked of a
 * model in `datasetBrief.js`, whose answer is checked against these same rows
 * before it arrives here. With no model and no brief, the flag lexicon is still
 * the best available guess and is still used — which is exactly today's
 * behaviour, unchanged.
 */

/**
 * The dataset's outcome, from a verified brief if there is one and from the
 * flag lexicon otherwise.
 *
 * @param {object}   input
 * @param {object}   [input.brief]     an already-verified brief; its claims are trusted here
 * @param {string[]} [input.columns]   columns to consider for the lexical fallback
 * @param {object[]} [input.sample]    rows, for the lexical fallback
 * @param {object}   [input.cardinality]
 * @returns {object|null} an outcome carrying `kind`, or null
 */
export function outcomeVariable({ brief = null, columns = [], sample = [], cardinality = {} } = {}) {
  // A brief that survived `acceptBrief` has already been checked against the
  // rows harder than anything here could check it, so it wins outright.
  const fromBrief = brief?.outcomes?.[0];
  if (fromBrief) return { ...fromBrief, source: 'brief' };

  const found = outcomeColumn({ columns, sample, cardinality });
  // The pre-existing detector only ever finds flags, so the kind is known
  // without asking. Tagged rather than assumed, so every consumer can branch on
  // `kind` and none has to know where the outcome came from.
  return found ? { ...found, kind: 'binary', source: 'lexicon' } : null;
}

/**
 * The SQL that measures the outcome, what to call it, and how to format it.
 *
 * One function because these three have to agree. They used to be two —
 * `outcomeRateExpression` and `outcomeRateName` — and that was safe only while
 * every outcome was a rate. The moment a continuous outcome exists, a mean
 * labelled "Rate" and formatted as a percentage is three separate bugs wearing
 * one chart, and none of them raises an error: the bars draw, the axis reads
 * 0-100, and every number on it is a hundred times too small.
 *
 * @returns {{ expr: string, name: string, format: 'percent'|'number' }}
 */
export function outcomeAggregate(outcome) {
  if (!outcome?.column) return null;

  if (outcome.kind === 'continuous') {
    return {
      expr: `AVG(${br(outcome.column)})`,
      name: `Average ${titleOf(String(outcome.column).replace(/[\s_-]+/g, ' ').trim())}`,
      format: 'number',
    };
  }

  // binary, ordinal and multiclass are all "what share of rows sit at the level
  // that matters", which is one expression with a different literal in it.
  return {
    expr: outcomeRateExpression(outcome),
    name: outcomeLevelRateName(outcome),
    format: 'percent',
  };
}

/**
 * What to call the share of a level.
 *
 * A binary outcome is named for its column — "Churn Rate" — because the column
 * *is* the event. A three-level column is not: "Risk Category Rate" names the
 * axis after the question rather than the answer, and the reader cannot tell
 * which of Low, Medium and High the bars are counting. So the level goes in the
 * name, the way `deriveMeasures` already names a status rate after the levels
 * it counts rather than after the column holding them.
 */
function outcomeLevelRateName(outcome) {
  if (outcome.kind === 'binary' || !outcome.event) return outcomeRateName(outcome);
  const level = titleOf(String(outcome.event).replace(/[\s_-]+/g, ' ').trim());
  const subject = titleOf(String(outcome.column).replace(/[\s_-]+/g, ' ').trim());
  // "High Risk Category Rate" reads badly and "High Risk Rate" reads well, so a
  // level that already repeats a word of the column name does not repeat it.
  const words = subject.split(/\s+/).filter((w) => !new RegExp(`^${w}$`, 'i').test(level));
  const head = words.length ? `${level} ${words.join(' ')}` : level;
  return `${head} Rate`;
}

/**
 * Is a rising outcome bad news?
 *
 * The scorecard needs this before it can call anything a risk, and every
 * consumer was reading `highIsGood` directly off an object that only ever had
 * one shape. A continuous outcome from a brief carries the model's answer; a
 * flag carries the lexicon's. Reading it through one function means a consumer
 * never has to know which.
 */
export function outcomeIsRisk(outcome) {
  return Boolean(outcome) && outcome.highIsGood === false;
}
