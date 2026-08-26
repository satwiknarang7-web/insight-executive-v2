/**
 * Step one of creating an account: take the credentials, email a code.
 *
 * No session is issued here and none can be — the user is created with an
 * unconfirmed address, which Supabase refuses to sign in. The account only
 * becomes usable when `/api/auth/verify` proves the inbox belongs to whoever
 * typed the address.
 */
import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '../../../../lib/vault/supabase.server';
import { createUnconfirmedUser, deleteAccount, findUserByEmail } from '../../../../lib/auth/accounts.server';
import { authSchemaReady, createChallenge } from '../../../../lib/auth/challenges.server';
import { isMailerConfigured, sendCodeEmail } from '../../../../lib/auth/mailer.server';
import { authFailure, schemaMissingResponse } from '../../../../lib/auth/failures';
import { normalizeEmail, passwordProblem } from '../../../../lib/auth/otp';
import { domainOf, emailProblem, suggestEmail } from '../../../../lib/auth/emailAddress';
import { domainAcceptsMail } from '../../../../lib/auth/mailDomain.server';
import { clientKey, take } from '../../../../lib/auth/rateLimit';

export const runtime = 'nodejs';

export async function POST(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Accounts are not configured on this deployment.' }, { status: 501 });
  }
  if (!isMailerConfigured()) {
    return NextResponse.json(
      { error: 'Email is not configured, so a verification code cannot be sent.' },
      { status: 501 }
    );
  }

  const limit = take(clientKey(request, 'signup'), { limit: 5, windowMs: 15 * 60 * 1000 });
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

  // Checked strictly, and before anything is created. An address that cannot
  // receive mail becomes an account nobody can confirm, a code sent nowhere, and
  // a user who believes they signed up — so the cheapest place to catch it is
  // while they are still looking at the form.
  const shape = emailProblem(body?.email);
  if (shape) {
    const suggestion = suggestEmail(body?.email);
    return NextResponse.json({ error: shape, suggestion }, { status: 400 });
  }

  const email = normalizeEmail(body?.email);
  if (!email) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });

  const weak = passwordProblem(body?.password);
  if (weak) return NextResponse.json({ error: weak }, { status: 400 });

  // Does the domain accept mail? DNS can answer that; only the emailed code can
  // prove the mailbox itself exists, and it is about to. The check fails open,
  // so a resolver problem of ours never blocks a real sign-up.
  const domain = domainOf(email);
  const route = await domainAcceptsMail(domain);
  if (!route.deliverable) {
    const suggestion = suggestEmail(email);
    return NextResponse.json(
      {
        error: suggestion
          ? `No mail server answers for “${domain}”. Did you mean ${suggestion}?`
          : `No mail server answers for “${domain}”, so a verification code could not reach you there.`,
        suggestion,
      },
      { status: 400 }
    );
  }

  // Checked BEFORE the account is created. The code is stored before it is
  // emailed, so without this a missing migration creates the user, fails on the
  // next line, and presents to everyone as "the verification email never
  // arrived" — sending them to debug SMTP settings that are working fine.
  if (!(await authSchemaReady())) {
    console.error('[auth/sign-up] the auth migration has not been applied to this Supabase project');
    return schemaMissingResponse();
  }

  const created = await createUnconfirmedUser(email, body.password);

  if (created.status === 'error') {
    console.error('[auth/sign-up]', created.message);
    return NextResponse.json({ error: 'That account could not be created.' }, { status: 500 });
  }

  // An address that already exists must not be confirmed or denied here — that
  // turns the form into a membership oracle. The response is identical either
  // way; only an account that genuinely awaits confirmation gets a new code.
  let userId = created.status === 'ok' ? created.user.id : null;
  if (created.status === 'exists') {
    const existing = await findUserByEmail(email);
    if (!existing || existing.email_confirmed_at) {
      return NextResponse.json({ pending: true, email, alreadyRegistered: true });
    }
    userId = existing.id;
  }

  let challenge;
  let code;
  try {
    ({ challenge, code } = await createChallenge({ email, userId, purpose: 'signup' }));
  } catch (error) {
    // The account exists but has no way to be confirmed. Roll it back rather
    // than leave an unusable row that also blocks retrying the address.
    if (created.status === 'ok') await deleteAccount(created.user.id).catch(() => {});
    const known = authFailure(error, 'auth/sign-up');
    if (known) return known;
    console.error('[auth/sign-up]', error.message);
    return NextResponse.json({ error: 'That account could not be created.' }, { status: 500 });
  }

  const sent = await sendCodeEmail({ to: email, code, purpose: 'signup' });
  if (!sent.ok) {
    // Same reasoning: an account nobody can confirm is worse than no account.
    if (created.status === 'ok') await deleteAccount(created.user.id).catch(() => {});
    console.error('[auth/sign-up] email failed:', sent.reason);
    return NextResponse.json(
      { error: `The verification email could not be sent (${sent.reason || 'unknown error'}).` },
      { status: 502 }
    );
  }

  return NextResponse.json({ pending: true, challengeId: challenge.id, email });
}
