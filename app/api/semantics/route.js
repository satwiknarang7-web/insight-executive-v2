import { callerGeminiKey, canGenerate, generateJson } from '../../../lib/llm.server';
import { refusedFor } from '../../../lib/plans.server';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { acceptUnitClaims } from '../../../lib/semanticClaims';
import { acceptVoidClaims } from '../../../lib/voidRows';

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

You are also answering a SECOND question about the same table.

Some tables record what became of each row: an order status, a transaction
state, a disposition. Where such a column exists, some of its values mean the
row DID NOT STAND — cancelled, returned, refunded, charged back, failed. Those
rows are not revenue, and a total that includes them has the wrong name.

You are shown the distinct values each category column actually holds, with how
often each occurs. Say which column records this, and which of ITS OWN VALUES
mean the row did not stand. Copy the values exactly from the list you were
shown; a value you invent will be discarded.

This is what the value list is for. "Storniert", "Retoure", "Annule", "RTO",
"Devuelto", "COD Failed" all mean it, in tables whose column names give nothing
away. A pending or in-progress row DID happen and is not void. A column where
most of the values would be void is not a status column, so say nothing.

Reply as JSON:
{
  "claims": [ { "column": "<exact column name>", "unit": "<short name for the unit, letters only>" } ],
  "void_rows": { "column": "<exact column name>", "values": ["<exact value>"] }
}

An empty claims list is a good answer and the most common correct one. Omit
void_rows entirely unless the table plainly has such a column.`;

export async function POST(request) {
  try {
    // The plan decides whether this account may reach a model at all, and it
    // is read from the database rather than the request — the browser hides
    // these controls on a free plan, but hiding is not enforcing.
    const denied = await refusedFor('model');
    if (denied) return Response.json(denied, { status: 402 });

    if (!canGenerate(request)) {
      return Response.json({ unavailable: true, reason: 'no_provider' });
    }
    const geminiKey = callerGeminiKey(request);

    const refused = await enforceLimit(request, 'semantics');
    if (refused) return refused;

    const { columns = [], detected = {}, sample = [] } = await request.json();
    if (!Array.isArray(columns) || columns.length === 0) {
      return Response.json({ unavailable: true, reason: 'no_columns' });
    }

    // A column's vocabulary is the evidence for both questions, so it goes
    // under the column rather than in a block of its own: the values of
    // `Order_Status` are useless three screens away from its name.
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

    const prompt = `The table has these columns:

${columns.map(describe).join('\n')}
${sample.length ? `\nA few whole rows, taken across the table:\n${JSON.stringify(sample.slice(0, 8))}` : ''}

Which number columns are counted in a unit that is not the same on every row, and
which values mean a row did not stand?`;

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

    // And a void-row claim only survives if it names a column whose values were
    // actually shown, and values that column actually holds. A status it made
    // up would exclude nothing while reporting that it had.
    const voidClaim = acceptVoidClaims(result.void_rows, { columns });

    return Response.json({ claims, voidClaim });
  } catch (error) {
    console.error('[semantics]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
