/**
 * Revoke one connection.
 *
 * DELETE rather than a PATCH, because that is what the user is doing; the
 * repository turns it into a revocation that keeps the metadata row so the
 * audit trail still has something to point at.
 */

// CONNECTIONS DISABLED (temporary)
// Revocation is off along with the rest of the connection feature.
// To restore: delete the stub below and uncomment the original code.

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function disabled() {
  return NextResponse.json(
    { error: 'Database connections are temporarily disabled on this deployment.' },
    { status: 503 }
  );
}

export async function DELETE() {
  return disabled();
}

/* ---- original implementation, commented out ----

import { NextResponse } from 'next/server';
import { revokeConnection, Forbidden, NotFound } from '../../../../lib/vault/connections';
import { isSupabaseConfigured, currentUser } from '../../../../lib/vault/supabase.server';

export const runtime = 'nodejs';

export async function DELETE(request, { params }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'The connection vault is not configured.' }, { status: 501 });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { id } = await params;
  const orgId = new URL(request.url).searchParams.get('org');
  if (!orgId) return NextResponse.json({ error: 'An organisation is required.' }, { status: 400 });

  try {
    return NextResponse.json(await revokeConnection(id, { orgId }));
  } catch (error) {
    if (error instanceof Forbidden) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof NotFound) return NextResponse.json({ error: error.message }, { status: 404 });
    console.error('[connections/revoke]', error);
    return NextResponse.json({ error: 'That connection could not be revoked.' }, { status: 500 });
  }
}

---- end original ---- */
