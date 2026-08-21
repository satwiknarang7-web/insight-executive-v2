/**
 * Connection CRUD.
 *
 * Nothing here ever returns a credential. `saveConnection` takes one in and
 * puts it beyond reach; `listConnections` returns metadata only. Decryption
 * happens exclusively inside the connector runtime, which is server-side and
 * has no path back to a response body.
 *
 * Errors are deliberately terse. A message like "password authentication
 * failed for user postgres" is useful to the owner and equally useful to
 * someone probing, so specifics stay in the server log.
 */
import { NextResponse } from 'next/server';
import {
  listConnections,
  saveConnection,
  Forbidden,
  NotFound,
} from '../../../lib/vault/connections';
import { isSupabaseConfigured, currentUser } from '../../../lib/vault/supabase.server';
import { isVaultConfigured } from '../../../lib/vault/crypto';

export const runtime = 'nodejs';

function guard() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'The connection vault is not configured on this deployment.' },
      { status: 501 }
    );
  }
  if (!isVaultConfigured()) {
    return NextResponse.json(
      { error: 'VAULT_MASTER_KEY is not set, so credentials cannot be stored safely.' },
      { status: 501 }
    );
  }
  return null;
}

function fail(error) {
  if (error instanceof Forbidden) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof NotFound) return NextResponse.json({ error: error.message }, { status: 404 });
  console.error('[connections]', error);
  return NextResponse.json({ error: 'That request could not be completed.' }, { status: 500 });
}

export async function GET(request) {
  const blocked = guard();
  if (blocked) return blocked;

  const orgId = new URL(request.url).searchParams.get('org');
  if (!orgId) return NextResponse.json({ error: 'An organisation is required.' }, { status: 400 });

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  try {
    return NextResponse.json({ connections: await listConnections(orgId) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request) {
  const blocked = guard();
  if (blocked) return blocked;

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const { orgId, name, source, config, connectionId = null } = body || {};
  if (!orgId || !name || !source || !config) {
    return NextResponse.json(
      { error: 'orgId, name, source and config are all required.' },
      { status: 400 }
    );
  }

  try {
    const saved = await saveConnection({ orgId, name, source, config, connectionId });
    // `saved.config` is the stripped copy — the secret half never comes back.
    return NextResponse.json({ connection: saved }, { status: connectionId ? 200 : 201 });
  } catch (error) {
    return fail(error);
  }
}
