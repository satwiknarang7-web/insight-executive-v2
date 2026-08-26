/**
 * Share a saved analysis with another user, by username or by email address.
 *
 * The name is resolved server-side; a caller cannot share with a user id they
 * guessed, only with someone who has published a username or holds the address
 * they typed.
 */
import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '../../../../../lib/vault/supabase.server';
import { Invalid, LibraryUnavailable, NotFound, listShares, shareAnalysis, unshareAnalysis } from '../../../../../lib/analyses.server';

export const runtime = 'nodejs';

function fail(error) {
  if (error instanceof Invalid) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof NotFound) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof LibraryUnavailable) {
    return NextResponse.json({ error: error.message, setupRequired: true }, { status: 503 });
  }
  console.error('[analyses/share]', error.message);
  return NextResponse.json({ error: `That did not work: ${error.message}` }, { status: 500 });
}

export async function GET(request, { params }) {
  const { id } = await params;
  try {
    return NextResponse.json({ shares: await listShares(id) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request, { params }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not configured.' }, { status: 501 });
  const { id } = await params;
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  try {
    // `handle` is the older field name. Kept so a page served before this
    // deploy does not start failing against the route served after it.
    const shared = await shareAnalysis(id, body?.recipient ?? body?.handle);
    return NextResponse.json({ shared, shares: await listShares(id) });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const userId = new URL(request.url).searchParams.get('user');
  if (!userId) return NextResponse.json({ error: 'A user is required.' }, { status: 400 });
  try {
    await unshareAnalysis(id, userId);
    return NextResponse.json({ shares: await listShares(id) });
  } catch (error) {
    return fail(error);
  }
}
