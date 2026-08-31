/**
 * The numbers the root portal shows.
 *
 * Gated on the signed root cookie and nothing else — a product session grants
 * no access here, and this grants none there.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ROOT_COOKIE, isRootConfigured, verifyRootSession } from '../../../../lib/auth/root.server';
import { countUsers } from '../../../../lib/auth/rootStats.server';
import { isSupabaseConfigured } from '../../../../lib/vault/supabase.server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET() {
  if (!isRootConfigured()) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const store = await cookies();
  if (!verifyRootSession(store.get(ROOT_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Accounts are not configured on this deployment, so there is nothing to count.' },
      { status: 501 }
    );
  }

  try {
    return NextResponse.json({ users: await countUsers() });
  } catch (error) {
    console.error('[root/stats]', error.message);
    return NextResponse.json({ error: 'Those numbers could not be read.' }, { status: 500 });
  }
}
