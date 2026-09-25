import { generateJson, modelCredential } from '../../../lib/llm.server';
import { refusedFor } from '../../../lib/plans.server';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { UNDERSTAND_SYSTEM, understandPrompt } from '../../../lib/engine/ai';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * A model's reading of a table before its dashboard is planned: what it is,
 * which number matters, which splits, which columns were misread, which ratios
 * to add. Given column names, types and a few values each — never rows.
 *
 * Returned raw. The page checks it against the reading (`acceptReading` in
 * lib/engine/ai.js) before the planner uses any of it.
 */
export async function POST(request) {
  try {
    const denied = await refusedFor('model');
    if (denied) return Response.json(denied, { status: 402 });
    const credential = await modelCredential(request);
    if (!credential) return Response.json({ unavailable: true, reason: 'no_provider' });
    const refused = await enforceLimit(request, 'understand');
    if (refused) return refused;

    const briefing = await request.json();
    if (!Array.isArray(briefing?.columns) || !briefing.columns.length) return Response.json({ unavailable: true, reason: 'no_columns' });
    briefing.columns = briefing.columns.slice(0, 120).map((c) => ({
      name: String(c?.name ?? '').slice(0, 120),
      type: String(c?.type ?? ''),
      readAs: String(c?.readAs ?? ''),
      agg: c?.agg ? String(c.agg) : undefined,
      distinct: Number(c?.distinct) || 0,
      examples: (Array.isArray(c?.examples) ? c.examples : []).slice(0, 6).map((v) => String(v).slice(0, 40)),
      range: Array.isArray(c?.range) ? c.range.slice(0, 2) : undefined,
    }));
    const proposal = await generateJson(understandPrompt(briefing), UNDERSTAND_SYSTEM, credential);
    if (!proposal || typeof proposal !== 'object') return Response.json({ unavailable: true, reason: 'generation_failed' });
    return Response.json({ proposal, via: credential.source });
  } catch (error) {
    console.error('[understand]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
