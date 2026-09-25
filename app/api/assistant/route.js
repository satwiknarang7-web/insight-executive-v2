import { generateJson, modelCredential } from '../../../lib/llm.server';
import { refusedFor } from '../../../lib/plans.server';
import { enforceLimit } from '../../../lib/routeLimits.server';
import { ACTION_GUIDE } from '../../../lib/assistant/actions';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * The assistant's model turn. The browser retrieves the passages (help pages,
 * and its own table and dashboard described in words — never rows) and sends
 * them with the conversation; the model answers from them and may propose
 * actions. What comes back is a proposal: the browser checks every action
 * against the table (lib/assistant/actions.js) and applies nothing until the
 * reader clicks Apply.
 */
const SYSTEM = `You are the assistant inside Insight Executive, a web app that turns an uploaded dataset into an analyst-grade dashboard.
Answer the user's latest message using ONLY the numbered context passages and the conversation. If the context does not say, say you don't know and suggest where in the app to look. Never invent numbers: any number you write must appear in the context.
Be brief and plain: at most 4 short sentences, or a short list.
When the user asks to change something (the dashboard, a chart, filters, KPIs, how a column is read, measures, or the data itself), propose actions. Never say a change is done — the user reviews and applies it.
For a question a chart would answer (e.g. "which region sells most?"), answer from the context if you can, and you may also propose an add_chart action.
${ACTION_GUIDE}
Reply with JSON only: {"reply":"<your answer>","actions":[...]} — "actions" may be empty.`;

const clip = (s, n) => String(s ?? '').slice(0, n);

export async function POST(request) {
  try {
    const denied = await refusedFor('model');
    if (denied) return Response.json(denied, { status: 402 });
    const credential = await modelCredential(request);
    if (!credential) return Response.json({ unavailable: true, reason: 'no_provider' });
    const refused = await enforceLimit(request, 'assistant');
    if (refused) return refused;

    const body = await request.json();
    const messages = (Array.isArray(body?.messages) ? body.messages : [])
      .slice(-10)
      .map((m) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', text: clip(m?.text, 1500) }))
      .filter((m) => m.text);
    const passages = (Array.isArray(body?.passages) ? body.passages : []).slice(0, 14).map((p, i) => `[${i + 1}] ${clip(p?.title, 120)}: ${clip(p?.text, 1500)}`);
    if (!messages.length || messages.at(-1).role !== 'user') return Response.json({ unavailable: true, reason: 'no_question' });

    const prompt = `Context:\n${passages.join('\n') || '(none)'}\n\nConversation:\n${messages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n')}`;
    const out = await generateJson(prompt, SYSTEM, credential);
    if (!out || typeof out !== 'object') return Response.json({ unavailable: true, reason: 'no_answer' });
    return Response.json({
      reply: clip(out.reply, 2000),
      actions: (Array.isArray(out.actions) ? out.actions : []).slice(0, 8).filter((a) => a && typeof a === 'object'),
      via: credential.source,
    });
  } catch (error) {
    console.error('[assistant]', error.message);
    return Response.json({ unavailable: true, reason: 'error' });
  }
}
