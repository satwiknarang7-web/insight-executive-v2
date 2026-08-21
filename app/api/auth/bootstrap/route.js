/**
 * Called once after sign-in to make sure the user has an organisation.
 *
 * Organisation creation cannot happen from the browser — `public.organizations`
 * has no INSERT policy, deliberately — so it happens here, with the service
 * role, and only for a user who has none.
 */
import { NextResponse } from 'next/server';
import { ensureOrganization, isSupabaseConfigured } from '../../../../lib/vault/supabase.server';

export const runtime = 'nodejs';

export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'The vault is not configured.' }, { status: 501 });
  }
  try {
    const org = await ensureOrganization();
    if (!org) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
    return NextResponse.json({ organization: org });
  } catch (error) {
    console.error('[auth/bootstrap]', error);
    return NextResponse.json({ error: 'Could not set up your organisation.' }, { status: 500 });
  }
}
