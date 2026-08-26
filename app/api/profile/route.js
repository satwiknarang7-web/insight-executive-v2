/** The signed-in user's public handle — how other people share with them. */
import { NextResponse } from 'next/server';
import { currentUser, isSupabaseConfigured } from '../../../lib/vault/supabase.server';
import { Invalid, LibraryUnavailable, myProfile, setHandle, suggestHandle } from '../../../lib/analyses.server';

export const runtime = 'nodejs';

export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ profile: null });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  try {
    const profile = await myProfile();
    return NextResponse.json({ profile, suggestion: profile ? null : suggestHandle(user.email) });
  } catch (error) {
    console.error('[profile]', error.message);
    return NextResponse.json({ error: 'Could not read your profile.' }, { status: 500 });
  }
}

export async function PUT(request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not configured.' }, { status: 501 });
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  try {
    return NextResponse.json({ profile: await setHandle({ handle: body?.handle, displayName: body?.displayName }) });
  } catch (error) {
    if (error instanceof Invalid) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('[profile/put]', error.message);
    return NextResponse.json({ error: 'Could not save your handle.' }, { status: 500 });
  }
}
