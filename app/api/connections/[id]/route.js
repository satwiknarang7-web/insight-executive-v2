/**
 * One connection: revoke it, or record what it points at.
 *
 * DELETE is a revocation rather than a delete, because that is what the user is
 * doing; the repository keeps the metadata row so the audit trail still has
 * something to point at.
 *
 * PATCH exists for the one thing that cannot be known when a connection is
 * created: Fabric's warehouse or lakehouse, whose SQL endpoint has to be
 * discovered with the credentials rather than typed alongside them. It amends
 * the non-secret config and nothing else — secret-shaped keys are stripped in
 * the repository, so this cannot become a second way to write a credential.
 */

import { NextResponse } from 'next/server';
import {
  revokeConnection,
  updateConnectionConfig,
  Forbidden,
  NotFound,
} from '../../../../lib/vault/connections';
import { configForItem } from '../../../../lib/connectors/fabricApi';
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

export async function PATCH(request, { params }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'The connection vault is not configured.' }, { status: 501 });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { id } = await params;
  const orgId = new URL(request.url).searchParams.get('org');
  if (!orgId) return NextResponse.json({ error: 'An organisation is required.' }, { status: 400 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  // Only one shape of amendment is accepted. Taking an arbitrary patch would
  // let a caller write any non-secret field on any connection, which is a
  // wider door than this feature needs.
  const patch = configForItem(body?.item);
  if (!patch) {
    return NextResponse.json(
      { error: 'Choose a warehouse or lakehouse to point this connection at.' },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json({ connection: await updateConnectionConfig(id, { orgId, patch }) });
  } catch (error) {
    if (error instanceof Forbidden) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof NotFound) return NextResponse.json({ error: error.message }, { status: 404 });
    console.error('[connections/patch]', error.message);
    return NextResponse.json({ error: 'That connection could not be updated.' }, { status: 500 });
  }
}
