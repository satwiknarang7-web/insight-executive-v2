/**
 * Telling a missing deployment step apart from a bug.
 *
 * The auth tables live behind SECURITY DEFINER functions that a migration
 * creates. Until that migration is applied, every call fails — and fails in the
 * most misleading way available, because the code is stored before it is
 * emailed, so a missing function presents to the user as "the email never
 * arrived" and sends whoever is debugging it into the SMTP settings, which are
 * fine.
 *
 * Kept free of `server-only` and of any Supabase import so the classification
 * can be tested directly. Everything else in `lib/auth/*.server.js` can only
 * run inside Next.
 */

/** What the user is told, in the one place both the routes and the class read. */
export const SCHEMA_MISSING_ERROR =
  'This deployment is not finished: the sign-in tables are missing from the database. ' +
  'Run supabase/APPLY_TO_LIVE_PROJECT.sql in the Supabase SQL editor.';

/** Thrown when the database has not had the auth migration applied. */
export class AuthSchemaMissing extends Error {
  constructor() {
    super(SCHEMA_MISSING_ERROR);
    this.name = 'AuthSchemaMissing';
  }
}

/**
 * Does this PostgREST error mean the function does not exist?
 *
 * PGRST202 is the code, but it does not always survive the client library, so
 * the message is checked too. Deliberately narrow: a permission error, a bad
 * argument or a network failure are all real errors and must not be dressed up
 * as a deployment step.
 */
export function isSchemaMissing(error) {
  if (!error) return false;
  const text = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return text.includes('pgrst202') || text.includes('could not find the function');
}

/** Raise on a missing schema; return quietly on anything else. */
export function raiseIfSchemaMissing(error) {
  if (isSchemaMissing(error)) throw new AuthSchemaMissing();
}
