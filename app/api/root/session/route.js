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
import { cookies } from 'next/headers';
import {
  ROOT_COOKIE,
  isRootConfigured,
  issueRootSession,
  rootCookieOptions,
  verifyRootCredentials,
  verifyRootSession,
} from '../../../../lib/auth/root.server';
import { clientKey, reset, take } from '../../../../lib/auth/rateLimit';

export const runtime = 'nodejs';

const notHere = () => NextResponse.json({ error: 'Not found.' }, { status: 404 });

export async function POST(request) {
  if (!isRootConfigured()) return notHere();

  /**
   * Slow a guesser without stranding the operator.
   *
   * This started at five attempts per fifteen minutes, on the reasoning that
   * there is exactly one valid credential here so anything more is a guess.
   * That reasoning ignored who else hits this door: the one person who is
   * *supposed* to, typing a long password by hand, possibly against a typo in
   * their own configuration. They spent five attempts finding that out and then
   * waited a quarter of an hour to try the fix.
   *
   * The window does the work instead of the count. Eight attempts in five
   * minutes is still nowhere near enough to search a real password, and a
   * fumble now costs minutes rather than the rest of the afternoon.
   */
  const limitKey = clientKey(request, 'root');
  const limit = take(limitKey, { limit: 8, windowMs: 5 * 60 * 1000 });
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

  // A good sign-in clears its own strikes, so the attempts it took to get here
  // are not still counted against the next one.
  reset(limitKey);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ROOT_COOKIE, issueRootSession(), rootCookieOptions());
  return response;
}

/**
 * Is there a portal here, and am I already in it?
 *
 * The sign-in page asks this so it can offer a way through to the operator
 * door. Without it the portal was reachable only by typing `/root` from
 * memory — which is how someone with the right credentials ended up putting
 * them into the product's sign-in form instead and landing in the normal app.
 *
 * Unlike the other methods this answers 200 either way rather than 404. It
 * discloses nothing new: `POST` and the stats route already answer 404 when
 * unconfigured and 401 when not, so whether a portal exists here is visible to
 * anyone who asks. What it adds is the ability to *say so* to the one person
 * who needs to know.
 */
export async function GET() {
  if (!isRootConfigured()) return NextResponse.json({ configured: false, signedIn: false });

  const store = await cookies();
  return NextResponse.json({
    configured: true,
    signedIn: verifyRootSession(store.get(ROOT_COOKIE)?.value),
  });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ROOT_COOKIE, '', { ...rootCookieOptions(), maxAge: 0 });
  return response;
}
