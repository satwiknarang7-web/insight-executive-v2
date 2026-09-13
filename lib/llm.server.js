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
import { KEY_HEADER, KEY_PATTERN } from './geminiKey.js';

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];

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

async function viaGemini(prompt, system, apiKey) {
  // A client per call rather than a memoised one: caching per viewer would mean
  // holding other people's credentials in process memory for as long as the
  // server lives.
  if (!apiKey) return null;
  const client = new GoogleGenerativeAI(apiKey);
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = client.getGenerativeModel({ model: modelName, systemInstruction: system });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      });
      const parsed = extractJson(result.response.text());
      if (parsed) return parsed;
    } catch (e) {
      console.warn(`[llm] gemini/${modelName}: ${e.message}`);
    }
  }
  return null;
}

/**
 * Generate on the caller's key. Returns parsed JSON, or null when there is no
 * key or the model could not produce usable JSON.
 */
export async function generateJson(prompt, system, { geminiKey = '' } = {}) {
  if (!geminiKey) return null;
  return (await viaGemini(prompt, system, geminiKey)) || null;
}
