import { generateJson, modelCredential } from '../../../lib/llm.server';
import { refusedFor } from '../../../lib/plans.server';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { acceptEdits } from '../../../lib/analystEdits';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The pass that edits the deck instead of describing it.
 *
 * The engine builds charts that are correct. Correct is not the same as well
 * presented, and the gap between them is what a human analyst closes in the ten
 * minutes after a report lands: this heading says what the query did rather than
 * what it found, these two belong the other way round, this one is a series over
 * time and is drawn as bars.
 *
 * None of that is a judgement a rule makes well, and all of it is safe to hand
 * over because of how narrow the moves are. The model is given the deck's
 * STRUCTURE — ids, headings, chart types, which column each is drawn over, how
 * many rows each drew — and, per slide, the list of chart types that slide could
 * legally be. It picks from that list. It cannot invent a type, cannot reach a
 * number, and cannot delete anything.
 *
 * It is shown no values, which is what makes the title check mechanical rather
 * than hopeful: a digit in a heading it wrote was not read anywhere, so
 * `acceptEdits` drops it.
 *
 * Unconfigured or failing, this returns `{ unavailable: true }` and the deck is
 * the one the engine built. Nothing here is on the path to a finished analysis.
 */

const SYSTEM = `You are a senior data analyst who has been handed a generated
report and asked to tidy it before it goes out. The numbers in it are already
verified and are not yours to touch. Your job is presentation: headings, chart
types, and the order the story is told in.

You are given the deck's structure — each slide's id, heading, chart type, the
column it is drawn over, the measure, and how many rows it drew. You are given
no values and no results. Each slide also carries 'alternatives': the chart
types that slide could legally be drawn as. That list was computed from the
data; it is the only set of types you may choose from.

The three operations you may return:

  { "op": "retitle", "id": "<slide id>", "title": "<new heading>", "why": "<short reason>" }
  { "op": "chart_type", "id": "<slide id>", "chart_type": "<one of that slide's alternatives>", "why": "..." }
  { "op": "reorder", "order": ["<id>", "<id>", ...], "why": "..." }

Guidance, in the order it matters:

1. Retitle the headings marked 'needs_rewrite' first — that field says what a
   check already found wrong with it, usually that it names the operation ("Sum
   of Amount by Region") or that it is too long and gets clipped on screen.
   Those are the ones worth your attention, and a shorter heading must still
   name the same thing: shorten by dropping words that carry nothing, never by
   dropping the subject. A heading with no flag and no problem stays as it is —
   renaming for the sake of it is worse than leaving it.
2. Never put a number, a superlative or a claim in a heading. You have been
   shown no values, so any figure you write is invented and will be dropped.
   Headings describe what the chart shows, never what it proves.
3. Change a chart type only when the current one misreads the data: a series
   over time drawn as separate bars, or a handful of parts of one whole drawn
   as a ranking. If the alternatives list is empty, that slide's type is fixed.
4. Reorder only if the deck tells its story out of order — the broadest finding
   first, the detail behind it after. Listing a few ids is enough; the rest keep
   their places. Leave the order alone if it is already sensible.
5. Fewer, better edits. An untouched deck is a valid answer, and a common one.

Reply as JSON: { "edits": [ ... ] }`;

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

    const refused = await enforceLimit(request, 'analyst');
    if (refused) return refused;

    const { slides = [], profile = null } = await request.json();
    if (!Array.isArray(slides) || slides.length === 0) {
      return Response.json({ unavailable: true, reason: 'no_slides' });
    }

    const prompt = `The deck has these slides, in order:

${JSON.stringify(slides, null, 2)}

What would you change before this went out?`;

    const result = await generateJson(prompt, SYSTEM, credential);
    if (!result || !Array.isArray(result.edits)) {
      return Response.json({ unavailable: true, reason: 'generation_failed' });
    }

    // Checked here, not trusted — against the same briefing the model was
    // given, so the rule it was told and the rule it is held to are one object.
    // An id that was not sent, a type that was not on that slide's menu, or a
    // heading with a digit in it does not come back out of this route.
    const edits = acceptEdits(result.edits, { slides, profile });

    return Response.json({ edits });
  } catch (error) {
    console.error('[analyst]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
