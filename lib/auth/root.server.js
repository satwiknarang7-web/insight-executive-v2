import 'server-only';

/**
 * The root portal's own front door.
 *
 * This is an operator login, deliberately separate from the product's: it does
 * not go through Supabase, has no account row, and grants nothing inside the
 * app. It exists to answer an operational question — how many people have
 * signed up — without anyone needing a customer account to ask it.
 *
 * That makes it a second way in, and a second way in is a liability unless it
 * is built like one. Four rules follow, and each is load-bearing:
 *
 *   1. **Off unless both variables are set.** An unset password must never
 *      become an empty password that anything matches. `isRootConfigured` is
 *      checked before the form renders and again before any credential is
 *      compared, and the routes answer 404 when it is false — an unconfigured
 *      portal should look like a feature that was never built, not one waiting
 *      to be guessed at. A password under twelve characters counts as unset, so
 *      a half-finished configuration cannot leave the door ajar either.
 *   2. **Comparisons are constant-time**, and both halves are compared even
 *      when the address is already wrong, so a wrong email and a wrong password
 *      cost the same.
 *   3. **The session is signed, not stored** — see `rootSession.js`, where that
 *      logic lives so it can be tested.
 *   4. **The password is never returned, logged, or echoed.** Not in an error,
 *      not in a debug line, not in a thrown message.
 *
 * The signing key is derived from the password, so rotating `ROOT_PASSWORD`
 * invalidates every outstanding session — which is what you want from a
 * break-glass credential.
 */
import { createHmac } from 'node:crypto';
import { ROOT_SESSION_MS, issueSession, sameSecret, verifySession } from './rootSession.js';

export const ROOT_COOKIE = 'insight_root';
export { ROOT_SESSION_MS };

/** The shortest root password this deployment will treat as configured. */
const MIN_ROOT_PASSWORD = 12;

const rootEmail = () => String(process.env.ROOT_EMAIL || '').trim().toLowerCase();
const rootPassword = () => String(process.env.ROOT_PASSWORD || '');

/** Is the portal switched on at all? */
export function isRootConfigured() {
  return rootEmail().length > 0 && rootPassword().length >= MIN_ROOT_PASSWORD;
}

/**
 * What signs the session cookie.
 *
 * Falls back through secrets this deployment already has rather than inventing
 * another required variable. The password is mixed in on purpose: changing it
 * ends every session issued under the old one.
 */
function signingKey() {
  const material =
    process.env.ROOT_SESSION_SECRET ||
    process.env.AUTH_OTP_PEPPER ||
    process.env.VAULT_MASTER_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';
  return createHmac('sha256', 'insight-root-session').update(`${material}:${rootPassword()}`).digest();
}

/** Check a submitted email and password. */
export function verifyRootCredentials(email, password) {
  if (!isRootConfigured()) return false;
  const key = signingKey();
  // Both are always compared: short-circuiting on the address would make a
  // wrong email measurably faster than a wrong password.
  const emailOk = sameSecret(key, String(email || '').trim().toLowerCase(), rootEmail());
  const passwordOk = sameSecret(key, password, rootPassword());
  return emailOk && passwordOk;
}

export function issueRootSession(now = Date.now()) {
  return issueSession(signingKey(), { now });
}

export function verifyRootSession(token, now = Date.now()) {
  if (!isRootConfigured()) return false;
  return verifySession(signingKey(), token, { now });
}

/** The cookie options a root session is set with. */
export function rootCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV !== 'development',
    path: '/',
    maxAge: Math.floor(ROOT_SESSION_MS / 1000),
  };
}
