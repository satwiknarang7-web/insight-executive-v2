import { callerGeminiKey, canGenerate, generateJson } from '../../../lib/llm.server';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { acceptUnitClaims } from '../../../lib/semanticClaims';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Which columns are counted in a unit that changes from row to row.
 *
 * `lib/measureUnits.js` answers this with a lexicon — LCU, local currency, a
 * `currency` column in the table — and the lexicon is right about the files it
 * was written for. A column called `importe` or `Betrag` is the same hazard in
 * a word it does not have, and the failure is silent: reais summed onto dollars
 * and printed as one figure.
 *
 * This is shown the shape of the table and none of its values, and asked only
 * that question. Everything it says is checked in `acceptUnitClaims` before it
 * can affect anything, and what the lexicon already found is not up for
 * discussion.
 *
 * Unlike the critic and the narrator, this one runs BEFORE the charts are
 * planned — it changes which sums are allowed, so it cannot be a background
 * pass. That makes it the only agent on the critical path, which is why it is
 * given a short deadline by the caller and why failing is cheap: no answer
 * means the lexicon alone, which is exactly today's behaviour.
 */

const SYSTEM = `You are reading the column list of a table, in any language, and
answering one question: which of the NUMBER columns hold a quantity whose UNIT
is not the same on every row?

The case that matters is money recorded in whatever currency each row belongs
to — a column of national-currency amounts across many countries, an "amount"
column beside a currency code, a name that says local or national currency in
any language. Summing those across rows adds unlike quantities.

Also count: a measure expressed per different bases across rows (per capita for
some rows, absolute for others), or a quantity whose name says it is in local
or national units.

Do NOT count:
- a column already in one fixed unit for every row, however large
- counts, quantities, scores, ratings, percentages, rates
- anything whose unit you are merely unsure about — silence is the right answer
  when you do not know

You are shown no values. Do not guess at magnitudes and do not invent a unit you
cannot read out of the column name itself.

Reply as JSON: { "claims": [ { "column": "<exact column name>", "unit": "<short
name for the unit, letters only>" } ] }

An empty list is a good answer and the most common correct one.`;

export async function POST(request) {
  try {
    if (!canGenerate(request)) {
      return Response.json({ unavailable: true, reason: 'no_provider' });
    }
    const geminiKey = callerGeminiKey(request);

    const refused = await enforceLimit(request, 'semantics');
    if (refused) return refused;

    const { columns = [], detected = {} } = await request.json();
    if (!Array.isArray(columns) || columns.length === 0) {
      return Response.json({ unavailable: true, reason: 'no_columns' });
    }

    const prompt = `The table has these columns:

${columns
  .map((c) => `- ${c.name} (${c.kind}${c.levels ? `, ${c.levels} distinct` : ''})`)
  .join('\n')}

Which of the number columns are counted in a unit that is not the same on every row?`;

    const result = await generateJson(prompt, SYSTEM, { geminiKey });
    if (!result || !Array.isArray(result.claims)) {
      return Response.json({ unavailable: true, reason: 'generation_failed' });
    }

    // Checked here, not trusted. A claim about a column that is not a measure,
    // or one the lexicon already settled, or a unit with a digit in it, does
    // not reach the planner.
    const claims = acceptUnitClaims(result.claims, {
      profile: { measures: columns.filter((c) => c.kind === 'number').map((c) => c.name) },
      detected,
    });

    return Response.json({ claims });
  } catch (error) {
    console.error('[semantics]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
