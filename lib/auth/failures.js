import { NextResponse } from 'next/server';
import { AuthSchemaMissing, SCHEMA_MISSING_ERROR } from './schema';

/**
 * The failures every auth route can hit, answered the same way in each.
 *
 * `AuthSchemaMissing` exists precisely so a deployment step is not mistaken for
 * a bug — but it was only ever caught in `/api/auth/sign-up`, which pre-checks
 * the schema. The other three routes let it escape, so a project without the
 * migration applied answered a correct password with an opaque 500 and no
 * indication that the fix is a SQL file sitting in the repo.
 *
 * Routes call `authFailure(error, scope)` and return whatever it hands back; a
 * null means the error is a genuine surprise and the route's own 500 stands.
 */

/** The 503 shown when the auth migration has not been applied. */
export function schemaMissingResponse() {
  return NextResponse.json({ error: SCHEMA_MISSING_ERROR }, { status: 503 });
}

/**
 * Map a thrown error to a response, or null if it is not one we recognise.
 *
 * Logs on the way past, because the message the user gets is deliberately less
 * specific than the one the operator needs.
 */
export function authFailure(error, scope) {
  if (error instanceof AuthSchemaMissing || error?.name === 'AuthSchemaMissing') {
    console.error(`[${scope}] the auth migration has not been applied to this Supabase project`);
    return schemaMissingResponse();
  }
  return null;
}
