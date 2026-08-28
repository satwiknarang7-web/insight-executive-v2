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
  /**
   * Everything except the places this app genuinely serves static files from.
   *
   * This list decides which requests reach the code above, so anything it
   * excludes is not merely skipping a session refresh — it is skipping the
   * sign-in check. That makes it part of the auth surface, and it has to be
   * read as one.
   *
   * It used to end with `.*\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$`, which was
   * wrong twice over.
   *
   * The dot was not escaped. In a single-quoted JavaScript string `\.` is just
   * `.`, so Next received a pattern matching ANY character before those
   * letters — confirmed in the compiled matcher the build emits. `/insight/[id]`
   * is a real dynamic route, so `/insight/abcpng` skipped the door outright.
   * Escaping it would still have left `/insight/abc.png` open, because an id
   * may contain a dot.
   *
   * And it was guarding nothing. The only files this app serves out of
   * `public/` are the four optional avatar portraits, and `avatars/` has its
   * own entry. Build assets — including anything imported through the bundler —
   * are under `_next/static`.
   *
   * So the extension test is gone rather than repaired: a rule that excludes
   * paths by how they end cannot tell an asset from a route whose id happens to
   * end the same way. What is left names locations instead, which a route
   * cannot accidentally resemble.
   *
   * This fails closed. A static file added to `public/` that a signed-out
   * visitor must load — something on the sign-in page — has to be added here
   * deliberately. Nothing needs it today: neither `/sign-in` nor the root
   * layout references an image or a font file.
   */
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|avatars/).*)'],
};
