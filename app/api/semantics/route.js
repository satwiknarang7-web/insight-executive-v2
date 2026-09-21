import { callerModelKey, canGenerate, generateJson } from '../../../lib/llm.server';
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
 *
 * It now carries a third question, and the third one decides what the report is
 * ABOUT: which column is the dependent variable. That used to be answered by a
 * list of forty English nouns in `measureSemantics.js`, which is why a file
 * about automation risk produced a report about record counts — its subject
 * was not on the list, and no list will contain the next one.
 *
 * Nothing here is trusted, and nothing here is verified either. The rows live
 * in the browser and never reach this route, so the checking happens where the
 * evidence is: `acceptBrief` runs in `DatasetProvider` and drops every claim the
 * rows do not support before the planner sees it. This route's job is to ask
 * well and to return a well-shaped proposal.
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

You are answering a THIRD question, and it is the one that decides what the
report is about.

What is this table a record of, and what about it does a reader want to know?

Every other part of this system reasons about shape — which column can be summed,
which has the widest spread. None of that can tell a dependent variable from an
attribute. A file of occupations carrying an automation probability is a file
ABOUT that probability; a file of customers carrying a churn flag is a file about
churn. Charting either as one more column produces a report that is arithmetically
perfect and about nothing.

So name the OUTCOME: the column the dataset exists to explain. Give its shape:

  binary      a flag with two levels. Name which level is the event.
  continuous  a probability, score, duration, amount. Many distinct values.
  ordinal     ranked levels — Low/Medium/High. Name the severe level.
  multiclass  named classes with no order. Name the class that matters.

Rules that matter more than being helpful:

- Most tables have ONE outcome. Some have none — a pure transaction log, a
  reference list. Returning an empty outcomes list is a good answer.
- Prefer the CONTINUOUS column over a banded version of the same thing. Where a
  table holds both a probability and a risk band computed from it, the
  probability is the outcome and the band is a restatement.
- An outcome must be a column that VARIES and that something else might explain.
  A key, a timestamp or a name is never an outcome.
- "high_is_good" says whether a rising number is good news. A churn rate rising
  is not; a survival rate rising is.

Also mark each column's role, using only these words:

  outcome | driver | attribute | identifier | preAggregate | rate | component

A "driver" is a column you expect to EXPLAIN the outcome. Be sparing: every
driver you name is checked against the rows, and one that does not move the
outcome is discarded.

And list up to five questions a reader of this file actually wants answered,
in plain language, as questions.

Reply as JSON:
{
  "claims": [ { "column": "<exact column name>", "unit": "<short name for the unit, letters only>" } ],
  "void_rows": { "column": "<exact column name>", "values": ["<exact value>"] },
  "subject": "<one sentence: what one row is a record of>",
  "outcomes": [
    { "column": "<exact column name>",
      "kind": "binary|continuous|ordinal|multiclass",
      "event": "<exact value that is the event; omit for continuous>",
      "high_is_good": true|false,
      "why": "<short reason this is what the file is for>" }
  ],
  "roles": { "<exact column name>": "<role>" },
  "questions": ["<question>"]
}

An empty claims list is a good answer and the most common correct one. Omit
void_rows entirely unless the table plainly has such a column. Copy every column
name and every value EXACTLY as shown above; anything invented is discarded.`;

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
    const credential = callerModelKey(request);

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

Which number columns are counted in a unit that is not the same on every row,
which values mean a row did not stand, and what is this table a record of?`;

    const result = await generateJson(prompt, SYSTEM, credential);
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

    /**
     * And the brief, which is the claim with the most riding on it.
     *
     * `acceptBrief` re-derives every part of it from the rows — the column
     * exists, its values have the claimed shape, nothing else determines it,
     * each named driver actually moves it — and returns only what survives.
     * The browser holds the rows, not this route, so the verification cannot
     * happen here; what is returned is the model's proposal, and the caller
     * runs it through the gate before it reaches the planner.
     *
     * Shaped here rather than passed through raw so the route's contract is a
     * brief rather than "whatever the model said", and so a reply missing the
     * new fields entirely — an older model, a truncated generation — comes back
     * as an empty brief instead of undefined.
     */
    const brief = {
      subject: typeof result.subject === 'string' ? result.subject : null,
      outcomes: Array.isArray(result.outcomes) ? result.outcomes : [],
      roles: result.roles && typeof result.roles === 'object' ? result.roles : {},
      questions: Array.isArray(result.questions) ? result.questions : [],
    };

    return Response.json({ claims, voidClaim, brief });
  } catch (error) {
    console.error('[semantics]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
