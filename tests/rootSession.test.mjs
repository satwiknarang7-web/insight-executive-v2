import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOT_SESSION_MS, issueSession, sameSecret, verifySession } from '../lib/auth/rootSession.js';

const KEY = Buffer.from('a-test-signing-key-of-some-length');
const OTHER = Buffer.from('a-different-signing-key-entirely!');

test('a session we issued is accepted', () => {
  assert.equal(verifySession(KEY, issueSession(KEY)), true);
});

test('a session signed with another key is not', () => {
  // What a forged cookie looks like: right shape, wrong signature.
  assert.equal(verifySession(KEY, issueSession(OTHER)), false);
});

test('rotating the key ends every outstanding session', () => {
  // The key is derived from ROOT_PASSWORD, so this is what changing the
  // password does — which is the point of a break-glass credential.
  const token = issueSession(KEY);
  assert.equal(verifySession(KEY, token), true);
  assert.equal(verifySession(OTHER, token), false);
});

test('a session expires', () => {
  const now = Date.now();
  const token = issueSession(KEY, { now });
  assert.equal(verifySession(KEY, token, { now: now + ROOT_SESSION_MS - 1000 }), true);
  assert.equal(verifySession(KEY, token, { now: now + ROOT_SESSION_MS + 1000 }), false);
});

test('an expiry cannot be extended without the key', () => {
  const now = Date.now();
  const token = issueSession(KEY, { now });
  const [, nonce, signature] = token.split('.');
  const forged = `${now + 10 * ROOT_SESSION_MS}.${nonce}.${signature}`;
  assert.equal(verifySession(KEY, forged, { now }), false, 'the signature covers the expiry');
});

test('malformed tokens are refused rather than throwing', () => {
  for (const token of ['', null, undefined, 'nonsense', 'a.b', 'a.b.c', 'a.b.c.d', '...']) {
    assert.equal(verifySession(KEY, token), false, String(token));
  }
});

test('a signature of a different length is refused, not an exception', () => {
  // timingSafeEqual throws on a length mismatch; that has to be caught, or a
  // one-character signature crashes the route instead of being rejected.
  const [expires, nonce] = issueSession(KEY).split('.');
  assert.equal(verifySession(KEY, `${expires}.${nonce}.x`), false);
});

test('secret comparison matches only on equality', () => {
  assert.equal(sameSecret(KEY, 'hunter2hunter2', 'hunter2hunter2'), true);
  assert.equal(sameSecret(KEY, 'hunter2hunter2', 'hunter2hunter3'), false);
  assert.equal(sameSecret(KEY, '', ''), true);
});

test('comparing secrets of different lengths does not throw', () => {
  // The reason both sides are hashed first: a raw timingSafeEqual on the two
  // inputs would throw, and the throw would leak the real secret's length.
  assert.equal(sameSecret(KEY, 'short', 'a-much-longer-secret-value'), false);
  assert.equal(sameSecret(KEY, '', 'nonempty'), false);
});

test('two sessions issued together are still distinct', () => {
  const now = Date.now();
  assert.notEqual(issueSession(KEY, { now }), issueSession(KEY, { now }), 'the nonce differs');
});
