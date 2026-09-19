import { callerModelKey, canGenerate, generateJson } from '../../../lib/llm.server';
import { refusedFor } from '../../../lib/plans.server';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { acceptSteps } from '../../../lib/preparation';
import { TRANSFORM_FIELDS } from '../../../lib/transforms';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Natural language -> one or more transform steps.
 *
 * The deterministic parser in lib/transformLanguage.js runs first, in the
 * browser, and handles the shapes people type. This route exists for the rest:
 * "add a margin column that is revenue less cost as a percentage of revenue",
 * "keep only the rows from the last full year", a conditional column described
 * in words. Only the column list, a few sample values and the existing steps
 * are sent — never the table.
 *
 * Whatever comes back is checked here with the same guard the preparation
 * pass uses, so a step the model invented cannot reach the engine just because
 * it came from the server; the client plans it again against the real column
 * list before it is staged.
 */

const fieldDocs = () =>
  Object.entries(TRANSFORM_FIELDS)
    .map(([kind, fields]) => `  ${kind}: ${Object.entries(fields).map(([f, d]) => `${f} (${d})`).join('; ')}`)
    .join('\n');

const SYSTEM = `You turn a plain-English request into one or more data-shaping
steps, the way Power Query steps work. Each step is one operation over the
table as the previous step left it.

RULES
- Use column names EXACTLY as listed, in square brackets inside formulas.
  A column you were not shown does not exist. A column an earlier step creates
  exists from then on.
- Row formulas (derive, filter, conditional rules) never use SUM, AVG, COUNT,
  MIN or MAX — they are computed from one row.
- Functions available: ABS, ROUND, FLOOR, CEIL, SQRT, POWER, LOG, SAFE_DIVIDE,
  COALESCE, NULLIF, IIF, GREATEST, LEAST, UPPER, LOWER, TRIM, PROPER, LEN,
  SUBSTRING, REPLACE, CONCAT, TEXT_JOIN, INSTR, SPLIT_PART, TEXT_BEFORE,
  TEXT_AFTER, CONTAINS, STARTS_WITH, ENDS_WITH, IS_BLANK, TO_NUMBER, TO_INTEGER,
  TO_TEXT, TO_DATE, YEAR, QUARTER, MONTH, MONTH_NAME, YEAR_MONTH, YEAR_QUARTER,
  DAY, WEEKDAY_NAME, DATE_ONLY, HOUR, DAYS_BETWEEN, MONTHS_BETWEEN, ADD_DAYS,
  TODAY, and CASE WHEN … THEN … ELSE … END. Text values in single quotes.
  No SELECT, FROM, JOIN, subqueries.
- Use the most specific kind: "datepart" for a month from a date, not a
  "derive" with MONTH(); "bucket" for bands of a number; "split" for a column
  holding two things; "group" to summarise; "filter" to keep or remove rows.
- Do exactly what was asked. Do not add steps that were not requested.
- Each step carries a "why": one short sentence saying what it does.

STEP KINDS AND THEIR FIELDS
${fieldDocs()}

Reply as JSON: { "steps": [ { "kind": "...", ...fields, "why": "..." } ] }`;

export async function POST(request) {
  try {
    const denied = await refusedFor('model');
    if (denied) return Response.json(denied, { status: 402 });

    if (!canGenerate(request)) {
      return Response.json({ unavailable: true, reason: 'no_provider' });
    }
    const credential = callerModelKey(request);

    const refused = await enforceLimit(request, 'transform');
    if (refused) return refused;

    const { phrase, columns = [], sample = [], existingSteps = [] } = await request.json();
    if (!phrase || !Array.isArray(columns) || !columns.length) {
      return Response.json({ error: 'phrase and columns are required' }, { status: 400 });
    }

    const prompt = `The table has these columns, in order:
${columns.map((c) => `- ${c}`).join('\n')}
${sample.length ? `\nA few whole rows:\n${JSON.stringify(sample.slice(0, 5))}` : ''}
${existingSteps.length ? `\nSteps already applied:\n${existingSteps.map((s) => `- ${s}`).join('\n')}` : ''}

REQUEST: ${String(phrase).slice(0, 500)}

Return the steps as JSON.`;

    const result = await generateJson(prompt, SYSTEM, credential);
    if (!result || !Array.isArray(result.steps)) {
      return Response.json({ unavailable: true, reason: 'generation_failed' });
    }

    const accepted = acceptSteps(result.steps, { columns, prefix: 'nl' });
    if (!accepted.steps.length) {
      return Response.json({
        unavailable: true,
        reason: accepted.skipped[0]?.reason || 'The model did not produce a step that fits this data.',
      });
    }

    return Response.json({ steps: accepted.steps });
  } catch (error) {
    console.error('[transform]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
