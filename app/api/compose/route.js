import { callerModelKey, canGenerate, generateJson } from '../../../lib/llm.server';
import { refusedFor } from '../../../lib/plans.server';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { acceptDeck, MAX_COMPOSED } from '../../../lib/deckComposer';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The whole deck, composed by a model.
 *
 * `/api/ask` has always turned one question from a person into one chart and
 * the SQL behind it. This asks the same thing for a dashboard nobody typed a
 * question for: here is what the table holds and what it appears to be for —
 * which charts would answer it?
 *
 * Only the SHAPE of the table is sent: column names, kinds, level counts, the
 * values of the small categorical columns, and a handful of whole rows for
 * context. The dataset stays in the browser. Every query comes back to be
 * executed there, against the rows, by the same engine that runs a planned one
 * — and then resolved, analysed, graded for evidence, and put past the sceptic
 * and the critic identically. The model chooses the questions. The engine
 * computes every answer, and every claim still has to earn its tier.
 *
 * `lib/deckComposer.js` is the gate: a query that is not a single read-only
 * SELECT, or that names a column the table does not have, or a chart shape this
 * app cannot draw, is dropped. When nothing survives the caller plans the deck
 * the way it always has, so a bad answer here costs a model call and nothing
 * else.
 */

const SYSTEM = (schema, purpose, rowCount) => `
# ROLE
You are a senior data analyst. You have been handed a table and you are
designing the dashboard a reader of it should see. Choose the charts.

# THE DATA
${schema}
${rowCount ? `\nThe table has ${rowCount} rows.\n` : ''}${purpose ? `\n# WHAT THIS TABLE IS FOR\n${purpose}\n` : ''}
# WHAT MAKES A DASHBOARD GOOD
- Answer the questions a reader of THIS table came with. A comparison of things
  to buy needs the things ranked and plotted against each other; a log of events
  needs what happened over time and what drove it; a table with an outcome
  column needs that outcome broken down by what predicts it.
- Every chart must be able to say something a reader could not have guessed.
- Do NOT aggregate a measure over buckets of itself: "total revenue by revenue
  band" is true by construction and says nothing.
- Do NOT pool a column that holds different quantities on different rows. If one
  column carries a GDP on one row and a life expectancy on the next, filter to
  one of them or leave it alone.
- Do NOT average an identifier, a rank, a tier code or an hour of the day.
- Where one row is already one thing a reader is choosing between, chart the
  rows themselves rather than averages over them.
- Between 4 and ${MAX_COMPOSED} charts. Fewer good ones beats more.

# SQL RULES (the query runs in AlaSQL, a small in-memory SQL engine)
- Query the table exactly as: SalesData
- Wrap EVERY column name in square brackets: [Column Name]. A name you write
  that is not a column of the table above is discarded along with its chart.
- Always aggregate: GROUP BY with SUM / AVG / COUNT. The one exception is a
  table where each row is a distinct thing being compared — there, select the
  rows with an ORDER BY and a LIMIT and no GROUP BY.
- Always alias an aggregate: AVG([Price]) AS [Average Price]
- Always add ORDER BY and LIMIT (10-20 rows makes a readable chart).
- Supported: SELECT, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, CASE WHEN,
  SUBSTRING, CONCAT.
- Not supported: CTEs (WITH), window functions, subqueries, JOINs.

# CHART TYPES
bar · hbar (long labels) · line, area (over time) · waterfall (what moved a
total) · donut, pie (share of a few) · treemap (share of many) · scatter (two
measures, one point per group or row) · composed (a summed and an averaged
measure together) · radar (3-6 categories over 3+ measures) · radial · funnel ·
matrix · table

# OUTPUT (STRICT)
One minified JSON object, no markdown, no commentary:
{"charts":[{
  "title":"Short, specific, says what the chart shows",
  "chart_type":"bar",
  "sql":"SELECT ...",
  "xAxisKey":"the alias or column on the X axis",
  "yAxisKey":"the alias on the Y axis",
  "secondaryYAxisKey":null,
  "dimension":"the column this chart breaks down by",
  "intent":"One sentence on why a reader needs this chart. No numbers — you have not seen the data."
}]}
`;

export async function POST(request) {
  try {
    // The plan decides whether this account may reach a model at all, and it is
    // read from the database rather than the request.
    const denied = await refusedFor('model');
    if (denied) return Response.json(denied, { status: 402 });

    if (!canGenerate(request)) {
      return Response.json({ unavailable: true, reason: 'no_provider' });
    }
    const credential = callerModelKey(request);

    const refused = await enforceLimit(request, 'compose');
    if (refused) return refused;

    const { schema, columns = [], purpose = null, rowCount = null, sample = [], focus = null } =
      await request.json();
    if (!schema || !Array.isArray(columns) || columns.length === 0) {
      return Response.json({ unavailable: true, reason: 'no_schema' });
    }

    // What the purpose pass settled, in the model's own terms rather than as a
    // structure it has to interpret.
    const brief = purpose
      ? [
          purpose.subject ? `One row is ${purpose.subject}.` : null,
          purpose.keyMeasures?.length ? `The measures a reader wants: ${purpose.keyMeasures.join(', ')}.` : null,
          purpose.keyDimensions?.length ? `Broken out by: ${purpose.keyDimensions.join(', ')}.` : null,
          purpose.avoid?.length ? `Keep these off the report entirely: ${purpose.avoid.join(', ')}.` : null,
          purpose.questions?.length ? `Questions a reader would ask: ${purpose.questions.join('; ')}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      : null;

    const prompt = [
      sample.length ? `A few whole rows, taken across the table:\n${JSON.stringify(sample.slice(0, 6))}` : null,
      focus ? `The reader asked to focus on: ${focus}` : null,
      'Design the dashboard. Return the charts as JSON.',
    ]
      .filter(Boolean)
      .join('\n\n');

    const result = await generateJson(prompt, SYSTEM(schema, brief, rowCount), credential);
    if (!result || typeof result !== 'object') {
      return Response.json({ unavailable: true, reason: 'generation_failed' });
    }

    // Checked here, not trusted: every query has to be one read-only SELECT
    // over columns that exist, and every shape one this app can draw.
    const deck = acceptDeck(result, { columns });
    if (!deck) return Response.json({ unavailable: true, reason: 'nothing_usable' });

    return Response.json({ charts: deck.charts, skipped: deck.skipped });
  } catch (error) {
    console.error('[compose]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
