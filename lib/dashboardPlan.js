/**
 * Letting a model choose what the dashboard is about.
 *
 * Everything else the model does in this product is presentation. It retitles
 * a slide, picks a legal chart type, writes a sentence under a figure it has
 * not seen, asks a question it may not answer. The one decision it has never
 * been allowed near is the one that decides whether the deck is any good:
 * which columns to chart in the first place.
 *
 * That decision has been a rule list — spreads, cardinalities, score constants
 * — and rule lists fail in a particular way. Upload a comparison of AI
 * subscriptions and the deck came back as "Record Count by Provider": how many
 * plan tiers each vendor sells. Every number true, none of them the reason
 * anybody opened the file. No individual rule was wrong; there is simply no
 * rule for "this is a table of prices against capabilities, so chart price
 * against capability", because that is a statement about meaning and the
 * planner has never had any.
 *
 * **What the model is given, and what it is not.** The same schema description
 * `/api/ask` already sends — column names, types, roles, distinct counts, and
 * at most three example values per column so it can tell a plan tier from a
 * postcode. No rows, no aggregates, no figures from the analysis. A model with
 * no numbers in front of it has none to quote, which is what makes the check
 * below mechanical rather than hopeful.
 *
 * **What comes back is a question, not an answer.** Every chart is a SQL query
 * that this app then runs itself, against the real table, and reads real
 * statistics off. The model nominates; the engine decides what is true. That
 * is the whole reason this is allowed to exist alongside the rule this product
 * will not break — a number on screen came from a query you can read — because
 * choosing which query to run was never the part that made a claim.
 *
 * Pure: strings and objects in, strings and objects out. The network call and
 * the SQL guard live in the route; the execution lives in the worker.
 */

import { honestAggregate } from './measureSemantics.js';

/** More than this and the deck is longer than anybody reads. */
export const MAX_PLAN_CHARTS = 9;

/** A title past this length has stopped being a title. */
const MAX_TITLE = 80;

/** The chart types the engine can draw, and the shapes they are for. */
const TYPES = new Set([
  'bar',
  'hbar',
  'line',
  'area',
  'donut',
  'pie',
  'treemap',
  'scatter',
  'composed',
  'radar',
  'radial',
  'waterfall',
  'matrix',
  'funnel',
  'gauge',
  'bubble',
]);

/**
 * What the model is asked.
 *
 * `intent` is the reader's own words about what they are trying to decide, and
 * it is the single most useful thing in this prompt when it is present: it
 * turns "which of these forty columns matter" from a guess into a brief. It is
 * optional and must stay optional — a dashboard that cannot be built without
 * an essay is a dashboard nobody waits for.
 */
export function dashboardBriefing({ schema, intent = '', rowCount = 0, guidance = '', max = MAX_PLAN_CHARTS } = {}) {
  const brief = String(intent || '').trim().slice(0, 500);
  return `
# ROLE
You are a data analyst deciding what a dashboard about this table should show.
You choose the questions. Another system runs your queries and computes every
figure, so you never state a number.

# THE DATA
${schema}
${rowCount ? `\nThe table has ${rowCount} rows.` : ''}
${guidance || ''}${brief ? `\n# WHAT THE READER IS TRYING TO DECIDE\n${brief}\n` : ''}
# WHAT MAKES A GOOD DASHBOARD HERE
- Chart what the table is ABOUT, not how many rows it has. A count of records
  per category is worth at most one chart, and usually none.
- Work out what kind of table this is. A comparison of products wants the
  trade-off between what they cost and what they do. A transaction log wants
  totals over time. A survey wants distributions. Choose accordingly.
- Prefer measures that vary between the categories. A column that is the same
  everywhere makes a flat chart.
- SUM only a quantity that can honestly be added up. Prices, rates, scores,
  indices and ratios are averaged, never summed — a total of four prices is not
  a price of anything.
- If the table carries its own unit column (a currency, a unit of measure) and
  it has more than one value, do not aggregate the columns it governs at all.
- Never group by a column that identifies a row, records where the row came
  from (a source link, a timestamp of collection), or has the same value in
  every row.
- Vary the question across the deck. Eight charts of the same measure is one
  chart shown eight times.

# SQL RULES (AlaSQL, a small in-memory engine)
- Query the table exactly as: SalesData
- Wrap every column name in square brackets: [Column Name]
- ALWAYS aggregate. GROUP BY with SUM / AVG / COUNT — never dump raw rows.
- Always alias the aggregate: AVG([Monthly Price USD]) AS [Average Monthly Price USD]
- Always ORDER BY, and LIMIT to 10-20 rows so the chart stays readable.
- Supported: SELECT, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, CASE WHEN, SUBSTRING.
- Not supported: CTEs, window functions, subqueries in FROM, JOINs.
- Use only the columns listed above. Never invent one.

# CHART TYPES
bar, hbar (compare categories) · line, area (change over time) · donut, pie
(share of a small set) · treemap (share of many) · scatter (two measures
against each other) · composed (a summed measure plus an averaged one) ·
radar (3-6 categories across several measures) · waterfall (what moved a total)

# OUTPUT (STRICT)
Return ONE minified JSON object, no markdown, no commentary:
{"charts":[{"title":"Short, specific, says what the chart shows","chart_type":"bar","sql":"SELECT ...","xAxisKey":"alias or column on the X axis","yAxisKey":"alias on the Y axis","why":"One sentence on why this belongs on the dashboard. No numbers - you have not seen the data."}]}

At most ${max} charts, ordered with the most important first.
`.trim();
}

/**
 * What this app already knows about these columns, written for the model.
 *
 * A raw schema says a column holds decimals. It does not say that this one is
 * a price and must never be summed, that this pair is quoted in two different
 * currencies and must never be combined at all, or that this one is a link
 * recording where the row came from and is not a subject anybody wants broken
 * down. The app works all three out — `detectDenomination`, `honestAggregate`,
 * and the value check the planner uses — and until now it kept that to itself.
 *
 * Handing it over is the difference between asking a model to guess the rules
 * and giving it the tools. It is also the thing a generic connector to a
 * generic BI tool cannot do: the knowledge is this product's, and it is worth
 * more in the prompt than in a comment.
 *
 * Silent where there is nothing to say. A brief full of caveats about ordinary
 * columns is a brief nobody reads to the end.
 */
export function columnGuidance({ profile = null, denominated = [], provenance = [] } = {}) {
  const lines = [];

  for (const column of denominated) {
    lines.push(
      `- ${column}: DO NOT AGGREGATE. This table carries its own unit column, so rows are ` +
        'not in one unit and summing or averaging them combines unlike quantities.'
    );
  }

  for (const column of profile?.measures || []) {
    if (denominated.includes(column)) continue;
    if (honestAggregate(column) === 'AVG') {
      lines.push(`- ${column}: average, never sum. It is a price, a rate or a score.`);
    }
  }

  for (const column of provenance) {
    lines.push(`- ${column}: records where the row came from, not what it is about. Do not group by it.`);
  }

  if (!lines.length) return '';
  return ['', '# WHAT THIS APP HAS ALREADY WORKED OUT ABOUT THESE COLUMNS', 'Treat these as binding.', ...lines, ''].join(
    '\n'
  );
}

/** Column names the model may legally reach, from the schema it was shown. */
export function columnsFromSchema(schema) {
  const names = [];
  for (const line of String(schema || '').split('\n')) {
    const m = line.match(/^-\s+(.+?)\s+\(/);
    if (m) names.push(m[1].trim());
  }
  return names;
}

/** Every `[bracketed]` name a query reaches for. */
function referenced(sql) {
  const out = new Set();
  for (const m of String(sql || '').matchAll(/\[([^\]]+)\]/g)) out.add(m[1].trim());
  return [...out];
}

/**
 * Take what the model returned, and keep only what is safe to run.
 *
 * The SQL guard is not here — it lives in `lib/engineSql.js` and the route
 * composes it, so there is one definition of what this engine will execute
 * rather than a second, weaker copy. What this does is everything else: shape,
 * bounds, and the one check the guard cannot make, which is whether a query
 * reaches for a column that exists.
 *
 * An alias the query itself declares counts as a column — `AVG([Price]) AS
 * [Average Price]` then `ORDER BY [Average Price]` is correct SQL and the
 * alias is not in the schema.
 *
 * @param {object}   raw       the model's parsed JSON
 * @param {string[]} columns   the columns it was shown
 * @param {number}   max       how many charts to keep
 * @returns {{charts: object[], rejected: string[]}}
 */
export function acceptDashboardPlan(raw, { columns = [], max = MAX_PLAN_CHARTS } = {}) {
  const known = new Set(columns.map((c) => String(c).toLowerCase()));
  const charts = [];
  const rejected = [];
  const seen = new Set();

  const list = Array.isArray(raw?.charts) ? raw.charts : Array.isArray(raw) ? raw : [];

  for (const item of list) {
    if (charts.length >= max) break;
    const title = String(item?.title || '').trim().slice(0, MAX_TITLE);
    const sql = String(item?.sql || '').trim();
    if (!sql) {
      rejected.push('a chart with no query');
      continue;
    }

    const type = String(item?.chart_type || 'bar').trim().toLowerCase();
    if (!TYPES.has(type)) {
      rejected.push(`${title || 'a chart'}: ${type} is not a chart this engine draws`);
      continue;
    }

    // Aliases the query declares are legal names for the rest of the query.
    const declared = new Set();
    for (const m of sql.matchAll(/\bAS\s+\[([^\]]+)\]/gi)) declared.add(m[1].trim().toLowerCase());

    const invented = referenced(sql).filter(
      (name) => !known.has(name.toLowerCase()) && !declared.has(name.toLowerCase())
    );
    if (invented.length) {
      rejected.push(`${title || 'a chart'}: no column called ${invented.map((i) => `"${i}"`).join(', ')}`);
      continue;
    }

    // The same query twice is the same chart twice, whatever it is titled.
    const key = sql.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) {
      rejected.push(`${title || 'a chart'}: the same query as an earlier one`);
      continue;
    }
    seen.add(key);

    charts.push({
      title: title || 'Untitled chart',
      chart_type: type,
      sql,
      xAxisKey: item?.xAxisKey ? String(item.xAxisKey).trim() : null,
      yAxisKey: item?.yAxisKey ? String(item.yAxisKey).trim() : null,
      secondaryYAxisKey: item?.secondaryYAxisKey ? String(item.secondaryYAxisKey).trim() : null,
      // Kept for the reader, not for the engine: it is the model's reason, and
      // it is marked as such wherever it is shown.
      why: String(item?.why || '').trim().slice(0, 240),
    });
  }

  return { charts, rejected };
}
