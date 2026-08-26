/** Open or delete one saved analysis. Row-level security decides visibility. */
import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '../../../../lib/vault/supabase.server';
import { LibraryUnavailable, NotFound, deleteAnalysis, getAnalysis, listShares } from '../../../../lib/analyses.server';

export const runtime = 'nodejs';

export async function GET(request, { params }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not configured.' }, { status: 501 });
  const { id } = await params;
  try {
    const analysis = await getAnalysis(id);
    // Only the owner has anyone to manage, so only they pay for the lookup.
    const shares = await listShares(id).catch(() => []);
    return NextResponse.json({ analysis, shares });
  } catch (error) {
    if (error instanceof NotFound) return NextResponse.json({ error: error.message }, { status: 404 });
    console.error('[analyses/get]', error.message);
    return NextResponse.json({ error: 'That analysis could not be opened.' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Not configured.' }, { status: 501 });
  const { id } = await params;
  try {
    return NextResponse.json(await deleteAnalysis(id));
  } catch (error) {
    if (error instanceof NotFound) return NextResponse.json({ error: error.message }, { status: 404 });
    console.error('[analyses/delete]', error.message);
    return NextResponse.json({ error: 'That analysis could not be deleted.' }, { status: 500 });
  }
}
