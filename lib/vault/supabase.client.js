'use client';

/**
 * The browser Supabase client.
 *
 * Only ever created with the publishable key, which is designed to be public —
 * it ships in every bundle. Everything it can reach is gated by row-level
 * security, and the credential vault is not reachable from it at all: that
 * table lives in a schema PostgREST does not expose.
 */
import { createBrowserClient } from '@supabase/ssr';

let client = null;

export function supabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null; // Vault features stay hidden rather than crashing.
  client ||= createBrowserClient(url, key);
  return client;
}

/** Is the vault backend configured in this deployment? */
export function vaultAvailable() {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

/**
 * Is "Continue with Google" offered in this deployment?
 *
 * Off unless it is switched on, which is the opposite of how the rest of this
 * file reads and is the point. A Supabase project has the Google provider
 * disabled until somebody registers an OAuth client with Google and pastes the
 * credentials in; until that happens the button is live, reachable, and takes
 * the reader to a consent screen belonging to no project — a dead end with the
 * word Google on it, which is worse than not offering it at all. Nothing in
 * the keys above can tell the two apart: a configured Supabase and a
 * configured *provider* are different facts, and only the operator knows the
 * second one.
 *
 * So it is declared. Set `NEXT_PUBLIC_GOOGLE_SIGN_IN=1` once the provider is
 * actually enabled in the Supabase dashboard, and the button comes back; leave
 * it unset and email sign-in is the only door, which is the one this product
 * is built around anyway.
 *
 * Read from `process.env` by its full name rather than through a variable:
 * Next inlines `NEXT_PUBLIC_*` into the bundle by matching the literal text,
 * so anything computed would arrive as undefined in the browser.
 */
export function googleSignInEnabled() {
  const flag = process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN;
  return flag === '1' || flag === 'true';
}
