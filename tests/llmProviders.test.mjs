import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROVIDER,
  PROVIDERS,
  PROVIDER_IDS,
  detectProvider,
  keyProblem,
  maskKey,
  providerFor,
} from '../lib/llmProviders.js';

/* A viewer brings their own key, and it no longer has to be Google's.

   The rule this file holds to is the one the Google-only version learned the
   hard way: prefixes are a fact about today's keys, not a specification. So
   detection may label a key and may warn about an obvious mismatch, and it may
   never refuse one for having a shape nobody here has seen. */

const KEYS = {
  google: 'AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz0123456',
  anthropic: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345',
  openai: 'sk-proj-abcdefghijklmnopqrstuvwxyz012345',
  xai: 'xai-abcdefghijklmnopqrstuvwxyz012345',
};

test('every offered provider is fully described', () => {
  for (const id of PROVIDER_IDS) {
    const provider = PROVIDERS[id];
    assert.ok(provider, `${id} is offered and not defined`);
    assert.ok(provider.models.length > 0, `${id} has no model to call`);
    assert.ok(provider.keysUrl.startsWith('https://'), `${id} sends people nowhere to get a key`);
    assert.ok(provider.label, `${id} has no name to show`);
  }
  assert.ok(PROVIDER_IDS.includes(DEFAULT_PROVIDER));
});

test('a key is recognised by its prefix, longest first', () => {
  for (const [id, key] of Object.entries(KEYS)) {
    assert.equal(detectProvider(key), id, `${id} key was read as something else`);
  }
  // The one that actually collides: every Anthropic key also starts `sk-`.
  assert.equal(detectProvider('sk-ant-anything-at-all-here-padding'), 'anthropic');
});

test('a shape nobody here has seen is passed through, not refused', () => {
  // Google's key format changed under this codebase once already and the panel
  // rejected real keys with a confident sentence. The provider decides.
  assert.equal(detectProvider('zz-some-new-format-nobody-has-seen'), null);
  assert.equal(keyProblem('zzsomenewformatnobodyhasseen12345', 'openai'), null);
});

test('a key for the wrong provider is named, because that error is unreadable otherwise', () => {
  const problem = keyProblem(KEYS.anthropic, 'openai');
  assert.match(problem, /Anthropic/);
  // And it says what to do about it, rather than only what is wrong.
  assert.match(problem, /Pick|paste/i);

  // The right key for the right provider is fine.
  for (const [id, key] of Object.entries(KEYS)) {
    assert.equal(keyProblem(key, id), null, `${id} refused its own key`);
  }
});

test('the ordinary mistakes are named without echoing the key', () => {
  assert.match(keyProblem('', 'google'), /Paste a key/);
  assert.match(keyProblem('AIza with a space', 'google'), /space/);
  // A copy that stopped short.
  assert.match(keyProblem('sk-ant-short', 'anthropic'), /cut short/);

  // An error message is the part of this that reliably ends up in a screenshot.
  for (const [id, key] of Object.entries(KEYS)) {
    const problem = keyProblem(key.slice(0, 12), id) || '';
    assert.ok(!problem.includes(key.slice(0, 12)), `${id} echoed the key back`);
  }
});

test('an unknown provider id falls back rather than throwing', () => {
  assert.equal(providerFor('nonsense'), DEFAULT_PROVIDER);
  assert.equal(providerFor(''), DEFAULT_PROVIDER);
  assert.equal(providerFor(null), DEFAULT_PROVIDER);
  assert.equal(providerFor('ANTHROPIC'), 'anthropic', 'case should not decide this');
});

test('a masked key identifies without exposing', () => {
  const masked = maskKey(KEYS.google);
  assert.ok(masked.includes('•'));
  assert.ok(!masked.includes(KEYS.google.slice(8, -4)), 'the middle survived');
  assert.equal(maskKey('short'), '••••');
  assert.equal(maskKey(null), '••••');
});
