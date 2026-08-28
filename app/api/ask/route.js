import { generateJson, hasAnyProvider } from '../../../lib/llm.server';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { assertEngineSelect, UnsafeQuery } from '../../../lib/engineSql';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Natural language -> one chart specification.
 *
 * Only the schema description (a few hundred bytes) is sent here — never data.
 * The returned SQL is executed in the browser against the in-memory table, so
 * the guard below is about keeping the engine happy, not about protecting a
 * database: anything other than a single SELECT is rejected outright.
 */

const SYSTEM = (schema) => `
# ROLE
You are a data analyst. Turn a plain-English question into ONE chart backed by ONE SQL query.

# THE DATA
${schema}

# SQL RULES (the query runs in AlaSQL, a small in-memory SQL engine)
- Query the table exactly as: SalesData
- Always wrap column names in square brackets: [Column Name]
- ALWAYS aggregate. Use GROUP BY with SUM / AVG / COUNT — never dump raw rows.
- Always alias aggregates: SUM([Revenue]) AS [Total Revenue]
- Always add ORDER BY and a LIMIT (10-20 rows makes a readable chart).
- Supported: SELECT, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, CASE WHEN, SUBSTRING.
- Not supported: CTEs (WITH), window functions, subqueries in FROM, JOINs.
- Use only columns that appear in THE DATA above. Never invent a column.

# CHART TYPES
bar (compare categories) · line, area (change over time) · donut (share of a small
set) · treemap (share of many) · scatter (two measures correlated) · composed
(one summed measure plus one averaged measure) · radar (3+ measures across 3-6
categories) · radial (a handful of values).

# OUTPUT (STRICT)
Return ONE minified JSON object, no markdown, no commentary:
{
  "title": "Short, specific chart title",
  "chart_type": "bar",
  "sql": "SELECT ...",
  "xAxisKey": "the alias or column used on the X axis",
  "yAxisKey": "the alias used on the Y axis",
  "secondaryYAxisKey": null,
  "interpretation": "One sentence saying what this chart will show. No numbers — you have not seen the data."
}
`;

/**
 * Check the model's query, and return it ready to run.
 *
 * The checks themselves live in `lib/engineSql.js`, which composes the connector
 * guard rather than keeping a second, weaker copy of it — see that module for
 * what the copy here used to let through.
 *
 * Returns `{ sql }` or `{ problem }`, because the caller reports a refusal as an
 * `unavailable` reason rather than an error.
 */
function validate(spec) {
  if (!spec || typeof spec.sql !== 'string') return { problem: 'The model did not return a query.' };
  try {
    return { sql: assertEngineSelect(spec.sql) };
  } catch (error) {
    if (error instanceof UnsafeQuery) return { problem: error.message };
    throw error;
  }
}

export async function POST(request) {
  try {
    if (!hasAnyProvider()) {
      return Response.json({ unavailable: true, reason: 'no_provider' });
    }

    const refused = await enforceLimit(request, 'ask');
    if (refused) return refused;

    const { question, schema } = await request.json();
    if (!question || !schema) {
      return Response.json({ error: 'question and schema are required' }, { status: 400 });
    }

    const spec = await generateJson(`QUESTION: ${question}\n\nReturn the chart specification as JSON.`, SYSTEM(schema));
    if (!spec) return Response.json({ unavailable: true, reason: 'generation_failed' });

    const checked = validate(spec);
    if (checked.problem) return Response.json({ unavailable: true, reason: checked.problem });

    return Response.json({
      title: spec.title || question,
      chart_type: spec.chart_type || 'bar',
      // The guard already returned the query with a trailing semicolon removed.
      sql: checked.sql,
      xAxisKey: spec.xAxisKey || null,
      yAxisKey: spec.yAxisKey || null,
      secondaryYAxisKey: spec.secondaryYAxisKey || null,
      interpretation: spec.interpretation || '',
    });
  } catch (error) {
    console.error('[ask]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
