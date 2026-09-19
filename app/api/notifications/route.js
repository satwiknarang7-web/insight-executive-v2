/**
 * The bell: what is in it, and marking it read.
 *
 * Never fails loudly. Every page in this app polls this route, and a
 * deployment with no Supabase, or one whose migrations are half applied, has
 * no notifications rather than a problem — see `absent` in
 * `lib/notifications.server.js`. An empty bell on a working app is correct; a
 * red banner in the sidebar of one is not.
 *
 * No rate limit. It reads two small indexed rows through the caller's own
 * session and bills nobody, which is the opposite of every route in
 * `lib/routeLimits.js`.
 */
import { NextResponse } from 'next/server';
import { listNotifications, markNotificationsSeen } from '../../../lib/notifications.server';

export const runtime = 'nodejs';
// Notifications are per-session and change between requests; a cached answer
// would show one person's bell to the next.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await listNotifications());
  } catch (error) {
    console.error('[notifications]', error.message);
    return NextResponse.json({ notifications: [], unread: 0, seenAt: null });
  }
}

export async function POST() {
  try {
    return NextResponse.json(await markNotificationsSeen());
  } catch (error) {
    console.error('[notifications/seen]', error.message);
    return NextResponse.json({ seenAt: null });
  }
}
