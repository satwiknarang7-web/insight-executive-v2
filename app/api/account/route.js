/**
 * Delete the signed-in account.
 *
 * Gated on the caller retyping their own address. A single click is too little
 * friction for something with no undo: every stored database credential under
 * this account is destroyed with it, and re-registering the same address gets a
 * new, empty account rather than the old one back.
 */
import { NextResponse } from 'next/server';
import { currentUser, isSupabaseConfigured } from '../../../lib/vault/supabase.server';
import { deleteAccount, signOut } from '../../../lib/auth/accounts.server';
import { purgeChallenges } from '../../../lib/auth/challenges.server';
import { sendAccountDeletedEmail } from '../../../lib/auth/mailer.server';
import { DEVICE_COOKIE, normalizeEmail } from '../../../lib/auth/otp';

export const runtime = 'nodejs';

export async function DELETE(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Accounts are not configured on this deployment.' }, { status: 501 });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  // Confirm against the session's own address, never one supplied in the body.
  const typed = normalizeEmail(body?.confirmEmail);
  const mine = normalizeEmail(user.email);
  if (!typed || typed !== mine) {
    return NextResponse.json({ error: 'Type your email address exactly to confirm.' }, { status: 400 });
  }

  try {
    const result = await deleteAccount(user.id);
    await purgeChallenges(mine);
    // Best-effort: the account is already gone if this fails.
    await sendAccountDeletedEmail({ to: mine }).catch(() => {});
    await signOut();

    const response = NextResponse.json({ ok: true, ...result });
    // The device trust rows went with the user; clear the cookie that pointed
    // at them so the next visitor here starts clean.
    response.cookies.set(DEVICE_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  } catch (error) {
    console.error('[account/delete]', error.message);
    return NextResponse.json({ error: 'That account could not be deleted.' }, { status: 500 });
  }
}
