import { generateJson, modelCredential } from '../../../lib/llm.server';
import { refusedFor } from '../../../lib/plans.server';
import { enforceLimit } from '../../../lib/routeLimits.server';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * A question the built-in reader could not read, passed to a model: it is
 * shown the column names and types and the measure list (no rows) and asked
 * for one chart as a tile spec. Returned raw — the worker checks every field,
 * measure and chart type against the table before anything is drawn
 * (`askTile` in app/workers/engine.worker.js).
 */
const SYSTEM = `You turn a question about a table into ONE chart, as JSON.
You see the table's columns (name, type, role) and its measures (id, label).
Reply with JSON only, one of these shapes:
{"kind":"breakdown","measures":["<measure id>"],"dim":"<category column>","series":null,"viz":"hbar","title":"..."}
{"kind":"trend","measures":["<measure id>"],"dim":"<date column>","grain":"day|week|month|quarter|year","series":null,"viz":"line","title":"..."}
{"kind":"table","measures":["<measure id>", "..."],"dim":"<column>","limit":10,"viz":"table","title":"..."}
{"kind":"relationship","x":"<number column>","y":"<number column>","measures":[],"viz":"scatter","title":"..."}
{"kind":"distribution","field":"<number column>","measures":[],"viz":"histogram","title":"..."}
{"kind":"kpi","measures":["<measure id>"],"viz":"kpi","title":"..."}
Optional "filters": [{"field":"<column>","values":["<value>"]}].
Use only the ids and column names given. If the question cannot be answered from these columns, reply {"error":"<why, in one sentence>"}.`;

export async function POST(request) {
  try {
    const denied = await refusedFor('model');
    if (denied) return Response.json(denied, { status: 402 });
    const credential = await modelCredential(request);
    if (!credential) return Response.json({ unavailable: true, reason: 'no_provider' });
    const refused = await enforceLimit(request, 'ask');
    if (refused) return refused;

    const body = await request.json();
    const question = String(body?.question || '').slice(0, 400);
    const fields = (Array.isArray(body?.fields) ? body.fields : []).slice(0, 150).map((f) => `- ${String(f?.name).slice(0, 100)} [${f?.kind}, ${f?.role}]`);
    const measures = (Array.isArray(body?.measures) ? body.measures : []).slice(0, 80).map((m) => `- ${String(m?.id).slice(0, 120)}: ${String(m?.label).slice(0, 80)}`);
    if (!question || !fields.length) return Response.json({ unavailable: true, reason: 'no_question' });

    const prompt = `Question: ${question}\n\nColumns:\n${fields.join('\n')}\n\nMeasures:\n${measures.join('\n')}`;
    const spec = await generateJson(prompt, SYSTEM, credential);
    if (!spec || typeof spec !== 'object' || spec.error) return Response.json({ error: spec?.error || 'The model could not read that question.' });
    return Response.json({ spec, via: credential.source });
  } catch (error) {
    console.error('[ask]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
