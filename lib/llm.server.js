/**
 * Server-side JSON generation, on the caller's own Gemini key and nothing else.
 *
 * The app is designed to be fully usable with no API key at all — every number
 * and every sentence has a deterministic source (see lib/insightEngine.js). The
 * model only rephrases already-verified findings, so when this module returns
 * `null` the caller quietly keeps the deterministic text. Nothing breaks; the
 * prose is plainer.
 *
 * **There is no deployment key.** A viewer who wants model-written prose brings
 * their own Gemini key and it is billed to their account. This deployment does
 * not hold credentials for Groq, Anthropic or Google, and will not spend anyone
 * else's money on a viewer's request — which also means a key that does not
 * work is reported as not working rather than hidden behind a fallback that
 * looked fine, leaving them to discover months later that nothing they typed
 * was ever used.
 *
 * The key is read from a header, used, and dropped. It is never logged, never
 * written anywhere, and never included in an error: the provider warnings below
 * print a message and a model name, and are the reason `viaGemini` takes the
 * key as an argument rather than reading it from anything ambient.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { KEY_HEADER, PROVIDER_HEADER } from './geminiKey.js';
import { KEY_PATTERN, PROVIDERS, detectProvider, providerFor } from './llmProviders.js';

/**
 * The viewer's own Gemini key, taken off the request.
 *
 * Checked before use so that a header full of junk is treated as no key rather
 * than dialled out to Google. The check is on content, not on format: nothing
 * here knows every shape Google issues, and the last version of this file that
 * thought it did refused a real key. So a key-shaped string it does not
 * recognise is passed on, and Google decides.
 *
 * Returns '' for anything that could not be a credential at all, and never
 * returns what it rejected — the value must not reach a log line, and the
 * surest way to guarantee that is for it never to be in one.
 */
export function callerGeminiKey(request) {
  const header = request?.headers?.get?.(KEY_HEADER) || '';
  const value = String(header).trim();
  return KEY_PATTERN.test(value) ? value : '';
}

/**
 * The viewer's credential: which provider, and the key.
 *
 * The provider travels in its own header. When it is absent — a client built
 * before this existed, or a hand-made request — it is inferred from the key's
 * own prefix, which is what every key stored under the old Google-only scheme
 * will do. So nobody has to migrate anything: a saved `AIza…` still resolves to
 * Google on the first request after this ships.
 */
export function callerModelKey(request) {
  const key = callerGeminiKey(request);
  if (!key) return { provider: null, key: '' };
  const stated = request?.headers?.get?.(PROVIDER_HEADER) || '';
  const provider = stated ? providerFor(stated) : detectProvider(key) || providerFor(stated);
  return { provider, key };
}

/**
 * Can this request reach a model at all?
 *
 * Only if the viewer brought a key. Without one the route declines and the
 * caller keeps the deterministic text, which is complete on its own.
 */
export function canGenerate(request) {
  return !!callerGeminiKey(request);
}

/** Pull the first JSON object/array out of a model response. */
export function extractJson(text) {
  if (!text) return null;
  const startObj = text.indexOf('{');
  const startArr = text.indexOf('[');
  let start = -1;
  if (startObj !== -1 && (startArr === -1 || startObj < startArr)) start = startObj;
  else if (startArr !== -1) start = startArr;

  const endObj = text.lastIndexOf('}');
  const endArr = text.lastIndexOf(']');
  let end = -1;
  if (endObj !== -1 && (endArr === -1 || endObj > endArr)) end = endObj;
  else if (endArr !== -1) end = endArr;

  const candidate =
    start !== -1 && end !== -1 && end > start
      ? text.slice(start, end + 1)
      : text.replace(/```json/gi, '').replace(/```/g, '').trim();

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/** How long any one provider gets before the caller keeps its plainer text. */
const TIMEOUT_MS = 45000;

/**
 * One prompt, one model, one parsed object — or null.
 *
 * Google keeps its SDK because it is already a dependency and already proven
 * in production here. Everybody else is plain `fetch`: OpenAI and xAI share the
 * chat-completions shape, Anthropic has its own, and all three are a POST with
 * a key in a header. Nothing is worth a second SDK for that.
 *
 * Each returns text; `extractJson` is what turns it into an object, and it
 * already copes with a model that wrapped its JSON in prose or a fence.
 */
async function callModel(providerId, modelName, prompt, system, apiKey, signal) {
  if (providerId === 'google') {
    // A client per call rather than a memoised one: caching per viewer would
    // mean holding other people's credentials in process memory for as long as
    // the server lives.
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({ model: modelName, systemInstruction: system });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    });
    return extractJson(result.response.text());
  }

  if (providerId === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 4096,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const text = (body?.content || []).map((part) => part?.text || '').join('');
    return extractJson(text);
  }

  // OpenAI and xAI: the same chat-completions request against different hosts.
  const base = providerId === 'xai' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1';
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelName,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return extractJson(body?.choices?.[0]?.message?.content || '');
}

/**
 * Generate on the caller's key. Returns parsed JSON, or null when there is no
 * key or the model could not produce usable JSON.
 *
 * `geminiKey` is still accepted, and still means Google, so nothing that was
 * calling this before has to change to keep working.
 *
 * A failure is warned about and moved past: the models of one provider are
 * tried in order, and when none of them answers usably the caller keeps its
 * deterministic text. That is the whole contract of this module — it is an
 * improvement on the output, never a dependency of it.
 */
export async function generateJson(prompt, system, { key = '', provider = '', geminiKey = '' } = {}) {
  const apiKey = String(key || geminiKey || '').trim();
  if (!apiKey) return null;
  const providerId = providerFor(provider || (geminiKey ? 'google' : detectProvider(apiKey)));
  const models = PROVIDERS[providerId]?.models || [];

  for (const modelName of models) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const parsed = await callModel(providerId, modelName, prompt, system, apiKey, abort.signal);
      if (parsed) return parsed;
    } catch (e) {
      // The message and the model name, never the key: this is the line most
      // likely to end up in somebody else's log aggregator.
      console.warn(`[llm] ${providerId}/${modelName}: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
