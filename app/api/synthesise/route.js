import { callerModelKey, canGenerate, generateJson } from '../../../lib/llm.server';
import { refusedFor } from '../../../lib/plans.server';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { acceptArgument } from '../../../lib/synthesiser';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The executive summary as a case, not a list.
 *
 * `lib/synthesiser.js` builds the spine deterministically — what is in doubt,
 * the largest claim, what qualifies it, what to decide — with every step citing
 * the finding it rests on. That spine is complete and correct on its own and is
 * what the customer sees at first paint. This writes it up.
 *
 * **This is the one agent shown numbers**, and the guarantee inverts rather
 * than disappearing. Every other model call here sees no values, which makes
 * any digit in its reply invented and rejectable. An executive summary without
 * figures is a press release, so this one sees the verified facts behind each
 * step — and every figure it writes must already appear in the facts of the
 * step it cited. Not "consistent with them": present in them, as a string.
 *
 * A sentence that cites nothing, cites a step that does not exist, or carries a
 * figure from nowhere is dropped rather than corrected. The deterministic spine
 * is always underneath.
 */

const SYSTEM = `You are writing the opening page of an analyst's report. You are
given the SPINE of an argument that has already been built: a numbered list of
steps, each with what it says, and the verified facts behind it.

Your job is to write that argument as prose a senior reader would take seriously.
Keep the order. Keep the logic. Make it read as one case rather than a list of
observations.

Rules you will be checked against, mechanically:

1. Every sentence you return names the step number it came from.
2. Every figure you write must appear, character for character, in that step's
   facts. You may round a long number down to what the facts show, and you may
   count things you can see in the list in front of you. You may not produce any
   other number. There is no figure you have that this list does not contain.
3. Do not add a claim. If the spine does not say something, it is not known.
4. Do not soften a doubt or move it later. If step 1 says the basis of a measure
   is contested, the reader learns that before they learn any total.
5. One or two sentences per step. This is an opening page, not a report.

Reply as JSON: { "lines": [ { "step": <number>, "text": "<sentence>" } ] }`;

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

    const refused = await enforceLimit(request, 'synthesise');
    if (refused) return refused;

    const { steps = [] } = await request.json();
    if (!Array.isArray(steps) || steps.length === 0) {
      return Response.json({ unavailable: true, reason: 'no_argument' });
    }

    const prompt = `The argument runs:

${JSON.stringify(steps, null, 2)}

Write it.`;

    const result = await generateJson(prompt, SYSTEM, credential);
    if (!result || !Array.isArray(result.lines)) {
      return Response.json({ unavailable: true, reason: 'generation_failed' });
    }

    // Checked here, not trusted. A sentence quoting a figure that is not in the
    // evidence behind the step it cited does not come back out of this route.
    const lines = acceptArgument(result.lines, { steps });

    return Response.json({ lines });
  } catch (error) {
    console.error('[synthesise]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
