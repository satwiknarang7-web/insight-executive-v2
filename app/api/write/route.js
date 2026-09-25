import { generateJson, modelCredential } from '../../../lib/llm.server';
import { refusedFor } from '../../../lib/plans.server';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { WRITE_SYSTEM, acceptWriting, writePrompt } from '../../../lib/engine/ai';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * The dashboard's words, written by a model from the facts the engine
 * computed. Every sentence with a number not in those facts is dropped here
 * (`acceptWriting`), and again on the page.
 */
export async function POST(request) {
  try {
    const denied = await refusedFor('model');
    if (denied) return Response.json(denied, { status: 402 });
    const credential = await modelCredential(request);
    if (!credential) return Response.json({ unavailable: true, reason: 'no_provider' });
    const refused = await enforceLimit(request, 'write');
    if (refused) return refused;

    const body = await request.json();
    const briefing = {
      subject: String(body?.subject ?? '').slice(0, 300),
      kpis: (Array.isArray(body?.kpis) ? body.kpis : []).slice(0, 8).map((k) => ({
        label: String(k?.label ?? '').slice(0, 80),
        value: String(k?.value ?? '').slice(0, 40),
        change: k?.change ? String(k.change).slice(0, 20) : null,
        vs: k?.vs ? String(k.vs).slice(0, 40) : null,
      })),
      tiles: (Array.isArray(body?.tiles) ? body.tiles : []).slice(0, 16).map((t) => ({
        id: String(t?.id ?? '').slice(0, 40),
        title: String(t?.title ?? '').slice(0, 120),
        draft: String(t?.draft ?? '').slice(0, 600),
      })),
    };
    if (!briefing.tiles.length) return Response.json({ unavailable: true, reason: 'nothing_to_write' });
    const proposal = await generateJson(writePrompt(briefing), WRITE_SYSTEM, credential);
    const written = acceptWriting(proposal, briefing);
    return Response.json({ written, via: credential.source });
  } catch (error) {
    console.error('[write]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
