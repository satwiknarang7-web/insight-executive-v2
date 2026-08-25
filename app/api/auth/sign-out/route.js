/**
 * End the session on this browser.
 *
 * The trusted-device cookie deliberately survives. Signing out says "not right
 * now"; it does not say "this computer is no longer mine" — that is what
 * deleting the account, or the 30-day expiry, is for.
 */
import { NextResponse } from 'next/server';
import { signOut } from '../../../../lib/auth/accounts.server';

export const runtime = 'nodejs';

export async function POST() {
  await signOut();
  return NextResponse.json({ ok: true });
}
