import { callerGeminiKey, canGenerate, generateJson } from '../../../lib/llm.server';
import { refusedFor } from '../../../lib/plans.server';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { acceptScepticQuestions } from '../../../lib/validitySceptic';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * What this deck claims that its numbers cannot carry.
 *
 * `lib/validitySceptic.js` catches the overclaims a rule can catch: causal
 * language over an engine that estimates no causes, a share of the shown rows
 * quoted as a share of the business, a correlation over group averages read as
 * one over records, a recommendation pointing away from the outlier its own
 * metrics found.
 *
 * What a rule list cannot do is notice that comparing a conversion rate across
 * segments of wildly different sizes makes the small one noise, or that a
 * ranking of averages hides a distribution, or that the measure being compared
 * across groups is not the measure the reader will think it is. That is
 * statistical judgement about a shape, and it is safe to ask for because the
 * answer is a question.
 *
 * **The model is shown no numbers.** Not the rows, not the findings — the SHAPE
 * of each claim: what it grouped by, what it aggregated, the chart type, how
 * many groups, the evidence tier, and the NAMES of the statistics computed.
 * Enough to doubt something; not enough to assert anything. Any digit in its
 * reply was invented and is dropped mechanically.
 */

const SYSTEM = `You are a statistician reviewing a colleague's finished analysis
for things it claims but cannot support. You are shown the SHAPE of each finding
— what it grouped by, what it measured, the chart type, how many groups it drew,
the evidence tier it was given, and the names of the statistics computed for it.
You are shown no values and no results.

The engine that produced these findings computes aggregates, shares, spreads and
correlations. It runs no experiment and fits no causal model. Nothing in it can
establish that one thing caused another.

Ask what an experienced statistician would doubt. The useful doubts here are
about shape: a rate compared across groups whose sizes differ by orders of
magnitude, an average standing in for a distribution that is probably skewed, a
relationship measured over aggregates and read as one over individuals, a
segment defined after the fact, a measure that will be read as something it is
not.

Rules you will be checked against, mechanically:

1. Every item is a QUESTION and ends with a question mark. Not a finding, not a
   correction, not an assertion that something IS wrong.
2. No numbers. You have been shown none, so any figure you write is invented.
3. Nothing already in 'alreadyAsked'.
4. Name a finding by its title. A doubt about a finding that does not exist is
   worse than no doubt.
5. At most three, the most serious first. Fewer is better than padding.
6. Nothing about missing data, sample size caveats, or columns that were not
   analysed — a different check owns those and your version would be noise.
7. Do not doubt something merely because its evidence tier is low. The tier is
   already shown to the reader; repeating it tells them nothing.

Reply as JSON: { "questions": [ "<question>" ] }

An empty list is a good answer.`;

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

    const refused = await enforceLimit(request, 'sceptic');
    if (refused) return refused;

    const { claims = [], rows = null, alreadyAsked = [] } = await request.json();
    if (!Array.isArray(claims) || claims.length === 0) {
      return Response.json({ unavailable: true, reason: 'no_claims' });
    }

    const prompt = `The analysis ran over ${rows ? 'a table of many rows' : 'a table'} and produced these findings:

${JSON.stringify(claims, null, 2)}

Already asked:
${(alreadyAsked || []).map((q) => `- ${q}`).join('\n') || '- nothing yet'}

What would you doubt?`;

    const result = await generateJson(prompt, SYSTEM, { geminiKey });
    if (!result || !Array.isArray(result.questions)) {
      return Response.json({ unavailable: true, reason: 'generation_failed' });
    }

    // Checked here, not trusted. A question with a figure in it was invented,
    // an assertion dressed as a question is not a question, and anything
    // already on the deck is noise.
    const questions = acceptScepticQuestions(result.questions, {
      titles: claims.map((c) => c?.title).filter(Boolean),
      existing: (alreadyAsked || []).map((q) => ({ question: q })),
    });

    return Response.json({ questions });
  } catch (error) {
    console.error('[sceptic]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
