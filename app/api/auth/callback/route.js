/**
 * Where an OAuth provider sends the browser back to.
 *
 * Google does not return a session. It returns the browser to Supabase, which
 * returns it here with a single-use `code`, and this exchanges that code for
 * the session cookies — which is why it has to be a route handler rather than
 * anything rendered: a Server Component cannot write cookies, and the session
 * has to exist before the next navigation is gated by the middleware.
 *
 * It sits under `/api/auth/`, which `middleware.js` already treats as public.
 * That is load-bearing rather than incidental: the caller has no session yet by
 * definition, so a gate here would refuse the one request that creates one.
 *
 * Nothing about the flow trusts this endpoint's caller. The code is opaque,
 * single-use, and only Supabase can redeem it; an attacker replaying one gets
 * an error rather than a session. What does need care is the `next` parameter,
 * which is the one attacker-controlled string here — see below.
 */
import { NextResponse } from 'next/server';
import { isSupabaseConfigured, userClient } from '../../../../lib/vault/supabase.server';
import { safeNext } from '../../../../lib/auth/redirectTarget';

export const runtime = 'nodejs';

/** Back to sign-in, saying what went wrong, rather than to a blank page. */
function refuse(request, reason) {
  const target = request.nextUrl.clone();
  target.pathname = '/sign-in';
  target.search = '';
  target.searchParams.set('error', reason);
  return NextResponse.redirect(target);
}

export async function GET(request) {
  if (!isSupabaseConfigured()) return refuse(request, 'not-configured');

  const code = request.nextUrl.searchParams.get('code');
  // The provider reports its own failures here — a declined consent screen
  // arrives as `error=access_denied` with no code at all.
  const providerError = request.nextUrl.searchParams.get('error_description')
    || request.nextUrl.searchParams.get('error');
  if (providerError) return refuse(request, 'provider');
  if (!code) return refuse(request, 'no-code');

  const supabase = await userClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // The message can name the project and the grant type, so it is logged
    // rather than returned: the visitor is told the exchange failed and the
    // operator can read why.
    console.error('[auth/callback]', error.message);
    return refuse(request, 'exchange');
  }

  const target = request.nextUrl.clone();
  target.pathname = safeNext(request.nextUrl.searchParams.get('next'));
  target.search = '';
  return NextResponse.redirect(target);
}
