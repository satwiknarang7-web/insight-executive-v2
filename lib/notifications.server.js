import 'server-only';

/**
 * Reading somebody's notifications, and recording that they read them.
 *
 * There is no notifications table. A notification here *is* a row of
 * `analysis_shares` — the recipient, the analysis and the moment access was
 * granted — read back through the recipient's own session, so RLS decides what
 * they can see exactly as it does everywhere else. The only thing stored on
 * top is one timestamp per person saying how far down they have read. The
 * migration explains why that is the whole schema.
 *
 * One consequence worth stating: revoking a share removes the notification
 * with it, and that is correct. A notice that somebody shared something,
 * pointing at something you can no longer open, is worse than no notice.
 */
import { currentUser, userClient } from './vault/supabase.server';
import { shareNotification, unreadCount } from './notifications.js';

/** How many to carry. A bell menu is a recent list, not an archive. */
const LIMIT = 20;

/**
 * A missing table is not an error here.
 *
 * The library, sharing and notifications are all optional: this app runs with
 * no Supabase at all, and a deployment that has one may not have applied every
 * migration. Everywhere else that shows up as a `LibraryUnavailable` the user
 * is told about, because they asked for the thing that needs it. Nobody asks
 * for a notification. An empty bell is the right answer, and a red error
 * banner in the sidebar of an app that is working perfectly well is not.
 *
 * Deliberately narrow: only the two things PostgREST says when the table has
 * not been created. It used to also swallow "does not exist" and any mention of
 * row-level security, which is far too much — a mistyped column or a policy
 * that does not match would have been silently indistinguishable from an
 * unmigrated project.
 */
function unmigrated(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('pgrst205') || text.includes('could not find the table');
}


const EMPTY = { notifications: [], unread: 0, seenAt: null };

/** When this person last opened their notifications, or null if never. */
async function readMarker(supabase, userId) {
  const { data, error } = await supabase
    .from('notification_reads')
    .select('seen_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error && !unmigrated(error)) throw error;
  return data?.seen_at || null;
}

/**
 * The notifications for whoever is signed in.
 *
 * Two queries rather than one join: `analyses.owner_id` points at `auth.users`
 * and so does `profiles.user_id`, so there is no foreign key between them for
 * PostgREST to embed across. `listShares` resolves names the same way for the
 * same reason.
 */
export async function listNotifications() {
  const user = await currentUser().catch(() => null);
  if (!user) return EMPTY;

  let supabase;
  try {
    supabase = await userClient();
  } catch {
    return EMPTY;
  }

  const { data, error } = await supabase
    .from('analysis_shares')
    .select('analysis_id, created_at, analyses(id, title, dataset_name, owner_id)')
    .eq('shared_with', user.id)
    .order('created_at', { ascending: false })
    .limit(LIMIT);

  if (error) {
    if (unmigrated(error)) return EMPTY;
    throw error;
  }

  // A share whose analysis has been deleted, or is no longer readable: the row
  // survives the cascade window, the embed comes back null, and there is
  // nothing to point the reader at.
  const rows = (data || []).filter((row) => row?.analyses);
  if (!rows.length) return { ...EMPTY, seenAt: await readMarker(supabase, user.id) };

  const owners = [...new Set(rows.map((row) => row.analyses.owner_id).filter(Boolean))];
  const byUser = new Map();
  if (owners.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, handle, display_name')
      .in('user_id', owners);
    for (const profile of profiles || []) byUser.set(profile.user_id, profile);
  }

  const notifications = rows.map((row) =>
    shareNotification(
      { analysisId: row.analysis_id, at: row.created_at },
      {
        profile: byUser.get(row.analyses.owner_id) || null,
        title: row.analyses.title,
        datasetName: row.analyses.dataset_name,
      }
    )
  );

  const seenAt = await readMarker(supabase, user.id);
  return { notifications, unread: unreadCount(notifications, seenAt), seenAt };
}

/**
 * Record that they have seen everything up to now.
 *
 * The timestamp is this server's, never the caller's. That is the whole point:
 * the browser sends no time at all, so a device whose clock runs fast cannot
 * mark the next few minutes of shares read before they have arrived.
 *
 * It is not the *database's* clock either, which would be better still and is
 * not reachable from here — PostgREST has no way to write `now()` as a value in
 * an upsert, and the column default only fires on an insert that omits the
 * column, which an upsert that must also cover the update case cannot do. Node
 * and Postgres are both NTP-synced on any real host, so the gap is milliseconds
 * and in the same direction for everyone.
 */
export async function markNotificationsSeen() {
  const user = await currentUser().catch(() => null);
  if (!user) return { seenAt: null };

  let supabase;
  try {
    supabase = await userClient();
  } catch {
    return { seenAt: null };
  }

  const seenAt = new Date().toISOString();
  const { error } = await supabase
    .from('notification_reads')
    .upsert({ user_id: user.id, seen_at: seenAt }, { onConflict: 'user_id' });

  if (error) {
    // A read that quietly returns nothing costs an empty bell. A *write* that
    // quietly does nothing costs the feature — "mark as read" would never
    // persist, the badge would return on every poll, and nothing would say
    // why. So only a missing table is forgiven; a refusal is a real fault and
    // is thrown, where the route logs it.
    if (unmigrated(error)) return { seenAt: null };
    throw error;
  }
  return { seenAt };
}
