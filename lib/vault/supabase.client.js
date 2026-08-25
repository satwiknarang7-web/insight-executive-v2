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
