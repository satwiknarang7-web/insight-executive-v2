/**
 * Send another code for a challenge already in flight.
 *
 * Rotating the code rather than opening a new challenge is deliberate: the
 * attempt counter travels with the challenge, so "resend" cannot be used to
 * reset the five-guess cap.
 */
import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '../../../../lib/vault/supabase.server';
import { getChallenge, rotateCode } from '../../../../lib/auth/challenges.server';
import { isMailerConfigured, sendCodeEmail } from '../../../../lib/auth/mailer.server';
import { authFailure } from '../../../../lib/auth/failures';
import { canResend, challengeState, resendWaitSeconds } from '../../../../lib/auth/otp';
import { clientKey, take } from '../../../../lib/auth/rateLimit';

export const runtime = 'nodejs';

export async function POST(request) {
  if (!isSupabaseConfigured() || !isMailerConfigured()) {
    return NextResponse.json({ error: 'Email is not configured on this deployment.' }, { status: 501 });
  }

  const limit = take(clientKey(request, 'resend'), { limit: 6, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many code requests. Try again in ${limit.retryAfterSeconds} seconds.` },
      { status: 429 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  let challenge;
  try {
    challenge = await getChallenge(body?.challengeId);
  } catch (error) {
    const known = authFailure(error, 'auth/resend');
    if (known) return known;
    console.error('[auth/resend]', error.message);
    return NextResponse.json({ error: 'Another code could not be sent.' }, { status: 502 });
  }

  const state = challengeState(challenge);
  // An expired challenge may still be resent — the code is being replaced
  // anyway. A consumed or locked one may not.
  if (state === 'missing' || state === 'consumed' || state === 'locked') {
    return NextResponse.json({ error: 'That code request is no longer active.', restart: true }, { status: 410 });
  }

  if (!canResend(challenge)) {
    return NextResponse.json(
      { error: `Wait ${resendWaitSeconds(challenge)} seconds before asking for another code.` },
      { status: 429 }
    );
  }

  let code;
  try {
    code = await rotateCode(challenge);
  } catch (error) {
    const known = authFailure(error, 'auth/resend');
    if (known) return known;
    console.error('[auth/resend]', error.message);
    return NextResponse.json({ error: 'Another code could not be sent.' }, { status: 502 });
  }

  const sent = await sendCodeEmail({ to: challenge.email, code, purpose: challenge.purpose });
  if (!sent.ok) {
    console.error('[auth/resend] email failed:', sent.reason);
    return NextResponse.json(
      { error: `The code email could not be sent (${sent.reason || 'unknown error'}).` },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
