import { generateJson, hasAnyProvider } from '../../../lib/llm.server';
import { validateExpression } from '../../../lib/measures';
import { enforceLimit } from '../../../lib/routeLimits.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Natural language -> one measure definition.
 *
 * The deterministic parser in lib/measureLanguage.js runs first, in the browser,
 * and handles the common shapes. This route exists for the rest: phrasing the
 * parser does not recognise, or a calculation that needs a CASE expression.
 *
 * Only the schema and the names of existing measures are sent — never data. The
 * expression that comes back is checked here with the same validator the client
 * uses, so a formula the model invented cannot reach the engine just because it
 * came from the server; the client validates it again against the real column
 * list before running it.
 */

const SYSTEM = (schema, measures) => `
# ROLE
You turn a plain-English request into ONE reusable measure — a named aggregate
calculation, the way a DAX measure works in Power BI.

# THE DATA
${schema}

${measures.length ? `# MEASURES THAT ALREADY EXIST\nYou may reference these by name in square brackets, exactly as written:\n${measures.map((m) => `- [${m.name}] = ${m.expr}`).join('\n')}\n` : ''}
# FORMULA RULES (the formula runs in AlaSQL, in the browser)
- Write ONE expression. Not a SELECT, not a query — just the calculation.
- Wrap every column name in square brackets: [Column Name]
- EVERY column reference must be inside an aggregate: SUM, AVG, COUNT, MIN, MAX.
  Write SUM([Revenue]) - SUM([Cost]), never [Revenue] - [Cost].
- An aggregate may never contain another aggregate.
- A reference to an existing measure, like [Profit], is already aggregated —
  never wrap it in SUM or AVG.
- Also available: ABS, ROUND, FLOOR, CEIL, SQRT, COALESCE, and CASE WHEN ... THEN ... ELSE ... END.
- For a conditional total, aggregate a CASE: SUM(CASE WHEN [Status] = 'Won' THEN [Revenue] ELSE 0 END).
- Not available: SELECT, FROM, JOIN, subqueries, window functions, DISTINCT outside COUNT.
- Use only columns that appear in THE DATA above. Never invent one.

# ROW FILTER
If the request restricts which rows count ("... for the West region"), put that
in "filter" as a row predicate — [Region] = 'West' — NOT in the formula. The
filter may not use an aggregate. If there is no restriction, use null.

# PERCENTAGES
If the request asks for a percentage, multiply the ratio by 100 in the formula
and set "format" to "percent".

# OUTPUT (STRICT)
Return ONE minified JSON object, no markdown, no commentary:
{
  "name": "Short name for this measure, 2-4 words, Title Case",
  "expr": "SUM([Revenue]) - SUM([Cost])",
  "filter": null,
  "format": "number" | "currency" | "percent",
  "explanation": "One sentence describing what the measure calculates. No numbers — you have not seen the data."
}
`;

const FORMATS = new Set(['number', 'currency', 'percent']);

export async function POST(request) {
  try {
    if (!hasAnyProvider()) {
      return Response.json({ unavailable: true, reason: 'no_provider' });
    }

    const refused = await enforceLimit(request, 'measure');
    if (refused) return refused;

    const { question, schema, columns = [], measures = [] } = await request.json();
    if (!question || !schema) {
      return Response.json({ error: 'question and schema are required' }, { status: 400 });
    }

    const known = (Array.isArray(measures) ? measures : [])
      .filter((m) => m && m.name && m.expr)
      .map((m) => ({ name: String(m.name), expr: String(m.expr) }));

    const spec = await generateJson(
      `REQUEST: ${question}\n\nReturn the measure definition as JSON.`,
      SYSTEM(schema, known)
    );
    if (!spec || typeof spec.expr !== 'string') {
      return Response.json({ unavailable: true, reason: 'generation_failed' });
    }

    // The same check the client runs. Done here too so a malformed formula is
    // reported as a refusal rather than shipped to the browser to fail there —
    // and, when the caller passes its column list, so the model cannot invent
    // a column name on the way through.
    const context = { columns: Array.isArray(columns) ? columns : [], measures: known, mode: 'measure' };
    if (context.columns.length) {
      const checked = validateExpression(spec.expr, context);
      if (!checked.ok) return Response.json({ unavailable: true, reason: checked.error });

      if (spec.filter) {
        const filter = validateExpression(spec.filter, { columns: context.columns, mode: 'filter' });
        if (!filter.ok) return Response.json({ unavailable: true, reason: `Filter: ${filter.error}` });
      }
    }

    return Response.json({
      name: String(spec.name || '').trim() || 'New measure',
      expr: spec.expr.trim(),
      filter: spec.filter ? String(spec.filter).trim() : null,
      format: FORMATS.has(spec.format) ? spec.format : 'number',
      explanation: String(spec.explanation || '').trim(),
    });
  } catch (error) {
    console.error('[measure]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
