import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  canResend,
  challengeState,
  expiryFrom,
  generateCode,
  generateDeviceToken,
  hashCode,
  hashToken,
  normalizeEmail,
  passwordProblem,
  resendWaitSeconds,
  verifyCode,
} from '../lib/auth/otp.js';

const PEPPER = 'test-pepper-value';

test('a code is always six digits, leading zeros kept', () => {
  for (let i = 0; i < 400; i++) {
    const code = generateCode();
    assert.equal(code.length, 6, `got ${code}`);
    assert.match(code, /^\d{6}$/);
  }
});

test('codes are not all the same', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(generateCode());
  assert.ok(seen.size > 100, `only ${seen.size} distinct codes in 200 draws`);
});

test('a stored hash does not contain the code', () => {
  const hash = hashCode('123456', PEPPER);
  assert.doesNotMatch(hash, /123456/);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('the same code under a different pepper does not verify', () => {
  // This is the property that makes a leaked database row useless on its own.
  const hash = hashCode('123456', PEPPER);
  assert.equal(verifyCode('123456', hash, PEPPER), true);
  assert.equal(verifyCode('123456', hash, 'other-pepper'), false);
});

test('hashing refuses to run without a pepper', () => {
  assert.throws(() => hashCode('123456', ''), /pepper/i);
});

test('a wrong code does not verify, and neither does junk', () => {
  const hash = hashCode('123456', PEPPER);
  assert.equal(verifyCode('123457', hash, PEPPER), false);
  assert.equal(verifyCode('', hash, PEPPER), false);
  assert.equal(verifyCode('123456', '', PEPPER), false);
  assert.equal(verifyCode(null, hash, PEPPER), false);
  assert.equal(verifyCode('123456', 'not-hex-and-wrong-length', PEPPER), false);
});

test('surrounding whitespace in a typed code is tolerated', () => {
  const hash = hashCode('123456', PEPPER);
  assert.equal(verifyCode(' 123456 ', hash, PEPPER), true);
});

const challenge = (over = {}) => ({
  attempts: 0,
  consumed_at: null,
  created_at: new Date().toISOString(),
  last_sent_at: new Date().toISOString(),
  expires_at: expiryFrom(CODE_TTL_MS),
  ...over,
});

test('a fresh challenge is open', () => {
  assert.equal(challengeState(challenge()), 'open');
});

test('a challenge closes on expiry, use, and too many guesses', () => {
  const now = Date.now();
  assert.equal(challengeState(challenge({ expires_at: new Date(now - 1).toISOString() }), now), 'expired');
  assert.equal(challengeState(challenge({ consumed_at: new Date().toISOString() })), 'consumed');
  assert.equal(challengeState(challenge({ attempts: MAX_ATTEMPTS })), 'locked');
  assert.equal(challengeState(null), 'missing');
});

test('a consumed challenge stays closed even if it has not expired', () => {
  const state = challengeState(challenge({ consumed_at: new Date().toISOString(), attempts: 0 }));
  assert.equal(state, 'consumed');
});

test('resend is refused inside the cooldown and allowed after it', () => {
  const now = Date.now();
  const fresh = challenge({ last_sent_at: new Date(now).toISOString() });
  assert.equal(canResend(fresh, now), false);
  assert.ok(resendWaitSeconds(fresh, now) > 0);

  const older = challenge({ last_sent_at: new Date(now - RESEND_COOLDOWN_MS - 1).toISOString() });
  assert.equal(canResend(older, now), true);
  assert.equal(resendWaitSeconds(older, now), 0);
});

test('a device token is long, random and stored only as a digest', () => {
  const a = generateDeviceToken();
  const b = generateDeviceToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40, `token too short: ${a.length}`);
  const digest = hashToken(a);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(digest, new RegExp(a.slice(0, 12).replace(/[-_]/g, '.')));
  assert.equal(hashToken(a), digest, 'hashing is stable');
});

test('addresses are lower-cased and trimmed, junk is rejected', () => {
  assert.equal(normalizeEmail('  Sam@Example.COM '), 'sam@example.com');
  assert.equal(normalizeEmail('no-at-sign'), null);
  assert.equal(normalizeEmail('two@@at.com'), null);
  assert.equal(normalizeEmail(''), null);
  assert.equal(normalizeEmail(null), null);
  assert.equal(normalizeEmail(`${'a'.repeat(250)}@x.com`), null);
});

test('password rules reject the weak cases and accept a reasonable one', () => {
  assert.match(passwordProblem('short1'), /10 characters/);
  assert.match(passwordProblem('alllettershere'), /letter and one number/);
  assert.match(passwordProblem('1234567890'), /letter and one number/);
  assert.match(passwordProblem('a1'.repeat(40)), /at most 72/);
  assert.equal(passwordProblem('correct horse 7 battery'), null);
});
