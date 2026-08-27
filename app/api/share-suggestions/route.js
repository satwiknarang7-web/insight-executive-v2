/**
 * Who to suggest in the "share with" box.
 *
 * Two lists: the people this user has shared with before, and — once two
 * characters have been typed — usernames matching what they have typed so far.
 * Only what someone published about themselves is returned, which is the
 * username they chose and the display name they typed. Never an address.
 */
import { NextResponse } from 'next/server';
import { currentUser, isSupabaseConfigured } from '../../../lib/vault/supabase.server';
import { LibraryUnavailable, shareSuggestions } from '../../../lib/analyses.server';

export const runtime = 'nodejs';

export async function GET(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ recent: [], matches: [] });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const query = new URL(request.url).searchParams.get('q') || '';
  try {
    return NextResponse.json(await shareSuggestions({ query }));
  } catch (error) {
    // A suggestion list is a convenience. If the tables are not there, or the
    // query fails, the box still works — it just stops offering names.
    if (!(error instanceof LibraryUnavailable)) {
      console.error('[share-suggestions]', error.message);
    }
    return NextResponse.json({ recent: [], matches: [] });
  }
}
