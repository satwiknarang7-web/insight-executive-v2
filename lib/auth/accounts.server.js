import 'server-only';

/**
 * Account lifecycle and session minting.
 *
 * The awkward part of a custom second factor is that the first factor must be
 * checked *without* handing out a session — otherwise the password alone signs
 * someone in and the code is decoration. So:
 *
 *   1. `verifyPassword` checks the password on a throwaway client that persists
 *      nothing. The session it returns is discarded on the spot.
 *   2. Only after the emailed code is claimed does `mintSession` create the real
 *      session, from the server, via an admin-generated link.
 *
 * That ordering means we never store the password, never park a half-valid
 * session anywhere, and never need the password again at step two.
 */
import { createClient } from '@supabase/supabase-js';
import { serviceClient, userClient } from '../vault/supabase.server';

const URL_VAR = 'NEXT_PUBLIC_SUPABASE_URL';
const ANON_VAR = 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY';

/** A client that authenticates but remembers nothing. */
function throwawayClient() {
  return createClient(process.env[URL_VAR], process.env[ANON_VAR], {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Look a user up by address. Returns null when there is none. */
export async function findUserByEmail(email) {
  // `listUsers` is paginated and there is no get-by-email; the filter is applied
  // server-side by the GoTrue admin API when given a query.
  const { data, error } = await serviceClient().auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return null;
  const match = (data?.users || []).find((u) => String(u.email || '').toLowerCase() === email);
  return match || null;
}

/**
 * Check an email/password pair without issuing a session.
 *
 * Returns one of: 'ok', 'invalid', 'unconfirmed', 'error'. 'unconfirmed' is
 * separated out because it is recoverable — the account exists and the password
 * was right, the sign-up was simply never finished.
 */
export async function verifyPassword(email, password) {
  const client = throwawayClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    const text = String(error.message || '').toLowerCase();
    if (text.includes('not confirmed')) return { status: 'unconfirmed' };
    if (text.includes('invalid login')) return { status: 'invalid' };
    return { status: 'error', message: error.message };
  }
  if (!data?.user) return { status: 'invalid' };

  // Nothing was persisted, but be explicit: this session must not survive.
  await client.auth.signOut().catch(() => {});
  return { status: 'ok', user: data.user };
}

/**
 * Create the account, unconfirmed.
 *
 * Created up front rather than after the code so that a duplicate address is
 * rejected immediately, while the user is still looking at the form. The account
 * cannot be signed into until `confirmUser` runs, so an abandoned sign-up leaves
 * an inert row rather than a usable login.
 */
export async function createUnconfirmedUser(email, password) {
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password,
    email_confirm: false,
  });
  if (error) {
    const text = String(error.message || '').toLowerCase();
    if (text.includes('already') || text.includes('registered') || text.includes('exists')) {
      return { status: 'exists' };
    }
    return { status: 'error', message: error.message };
  }
  return { status: 'ok', user: data.user };
}

/** Mark the address as verified, once the code proves the inbox is theirs. */
export async function confirmUser(userId) {
  const { error } = await serviceClient().auth.admin.updateUserById(userId, { email_confirm: true });
  if (error) throw new Error(error.message);
}

/**
 * Issue a real session for an already-authenticated user and set its cookies.
 *
 * The admin API mints a magic-link token, which is then redeemed server-side —
 * the link itself is never sent anywhere, so this is not an email round trip; it
 * is simply the supported way to obtain a session without a password. Redeeming
 * it through the cookie-writing client is what leaves the browser signed in.
 */
export async function mintSession(email) {
  const { data, error } = await serviceClient().auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(error.message);

  const hashed = data?.properties?.hashed_token;
  if (!hashed) throw new Error('Supabase returned no token to redeem.');

  const supabase = await userClient();
  const { data: session, error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: hashed,
    type: 'email',
  });
  if (verifyError) throw new Error(verifyError.message);
  return session?.user || null;
}

/** End the session on this browser. */
export async function signOut() {
  const supabase = await userClient();
  await supabase.auth.signOut().catch(() => {});
}

/**
 * Delete an account and everything that belongs only to it.
 *
 * Order matters and is not obvious. Deleting the auth user cascades memberships
 * (and nulls `created_by` on connections), but an organisation has no foreign
 * key to a user at all — so deleting the user first would strand the org, its
 * connections and their encrypted secrets in the database, unreachable but
 * still present. Sole-member organisations are therefore removed first, which
 * cascades to connections, secrets and audit rows.
 *
 * An organisation with other members is deliberately left alone: it is not this
 * user's to delete, and removing it would take everyone else's connections with
 * it. Their membership row disappears either way.
 */
export async function deleteAccount(userId) {
  const svc = serviceClient();

  const { data: memberships, error: memberError } = await svc
    .from('memberships')
    .select('org_id')
    .eq('user_id', userId);
  if (memberError) throw new Error(memberError.message);

  const removedOrgs = [];
  for (const { org_id: orgId } of memberships || []) {
    const { count, error } = await svc
      .from('memberships')
      .select('user_id', { count: 'exact', head: true })
      .eq('org_id', orgId);
    if (error) throw new Error(error.message);

    if ((count ?? 0) <= 1) {
      const { error: dropError } = await svc.from('organizations').delete().eq('id', orgId);
      if (dropError) throw new Error(dropError.message);
      removedOrgs.push(orgId);
    }
  }

  const { error: userError } = await svc.auth.admin.deleteUser(userId);
  if (userError) throw new Error(userError.message);

  return { removedOrgs: removedOrgs.length };
}
