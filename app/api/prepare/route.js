import { generateJson, modelCredential } from '../../../lib/llm.server';
import { refusedFor } from '../../../lib/plans.server';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { acceptPreparation, MAX_MEASURES, MAX_STEPS } from '../../../lib/preparation';
import { TRANSFORM_FIELDS } from '../../../lib/transforms';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The pass that reads the table before anything is charted.
 *
 * Every other agent in this app works on a report that already exists — it
 * retitles, reorders, doubts, rephrases. This one works on the DATA, which is
 * where an analyst's judgement goes first: the column the file should have had
 * and does not, the date that is only useful once it is a month, the field that
 * is two fields with a comma between them, the number the business tracks that
 * is a formula over three columns.
 *
 * It is shown the shape and vocabulary of the table — column names, the values
 * each category column holds, the range of each number, a few whole rows — and
 * asked what it would do before opening the chart menu. It returns steps in
 * the transform layer's own vocabulary and measures in the measure layer's, and
 * both are checked here by the same validators a typed step or measure goes
 * through. A step naming a column that is not there, or a measure with a bare
 * column outside an aggregate, does not come back out of this route.
 *
 * What the caller does with the result is the caller's decision; the provider
 * applies only the steps that add a column, and offers the rest.
 */

const fieldDocs = () =>
  Object.entries(TRANSFORM_FIELDS)
    .map(([kind, fields]) => `  ${kind}: ${Object.entries(fields).map(([f, d]) => `${f} (${d})`).join('; ')}`)
    .join('\n');

const SYSTEM = `You are a senior data analyst. You have been handed a table you
have never seen and asked to prepare it before it is analysed — the ten minutes
of work a good analyst does before building a single chart.

You are shown the columns, the distinct values of each category column with how
often each occurs, the range of each number column, a few whole rows, and what
has already been done to this table. Read them the way an analyst would: what
is this table about, what is each row, what is missing that the business would
ask for.

Propose two things.

1. STEPS that reshape the table so the analysis can see what matters:
   - derived columns the file should have had: margin from revenue and cost,
     unit price from amount and quantity, duration from two dates
     (DAYS_BETWEEN), age from a birth date, a rate from a numerator and a
     denominator (use SAFE_DIVIDE so a zero denominator is blank, not infinite)
   - a date part from a date column when the table has one: year_month for a
     series longer than a few months, weekday if the question is when in the
     week, quarter for a multi-year table
   - a split of a column that holds two things ("City, State", "Last, First")
   - a conditional or bucket column that turns a raw number into the bands the
     business talks about (order size, age group, tenure)
   - tidying that changes meaning nothing: trim, proper case for names
   - removing rows that plainly are not data — test records, a totals row,
     rows whose status value means the row did not happen — and dropping
     columns that are empty or are pure identifiers nothing can be learned from
   Prefer steps that ADD a column over steps that remove or change one. Steps
   run in the order you give them, and a later step may use a column an
   earlier one created. At most ${MAX_STEPS}; three good ones beat eight.

2. MEASURES: the named numbers this business would put on a card — total
   revenue, average order value, margin percentage, conversion rate, return
   rate. At most ${MAX_MEASURES}. Each is ONE aggregate expression: every
   column reference sits inside SUM, AVG, COUNT, MIN or MAX; an aggregate never
   contains another; a percentage is multiplied by 100 with format "percent".
   Write the column a measure is best broken out by in "by" — the dimension an
   analyst would chart it against — or null.

RULES
- Use column names EXACTLY as shown, in square brackets inside formulas:
  [Order Date]. A column you did not see does not exist. A column you create in
  a step exists from that step on.
- Row formulas (derive, filter, conditional rules) use no aggregates. Measures
  use only aggregates. Functions available in both: ABS, ROUND, FLOOR, CEIL,
  SQRT, POWER, LOG, SAFE_DIVIDE, COALESCE, NULLIF, IIF, GREATEST, LEAST, UPPER,
  LOWER, TRIM, PROPER, LEN, SUBSTRING, REPLACE, CONCAT, TEXT_JOIN, INSTR,
  SPLIT_PART, TEXT_BEFORE, TEXT_AFTER, CONTAINS, STARTS_WITH, ENDS_WITH,
  IS_BLANK, TO_NUMBER, TO_INTEGER, TO_TEXT, TO_DATE, YEAR, QUARTER, MONTH,
  MONTH_NAME, YEAR_MONTH, YEAR_QUARTER, DAY, WEEKDAY_NAME, DATE_ONLY, HOUR,
  DAYS_BETWEEN, MONTHS_BETWEEN, ADD_DAYS, TODAY, and CASE WHEN … THEN … ELSE … END.
  Text values are in single quotes: 'West'. No SELECT, FROM, JOIN, subqueries.
- Do not repeat a step or a measure that already exists.
- Do not propose a step whose only effect is cosmetic renaming.
- Every step and measure carries a "why": one plain sentence an executive
  would accept as the reason. No numbers in it — you have seen a sample, not
  the table.
- Nothing is better than something doubtful. An empty list is a valid answer.

STEP KINDS AND THEIR FIELDS
${fieldDocs()}

Reply as JSON:
{
  "summary": "one sentence: what this table is and what each row is",
  "steps": [ { "kind": "...", ...fields, "why": "..." } ],
  "measures": [ { "name": "Title Case, 2-4 words", "expr": "SUM([Revenue]) - SUM([Cost])", "filter": null, "format": "number" | "currency" | "percent", "by": "<column or null>", "why": "..." } ]
}`;

export async function POST(request) {
  try {
    // The plan decides whether this account may reach a model at all, and it
    // is read from the database rather than the request — the browser hides
    // these controls on a free plan, but hiding is not enforcing.
    const denied = await refusedFor('model');
    if (denied) return Response.json(denied, { status: 402 });

    // The reader's own key, or the deployment's for a Pro account — see
    // modelCredential in lib/llm.server.js.
    const credential = await modelCredential(request);
    if (!credential) {
      return Response.json({ unavailable: true, reason: 'no_provider' });
    }

    const refused = await enforceLimit(request, 'prepare');
    if (refused) return refused;

    const body = await request.json();
    const {
      columns = [],
      sample = [],
      existingSteps = [],
      existingMeasures = [],
      fileName = '',
      rowCount = 0,
      columnNames = [],
      focus = null,
    } = body || {};
    if (!Array.isArray(columns) || columns.length === 0 || !Array.isArray(columnNames) || !columnNames.length) {
      return Response.json({ unavailable: true, reason: 'no_columns' });
    }

    const describe = (c) => {
      const head = `- ${c.name} (${c.kind}${c.levels ? `, ${c.levels} distinct` : ''})`;
      if (Array.isArray(c.values) && c.values.length) {
        return `${head}\n    values: ${c.values.map((v) => `${v.value} (${v.sharePct}%)`).join(', ')}`;
      }
      if (c.range) {
        return (
          `${head}\n    range: ${c.range.min} to ${c.range.max}, median ${c.range.median}` +
          `${c.range.negatives ? ', goes below zero' : ''}`
        );
      }
      return head;
    };

    const prompt = `The file is called "${fileName}" and has ${Number(rowCount) || 'an unknown number of'} rows.

Columns, in order:
${columns.map(describe).join('\n')}
${sample.length ? `\nA few whole rows, taken across the table:\n${JSON.stringify(sample.slice(0, 8))}` : ''}
${existingSteps.length ? `\nSteps already applied:\n${existingSteps.map((s) => `- ${s}`).join('\n')}` : ''}
${existingMeasures.length ? `\nMeasures already defined:\n${existingMeasures.map((m) => `- [${m.name}] = ${m.expr}`).join('\n')}` : ''}
${focus ? `\nThe reader's question is: ${String(focus).slice(0, 300)}` : ''}

What would you do to this table before analysing it, and which numbers would you name?`;

    const result = await generateJson(prompt, SYSTEM, credential);
    if (!result || (!Array.isArray(result.steps) && !Array.isArray(result.measures))) {
      return Response.json({ unavailable: true, reason: 'generation_failed' });
    }

    // Checked here, not trusted — and checked again where it is applied.
    const accepted = acceptPreparation(result, {
      columns: columnNames,
      measures: existingMeasures,
    });

    return Response.json({
      summary: accepted.summary,
      steps: accepted.steps,
      measures: accepted.measures,
      skipped: accepted.skipped.map((s) => ({ kind: s.proposal?.kind || 'measure', reason: s.reason })),
    });
  } catch (error) {
    console.error('[prepare]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
