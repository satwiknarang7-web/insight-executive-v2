/**
 * Keeps the Supabase session cookie fresh.
 *
 * Server Components cannot write cookies, so a session that expires mid-visit
 * would silently sign the user out on their next navigation. The middleware is
 * the one place in the request path that can refresh and re-set it.
 *
 * It is a no-op when the vault is not configured, so a deployment that only
 * ever uploads files never pays for auth it does not use.
 */
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

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
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the worker bundle.
    '/((?!_next/static|_next/image|favicon.ico|avatars|.*\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
};
