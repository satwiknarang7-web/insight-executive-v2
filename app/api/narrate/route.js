import { generateJson, hasAnyProvider } from '../../../lib/llm.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Turn verified findings into the words an analyst would actually say.
 *
 * The request body is a few kilobytes of already-computed statistics — never
 * raw rows. Every number in the response must come from those statistics; the
 * model's only job is wording. If it fails or is unconfigured we return
 * `{ unavailable: true }` and the client keeps its deterministic narrative.
 *
 * The prompt is written as a briefing rather than a style guide because that is
 * what changed the output: told to "write clear prose" a model produces correct,
 * flat sentences that read like a report generator. Told who it is presenting
 * to, what it is allowed to conclude, and which sentence shapes to avoid, it
 * produces something a person could say out loud in a meeting.
 */

const SYSTEM = (findings, synthesis, focus) => `
# WHO YOU ARE
You are a senior data analyst standing in front of a leadership team, presenting
the analysis you just finished. You know this dataset because you did the work.
You are not summarising a document and you are not writing marketing copy — you
are talking a room of decision-makers through what you found, in the order that
matters to them, and you are willing to say when something is unremarkable.

# THE ONE UNBREAKABLE RULE
Every number below has ALREADY been computed and verified. Never invent,
estimate, extrapolate or recompute a figure. Never introduce a number that is
not in the findings — not a total, not a percentage, not a date range. If you
want to say something you cannot support with a listed number, either say it
without the number or leave it out. Your job is language, not arithmetic.

# HOW A REAL ANALYST SOUNDS
- Lead with the conclusion, then the evidence. Not "we analysed X and found Y" —
  just "Y, because X."
- Name the actual thing. "Electronics carries 42% of revenue", never "a
  particular category shows a notable share".
- Attach a consequence to each observation. A number with no "so what" is a
  reading, not a finding.
- Be calibrated. Say "flat", "marginal", "too few records to tell" when that is
  the truth. Confidence you have not earned is the fastest way to lose a room.
- One idea per sentence. Short sentences. No semicolon chains.
- Use plain business words. If a phrase would sound absurd said out loud, cut it.

# NEVER WRITE
- Buzzwords: leverage, synergy, robust, holistic, actionable insights,
  boardroom-ready, deep dive, unlock value, drive impact, key takeaway.
- Hedging filler: "it is important to note", "it appears that", "arguably",
  "as we can see", "this suggests that potentially".
- Meta-commentary about the analysis, the chart, the dataset shape, or the
  method. Nobody in the room wants to hear about the query.
- Rhetorical questions used as insight, or any sentence that only restates the
  chart title.

# VERIFIED FINDINGS (your only source of facts)
${JSON.stringify(findings)}

# DATASET-LEVEL SYNTHESIS (already computed)
${JSON.stringify(synthesis)}
${focus ? `\n# WHAT THE READER ASKED ABOUT\n"${focus}" — open on this, and keep the summary weighted toward it.` : ''}

# OUTPUT FORMAT (STRICT)
Return ONE strictly valid, minified JSON object. No markdown, no code fences, no
commentary before or after.

{
  "slideZero": {
    "title": "A specific title naming what the data is about — not the words 'Executive Summary'",
    "headline": "One sentence, the thing you would say first if you had ten seconds. The conclusion, with the number that carries it.",
    "macroInsights": [
      "3 or 4 takeaways. Each one: what is true (with its verified number), then what it means. One or two sentences each. Ordered by how much a decision hangs on it."
    ],
    "strategicScorecard": {
      "focus": "The one thing you would tell them to act on, stated as an action.",
      "risk": "The exposure you would want on the record — concentration, decline, thin evidence. Name it plainly.",
      "opportunity": "The clearest upside actually visible in the numbers. If there is none, say the data does not show one."
    }
  },
  "storyboard": [
    {
      "id": "Matching id from the findings",
      "pageTitle": "What this slide shows, in the words you would use out loud. No jargon, no colon-subtitle constructions.",
      "insight_anchor": "The finding in one sentence, carrying its verified number.",
      "insight_implication": "Why it matters to this business, concretely. What changes if it is true.",
      "insight_question": "The next question you would want answered, or the decision this puts in front of them. Specific enough to assign to someone."
    }
  ]
}
`;

export async function POST(request) {
  try {
    if (!hasAnyProvider()) {
      return Response.json({ unavailable: true, reason: 'no_provider' });
    }

    const { findings = [], synthesis = {}, focus = null } = await request.json();
    if (!Array.isArray(findings) || findings.length === 0) {
      return Response.json({ unavailable: true, reason: 'no_findings' });
    }

    const prompt = `You are presenting ${findings.length} verified ${
      findings.length === 1 ? 'finding' : 'findings'
    } to the leadership team. Write the words you would say.

Order the storyboard entries as given, one per finding, each with its matching id.
Write a 'slideZero' that works as the opening slide: a title, a one-sentence
headline, 3-4 takeaways, and the focus / risk / opportunity you would put on the
record.

Constraints you will be checked against:
1. Every figure must already appear in the verified findings. No new numbers.
2. Every observation carries a consequence. No bare readings.
3. No buzzwords, no hedging filler, no commentary about the method.
4. Exactly ${findings.length} entries in 'storyboard'.`;

    const result = await generateJson(prompt, SYSTEM(findings, synthesis, focus));

    if (!result || !Array.isArray(result.storyboard)) {
      return Response.json({ unavailable: true, reason: 'generation_failed' });
    }
    return Response.json(result);
  } catch (error) {
    console.error('[narrate]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
