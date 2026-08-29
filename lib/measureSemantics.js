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

/** Names that mean "already aggregated by someone else". */
const PRE_AGGREGATE_RE = /(^|[\s_-])(total|sum|count|num|number|qty|orders|spent|lifetime|ltv|ytd|mtd|cumulative|running)([\s_-]|$)|^(total|avg|average|mean|min|max)[\s_-]/i;

/** Names that are a rate, price or score: averaging is the only honest aggregate. */
const RATE_RE = /(per[\s_-]?capita|\bper\b|ratio|percent|\bpct\b|\brate\b|\baverage\b|\bavg\b|\bmean\b|\bmedian\b|\bindex\b|\bscore\b|\brating\b|\bnps\b|\bgrowth\b|price|\bcost\b|\bweight\b|\bage\b)/i;

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
export function classifyColumns({ profile, provenance = {}, roles = {}, cardinality = {}, rowCount = 0 } = {}) {
  const numeric = profile?.measures || [];
  const categorical = profile?.dimensions || [];
  const byColumn = {};

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
  const { profile, provenance = {}, roles = {}, cardinality = {}, rowCount = 0, sample = [] } = context;
  const columns = context.columns || [...(profile?.measures || []), ...(profile?.dimensions || [])];
  const classes = classifyColumns({ profile, provenance, roles, cardinality, rowCount });
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
  /^(churn(ed)?|attrition|exited?|left|lost|cancell?ed|closed|returned|refunded|defaulted|converted|renewed|retained|active|subscribed|is_?active|survived|responded|clicked|clicks|purchased|fraud(ulent)?|deceased|readmitted|won|lost_?deal)$/i;

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
    if (!OUTCOME_RE.test(bare) && !OUTCOME_RE.test(bare.replace(/_/g, ''))) continue;

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
    const highIsGood = /^(active|retained|renewed|survived|subscribed|isactive|won|converted|responded)$/i.test(
      bare.replace(/_/g, '')
    );
    return { column: col, event: yes, other: no, levels, highIsGood };
  }
  return null;
}

/** The rate of the event, as a percentage, in SQL the engine can run. */
export function outcomeRateExpression(outcome) {
  const level = String(outcome.event).replace(/'/g, "''");
  return `SUM(CASE WHEN ${br(outcome.column)} = '${level}' THEN 1 ELSE 0 END) * 100.0 / COUNT(*)`;
}

/** What to call it: "Churn Rate", not "Churn Status Rate". */
export function outcomeRateName(outcome) {
  const base = titleOf(String(outcome.column).replace(/[\s_-]+/g, ' '));
  return /rate$/i.test(base) ? base : `${base} Rate`;
}
