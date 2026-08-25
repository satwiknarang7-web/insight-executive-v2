/**
 * Keeps the Supabase session fresh, and decides who is allowed past the door.
 *
 * Two jobs, in this order:
 *
 * 1. Refresh the session cookie. Server Components cannot write cookies, so a
 *    session that expires mid-visit would silently sign the user out on their
 *    next navigation. The middleware is the one place in the request path that
 *    can refresh and re-set it.
 *
 * 2. Send signed-out visitors to /sign-in. The product now leads with an
 *    account: you sign in, and then you choose a data source. Before this, the
 *    upload page was the front door and the account was an optional extra for
 *    saving connections.
 *
 * Both jobs are skipped entirely when Supabase is not configured. That is
 * load-bearing, not a nicety: gating on an auth system that does not exist
 * would make such a deployment unreachable, with no way in and no way to see
 * why. A deployment with no Supabase keys keeps the old behaviour — files are
 * parsed in the browser, no account needed.
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Paths a signed-out visitor may still reach.
 *
 * The auth API has to stay open or signing in could never happen, and the
 * sign-in page itself obviously cannot require a session. Everything else on
 * the site is behind the door.
 */
function isPublic(pathname) {
  return (
    pathname === '/sign-in' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  );
}

export async function middleware(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !url.startsWith('http')) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() revalidates against the auth server; getSession() would trust a
  // cookie the client could have edited.
  const { data } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  if (!data?.user && !isPublic(pathname)) {
    // A page request is redirected so the visitor sees the sign-in screen; an
    // API request gets a 401, because redirecting a fetch to an HTML page turns
    // "you are signed out" into a JSON parse error at the call site.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
    }
    const target = request.nextUrl.clone();
    target.pathname = '/sign-in';
    target.search = '';
    // Where they were heading, so sign-in can put them back there.
    if (pathname !== '/') target.searchParams.set('next', pathname);
    return NextResponse.redirect(target);
  }

  // Someone already signed in has no use for the sign-in page.
  if (data?.user && pathname === '/sign-in') {
    const target = request.nextUrl.clone();
    target.pathname = '/';
    target.search = '';
    return NextResponse.redirect(target);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the worker bundle.
    '/((?!_next/static|_next/image|favicon.ico|avatars|.*\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
};
