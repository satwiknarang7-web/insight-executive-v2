/**
 * The root portal's sign-in and sign-out.
 *
 * Separate from `/api/auth/*` on purpose: this grants nothing inside the
 * product, only the ability to read operational counts. It is off entirely
 * unless ROOT_EMAIL and ROOT_PASSWORD are both set, and it answers a
 * misconfigured deployment with 404 rather than 401 — an unconfigured portal
 * should look like a feature that does not exist, not one waiting to be guessed
 * at.
 */
import { NextResponse } from 'next/server';
import {
  ROOT_COOKIE,
  isRootConfigured,
  issueRootSession,
  rootCookieOptions,
  verifyRootCredentials,
} from '../../../../lib/auth/root.server';
import { clientKey, take } from '../../../../lib/auth/rateLimit';

export const runtime = 'nodejs';

const notHere = () => NextResponse.json({ error: 'Not found.' }, { status: 404 });

export async function POST(request) {
  if (!isRootConfigured()) return notHere();

  // Tighter than the product's own sign-in: there is exactly one valid
  // credential here, so anything past a handful of attempts is a guess.
  const limit = take(clientKey(request, 'root'), { limit: 5, windowMs: 15 * 60 * 1000 });
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

  if (!verifyRootCredentials(body?.email, body?.password)) {
    // One message for both halves. Saying which was wrong turns the form into a
    // way to confirm the operator's address.
    return NextResponse.json({ error: 'Those credentials were not accepted.' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ROOT_COOKIE, issueRootSession(), rootCookieOptions());
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ROOT_COOKIE, '', { ...rootCookieOptions(), maxAge: 0 });
  return response;
}
