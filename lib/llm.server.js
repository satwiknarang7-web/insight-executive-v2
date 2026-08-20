/**
 * Server-side JSON generation with a provider fallback chain.
 *
 * The app is designed to be fully usable with no API keys at all — every number
 * and every sentence has a deterministic source (see lib/insightEngine.js). The
 * LLM only rephrases already-verified findings, so when this module returns
 * `null` the caller quietly keeps the deterministic text.
 *
 * Order: Groq (fastest) -> Anthropic -> Gemini. Each leg is tried once; there is
 * no retry storm, because a slow narrative pass is worse than no narrative pass.
 */
import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
const ANTHROPIC_MODEL = 'claude-opus-5';

let groqClient = null;
let anthropicClient = null;
let geminiClient = null;

function groq() {
  if (!process.env.GROQ_API_KEY) return null;
  groqClient ||= new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groqClient;
}

function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  anthropicClient ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropicClient;
}

function gemini() {
  if (!process.env.GEMINI_API_KEY) return null;
  geminiClient ||= new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return geminiClient;
}

export function hasAnyProvider() {
  return !!(process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY);
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

async function viaGroq(prompt, system) {
  const client = groq();
  if (!client) return null;
  for (const model of GROQ_MODELS) {
    try {
      const completion = await client.chat.completions.create({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      });
      const parsed = extractJson(completion.choices[0]?.message?.content || '');
      if (parsed) return parsed;
    } catch (e) {
      console.warn(`[llm] groq/${model}: ${e.message}`);
    }
  }
  return null;
}

async function viaAnthropic(prompt, system) {
  const client = anthropic();
  if (!client) return null;
  try {
    // Streamed because a large storyboard can take a while; the helper collects
    // the whole message so the caller still sees a single result.
    const stream = client.messages.stream({
      model: ANTHROPIC_MODEL,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') {
      console.warn('[llm] anthropic declined the request');
      return null;
    }
    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return extractJson(text);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) console.warn('[llm] anthropic rate limited');
    else if (e instanceof Anthropic.AuthenticationError) console.warn('[llm] anthropic key rejected');
    else if (e instanceof Anthropic.APIError) console.warn(`[llm] anthropic ${e.status}: ${e.message}`);
    else console.warn(`[llm] anthropic: ${e.message}`);
    return null;
  }
}

async function viaGemini(prompt, system) {
  const client = gemini();
  if (!client) return null;
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
 * Try each configured provider in turn. Returns parsed JSON, or null when no
 * provider is configured or all of them fail.
 */
export async function generateJson(prompt, system) {
  return (
    (await viaGroq(prompt, system)) ||
    (await viaAnthropic(prompt, system)) ||
    (await viaGemini(prompt, system)) ||
    null
  );
}
