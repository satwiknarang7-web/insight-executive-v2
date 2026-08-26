import 'server-only';

/**
 * Saved analyses, handles, and who may open what.
 *
 * Everything here runs through the *user* client, not the service role. That is
 * deliberate and is the whole reason these tables live in `public`: the policies
 * on them are the authorisation. Reaching for the service role would bypass the
 * rules and move the decision into application code, where the next route to be
 * written would have to remember to repeat it.
 *
 * The payload is the analysis, never the data. Chart result sets are already
 * aggregated to the handful of rows a chart draws; the cleaned dataset stays in
 * the browser, so saving an analysis does not quietly upload someone's file.
 */
import { userClient, currentUser } from './vault/supabase.server';

/** Postgres rejects a jsonb document this big long before it is useful. */
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

export class NotFound extends Error {
  constructor(message = 'That analysis does not exist, or is not shared with you.') {
    super(message);
    this.name = 'NotFound';
  }
}

export class Invalid extends Error {
  constructor(message) {
    super(message);
    this.name = 'Invalid';
  }
}

/**
 * The library tables are not in this database, or PostgREST cannot see them.
 *
 * Worth its own type for the same reason `AuthSchemaMissing` is: it is a
 * deployment step rather than a bug, and it is otherwise indistinguishable from
 * a crash. PostgREST reports both "the migration was never run" and "the schema
 * cache is stale" with the same PGRST205, and the remedy — run the SQL, which
 * ends by reloading the cache — is the same either way.
 */
export class LibraryUnavailable extends Error {
  constructor(detail = '') {
    super(
      'The library tables are missing from this Supabase project. ' +
        'Run supabase/APPLY_SHARING.sql in its SQL editor.' +
        (detail ? ` (${detail})` : '')
    );
    this.name = 'LibraryUnavailable';
  }
}

/** Turn a Supabase error into ours, so routes can answer usefully. */
function raise(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  if (text.includes('pgrst205') || text.includes('could not find the table')) {
    throw new LibraryUnavailable(error?.message);
  }
  // A policy refusal on a WRITE is ambiguous, and the two cases need different
  // answers. Postgres reports both as 42501:
  //   - the row genuinely is not yours  -> a 404 is right
  //   - no INSERT policy exists at all  -> the deployment is half-applied, and
  //     telling the user "not yours" sends them hunting for a permissions bug
  //     in their own account. `new row violates` only ever means the second on
  //     an insert of a row we just stamped with the caller's own id.
  if (text.includes('new row violates row-level security')) {
    throw new LibraryUnavailable(
      'the database is missing its insert policy — re-run the SQL, which recreates every policy'
    );
  }
  if (text.includes('row-level security')) {
    throw new NotFound('That analysis does not exist, or is not yours to change.');
  }
  throw new Error(error?.message || String(error));
}

/** A handle is lower-case, short, and unambiguous to type. */
export function normalizeHandle(raw) {
  const value = String(raw ?? '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
  return /^[a-z0-9_]{3,24}$/.test(value) ? value : null;
}

/**
 * Suggest a handle from an email address.
 *
 * Only ever a starting point shown in a form — never assigned silently, because
 * a handle is how other people will refer to you and that should be a choice.
 */
export function suggestHandle(email) {
  const base = String(email || '')
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24);
  return base.length >= 3 ? base : `user_${Math.random().toString(36).slice(2, 8)}`;
}

/** The signed-in user's profile, or null when they have not chosen a handle. */
export async function myProfile() {
  const user = await currentUser();
  if (!user) return null;

  const supabase = await userClient();
  const { data } = await supabase
    .from('profiles')
    .select('user_id, handle, display_name')
    .eq('user_id', user.id)
    .maybeSingle();

  return data || null;
}

/** Claim or change a handle. Uniqueness is enforced by the database, not here. */
export async function setHandle({ handle, displayName = null }) {
  const user = await currentUser();
  if (!user) throw new NotFound('Sign in first.');

  const clean = normalizeHandle(handle);
  if (!clean) {
    throw new Invalid('A handle is 3–24 characters: lower-case letters, numbers or underscores.');
  }

  const supabase = await userClient();
  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      { user_id: user.id, handle: clean, display_name: displayName?.trim() || null },
      { onConflict: 'user_id' }
    )
    .select('user_id, handle, display_name')
    .single();

  if (error) {
    // 23505 is a unique violation — the only failure a user can fix themselves.
    if (error.code === '23505') throw new Invalid(`“${clean}” is already taken.`);
    raise(error);
  }
  return data;
}

/**
 * Save an analysis.
 *
 * Passing an id updates that analysis instead of adding another, so pressing
 * Save twice does not litter the library with near-identical copies.
 */
export async function saveAnalysis({ id = null, title, datasetName, rowCount, payload }) {
  const user = await currentUser();
  if (!user) throw new NotFound('Sign in first.');

  const name = String(title || '').trim();
  if (!name) throw new Invalid('Give the analysis a title.');
  if (!payload || typeof payload !== 'object') throw new Invalid('There is nothing to save.');

  const size = Buffer.byteLength(JSON.stringify(payload));
  if (size > MAX_PAYLOAD_BYTES) {
    throw new Invalid('This analysis is too large to save. Remove a few charts and try again.');
  }

  const supabase = await userClient();
  const row = {
    owner_id: user.id,
    title: name,
    dataset_name: datasetName || null,
    row_count: Number.isFinite(rowCount) ? rowCount : null,
    payload,
  };

  const query = id
    ? supabase.from('analyses').update(row).eq('id', id).select('id, title, updated_at').single()
    : supabase.from('analyses').insert(row).select('id, title, updated_at').single();

  const { data, error } = await query;
  if (error) raise(error);
  if (!data) throw new NotFound();
  return data;
}

/**
 * Everything the caller may open, theirs and shared alike.
 *
 * The list deliberately omits `payload`: a library page needs titles and dates,
 * and shipping every stored storyboard to render a list would be wasteful.
 */
export async function listAnalyses() {
  const user = await currentUser();
  if (!user) return { mine: [], shared: [] };

  const supabase = await userClient();
  const { data, error } = await supabase
    .from('analyses')
    .select('id, owner_id, title, dataset_name, row_count, created_at, updated_at')
    .order('updated_at', { ascending: false });

  if (error) raise(error);

  const rows = data || [];
  return {
    mine: rows.filter((r) => r.owner_id === user.id),
    shared: rows.filter((r) => r.owner_id !== user.id),
  };
}

/** One analysis, with its payload. RLS decides whether it is visible. */
export async function getAnalysis(id) {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from('analyses')
    .select('id, owner_id, title, dataset_name, row_count, payload, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();

  if (error) raise(error);
  if (!data) throw new NotFound();
  return data;
}

export async function deleteAnalysis(id) {
  const supabase = await userClient();
  const { data, error } = await supabase.from('analyses').delete().eq('id', id).select('id').maybeSingle();
  if (error) raise(error);
  if (!data) throw new NotFound();
  return { id, deleted: true };
}

/** Who an analysis is shared with. */
export async function listShares(analysisId) {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from('analysis_shares')
    .select('shared_with, created_at, profiles!inner(handle, display_name)')
    .eq('analysis_id', analysisId);

  if (error) raise(error);
  return (data || []).map((row) => ({
    userId: row.shared_with,
    handle: row.profiles?.handle,
    displayName: row.profiles?.display_name,
    sharedAt: row.created_at,
  }));
}

/**
 * Share with the person behind a handle.
 *
 * Resolving the handle here rather than taking a user id from the client is the
 * point: a caller cannot share with an arbitrary uuid they guessed, only with
 * someone who has published a handle.
 */
export async function shareAnalysis(analysisId, handle) {
  const user = await currentUser();
  if (!user) throw new NotFound('Sign in first.');

  const clean = normalizeHandle(handle);
  if (!clean) throw new Invalid('That is not a valid handle.');

  const supabase = await userClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('user_id, handle, display_name')
    .eq('handle', clean)
    .maybeSingle();

  if (!profile) throw new Invalid(`Nobody here uses the handle “${clean}”.`);
  if (profile.user_id === user.id) throw new Invalid('That analysis is already yours.');

  const { error } = await supabase
    .from('analysis_shares')
    .upsert({ analysis_id: analysisId, shared_with: profile.user_id }, { onConflict: 'analysis_id,shared_with' });

  // The policy refuses a share on an analysis the caller does not own, which
  // surfaces as a row-level-security error rather than a friendly one.
  if (error) {
    if (/row-level security/i.test(error.message)) throw new NotFound('You can only share your own analyses.');
    raise(error);
  }
  return { handle: clean, displayName: profile.display_name };
}

export async function unshareAnalysis(analysisId, userId) {
  const supabase = await userClient();
  const { error } = await supabase
    .from('analysis_shares')
    .delete()
    .eq('analysis_id', analysisId)
    .eq('shared_with', userId);
  if (error) raise(error);
  return { removed: true };
}
