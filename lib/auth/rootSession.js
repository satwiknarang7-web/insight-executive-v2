/**
 * Signing and checking a root-portal session.
 *
 * Kept apart from `root.server.js` for the reason `lookup.js` is kept apart
 * from `accounts.server.js`: that file imports `server-only` and so cannot be
 * loaded by the test runner, and these are exactly the rules that should be
 * tested directly rather than inferred from a portal that lets the wrong person
 * in. Everything here takes its key as an argument and reads no environment.
 *
 * The token is `expiry.nonce.signature`, signed with HMAC-SHA256. Stateless on
 * purpose — there is no session table to keep, and rotating the key invalidates
 * every outstanding session at once, which is the behaviour a break-glass
 * credential should have.
 */
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

/** How long a root session lasts. Short: this is not a place to linger. */
export const ROOT_SESSION_MS = 60 * 60 * 1000;

/**
 * Compare two secrets without revealing where they diverge.
 *
 * `timingSafeEqual` throws when the two buffers differ in length, and that
 * throw is itself a timing signal that leaks the length of the real secret.
 * Hashing both sides first makes them a fixed 32 bytes, so a wrong password of
 * the wrong length costs exactly what a wrong password of the right length does.
 */
export function sameSecret(key, a, b) {
  const left = createHmac('sha256', key).update(String(a ?? ''), 'utf8').digest();
  const right = createHmac('sha256', key).update(String(b ?? ''), 'utf8').digest();
  return timingSafeEqual(left, right);
}

/** Mint a signed session token. */
export function issueSession(key, { now = Date.now(), ttlMs = ROOT_SESSION_MS } = {}) {
  const expires = now + ttlMs;
  const nonce = randomUUID();
  const payload = `${expires}.${nonce}`;
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}

/**
 * Is this token one we issued, and still inside its window?
 *
 * Returns a boolean rather than a reason: nothing downstream benefits from
 * being told whether a rejected token was forged or merely stale, and saying
 * which would help someone probing.
 */
export function verifySession(key, token, { now = Date.now() } = {}) {
  if (!token) return false;

  const parts = String(token).split('.');
  if (parts.length !== 3) return false;

  const [expires, nonce, signature] = parts;
  const expected = createHmac('sha256', key).update(`${expires}.${nonce}`).digest('base64url');

  let signed = false;
  try {
    signed = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    // Different lengths: not a token we produced.
    return false;
  }
  if (!signed) return false;

  const at = Number(expires);
  return Number.isFinite(at) && at > now;
}
