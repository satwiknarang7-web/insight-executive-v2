/**
 * What a notification says, and how many of them are new.
 *
 * Pure, so the wording and the counting can be read and tested without a
 * database, a session or a clock — the same split as `routeLimits.js` and its
 * `.server` half. The queries live in `./notifications.server.js`.
 *
 * There is one kind of notification so far: somebody shared a saved analysis
 * with you. It is derived from the share itself rather than stored as an event
 * (see the migration for why), which means everything here is a function of a
 * share row and the profile of whoever owns the analysis.
 */

/** A name for the person who shared it, in the order a reader would prefer. */
export function senderName(profile) {
  const display = String(profile?.display_name || '').trim();
  if (display) return display;
  const handle = String(profile?.handle || '').trim();
  if (handle) return `@${handle}`;
  // Somebody who has never chosen a username. Naming them "unknown" reads as a
  // fault; "someone" reads as the fact, which is that this app does not publish
  // email addresses to other users and there is nothing else to show.
  return 'Someone';
}

/**
 * One notification, from a share row and what is known about its owner.
 *
 * `id` is the share's own identity. One analysis can only be shared with one
 * person once — the pair is the share table's primary key — so re-sharing
 * upserts the same row and leaves `created_at` alone. Somebody who already has
 * access is not notified again, which is right: nothing changed for them.
 */
export function shareNotification(share, { profile = null, title = '', datasetName = null } = {}) {
  const from = senderName(profile);
  const name = String(title || '').trim() || 'an analysis';
  return {
    id: `${share.analysisId}:${share.at}`,
    kind: 'share',
    analysisId: share.analysisId,
    at: share.at,
    from,
    title: name,
    datasetName: datasetName || null,
    message: `${from} shared “${name}” with you`,
  };
}

/**
 * How many are newer than the last time this person looked.
 *
 * No marker at all means everything is unread, which is right: a user who has
 * never opened the menu has never seen any of it.
 */
export function unreadCount(notifications = [], seenAt = null) {
  if (!seenAt) return notifications.length;
  const mark = Date.parse(seenAt);
  if (!Number.isFinite(mark)) return notifications.length;
  return notifications.filter((n) => {
    const at = Date.parse(n?.at);
    return Number.isFinite(at) && at > mark;
  }).length;
}

/** Is this one of the new ones? Used to mark the rows in the menu. */
export function isUnread(notification, seenAt = null) {
  return unreadCount([notification], seenAt) === 1;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago, in the words somebody would use out loud.
 *
 * Stops at a week and gives the date instead: "23 days ago" is arithmetic the
 * reader then has to do again to find out whether that was before or after the
 * meeting they are thinking of.
 */
export function relativeTime(at, now = Date.now()) {
  const then = Date.parse(at);
  if (!Number.isFinite(then)) return '';
  const gap = now - then;
  if (gap < MINUTE) return 'just now';
  if (gap < HOUR) {
    const n = Math.floor(gap / MINUTE);
    return `${n} minute${n === 1 ? '' : 's'} ago`;
  }
  if (gap < DAY) {
    const n = Math.floor(gap / HOUR);
    return `${n} hour${n === 1 ? '' : 's'} ago`;
  }
  if (gap < 7 * DAY) {
    const n = Math.floor(gap / DAY);
    return `${n} day${n === 1 ? '' : 's'} ago`;
  }
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * What the badge shows.
 *
 * Capped, because a three-digit count in a 16px circle is a smudge, and the
 * difference between 99 and 140 unread shares changes nothing anybody does.
 */
export function badgeLabel(count) {
  if (!(count > 0)) return '';
  return count > 99 ? '99+' : String(count);
}
