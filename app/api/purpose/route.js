import { generateJson, modelCredential } from '../../../lib/llm.server';
import { refusedFor } from '../../../lib/plans.server';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { acceptPurpose } from '../../../lib/datasetPurpose';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * What is this table for?
 *
 * The one question the planner never asked. It ranked dimensions by how many
 * levels they had plus a hard-coded list of English business words, and
 * measures by the width of their numeric range — so on a comparison of AI
 * subscription plans it led with `Average Context Window`, a column counted in
 * millions and therefore the widest in the file, and spent three more slides
 * counting how many rows each vendor contributed. The prices and the benchmark
 * scores the file exists to compare were never charted.
 *
 * Like the unit pass, this runs BEFORE the charts are planned — it changes what
 * is worth charting, so it cannot be a background pass. That makes it the
 * second agent on the critical path, which is why the caller gives it a short
 * deadline and why failing is cheap: no answer, no provider, or a slow one, and
 * the planner ranks on statistics alone, which is what every analysis did until
 * now.
 *
 * It is shown the shape of the table and a few whole rows. It computes nothing,
 * and it cannot: everything it returns is a column name, checked against the
 * columns that exist in `acceptPurpose` before it can affect anything. Every
 * figure in the finished report is still SQL over the reader's own rows.
 */

const SYSTEM = `You are looking at the column list of a table and working out
what it is FOR — what a person opening this file would want to know from it.

Answer four questions.

1. SUBJECT. What does one row represent? One short phrase, e.g. "a subscription
   plan offered by an AI vendor", "an order line", "a patient visit". If you
   cannot tell, say so briefly rather than guessing.

2. KEY MEASURES. Which NUMBER columns would a reader actually want measured —
   totalled, averaged, compared, ranked? Best first, at most six.

   Prefer columns that carry meaning for the subject: money, rates, scores,
   quantities, and especially columns that already express a ratio the file was
   built to compare (a cost per unit of quality, a yield, an efficiency).

   Do NOT pick: identifiers, row numbers, ranks, sequence positions, years used
   as labels, or a column whose value is the same on nearly every row. A column
   with a wide numeric range is not thereby interesting — a context window in
   tokens is a large number and a boring one.

3. KEY DIMENSIONS. Which CATEGORY columns would a reader want those measures
   broken out by? Best first, at most six. Prefer the few columns that name the
   thing being compared; skip ones with so many distinct values that a chart of
   them is unreadable.

4. AVOID. Which columns should stay off a report entirely? Identifiers, keys,
   URLs, source citations, free-text notes, and provenance — the date the
   extract was taken, the name of the tool that produced it, a verification
   flag. These are how the file was made, not what it says.

Rules:
- Use column names EXACTLY as they are given to you. A name you invent is
  discarded, and it takes the rest of that list with it.
- A column belongs in at most one of measures, dimensions and avoid.
- Judge from names, kinds and the sample values you are shown. Do not assume a
  column holds something its name and values do not support.
- Empty lists are allowed. Silence is better than a guess you cannot support.

Reply as JSON:
{
  "subject": "<one short phrase for what one row is>",
  "keyMeasures": ["<exact column name>"],
  "keyDimensions": ["<exact column name>"],
  "avoid": ["<exact column name>"],
  "questions": ["<a question a reader of this file would ask>"]
}`;

export async function POST(request) {
  try {
    // The plan decides whether this account may reach a model at all, and it is
    // read from the database rather than the request — the browser hides these
    // controls on a free plan, but hiding is not enforcing.
    const denied = await refusedFor('model');
    if (denied) return Response.json(denied, { status: 402 });

    // The reader's own key, or the deployment's for a Pro account — see
    // modelCredential in lib/llm.server.js.
    const credential = await modelCredential(request);
    if (!credential) {
      return Response.json({ unavailable: true, reason: 'no_provider' });
    }

    const refused = await enforceLimit(request, 'purpose');
    if (refused) return refused;

    const { columns = [], sample = [], fileName = null, rowCount = null } = await request.json();
    if (!Array.isArray(columns) || columns.length === 0) {
      return Response.json({ unavailable: true, reason: 'no_columns' });
    }

    // A column's own values are the evidence for what it is, so they go under
    // its name rather than in a block of their own.
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

    const prompt = `${fileName ? `The file is called "${fileName}".\n` : ''}${
      Number.isFinite(rowCount) ? `It has ${rowCount} rows.\n` : ''
    }
The table has these columns:

${columns.map(describe).join('\n')}
${sample.length ? `\nA few whole rows, taken across the table:\n${JSON.stringify(sample.slice(0, 8))}` : ''}

What is this table for, which columns carry that, and which are plumbing?`;

    const result = await generateJson(prompt, SYSTEM, credential);
    if (!result || typeof result !== 'object') {
      return Response.json({ unavailable: true, reason: 'generation_failed' });
    }

    // Checked here, not trusted: every name has to be a column that exists, and
    // a purpose that survives with nothing in it is no purpose at all.
    const purpose = acceptPurpose(result, { columns: columns.map((c) => c.name) });
    if (!purpose) return Response.json({ unavailable: true, reason: 'nothing_usable' });

    return Response.json({ purpose });
  } catch (error) {
    console.error('[purpose]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
