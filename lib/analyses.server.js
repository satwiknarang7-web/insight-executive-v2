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
import { findUserByEmail } from './auth/accounts.server';
import { normalizeHandle, parseRecipient } from './handles.js';

// Re-exported so every caller keeps importing them from one place, even
// though the rules themselves live in a module the test runner can load.
export { isEmailAddress, normalizeHandle, parseRecipient, suggestHandle } from './handles.js';

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

/** The signed-in user's profile, or null when they have not chosen a username. */
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

/** Claim or change a username. Uniqueness is enforced by the database, not here. */
export async function setHandle({ handle, displayName = null }) {
  const user = await currentUser();
  if (!user) throw new NotFound('Sign in first.');

  const clean = normalizeHandle(handle);
  if (!clean) {
    throw new Invalid('A username is 3–24 characters: lower-case letters, numbers or underscores.');
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

/** The columns a share row carries once the sharing migration is applied. */
const SHARE_COLUMNS = 'shared_with, created_at, shared_as';

/**
 * Who an analysis is shared with.
 *
 * Two queries rather than one embedded select, and that is the fix for sharing
 * appearing not to work at all. `analysis_shares.shared_with` references
 * `auth.users`, not `public.profiles`, so there is no foreign key for PostgREST
 * to follow and `profiles!inner(...)` came back as PGRST200 - "could not find a
 * relationship". Every sharing route ends by re-reading this list, so a share
 * that had already been written was still reported to the browser as a 500 and
 * the recipient never appeared in the dialog.
 */
export async function listShares(analysisId) {
  const supabase = await userClient();
  const { data, error } = await supabase
    .from('analysis_shares')
    .select(SHARE_COLUMNS)
    .eq('analysis_id', analysisId)
    .order('created_at', { ascending: true });

  if (error) {
    // A deployment that has not run the newer migration has no `shared_as`
    // column. That is a missing column, not a missing feature: read the rest.
    if (missingColumn(error)) return listSharesWithoutLabel(analysisId, supabase);
    raise(error);
  }
  return decorateShares(supabase, data || []);
}

async function listSharesWithoutLabel(analysisId, supabase) {
  const { data, error } = await supabase
    .from('analysis_shares')
    .select('shared_with, created_at')
    .eq('analysis_id', analysisId)
    .order('created_at', { ascending: true });
  if (error) raise(error);
  return decorateShares(supabase, data || []);
}

/** Attach each recipient's public handle, where they have chosen one. */
async function decorateShares(supabase, rows) {
  if (!rows.length) return [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, handle, display_name')
    .in(
      'user_id',
      rows.map((r) => r.shared_with)
    );

  const byUser = new Map((profiles || []).map((p) => [p.user_id, p]));
  return rows.map((row) => {
    const profile = byUser.get(row.shared_with) || null;
    return {
      userId: row.shared_with,
      handle: profile?.handle || null,
      displayName: profile?.display_name || null,
      // What the owner typed. Someone shared with by address before they chose
      // a username would otherwise be an anonymous row in their own list.
      sharedAs: row.shared_as || profile?.handle || null,
      sharedAt: row.created_at,
    };
  });
}

/** Postgres and PostgREST for "that column is not in this database". */
function missingColumn(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('pgrst204') || text.includes('shared_as');
}

/**
 * Share with a person, named either by their username or by their email address.
 *
 * Resolving the name here rather than taking a user id from the client is the
 * point: a caller cannot share with an arbitrary uuid they guessed. A username
 * is resolved through the profiles table, which every signed-in user may read
 * by design. An address is resolved through the admin API instead, because
 * addresses deliberately are not in that table - which makes this the one path
 * that runs with more privilege than the caller, so it does exactly one thing
 * with it: turn an address the caller already knows into the id of the row they
 * are about to insert. The insert itself still goes through the user client and
 * is still refused by policy on an analysis they do not own.
 */
export async function shareAnalysis(analysisId, recipient) {
  const user = await currentUser();
  if (!user) throw new NotFound('Sign in first.');

  const parsed = parseRecipient(recipient);
  if (parsed.kind === 'none') throw new Invalid('Type a username or an email address to share with.');
  if (parsed.kind === 'bad-email') {
    throw new Invalid(`“${parsed.value}” is not a complete email address.`);
  }
  if (parsed.kind === 'bad-handle') {
    throw new Invalid('A username is 3–24 characters: lower-case letters, numbers or underscores.');
  }

  const supabase = await userClient();
  const target = await resolveRecipient(parsed, supabase);
  if (target.userId === user.id) throw new Invalid('That analysis is already yours.');

  const row = { analysis_id: analysisId, shared_with: target.userId, shared_as: target.label };
  let { error } = await supabase
    .from('analysis_shares')
    .upsert(row, { onConflict: 'analysis_id,shared_with' });

  // A deployment that has not run the newer migration has no `shared_as`
  // column. Sharing still works there; the list is simply less descriptive.
  if (error && missingColumn(error)) {
    ({ error } = await supabase
      .from('analysis_shares')
      .upsert(
        { analysis_id: analysisId, shared_with: target.userId },
        { onConflict: 'analysis_id,shared_with' }
      ));
  }

  // The policy refuses a share on an analysis the caller does not own, which
  // surfaces as a row-level-security error rather than a friendly one.
  if (error) {
    if (/row-level security/i.test(error.message)) throw new NotFound('You can only share your own analyses.');
    raise(error);
  }
  // `userId` is the only unambiguous identifier here. A handle is null for
  // anyone who has not chosen one and a label is whatever the owner typed, so a
  // caller that needs to know *which person* was just granted access — the
  // notification email does — cannot rediscover it from the other two.
  return {
    userId: target.userId,
    handle: target.handle,
    displayName: target.displayName,
    label: target.label,
  };
}

/** Turn a parsed username or address into the user it belongs to. */
async function resolveRecipient(parsed, supabase) {
  if (parsed.kind === 'handle') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('user_id, handle, display_name')
      .eq('handle', parsed.value)
      .maybeSingle();

    if (!profile) throw new Invalid(`Nobody here uses the username “${parsed.value}”.`);
    return {
      userId: profile.user_id,
      handle: profile.handle,
      displayName: profile.display_name,
      label: profile.handle,
    };
  }

  // This message confirms whether an address has an account here, and that is a
  // decision rather than an oversight.
  //
  // `/api/auth/sign-up` goes the other way on purpose: it answers a new address
  // and an existing one identically, with a comment saying the form must not
  // become a membership oracle. The two are not inconsistent, they are answering
  // different questions. Sign-up is reachable by anyone on the internet, and the
  // person typing has no legitimate need to learn who else has registered.
  // Sharing is reachable only by someone who already has a verified account, and
  // the whole task in front of them is "does this person have an account, and if
  // not what do I do about it". Answering "no, ask them to sign up" is the
  // useful answer; a silent failure sends them to check for a typo that is not
  // there, or to assume the share worked when it did not.
  //
  // The oracle is real and is not removed by rewording. A share that lands
  // returns 200 and one that does not returns 400, so the wording is only
  // convenience on top of a signal the feature cannot work without. What bounds
  // it is the `share` rate limit on the route: thirty attempts a quarter of an
  // hour, per account, which is far more than anyone shares by hand and far too
  // slow to enumerate with.
  const account = await findUserByEmail(parsed.value);
  if (!account) throw new Invalid(`No account here uses ${parsed.value}. Ask them to sign up first.`);

  // They may also have a username; showing that back is friendlier than the
  // address, and it is what the recipient chose to be known by.
  const { data: profile } = await supabase
    .from('profiles')
    .select('user_id, handle, display_name')
    .eq('user_id', account.id)
    .maybeSingle();

  return {
    userId: account.id,
    handle: profile?.handle || null,
    displayName: profile?.display_name || null,
    label: profile?.handle || parsed.value,
  };
}

/**
 * Who this user is likely to be sharing with.
 *
 * Two lists, because they answer different questions. The people they have
 * shared with before are the ones they will share with again — that is most of
 * the traffic, and it needs no typing at all. A search over usernames covers
 * the rest, and only runs on two or more characters: `public.profiles` is
 * readable by every signed-in user by design (that is what makes "share with
 * @sam" possible), but there is a difference between looking up a name someone
 * already knows and handing out the whole directory a letter at a time.
 *
 * Only what a person published about themselves is returned — the username they
 * chose and the display name they typed. Never an email address: knowing
 * someone's handle is not grounds to be told their address.
 */
export async function shareSuggestions({ query = '', limit = 8 } = {}) {
  const user = await currentUser();
  if (!user) return { recent: [], matches: [] };

  const supabase = await userClient();
  const term = String(query || '').trim().toLowerCase().replace(/^@/, '');

  const [recent, matches] = await Promise.all([
    recentRecipients(supabase, user.id, limit),
    term.length >= 2 ? searchProfiles(supabase, user.id, term, limit) : Promise.resolve([]),
  ]);

  // Someone already in the recent list is not repeated in the matches.
  const seen = new Set(recent.map((r) => r.userId));
  return { recent, matches: matches.filter((m) => !seen.has(m.userId)) };
}

/** The people this user has shared any of their own analyses with. */
async function recentRecipients(supabase, ownerId, limit) {
  const { data: mine } = await supabase.from('analyses').select('id').eq('owner_id', ownerId).limit(200);
  const ids = (mine || []).map((a) => a.id);
  if (!ids.length) return [];

  const { data } = await supabase
    .from('analysis_shares')
    .select(SHARE_COLUMNS)
    .in('analysis_id', ids)
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = [];
  const seen = new Set();
  for (const row of data || []) {
    if (seen.has(row.shared_with)) continue;
    seen.add(row.shared_with);
    rows.push(row);
    if (rows.length >= limit) break;
  }

  return decorateShares(supabase, rows);
}

/** Usernames and display names matching what has been typed so far. */
async function searchProfiles(supabase, selfId, term, limit) {
  const escaped = term.replace(/[%_]/g, (c) => `\\${c}`);
  const { data } = await supabase
    .from('profiles')
    .select('user_id, handle, display_name')
    .or(`handle.ilike.%${escaped}%,display_name.ilike.%${escaped}%`)
    .limit(limit + 1);

  return (data || [])
    .filter((p) => p.user_id !== selfId)
    .slice(0, limit)
    .map((p) => ({
      userId: p.user_id,
      handle: p.handle,
      displayName: p.display_name,
      sharedAs: p.handle,
      sharedAt: null,
    }));
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
