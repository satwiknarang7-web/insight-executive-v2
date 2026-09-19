/**
 * Which model providers a viewer may bring a key for.
 *
 * This app has always run on the viewer's own key rather than the deployment's
 * — one person should not pay for everybody's analysis — and for a long time
 * that key had to be Google's. Which was a strange thing to require of a
 * product whose users are, by and large, already paying somebody: a person with
 * a Claude subscription, an OpenAI account and a Grok seat could not use a
 * single model feature here without opening an account with a fourth company.
 *
 * So the provider is part of the credential now, not an assumption baked into
 * the one module that calls out.
 *
 * **Pure and shared.** The settings panel needs to know what a key looks like
 * and where to get one; the server needs to know which endpoint to call and
 * with which header. Both read this. Nothing here performs a request — the
 * server half lives in `llm.server.js`, which is the only file that holds a
 * key long enough to use it.
 *
 * **Detection is a convenience, never a gate.** Prefixes are a fact about
 * today's keys, not a specification: Google's own key format changed under
 * this codebase once already and the panel refused real keys with a confident
 * sentence. So a key whose shape nobody here recognises is passed through to
 * the provider the viewer chose, and that provider decides.
 */

/**
 * What the model is asked to do here is small — read a schema, return JSON —
 * so the cheapest capable model from each provider leads, with one fallback.
 * A list rather than a single id because a model name is the part of this file
 * most likely to be retired without warning.
 */
/** The classic Google key: `AIza` and 35 more characters of URL-safe base64. */
export const CLASSIC_PATTERN = /^AIza[0-9A-Za-z_-]{35}$/;

/** The newer AI Studio key, which is longer and carries an `AQ.` prefix. */
export const STUDIO_PATTERN = /^AQ\.[0-9A-Za-z_-]{20,}$/;

/**
 * Prefixes belonging to services this app does not call.
 *
 * Worth naming even though none of them can be selected: somebody who pastes a
 * Groq key into any of these fields has made a mistake that the provider's own
 * authentication error would describe uselessly.
 */
const FOREIGN_PREFIXES = [
  ['gsk_', 'Groq'],
  ['AKIA', 'AWS'],
  ['ghp_', 'GitHub'],
  ['hf_', 'Hugging Face'],
];

export const PROVIDERS = {
  google: {
    id: 'google',
    label: 'Google Gemini',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
    keysUrl: 'https://aistudio.google.com/apikey',
    keysLabel: 'Google AI Studio',
    // `AIza…` is the classic key; `AQ.` the newer AI Studio one.
    hints: [CLASSIC_PATTERN, STUDIO_PATTERN],
    prefixes: ['AIza', 'AQ.'],
    // Where a shape has a fixed length, saying so turns "that is wrong" into
    // something the reader can act on: it was copied short.
    fixedLengths: [{ prefix: 'AIza', length: 39 }],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    models: ['claude-haiku-4-5-20251001', 'claude-sonnet-5'],
    keysUrl: 'https://console.anthropic.com/settings/keys',
    keysLabel: 'the Anthropic Console',
    hints: [/^sk-ant-[0-9A-Za-z_-]{20,}$/],
    prefixes: ['sk-ant-'],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    models: ['gpt-5.6-luna', 'gpt-5.4-mini'],
    keysUrl: 'https://platform.openai.com/api-keys',
    keysLabel: 'the OpenAI platform',
    hints: [/^sk-[0-9A-Za-z_-]{20,}$/],
    // `sk-ant-` is checked first, so a bare `sk-` cannot swallow an Anthropic key.
    prefixes: ['sk-proj-', 'sk-'],
  },
  xai: {
    id: 'xai',
    label: 'xAI Grok',
    models: ['grok-4.6'],
    keysUrl: 'https://console.x.ai',
    keysLabel: 'the xAI console',
    hints: [/^xai-[0-9A-Za-z_-]{20,}$/],
    prefixes: ['xai-'],
  },
};

/** In the order they are offered. Google first: it is what existed before. */
export const PROVIDER_IDS = ['google', 'anthropic', 'openai', 'xai'];

export const DEFAULT_PROVIDER = 'google';

/** A known provider id, or the default. Never throws on a hand-edited value. */
export function providerFor(id) {
  const key = String(id ?? '').trim().toLowerCase();
  return PROVIDERS[key] ? key : DEFAULT_PROVIDER;
}

/**
 * Which provider a key appears to belong to, or null.
 *
 * Used to label a key somebody pasted, and to migrate the keys stored before
 * this file existed — those are Google's by definition, and detection says so
 * without needing a migration that runs on every load.
 *
 * Longest prefix first so `sk-ant-` is never read as `sk-`.
 */
export function detectProvider(key) {
  const value = String(key ?? '').trim();
  if (!value) return null;
  const matches = [];
  for (const id of PROVIDER_IDS) {
    for (const prefix of PROVIDERS[id].prefixes) {
      if (value.startsWith(prefix)) matches.push({ id, length: prefix.length });
    }
  }
  if (!matches.length) return null;
  matches.sort((a, b) => b.length - a.length);
  return matches[0].id;
}

/**
 * What is accepted as a credential at all.
 *
 * Deliberately loose on shape and strict on content: it is what keeps a header
 * full of junk — control characters, a whole pasted paragraph — from being
 * dialled out to anybody, and that is the only job it has.
 */
export const KEY_PATTERN = /^[0-9A-Za-z._-]{20,200}$/;

/**
 * What is wrong with this key for this provider, or null.
 *
 * Only says what it can support. A key of a shape this file does not recognise
 * draws no complaint — it goes to the provider, which is the only thing that
 * actually knows. The one mistake worth naming loudly is the common one: a key
 * from a different provider than the one selected, because the error the
 * provider returns for that is authentication-shaped and tells you nothing.
 */
/** "a Google Gemini key" but "an Anthropic key" — the labels are shown to people. */
const article = (word) => (/^[aeiou]/i.test(String(word)) ? 'an' : 'a');

export function keyProblem(key, providerId = DEFAULT_PROVIDER) {
  const value = String(key ?? '').trim();
  const provider = PROVIDERS[providerFor(providerId)];
  if (!value) return 'Paste a key first.';
  if (/\s/.test(value)) return 'That has a space in it — check for a stray newline or a partial copy.';

  for (const [prefix, service] of FOREIGN_PREFIXES) {
    if (value.startsWith(prefix)) {
      return `That looks like ${article(service)} ${service} key, and this app does not call ${service}.`;
    }
  }

  const detected = detectProvider(value);
  if (detected && detected !== provider.id) {
    const theirs = PROVIDERS[detected].label;
    return `That looks like ${article(theirs)} ${theirs} key. Pick ${theirs} above, or paste ${article(provider.label)} ${provider.label} key.`;
  }

  // Shapes this provider is known to issue, and the mistake they fail on:
  // a copy that stopped short.
  if (detected === provider.id && provider.hints.length) {
    const fits = provider.hints.some((hint) => hint.test(value));
    if (!fits) {
      // Right prefix and a shape with a known length: say which of the two
      // things is wrong, because they have different fixes. A key of the right
      // length that still does not match is not a short copy — it has
      // characters the format does not use.
      for (const { prefix, length } of provider.fixedLengths || []) {
        if (!value.startsWith(prefix)) continue;
        return value.length === length
          ? 'That has characters an API key does not use.'
          : `A key starting "${prefix}" is ${length} characters; that one is ${value.length}. It was probably copied short.`;
      }
      return `That looks like ${article(provider.label)} ${provider.label} key that was cut short. Copy the whole thing.`;
    }
  }

  if (!KEY_PATTERN.test(value)) return 'That has characters an API key does not use.';
  return null;
}

/**
 * The key with its middle removed, for showing one that is already saved.
 *
 * Enough to tell two keys apart, not enough to be worth a screenshot: the
 * leading characters are a format marker shared by every key of that kind and
 * carry nothing.
 */
export function maskKey(key) {
  const value = String(key ?? '');
  if (value.length < 12) return '••••';
  return `${value.slice(0, 8)}${'•'.repeat(10)}${value.slice(-4)}`;
}
