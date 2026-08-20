import { generateJson, hasAnyProvider } from '../../../lib/llm.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Turn verified findings into plain-English executive prose.
 *
 * The request body is a few kilobytes of already-computed statistics — never
 * raw rows. Every number in the response must come from those statistics; the
 * model's only job is wording. If it fails or is unconfigured we return
 * `{ unavailable: true }` and the client keeps its deterministic narrative.
 */

const SYSTEM = (findings, synthesis, focus) => `
# WHO YOU ARE
You are a clear-headed business analyst writing for busy, non-technical executives. You turn already-computed statistics into plain, confident English a CEO can read in seconds.

# THE MOST IMPORTANT RULE
Every number has ALREADY been calculated and is listed below under VERIFIED FINDINGS. Do NOT invent, estimate, or recompute any number. Use only the figures given. If a number isn't in the findings, don't state it. Your only job is wording, not maths.

# HOW TO WRITE
- Plain language. No jargon, no buzzwords ("synergy", "leverage", "boardroom-ready"), no filler.
- Short, direct sentences. Lead with the point.
- Name the actual segment and the actual number.
- Be honest: if a relationship is weak or a trend is flat, say so.
${focus ? `- The reader specifically asked about: "${focus}". Bias the summary toward that.` : ''}

# VERIFIED FINDINGS (your only source of facts)
${JSON.stringify(findings)}

# DATASET-LEVEL SYNTHESIS (already computed)
${JSON.stringify(synthesis)}

# OUTPUT FORMAT (STRICT)
Return ONE strictly valid, minified JSON object. No markdown, no code fences, no commentary.

{
  "slideZero": {
    "title": "Executive Summary",
    "macroInsights": ["Exactly 3 plain-English takeaways, each citing a verified number"],
    "strategicScorecard": {
      "focus": "The single most important thing to act on",
      "risk": "The biggest risk or concentration in the data",
      "opportunity": "The clearest opportunity or positive trend"
    }
  },
  "storyboard": [
    {
      "id": "Matching id from the findings",
      "pageTitle": "Short, plain slide title (no jargon)",
      "insight_anchor": "The key finding in one sentence, with the verified number",
      "insight_implication": "What it means for the business, plainly",
      "insight_question": "One specific next question or decision"
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

    const prompt = `Rewrite the ${findings.length} VERIFIED FINDINGS into a clear executive storyboard for a non-technical leader.

RULES:
1. Use ONLY the numbers in the verified findings. Never invent or recompute a figure.
2. Plain English. No jargon or buzzwords. Short, direct sentences.
3. Return a 'slideZero' object AND exactly ${findings.length} entries in 'storyboard', each with the matching id.`;

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
