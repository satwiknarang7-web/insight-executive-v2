import { generateJson, modelCredential } from '../../../lib/llm.server';
import { refusedFor } from '../../../lib/plans.server';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { QUESTIONS_SYSTEM, questionsPrompt } from '../../../lib/modelQuestions';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Which questions a report on this table should answer — a model's reading.
 *
 * Phase 4 of docs/design/question-first-reports.md. Called when the question
 * card opens, with the same briefing the semantics pass already sends (column
 * names, each column's values or range, twenty whole rows) and the catalogue's
 * own list of questions. The model picks from the list and proposes what is
 * missing, in the catalogue's typed form.
 *
 * Returned raw, as a proposal. This route cannot check it — the rows are in the
 * reader's browser — so the worker does, with `acceptModelQuestions` in
 * lib/modelQuestions.js, before anything reaches the card.
 */
export async function POST(request) {
  try {
    const denied = await refusedFor('model');
    if (denied) return Response.json(denied, { status: 402 });

    // The reader's own key, or the deployment's for a Pro account.
    const credential = await modelCredential(request);
    if (!credential) return Response.json({ unavailable: true, reason: 'no_provider' });

    const refused = await enforceLimit(request, 'questions');
    if (refused) return refused;

    const { columns = [], sample = [], fileName = null, rowCount = null, grain = null, catalogue = [] } = await request.json();
    if (!Array.isArray(columns) || columns.length === 0) {
      return Response.json({ unavailable: true, reason: 'no_columns' });
    }
    // Only ids and wording travel: the catalogue's questions name columns and
    // carry nothing else.
    const list = (Array.isArray(catalogue) ? catalogue : [])
      .slice(0, 40)
      .map((q) => ({ id: String(q?.id || '').slice(0, 200), text: String(q?.text || '').slice(0, 200) }))
      .filter((q) => q.id);

    const prompt = questionsPrompt({ columns, sample, fileName, rowCount, grain, catalogue: list });
    const proposal = await generateJson(prompt, QUESTIONS_SYSTEM, credential);
    if (!proposal || typeof proposal !== 'object') {
      return Response.json({ unavailable: true, reason: 'generation_failed' });
    }
    return Response.json({ proposal, via: credential.source });
  } catch (error) {
    console.error('[questions]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
