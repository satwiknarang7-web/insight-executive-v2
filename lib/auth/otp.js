/**
 * One-time codes, device tokens and the rules around them.
 *
 * Deliberately pure: every function takes what it needs as an argument and
 * touches neither the database, the network, nor `process.env`. That is what
 * lets the security-relevant decisions here — how long a code lives, how many
 * guesses it gets, whether a comparison leaks timing — be tested directly,
 * rather than inferred from the behaviour of a route handler.
 *
 * The server wrapper (`lib/auth/challenges.server.js`) supplies the pepper and
 * the clock.
 */
import { createHmac, randomInt, randomBytes, timingSafeEqual, createHash } from 'crypto';

/** How long an emailed code stays valid. Long enough to switch to an inbox. */
export const CODE_TTL_MS = 10 * 60 * 1000;

/** Guesses allowed before a challenge is burned. 6 digits, so 5 is generous. */
export const MAX_ATTEMPTS = 5;

/** Minimum gap between "send me another code" requests. */
export const RESEND_COOLDOWN_MS = 60 * 1000;

/** How long a device stays trusted after a successful code. */
export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The cookie that marks this browser as already having passed a code. */
export const DEVICE_COOKIE = 'ia_device';

/**
 * A six-digit code, uniformly distributed and cryptographically random.
 *
 * `randomInt` rather than `Math.random`, and a fixed width so a leading zero is
 * never dropped — "042931" typed back as "42931" is a support ticket.
 */
export function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Hash a code for storage.
 *
 * HMAC with a server-held pepper, not a bare hash: the search space of a
 * six-digit code is a million entries, so an attacker holding a leaked database
 * row could otherwise recover the code with a laptop and a for-loop. Without the
 * pepper — which never leaves the environment — the stored digest is useless.
 */
export function hashCode(code, pepper) {
  if (!pepper) throw new Error('A pepper is required to hash a code.');
  return createHmac('sha256', pepper).update(String(code)).digest('hex');
}

/**
 * Constant-time comparison of a submitted code against a stored hash.
 *
 * Hashing first means both sides are the same fixed length, so `timingSafeEqual`
 * cannot throw on a length mismatch and the comparison leaks nothing about how
 * much of the code was right.
 */
export function verifyCode(submitted, storedHash, pepper) {
  if (typeof submitted !== 'string' || typeof storedHash !== 'string') return false;
  const candidate = Buffer.from(hashCode(submitted.trim(), pepper), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (candidate.length !== stored.length || stored.length === 0) return false;
  return timingSafeEqual(candidate, stored);
}

/** A code is only usable while unexpired, unconsumed and under the attempt cap. */
export function challengeState(challenge, now = Date.now()) {
  if (!challenge) return 'missing';
  if (challenge.consumed_at) return 'consumed';
  if (challenge.attempts >= MAX_ATTEMPTS) return 'locked';
  if (new Date(challenge.expires_at).getTime() <= now) return 'expired';
  return 'open';
}

/** When the next code may be sent for this challenge. */
export function canResend(challenge, now = Date.now()) {
  if (!challenge) return false;
  const last = new Date(challenge.last_sent_at || challenge.created_at).getTime();
  return now - last >= RESEND_COOLDOWN_MS;
}

/** Seconds a caller should wait before another code is allowed. */
export function resendWaitSeconds(challenge, now = Date.now()) {
  if (!challenge) return 0;
  const last = new Date(challenge.last_sent_at || challenge.created_at).getTime();
  return Math.max(0, Math.ceil((RESEND_COOLDOWN_MS - (now - last)) / 1000));
}

/** An opaque, high-entropy token identifying a trusted browser. */
export function generateDeviceToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Hash a device token for storage.
 *
 * A plain SHA-256 is right here where it was wrong for the code: this token has
 * 256 bits of entropy, so there is no search space to brute-force, and the
 * lookup has to be by digest.
 */
export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

/** An expiry timestamp `ms` from now, as an ISO string. */
export function expiryFrom(ms, now = Date.now()) {
  return new Date(now + ms).toISOString();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Normalise an address for storage and lookup.
 *
 * Lower-cased, because "Sam@x.com" and "sam@x.com" are one account and treating
 * them as two lets someone register a duplicate. Returns null when the value is
 * not an address at all, so callers have one thing to check.
 */
export function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value || value.length > 254 || !EMAIL_RE.test(value)) return null;
  return value;
}

/** Minimum password rules, stated once so sign-up and reset cannot disagree. */
export function passwordProblem(password) {
  const value = String(password || '');
  if (value.length < 10) return 'Use at least 10 characters.';
  if (value.length > 72) return 'Use at most 72 characters.';
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Include at least one letter and one number.';
  }
  return null;
}
