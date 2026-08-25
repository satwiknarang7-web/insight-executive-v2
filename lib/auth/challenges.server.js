import 'server-only';

/**
 * The store behind the second factor: pending codes, and trusted browsers.
 *
 * Both tables live in `app_private`, which PostgREST does not route to — not
 * even with the service-role key. Everything here therefore goes through the
 * `svc_*` functions in `public`, which are SECURITY DEFINER and whose EXECUTE is
 * granted to `service_role` alone. A browser calling them gets 403 before any
 * function body runs, and the tables stay unaddressable over REST.
 *
 * The state machine — expired, consumed, locked, wrong — lives in SQL rather
 * than here, so that checking a code and counting the guess happen in one
 * transaction under a row lock. Done in JavaScript it is a read-then-write race:
 * two requests with the same wrong code both read attempts=4, both write 5, and
 * the five-guess cap quietly becomes six.
 *
 * Nothing in this module returns a row to a caller that could forward it to a
 * browser: callers get decisions.
 */
import { serviceClient } from '../vault/supabase.server';
import { AuthSchemaMissing, raiseIfSchemaMissing } from './schema';
import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  TRUSTED_DEVICE_TTL_MS,
  expiryFrom,
  generateCode,
  generateDeviceToken,
  hashCode,
  hashToken,
} from './otp';

/**
 * The secret that makes a stored code hash useless on its own.
 *
 * Prefers a dedicated variable, and otherwise borrows one the deployment
 * already has to have. Falling back rather than requiring a new variable means
 * 2FA works the moment Supabase is configured; setting AUTH_OTP_PEPPER
 * explicitly is still better, because rotating the service key then does not
 * invalidate every code in flight.
 */
function pepper() {
  const value =
    process.env.AUTH_OTP_PEPPER || process.env.VAULT_MASTER_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error('No secret available to hash one-time codes with.');
  return value;
}

// The classification itself lives in ./schema, which stays importable outside
// Next so it can be tested; re-exported here because this is where callers
// already look for it.
export { AuthSchemaMissing };

/** Open a challenge, returning the plaintext code for the mailer. */
export async function createChallenge({ email, userId = null, purpose }) {
  const code = generateCode();
  const { data, error } = await serviceClient().rpc('svc_challenge_create', {
    p_email: email,
    p_user_id: userId,
    p_purpose: purpose,
    p_code_hash: hashCode(code, pepper()),
    p_expires_at: expiryFrom(CODE_TTL_MS),
  });
  raiseIfSchemaMissing(error);
  if (error) throw new Error(error.message);
  return { challenge: { id: data, email, purpose }, code };
}

/**
 * Is the auth schema actually present?
 *
 * Called before an account is created, so a misconfigured deployment is caught
 * before it leaves a half-made user behind.
 */
export async function authSchemaReady() {
  const { error } = await serviceClient().rpc('svc_challenge_get', {
    p_id: '00000000-0000-0000-0000-000000000000',
  });
  try {
    raiseIfSchemaMissing(error);
  } catch {
    return false;
  }
  return true;
}

/**
 * Fetch one challenge. Returns null rather than throwing on a bad id.
 *
 * A missing *function* is not a missing challenge, and swallowing it here made
 * an unapplied migration look like an expired code — the one wrong answer that
 * sends the user round the loop again instead of telling anyone what to fix.
 */
export async function getChallenge(id) {
  if (!isUuid(id)) return null;
  const { data, error } = await serviceClient().rpc('svc_challenge_get', { p_id: id });
  raiseIfSchemaMissing(error);
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

/**
 * Replace the code on an open challenge and report it for re-sending.
 *
 * The attempt counter is deliberately not reset — see the module comment.
 */
export async function rotateCode(challenge) {
  const code = generateCode();
  const { error } = await serviceClient().rpc('svc_challenge_rotate', {
    p_id: challenge.id,
    p_code_hash: hashCode(code, pepper()),
    p_expires_at: expiryFrom(CODE_TTL_MS),
  });
  raiseIfSchemaMissing(error);
  if (error) throw new Error(error.message);
  return code;
}

/**
 * Check a submitted code and burn the challenge on success.
 *
 * Returns a verdict, never a row. The comparison happens inside the database
 * against the hash we compute here, so the plaintext code never goes to
 * Postgres and the stored hash never comes back.
 */
export async function claimChallenge(id, submittedCode) {
  if (!isUuid(id)) return { ok: false, reason: 'missing' };

  const { data, error } = await serviceClient().rpc('svc_challenge_claim', {
    p_id: id,
    p_code_hash: hashCode(String(submittedCode || '').trim(), pepper()),
  });
  raiseIfSchemaMissing(error);
  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, reason: 'missing' };
  if (row.ok) {
    return { ok: true, challenge: { id, email: row.email, purpose: row.purpose, user_id: row.user_id } };
  }
  return {
    ok: false,
    reason: row.reason,
    remaining: Math.max(0, MAX_ATTEMPTS - (row.attempts ?? MAX_ATTEMPTS)),
  };
}

/** Drop every challenge for an address (used when an account is deleted). */
export async function purgeChallenges(email) {
  await serviceClient().rpc('svc_challenge_purge', { p_email: email });
}

// ---------------------------------------------------------------------------
// Trusted devices
// ---------------------------------------------------------------------------

/** Register this browser as having passed a code. Returns the raw cookie token. */
export async function trustDevice(userId, label = null) {
  const token = generateDeviceToken();
  const { error } = await serviceClient().rpc('svc_device_trust', {
    p_user_id: userId,
    p_token_hash: hashToken(token),
    p_label: label ? String(label).slice(0, 120) : null,
    p_expires_at: expiryFrom(TRUSTED_DEVICE_TTL_MS),
  });
  raiseIfSchemaMissing(error);
  if (error) throw new Error(error.message);
  return token;
}

/**
 * Is this token a live trust for this account?
 *
 * The user id is part of the match, not a check afterwards, so a token issued
 * for one account can never wave through a sign-in to another.
 */
export async function deviceIsTrusted(token, userId) {
  if (!token || !userId) return false;
  const { data, error } = await serviceClient().rpc('svc_device_check', {
    p_token_hash: hashToken(token),
    p_user_id: userId,
  });
  if (error) return false;
  return data === true;
}

/** Forget every device for a user. */
export async function forgetDevices(userId) {
  await serviceClient().rpc('svc_device_forget_all', { p_user_id: userId });
}

/** Housekeeping: drop rows nobody can use any more. */
export async function purgeExpired() {
  await serviceClient().rpc('svc_auth_purge_expired');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
