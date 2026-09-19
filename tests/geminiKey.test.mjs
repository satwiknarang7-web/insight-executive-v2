import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KEY_HEADER,
  KEY_PATTERN,
  CLASSIC_PATTERN,
  STUDIO_PATTERN,
  STORAGE_KEY,
  clearKey,
  keyProblem,
  maskKey,
  keySnapshot,
  modelHeaders,
  readKey,
  serverKeySnapshot,
  subscribeToKey,
  verifyKey,
  writeKey,
} from '../lib/geminiKey.js';
import { callerGeminiKey } from '../lib/llm.server.js';

/* Somebody else's API key.
 *
 * The failure modes here are not "the panel looks wrong". They are: a key that
 * gets sent somewhere it should not, a key that ends up in a log or an error
 * message, and a key that is quietly ignored so the viewer pays for nothing
 * while the operator keeps paying for everything. Each is checked below. */

const VALID = `AIza${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R'}`; // 4 + 35

/* The newer AI Studio format. The panel used to refuse these outright, with a
 * sentence explaining confidently that they were a key for something else —
 * because this file had one issuing format written into it as if it were the
 * only one. It was the only one at the time. */
const STUDIO = `AQ.${'Ab8RN6Jv'}${'x7Q2'.repeat(8)}`;

test('both shapes Google issues are accepted', () => {
  assert.equal(VALID.length, 39);
  assert.ok(CLASSIC_PATTERN.test(VALID));
  assert.equal(keyProblem(VALID), null);
  assert.ok(STUDIO_PATTERN.test(STUDIO));
  assert.equal(keyProblem(STUDIO), null, 'an AI Studio key is not a key for something else');
});

test('a shape this file has never seen is not refused on a guess', () => {
  // The decision about what a valid key is belongs to Google, and `verifyKey`
  // asks it before anything is saved. Turning an unknown format away here is
  // how the last one broke, so an unfamiliar but plausible key goes through.
  assert.equal(keyProblem(`XY.${'a1B2c3D4'.repeat(4)}`), null);
});

test('a key that is wrong is refused, and told why', () => {
  assert.match(keyProblem(''), /Paste a key/);
  assert.match(keyProblem('   '), /Paste a key/);
  // Named where it can be named: these prefixes belong to somebody else.
  assert.match(keyProblem('sk-proj-abcdefghijklmnopqrstuvwxyz012345'), /OpenAI/);
  assert.match(keyProblem(`sk-ant-${'a'.repeat(40)}`), /Anthropic/);
  assert.match(keyProblem(`gsk_${'a'.repeat(40)}`), /Groq/);
  assert.match(keyProblem('AIzaShort'), /39 characters; that one is 9/);
  assert.match(keyProblem(`${VALID}extra`), /39 characters/);
  assert.match(keyProblem('AQ.short'), /cut short/);
  // A newline pulled in by a sloppy copy is the most common real mistake.
  assert.match(keyProblem(`AIza a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q`), /space in it/);
  // Right length and prefix, wrong alphabet.
  assert.match(keyProblem(`AIza${'!'.repeat(35)}`), /characters an API key does not use|copied short/);
  // And a paste that is not a credential at all never reaches a provider.
  assert.match(keyProblem('!'.repeat(40)), /characters an API key does not use/);
});

test('no rejection message ever repeats the key back', () => {
  // Error text is the part of this that reliably reaches a screenshot or a
  // support thread, so it must not carry the secret it is complaining about.
  for (const bad of [`${VALID}extra`, `AIza${'!'.repeat(35)}`, 'AIzaShort', 'AQ.short']) {
    const message = keyProblem(bad);
    assert.ok(message, 'expected a problem');
    assert.ok(!message.includes(bad), `the message quoted the key: ${message}`);
  }
});

test('a saved key is shown with its middle removed', () => {
  const masked = maskKey(VALID);
  assert.ok(masked.startsWith('AIzaa1B2'));
  assert.ok(masked.endsWith(VALID.slice(-4)));
  assert.ok(!masked.includes(VALID.slice(8, -4)), 'the middle survived the mask');
  assert.ok(masked.length < VALID.length + 12);
  assert.equal(maskKey(''), '••••');
  assert.equal(maskKey(null), '••••');
});

/* -- storage ------------------------------------------------------------ */

function withStorage(fn) {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
  };
  try {
    return fn(store);
  } finally {
    delete globalThis.window;
  }
}

test('a key round-trips through storage and can be removed', () => {
  withStorage((store) => {
    assert.equal(readKey(), '');
    assert.equal(writeKey(VALID), true);
    assert.equal(store.get(STORAGE_KEY), VALID);
    assert.equal(readKey(), VALID);
    clearKey();
    assert.equal(readKey(), '');
  });
});

test('storage that has been tampered with is treated as empty, not sent', () => {
  // localStorage is editable by hand and shared with everything else on the
  // origin. A value that is no longer key-shaped must not be dialled out.
  withStorage((store) => {
    store.set(STORAGE_KEY, 'not-a-key');
    assert.equal(readKey(), '');
    assert.deepEqual(modelHeaders({ 'Content-Type': 'application/json' }), {
      'Content-Type': 'application/json',
    });
  });
});

test('a browser that refuses storage does not take the page down', () => {
  globalThis.window = {
    localStorage: {
      getItem() {
        throw new Error('access denied');
      },
      setItem() {
        throw new Error('access denied');
      },
      removeItem() {
        throw new Error('access denied');
      },
    },
  };
  try {
    assert.equal(readKey(), '');
    assert.equal(writeKey(VALID), false);
    assert.doesNotThrow(() => clearKey());
  } finally {
    delete globalThis.window;
  }
});

test('there is no key on the server, and asking for one changes no headers', () => {
  // Rendered on the server there is no `window` at all; the accessors must
  // answer rather than throw, and must not invent a header.
  assert.equal(readKey(), '');
  assert.equal(writeKey(VALID), false);
  assert.deepEqual(modelHeaders({ a: '1' }), { a: '1' });
});

test('the header is only added when there is a key to add', () => {
  withStorage(() => {
    assert.deepEqual(modelHeaders({ a: '1' }), { a: '1' });
    writeKey(VALID);
    assert.deepEqual(modelHeaders({ a: '1' }), {
      a: '1',
      [KEY_HEADER]: VALID,
      'X-Model-Provider': 'google',
    });
    // The base object is copied, not mutated.
    const base = { a: '1' };
    modelHeaders(base);
    assert.deepEqual(base, { a: '1' });
  });
});

/* -- the server's side of the same header ------------------------------- */

const asRequest = (headers) => ({ headers: { get: (name) => headers[name] ?? null } });

test('the route reads a plausible key and ignores anything else', () => {
  assert.equal(callerGeminiKey(asRequest({ [KEY_HEADER]: VALID })), VALID);
  assert.equal(callerGeminiKey(asRequest({ [KEY_HEADER]: STUDIO })), STUDIO);
  assert.equal(callerGeminiKey(asRequest({ [KEY_HEADER]: `  ${VALID}  ` })), VALID);
  // Junk in the header is no key, not a key to try. What counts as junk is
  // deliberately narrow now: something that could not be a credential at all.
  // The server does not know every length Google issues — it guessed once, and
  // the guess is what refused a real key — so a key-shaped string it does not
  // recognise is passed on to be rejected by the only thing that knows.
  const newline = String.fromCharCode(10);
  for (const junk of ['', 'null', 'undefined', 'AIzaShort', 'Bearer ' + VALID, VALID + newline + 'X-Injected: yes', '!'.repeat(40), 'x'.repeat(500)]) {
    assert.equal(callerGeminiKey(asRequest({ [KEY_HEADER]: junk })), '');
  }
  assert.equal(callerGeminiKey(asRequest({})), '');
  assert.equal(callerGeminiKey(undefined), '');
  assert.equal(callerGeminiKey({}), '');
});

/* -- verification ------------------------------------------------------- */

test('the key is checked against Google in the header, never the query string', async () => {
  // A URL is the one place a secret is certain to be recorded — proxies and
  // access logs keep them by default. Google accepts `?key=`; this must not
  // use it.
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ models: [{ name: 'gemini-2.5-flash' }] }) };
  };

  const result = await verifyKey(VALID, { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.models, 1);
  assert.ok(!seen.url.includes(VALID), 'the key was put in the URL');
  assert.ok(!seen.url.includes('key='), 'the key parameter was used');
  assert.equal(seen.init.headers['x-goog-api-key'], VALID);
  // Straight to Google, so a key that turns out to be wrong was never sent to
  // this app's own server.
  assert.ok(seen.url.startsWith('https://generativelanguage.googleapis.com/'));
});

test('a key Google rejects is reported as rejected, not as a network problem', async () => {
  for (const status of [400, 401, 403]) {
    const result = await verifyKey(VALID, { fetchImpl: async () => ({ ok: false, status }) });
    assert.equal(result.ok, false);
    assert.match(result.problem, /Google rejected that key/);
  }
});

test('a wrong-shaped key is refused without a request being made at all', async () => {
  let called = false;
  const result = await verifyKey('AIzaShort', {
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(called, false, 'a malformed key was sent to Google anyway');
});

test('an unreachable Google is not reported as a bad key', async () => {
  // Telling somebody their key is wrong when the network is down sends them
  // to regenerate a key that was fine.
  const result = await verifyKey(VALID, {
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.problem, /Could not reach Google/);
});

test('a 200 with an unreadable body still counts as a working key', async () => {
  const result = await verifyKey(VALID, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.models, 0);
});

/* -- whose account pays -------------------------------------------------- */

test('a viewer key is used on its own — the deployment is never billed instead', async () => {
  // The whole point of supplying a key is that the call goes on your account.
  // Falling back to the deployment's providers when it fails would spend the
  // operator's money on a request that was explicitly moved off it, and would
  // hide a broken key behind a result that looked fine.
  const { generateJson } = await import('../lib/llm.server.js');

  const before = {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };
  // Every deployment provider configured, so a fallback would certainly be
  // reachable if one existed.
  process.env.GROQ_API_KEY = 'gsk_deployment';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-deployment';
  process.env.GEMINI_API_KEY = 'AIzaDEPLOYMENTdeploymentDEPLOYMENTdep';

  try {
    // A syntactically valid key that Google will reject. If any deployment
    // provider were tried after it, this would take far longer and would fail
    // with one of their errors rather than simply returning null.
    const result = await generateJson('hello', 'be brief', { geminiKey: VALID });
    assert.equal(result, null, 'a failed viewer key produced a result from somewhere else');
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('canGenerate says yes for a viewer key and no for anything else', async () => {
  const { canGenerate } = await import('../lib/llm.server.js');
  const before = {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };
  for (const name of Object.keys(before)) delete process.env[name];

  try {
    // The deployment holds no keys at all: every viewer brings their own, and
    // anyone who does not gets the deterministic text, which is complete on its
    // own. Deployment variables being set must change nothing.
    assert.equal(canGenerate(asRequest({})), false);
    process.env.GROQ_API_KEY = 'gsk_deployment_key';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-deployment-key';
    process.env.GEMINI_API_KEY = 'AIzaDeploymentKey';
    assert.equal(canGenerate(asRequest({})), false, 'a deployment key opened the route');
    for (const name of Object.keys(before)) delete process.env[name];
    assert.equal(canGenerate(asRequest({ [KEY_HEADER]: VALID })), true);
    // Junk in the header must not open the route.
    assert.equal(canGenerate(asRequest({ [KEY_HEADER]: 'not-a-key' })), false);
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value !== undefined) process.env[name] = value;
    }
  }
});

/* -- the store the panel subscribes to ----------------------------------- */

test('the snapshot is stable between changes, and changes when the key does', () => {
  withStorage(() => {
    const events = [];
    const listeners = [];
    globalThis.window.addEventListener = (name, fn) => listeners.push([name, fn]);
    globalThis.window.removeEventListener = () => {};

    const unsubscribe = subscribeToKey(() => events.push('changed'));

    // Identity-stable, or useSyncExternalStore re-renders forever.
    assert.equal(keySnapshot(), '');
    assert.equal(keySnapshot(), keySnapshot());

    writeKey(VALID);
    assert.equal(events.length, 1);
    assert.equal(keySnapshot(), VALID);
    assert.equal(keySnapshot(), keySnapshot());

    clearKey();
    assert.equal(events.length, 2);
    assert.equal(keySnapshot(), '');

    unsubscribe();
    writeKey(VALID);
    assert.equal(events.length, 2, 'a listener kept firing after unsubscribe');
    clearKey();
  });
});

test('the server renders no key, whatever is in storage', () => {
  // This is the value React hydrates against; if it ever returned a real key
  // the markup would differ between server and client for the same render.
  assert.equal(serverKeySnapshot(), '');
  withStorage(() => {
    writeKey(VALID);
    assert.equal(serverKeySnapshot(), '');
  });
});

test('removal empties the panel even when storage throws on the way out', () => {
  // A key that cannot be reached cannot be sent either, so the UI must not be
  // left claiming it is connected.
  const listeners = [];
  globalThis.window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem() {
        throw new Error('access denied');
      },
    },
    addEventListener: (name, fn) => listeners.push([name, fn]),
    removeEventListener: () => {},
  };
  try {
    let notified = 0;
    const unsubscribe = subscribeToKey(() => (notified += 1));
    assert.doesNotThrow(() => clearKey());
    assert.equal(notified, 1, 'the panel was never told');
    assert.equal(keySnapshot(), '');
    unsubscribe();
  } finally {
    delete globalThis.window;
  }
});
