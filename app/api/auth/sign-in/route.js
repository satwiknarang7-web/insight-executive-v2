/**
 * Step one of signing in: check the password, then decide whether a code is
 * needed at all.
 *
 * A browser that has passed a code before carries a trust token, and skips
 * straight to a session. Everything else gets a code by email. The password is
 * verified either way, and on its own is never enough to obtain a session.
 */
import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '../../../../lib/vault/supabase.server';
import { findUserByEmail, mintSession, verifyPassword } from '../../../../lib/auth/accounts.server';
import { createChallenge, deviceIsTrusted } from '../../../../lib/auth/challenges.server';
import { isMailerConfigured, sendCodeEmail } from '../../../../lib/auth/mailer.server';
import { authFailure } from '../../../../lib/auth/failures';
import { DEVICE_COOKIE, normalizeEmail } from '../../../../lib/auth/otp';
import { emailProblem, suggestEmail } from '../../../../lib/auth/emailAddress';
import { clientKey, reset, take } from '../../../../lib/auth/rateLimit';

export const runtime = 'nodejs';

export async function POST(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Accounts are not configured on this deployment.' }, { status: 501 });
  }

  const limit = take(clientKey(request, 'signin'), { limit: 10, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.` },
      { status: 429 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  // The same strict rules the sign-up form uses. Only the shape, though: no
  // DNS lookup here. The account already exists, its domain was checked when it
  // was created, and a per-sign-in network round trip would slow the hot path
  // to tell us something we cannot act on anyway.
  const shape = emailProblem(body?.email);
  if (shape) {
    return NextResponse.json({ error: shape, suggestion: suggestEmail(body?.email) }, { status: 400 });
  }

  const email = normalizeEmail(body?.email);
  if (!email || !body?.password) {
    return NextResponse.json({ error: 'Enter your email and password.' }, { status: 400 });
  }

  const check = await verifyPassword(email, body.password);

  if (check.status === 'error') {
    console.error('[auth/sign-in]', check.message);
    return NextResponse.json({ error: 'Sign-in is temporarily unavailable.' }, { status: 502 });
  }
  if (check.status === 'invalid') {
    // Deliberately the same message for a wrong password and an unknown
    // address, so this endpoint cannot be used to enumerate accounts.
    return NextResponse.json({ error: 'That email and password do not match.' }, { status: 401 });
  }

  if (!isMailerConfigured()) {
    return NextResponse.json(
      { error: 'Email is not configured, so a sign-in code cannot be sent.' },
      { status: 501 }
    );
  }

  // The sign-up was abandoned before the code. The password was right, so send
  // a fresh confirmation rather than a sign-in code.
  if (check.status === 'unconfirmed') {
    const user = await findUserByEmail(email);
    if (!user) return NextResponse.json({ error: 'That email and password do not match.' }, { status: 401 });
    return issueCode({ email, userId: user.id, purpose: 'signup' });
  }

  // Known browser: the second factor was already satisfied here, within its
  // window, for this same account.
  const deviceToken = request.cookies.get(DEVICE_COOKIE)?.value;
  if (deviceToken && (await deviceIsTrusted(deviceToken, check.user.id))) {
    try {
      await mintSession(email);
    } catch (error) {
      console.error('[auth/sign-in]', error.message);
      return NextResponse.json({ error: 'Sign-in is temporarily unavailable.' }, { status: 502 });
    }
    reset(clientKey(request, 'signin'));
    return NextResponse.json({ verified: true, trustedDevice: true });
  }

  return issueCode({ email, userId: check.user.id, purpose: 'signin' });
}

/**
 * Open a challenge and email its code.
 *
 * Both paths above end here, and both can fail the same two ways: the auth
 * migration is missing, or the mail server refused. Neither is the user's
 * fault, and neither should reach them as an unexplained 500 — which is what
 * happened until this was wrapped, because `createChallenge` throws.
 */
async function issueCode({ email, userId, purpose }) {
  let challenge;
  let code;
  try {
    ({ challenge, code } = await createChallenge({ email, userId, purpose }));
  } catch (error) {
    const known = authFailure(error, 'auth/sign-in');
    if (known) return known;
    console.error('[auth/sign-in]', error.message);
    return NextResponse.json({ error: 'Sign-in is temporarily unavailable.' }, { status: 502 });
  }

  const sent = await sendCodeEmail({ to: email, code, purpose });
  if (!sent.ok) {
    console.error('[auth/sign-in] email failed:', sent.reason);
    return NextResponse.json(
      { error: `The code email could not be sent (${sent.reason || 'unknown error'}).` },
      { status: 502 }
    );
  }

  return NextResponse.json({ pending: true, challengeId: challenge.id, email, purpose });
}
