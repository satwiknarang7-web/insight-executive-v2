import 'server-only';

/**
 * Supabase clients for the server.
 *
 * Two of them, and the difference matters more than anything else in this file:
 *
 * - `userClient()` acts as the signed-in user. Row-level security applies, so
 *   the database itself refuses to return another organisation's rows. Use this
 *   for everything a user is allowed to see.
 *
 * - `serviceClient()` bypasses RLS entirely. It is the only thing that can read
 *   the credential vault, and it will happily read *any* organisation's. Every
 *   call site must authorise the request itself before using it — the database
 *   is no longer doing that job.
 *
 * The `server-only` import at the top is load-bearing: it makes the build fail
 * rather than quietly bundling the service key into client JavaScript.
 */
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const URL_VAR = 'NEXT_PUBLIC_SUPABASE_URL';
const ANON_VAR = 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY';
const SERVICE_VAR = 'SUPABASE_SERVICE_ROLE_KEY';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  }
  if (name === URL_VAR && !value.startsWith('http')) {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL. It currently looks like it might be a secret key or incorrectly copied value.`);
  }
  return value;
}

/**
 * Thrown when Supabase rejects our credentials rather than our request.
 *
 * These are indistinguishable from a real failure at the call site -- the
 * database simply says "Invalid API key" -- but the remedy is completely
 * different: nothing about the query is wrong, the deployment is misconfigured.
 * Callers catch this to show the "not configured" screen instead of a crash.
 */
export class VaultConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultConfigError';
  }
}

/**
 * Does this Supabase error mean "your keys are wrong" rather than "your query is wrong"?
 *
 * `isSupabaseConfigured` only proves the variables are non-empty. A key copied
 * from the wrong project, a leftover placeholder, or a rotated key all pass that
 * check and fail here instead.
 */
function isCredentialFailure(message) {
  const text = String(message || '').toLowerCase();
  return (
    text.includes('invalid api key') ||
    text.includes('invalid authentication') ||
    text.includes('jwt') ||
    text.includes('no api key')
  );
}

/** Rethrow a Supabase error, upgrading credential failures to something actionable. */
function raise(error) {
  const message = error?.message || String(error);
  if (isCredentialFailure(message)) {
    throw new VaultConfigError(
      `Supabase rejected the server credentials (${message}). Check that ` +
        `${URL_VAR}, ${ANON_VAR} and ${SERVICE_VAR} in .env.local all come from ` +
        `the same Supabase project, then restart the dev server.`
    );
  }
  throw new Error(message);
}

/**
 * Database calls must never be served from Next's fetch cache.
 *
 * Next patches global `fetch` in route handlers and can replay a stored
 * response. That is fine for a static asset and wrong for a database: a
 * PostgREST reply saying a table does not exist — as it does for the few
 * seconds after a migration, before the schema cache reloads — was being
 * cached and replayed indefinitely, so the app insisted the table was missing
 * long after it existed. The rows behind these calls also change constantly;
 * none of it is cacheable.
 */
const uncachedFetch = (url, options = {}) => fetch(url, { ...options, cache: 'no-store' });

/** Is the vault backend configured at all? Lets the UI explain itself instead of erroring. */
export function isSupabaseConfigured() {
  return !!(process.env[URL_VAR]?.startsWith('http') && process.env[ANON_VAR] && process.env[SERVICE_VAR]);
}

/**
 * A client scoped to the signed-in user, reading the session from cookies.
 * RLS applies to everything it touches.
 */
export async function userClient() {
  const store = await cookies();
  return createServerClient(required(URL_VAR), required(ANON_VAR), {
    global: { fetch: uncachedFetch },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session instead, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * The service-role client. Bypasses RLS.
 *
 * Never hand this to a request handler that has not already established who the
 * caller is and what organisation they belong to.
 */
export function serviceClient() {
  return createClient(required(URL_VAR), required(SERVICE_VAR), {
    global: { fetch: uncachedFetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The signed-in user, or null. */
export async function currentUser() {
  const supabase = await userClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data?.user ?? null;
}

/**
 * Resolve the caller's membership of one organisation.
 *
 * This is the authorisation gate in front of every service-role operation.
 * It deliberately runs through the *user* client, so the answer comes from RLS
 * rather than from application logic that could drift.
 */
export async function membership(orgId) {
  const user = await currentUser();
  if (!user) return null;

  const supabase = await userClient();
  const { data, error } = await supabase
    .from('memberships')
    .select('org_id, role')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error || !data) return null;
  return { userId: user.id, orgId: data.org_id, role: data.role };
}

/** Every organisation the caller belongs to. */
export async function myOrganizations() {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from('memberships')
    .select('role, organizations(id, name, created_at)')
    .order('created_at', { referencedTable: 'organizations', ascending: true });

  if (error) return [];
  return (data || [])
    .filter((row) => row.organizations)
    .map((row) => ({ ...row.organizations, role: row.role }));
}

/**
 * Give a newly signed-up user an organisation.
 *
 * `public.organizations` deliberately has no INSERT policy, so a client cannot
 * mint itself a tenant. Bootstrapping therefore has to happen here, with the
 * service role, and only for a user who genuinely has none — otherwise this
 * becomes the org-creation endpoint the missing policy was meant to prevent.
 */
export async function ensureOrganization(name = null) {
  const user = await currentUser();
  if (!user) return null;

  const existing = await myOrganizations();
  if (existing.length > 0) return existing[0];

  const svc = serviceClient();
  const label = name || defaultOrgName(user.email);

  const { data: org, error: orgError } = await svc
    .from('organizations')
    .insert({ name: label })
    .select('id, name, created_at')
    .single();
  if (orgError) raise(orgError);

  const { error: memberError } = await svc
    .from('memberships')
    .insert({ user_id: user.id, org_id: org.id, role: 'owner' });

  if (memberError) {
    // An organisation nobody belongs to is unreachable by anyone, including
    // this user on their next sign-in. Roll it back rather than orphan it.
    await svc.from('organizations').delete().eq('id', org.id);
    raise(memberError);
  }

  return { ...org, role: 'owner' };
}

function defaultOrgName(email) {
  const domain = String(email || '').split('@')[1];
  if (!domain) return 'My organisation';
  const base = domain.split('.')[0];
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'My organisation';
}
