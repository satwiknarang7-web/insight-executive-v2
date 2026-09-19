/**
 * The viewer's own Gemini key: where it is kept, and what counts as one.
 *
 * The deployment can carry provider keys of its own, and when it does every
 * model call is billed to whoever runs it. That does not scale past a demo —
 * one person pays for everybody's analysis — so a viewer can supply their own
 * key instead, and from then on their narration runs on their account.
 *
 * **Where it lives.** `localStorage`, on that one browser, and nowhere else. It
 * is never written to the vault, never attached to a saved analysis, never put
 * in a cookie — a cookie would be sent on every request to the site whether the
 * request needed a model or not — and never sent to any host but Google and
 * this app's own model routes.
 *
 * **How it reaches a model.** In the `X-Gemini-Key` header of the three routes
 * that call one, which use it in place of the deployment's key and neither log
 * nor store it. Building the prompts in the browser instead would keep the key
 * off the server altogether; the prompts are assembled server-side from the
 * schema and the verified findings, so that is a much larger change than this,
 * and it is the honest caveat on this one: the key passes through the server it
 * is sent to.
 *
 * A header rather than the body, because a body is the thing a logger is most
 * likely to record whole; and never the query string, which proxies and access
 * logs keep by default.
 */
import {
  DEFAULT_PROVIDER,
  PROVIDERS,
  detectProvider,
  keyProblem as storedKeyProblem,
  providerFor,
} from './llmProviders.js';

/**
 * Where the key is kept in `localStorage`.
 *
 * The name still says Gemini because the value in it still is one for everybody
 * who set it before this app took other providers. Renaming the slot would log
 * those people out of a feature they had already configured, to no benefit;
 * which provider it belongs to is stored beside it, and inferred from the key
 * itself when it is missing.
 */
export const STORAGE_KEY = 'insight.gemini.key';

/** And which provider that key belongs to. */
export const PROVIDER_STORAGE_KEY = 'insight.model.provider';

/** The headers the model routes read them from. */
export const KEY_HEADER = 'X-Gemini-Key';
export const PROVIDER_HEADER = 'X-Model-Provider';

/** Where a viewer gets one, for the provider they picked. */
export const STUDIO_URL = PROVIDERS.google.keysUrl;

/**
 * What a key may look like, and what it may not.
 *
 * All of this moved to `llmProviders.js` when the provider stopped being an
 * assumption: what counts as a key is a fact about a provider, and keeping one
 * file's worth of Google-shaped regexes here would have meant a second, stale
 * copy the moment anybody added OpenAI. Re-exported so the panel keeps one
 * import.
 */
export { CLASSIC_PATTERN, KEY_PATTERN, STUDIO_PATTERN, keyProblem, maskKey } from './llmProviders.js';

/* -------------------------------------------------------------------------
 * Browser storage.
 *
 * Every accessor is wrapped: `localStorage` throws outright in some privacy
 * modes rather than returning empty, and a settings panel is not worth taking
 * the page down for. Absent and unreadable are the same answer here — no key.
 * ---------------------------------------------------------------------- */

export function readKey() {
  if (typeof window === 'undefined') return '';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) || '';
    // A value that no longer looks like a key is treated as absent rather than
    // sent: the storage is editable by hand and shared with everything else on
    // the origin. Checked against the provider it is stored for, because what
    // counts as a key depends on whose it is.
    return storedKeyProblem(stored, readProvider()) ? '' : stored;
  } catch {
    return '';
  }
}

/**
 * Which provider the stored key belongs to.
 *
 * Stored explicitly once somebody chooses one. Before that — every key saved
 * under the Google-only scheme — it is read off the key's own prefix, so an
 * existing `AIza…` keeps working on the first load after this ships with no
 * migration step and no interruption.
 */
export function readProvider() {
  if (typeof window === 'undefined') return DEFAULT_PROVIDER;
  try {
    const stored = window.localStorage.getItem(PROVIDER_STORAGE_KEY);
    if (stored) return providerFor(stored);
    const key = window.localStorage.getItem(STORAGE_KEY) || '';
    return detectProvider(key) || DEFAULT_PROVIDER;
  } catch {
    return DEFAULT_PROVIDER;
  }
}

export function writeKey(key, provider = null) {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(key).trim());
    if (provider) window.localStorage.setItem(PROVIDER_STORAGE_KEY, providerFor(provider));
    notify();
    return true;
  } catch {
    return false;
  }
}

export function clearKey() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(PROVIDER_STORAGE_KEY);
  } catch {
    /* nothing to clear if it cannot be reached */
  }
  // Outside the try: the panel must return to its empty state even if the
  // removal threw, because a key that cannot be reached cannot be sent either.
  notify();
}

/* -------------------------------------------------------------------------
 * Subscribing to the stored key.
 *
 * `localStorage` is external state, so React reads it through
 * `useSyncExternalStore` rather than through an effect that sets state on
 * mount. That is not a style preference: the effect version renders "no key"
 * first and corrects itself after hydration, which is a visible flash of the
 * wrong answer on every load for anyone who has one.
 *
 * Subscribing also makes the `storage` event useful, and that event only fires
 * in the *other* tabs — so removing a key in one tab updates the panel in the
 * rest, while the tab that made the change is covered by `notify` below.
 * ---------------------------------------------------------------------- */

const listeners = new Set();

/** Cached so repeated snapshots return the same string identity. */
let snapshot = null;

function notify() {
  snapshot = null;
  for (const listener of listeners) listener();
}

export function subscribeToKey(listener) {
  listeners.add(listener);
  if (typeof window !== 'undefined') window.addEventListener('storage', notify);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined' && listeners.size === 0) {
      window.removeEventListener('storage', notify);
    }
  };
}

/**
 * The current key, as a stable reference.
 *
 * `useSyncExternalStore` calls this during render and compares by identity, so
 * returning a fresh read every time would loop. The cache is dropped by
 * `notify` whenever the value can have changed.
 */
export function keySnapshot() {
  if (snapshot === null) snapshot = readKey();
  return snapshot;
}

/**
 * What the server renders: never a key.
 *
 * There is no storage on the server, and this is the value React hydrates
 * against — which is why the panel's first client render is allowed to differ
 * from it without a mismatch.
 */
export function serverKeySnapshot() {
  return '';
}

/**
 * Request headers for a model route, carrying the viewer's key when there is
 * one. With no key the header is simply absent and the route falls back to
 * whatever the deployment is configured with — which may be nothing, and that
 * is a supported state: the app's numbers never came from a model.
 */
export function modelHeaders(base = {}) {
  const key = readKey();
  if (!key) return { ...base };
  return { ...base, [KEY_HEADER]: key, [PROVIDER_HEADER]: readProvider() };
}

/**
 * Ask Google whether the key works, from the browser, before saving it.
 *
 * The check goes straight to Google and never touches this app's server, so a
 * key that turns out to be wrong is rejected without having been sent anywhere
 * it did not need to go. `models.list` is the cheapest call that requires
 * authentication and bills nothing.
 *
 * The key travels in `x-goog-api-key` rather than the `?key=` parameter Google
 * also accepts, to keep it out of anything that records URLs.
 */
export async function verifyKey(key, { provider = DEFAULT_PROVIDER, fetchImpl = fetch, signal } = {}) {
  const which = providerFor(provider);
  const problem = storedKeyProblem(key, which);
  if (problem) return { ok: false, problem };

  /*
   * Only Google can be asked from here.
   *
   * The check below goes straight to the provider and never touches this app's
   * server, which is the point of doing it in the browser: a key that turns out
   * to be wrong is rejected without having been sent anywhere it did not need
   * to go. Anthropic, OpenAI and xAI do not serve their APIs to a browser
   * origin, so the same request fails on CORS whatever the key is — and a check
   * that cannot tell a bad key from a blocked request is worse than no check,
   * because it would reject every key including the good ones.
   *
   * Routing it through this app's server instead would work, and would give up
   * the one property this function exists to hold. So the key is saved
   * unchecked and the panel says so: the first real model call is what reports
   * whether it works, and this module has always been built to return `null`
   * and let the caller keep its deterministic text.
   */
  if (which !== 'google') {
    return { ok: true, unchecked: true, provider: which };
  }

  let response;
  try {
    response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': String(key).trim() },
      signal,
    });
  } catch {
    return { ok: false, problem: 'Could not reach Google to check the key. Check the connection and try again.' };
  }

  if (response.status === 400 || response.status === 401 || response.status === 403) {
    return { ok: false, problem: 'Google rejected that key. Check it was copied whole, and that the Generative Language API is enabled for the project.' };
  }
  if (!response.ok) {
    return { ok: false, problem: `Google answered ${response.status} when checking the key. Try again in a moment.` };
  }

  let models = [];
  try {
    const body = await response.json();
    models = Array.isArray(body?.models) ? body.models : [];
  } catch {
    /* A 200 is the answer that matters; the list is a nicety. */
  }
  return { ok: true, models: models.length };
}
