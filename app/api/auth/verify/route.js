/**
 * Step two, for both flows: claim the code, and only then issue a session.
 *
 * This is the single place a session is created. A correct code is the last
 * thing that has to be true; the password was already checked at step one, and
 * the challenge row is what carries that fact forward — it cannot be forged,
 * because its id is a random uuid handed only to the caller who passed step one.
 */
import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '../../../../lib/vault/supabase.server';
import { confirmUser, mintSession } from '../../../../lib/auth/accounts.server';
import { claimChallenge, trustDevice } from '../../../../lib/auth/challenges.server';
import { authFailure } from '../../../../lib/auth/failures';
import { DEVICE_COOKIE, TRUSTED_DEVICE_TTL_MS } from '../../../../lib/auth/otp';
import { clientKey, take } from '../../../../lib/auth/rateLimit';

export const runtime = 'nodejs';

/** What to tell the user for each way a challenge can be unusable. */
const REASONS = {
  missing: 'That code request has expired. Start again.',
  consumed: 'That code has already been used. Start again.',
  expired: 'That code has expired. Ask for a new one.',
  locked: 'Too many incorrect codes. Start again.',
  wrong: 'That code is not right.',
};

export async function POST(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Accounts are not configured on this deployment.' }, { status: 501 });
  }

  const limit = take(clientKey(request, 'verify'), { limit: 20, windowMs: 15 * 60 * 1000 });
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

  const code = String(body?.code || '').replace(/\D/g, '');
  if (code.length !== 6) return NextResponse.json({ error: 'Enter the six-digit code.' }, { status: 400 });

  let claim;
  try {
    claim = await claimChallenge(body?.challengeId, code);
  } catch (error) {
    // Checking the code is the one step that cannot degrade to a guess, so a
    // failure here is reported rather than treated as a wrong code.
    const known = authFailure(error, 'auth/verify');
    if (known) return known;
    console.error('[auth/verify]', error.message);
    return NextResponse.json({ error: 'That code could not be checked.' }, { status: 502 });
  }

  if (!claim.ok) {
    const message = REASONS[claim.reason] || 'That code could not be checked.';
    const withCount =
      claim.reason === 'wrong' && claim.remaining > 0
        ? `${message} ${claim.remaining} ${claim.remaining === 1 ? 'try' : 'tries'} left.`
        : message;
    // 'wrong' is a failed guess (401); anything else means the challenge itself
    // is finished, and the client has to start the flow over (410).
    return NextResponse.json({ error: withCount, restart: claim.reason !== 'wrong' }, {
      status: claim.reason === 'wrong' ? 401 : 410,
    });
  }

  const { challenge } = claim;

  try {
    // Finishing a sign-up is what marks the address as genuinely theirs.
    if (challenge.purpose === 'signup' && challenge.user_id) {
      await confirmUser(challenge.user_id);
    }

    const user = await mintSession(challenge.email);
    const response = NextResponse.json({ ok: true, email: challenge.email });

    // Remembering the browser is a convenience on top of a session that has
    // already been issued. If it fails, the user is still signed in, and losing
    // the whole sign-in over it would be the wrong trade.
    if (body?.remember && user?.id) {
      try {
        const token = await trustDevice(user.id, request.headers.get('user-agent'));
        response.cookies.set(DEVICE_COOKIE, token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          maxAge: Math.floor(TRUSTED_DEVICE_TTL_MS / 1000),
        });
      } catch (error) {
        console.error('[auth/verify] this browser could not be remembered:', error.message);
      }
    }

    return response;
  } catch (error) {
    console.error('[auth/verify]', error.message);
    return NextResponse.json({ error: 'The code was right, but signing in failed.' }, { status: 500 });
  }
}
