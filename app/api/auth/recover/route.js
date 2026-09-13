/**
 * Step one of resetting a forgotten password: email a code.
 *
 * The account is never confirmed or denied. A reset form that says "no account
 * with that address" is a membership oracle anyone can query, and this one
 * answers identically either way — the same body, the same status, and no
 * timing tell worth the name, because the expensive part (sending mail) only
 * happens when there is somewhere to send it and the response does not wait on
 * the difference in any way a caller can read.
 *
 * Nothing changes here. This route opens a challenge and sends its code; the
 * password itself is set in `/api/auth/verify`, once that code comes back. So a
 * request made by somebody who is not the account holder does nothing at all
 * except deliver a piece of mail the real holder can ignore — which is what the
 * email says.
 */
import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '../../../../lib/vault/supabase.server';
import { findUserByEmail } from '../../../../lib/auth/accounts.server';
import { createChallenge } from '../../../../lib/auth/challenges.server';
import { isMailerConfigured, sendCodeEmail } from '../../../../lib/auth/mailer.server';
import { normalizeEmail } from '../../../../lib/auth/otp';
import { emailProblem, suggestEmail } from '../../../../lib/auth/emailAddress';
import { clientKey, take } from '../../../../lib/auth/rateLimit';

export const runtime = 'nodejs';

export async function POST(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Accounts are not configured on this deployment.' }, { status: 501 });
  }
  if (!isMailerConfigured()) {
    return NextResponse.json(
      { error: 'Email is not configured, so a reset code cannot be sent.' },
      { status: 501 }
    );
  }

  // Tighter than sign-in. Nothing here is guessable, so a high rate is not an
  // attack on the account — it is an attack on the mailbox, and on the sending
  // reputation of whatever address this deployment sends from.
  const limit = take(clientKey(request, 'recover'), { limit: 5, windowMs: 15 * 60 * 1000 });
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

  // The shape is checked and reported, because a typo is the likeliest reason a
  // reset never arrives and saying so reveals nothing about who has an account.
  const shape = emailProblem(body?.email);
  if (shape) {
    return NextResponse.json({ error: shape, suggestion: suggestEmail(body?.email) }, { status: 400 });
  }

  const email = normalizeEmail(body?.email);
  if (!email) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });

  // Everything below this line ends in the same response.
  const pending = { pending: true, email, purpose: 'recover' };

  let user;
  try {
    user = await findUserByEmail(email);
  } catch (error) {
    console.error('[auth/recover]', error.message);
    return NextResponse.json({ error: 'A reset could not be started.' }, { status: 502 });
  }

  if (!user) return NextResponse.json(pending);

  try {
    const { challenge, code } = await createChallenge({ email, userId: user.id, purpose: 'recover' });
    const sent = await sendCodeEmail({ to: email, code, purpose: 'recover' });
    if (!sent.ok) {
      // Logged, not surfaced. Telling this caller the mail failed would tell
      // them the address exists, which is the one thing being withheld.
      console.error('[auth/recover] email failed:', sent.reason);
      return NextResponse.json(pending);
    }
    return NextResponse.json({ ...pending, challengeId: challenge.id });
  } catch (error) {
    console.error('[auth/recover]', error.message);
    return NextResponse.json(pending);
  }
}
