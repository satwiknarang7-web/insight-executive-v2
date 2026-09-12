import { callerGeminiKey, canGenerate, generateJson } from '../../../lib/llm.server';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { acceptModelQuestions } from '../../../lib/critic';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * What else an analyst would have asked of this dataset.
 *
 * `lib/critic.js` finds the questions a rule can find: a deck that argues with
 * itself, an outcome nothing is built on, columns profiled and never used.
 * What a rule list cannot do is look at a table about athletes and wonder
 * whether height matters more in some sports than others. That is domain
 * imagination, it is the one thing a model is unambiguously better at than a
 * regex, and it is safe to ask for precisely because the answer is a question.
 *
 * **The model is shown no numbers.** Not the rows — that was never on the table
 * — but not the findings either. It gets column names, what kind of column each
 * is, how many levels it has, and the titles of the charts already built. That
 * is enough to ask a good question and not enough to assert anything.
 *
 * Which is the point. A model with no figures in front of it has none to quote,
 * so any digit in its reply is invented, and `acceptModelQuestions` drops it
 * mechanically rather than the prompt asking nicely. The same validator
 * enforces the rest: a question mark or it is not a question, nothing already
 * asked, a length limit, and every survivor tagged as model-written so a reader
 * can tell which questions were found in the data and which were thought up
 * about it.
 *
 * Unconfigured or failing, this returns `{ unavailable: true }` and the deck
 * keeps the deterministic questions it already had. Nothing here is on the path
 * to a finished analysis.
 */

const SYSTEM = `You are a senior data analyst reviewing a colleague's first pass
at a dataset. You are given the SHAPE of the data — column names, whether each
is a category or a number, roughly how many distinct values it has — and the
titles of the charts they built. You are given no values and no results, and you
must not pretend otherwise.

Your job is to ask what they did not. Good questions here are the ones an
experienced analyst asks on seeing the column list: a relationship between two
columns nobody crossed, a breakdown that would change how a headline reads, a
confounder that would explain an obvious result, a segment worth separating.

Rules you will be checked against, mechanically:

1. Every item is a QUESTION and ends with a question mark. Not a finding, not a
   recommendation, not an observation.
2. No numbers. You have been shown none, so any figure you write is invented.
   The only digits allowed are ones inside a column name you were given.
3. Nothing already in 'alreadyAsked'. Say something new or say less.
4. Name real columns from the list. A question about a column that does not
   exist is worse than no question.
5. At most four, ordered with the most useful first. Fewer is better than
   padding.
6. No questions about method, data quality, sample size or missing values — the
   engine checks those itself and your version would be noise.

Reply as JSON: { "questions": ["...?", "...?"] }`;

export async function POST(request) {
  try {
    if (!canGenerate(request)) {
      return Response.json({ unavailable: true, reason: 'no_provider' });
    }
    const geminiKey = callerGeminiKey(request);

    const refused = await enforceLimit(request, 'critique');
    if (refused) return refused;

    const { columns = [], charted = [], alreadyAsked = [] } = await request.json();
    if (!Array.isArray(columns) || columns.length === 0) {
      return Response.json({ unavailable: true, reason: 'no_columns' });
    }

    const describe = (c) =>
      `${c.name} (${c.kind}${c.levels ? `, ${c.levels} distinct` : ''})`;

    const prompt = `The dataset has these columns:

${columns.map((c) => `- ${describe(c)}`).join('\n')}

The analysis already built these charts:

${charted.length ? charted.map((t) => `- ${t}`).join('\n') : '- none'}

And these questions have already been raised about it:

${alreadyAsked.length ? alreadyAsked.map((q) => `- ${q}`).join('\n') : '- none'}

What would you ask that nobody has asked yet?`;

    const result = await generateJson(prompt, SYSTEM, { geminiKey });
    if (!result || !Array.isArray(result.questions)) {
      return Response.json({ unavailable: true, reason: 'generation_failed' });
    }

    // Validated here rather than trusted. The author of this list is not this
    // codebase, so it clears the same bar the deterministic questions do.
    const questions = acceptModelQuestions(result.questions, {
      columns: columns.map((c) => c.name),
      existing: alreadyAsked.map((q) => ({ question: q })),
    });

    return Response.json({ questions });
  } catch (error) {
    console.error('[critique]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
