/**
 * The connector runtime.
 *
 * One action-dispatched route, because every action shares the same expensive
 * preamble: authorise the caller, open the credential from the vault, pick a
 * driver. Splitting it into four routes would mean writing that four times.
 *
 * Decrypted credentials exist only inside this handler. They are never put in a
 * response, never logged, and never attached to an error — driver errors are
 * scrubbed before they leave.
 */

import { NextResponse } from 'next/server';
import { openConnection, Forbidden, NotFound } from '../../../lib/vault/connections';
import { isSupabaseConfigured, currentUser } from '../../../lib/vault/supabase.server';
import { isVaultConfigured } from '../../../lib/vault/crypto';
import { BlockedHost, UnsafeQuery, MAX_ROWS } from '../../../lib/connectors/guards';
import { driverFor, IMPLEMENTED } from '../../../lib/connectors/drivers.server';
import { enforceLimit } from '../../../lib/routeLimits.server';

export const runtime = 'nodejs';
export const maxDuration = 60;


export async function POST(request) {
  if (!isSupabaseConfigured() || !isVaultConfigured()) {
    return NextResponse.json({ error: 'The connection vault is not configured.' }, { status: 501 });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const refused = await enforceLimit(request, 'connect');
  if (refused) return refused;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const { action, orgId, connectionId } = body || {};
  if (!action || !orgId || !connectionId) {
    return NextResponse.json(
      { error: 'action, orgId and connectionId are all required.' },
      { status: 400 }
    );
  }

  let credentials = null;
  try {
    // Authorisation happens inside openConnection: it checks membership, checks
    // the connection belongs to that organisation, and audits the read.
    credentials = await openConnection(connectionId, {
      orgId,
      reason: action === 'test' ? 'tested' : 'used',
    });

    const driver = await driverFor(credentials.__source);
    if (!driver) {
      return NextResponse.json(
        { error: `The ${credentials.__source} connector is not built yet.` },
        { status: 501 }
      );
    }

    switch (action) {
      case 'test':
        return NextResponse.json(await driver.testConnection(credentials));

      case 'tables':
        return NextResponse.json({ tables: await driver.listTables(credentials) });

      case 'preview': {
        const { schema, table, ref } = body;
        // A non-SQL source addresses its data by an opaque reference rather
        // than a schema and a table.
        if (!ref && (!schema || !table)) {
          return NextResponse.json({ error: 'schema and table are required.' }, { status: 400 });
        }
        return NextResponse.json(await driver.previewTable(credentials, { schema, name: table, ref }));
      }

      case 'fetch': {
        const { sql, limit, label } = body;
        if (!sql) return NextResponse.json({ error: 'A query is required.' }, { status: 400 });
        if (driver.capabilities?.sql === false) {
          return NextResponse.json(
            { error: `${credentials.__source} does not run SQL queries.` },
            { status: 400 }
          );
        }

        const result = await driver.fetchRows(credentials, { sql, limit });
        return NextResponse.json({
          label: label || 'Query result',
          columns: result.columns,
          rows: result.rows,
          rowCount: result.rows.length,
          truncated: result.truncated,
          cap: result.cap,
        });
      }

      case 'fetchTable': {
        const { schema, table, ref, limit } = body;
        if (!ref && (!schema || !table)) {
          return NextResponse.json({ error: 'schema and table are required.' }, { status: 400 });
        }
        // The driver builds the statement, because identifier quoting differs
        // per dialect — and a non-SQL source builds no statement at all. The
        // names came from listTables, not from free text.
        const result = await driver.fetchTable(credentials, { schema, name: table, ref, limit });
        return NextResponse.json({
          label: table,
          columns: result.columns,
          rows: result.rows,
          rowCount: result.rows.length,
          truncated: result.truncated,
          cap: result.cap,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof Forbidden) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof NotFound) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof BlockedHost || error instanceof UnsafeQuery) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // Driver errors are already scrubbed by safeErrorMessage, so this is the
    // one place a database's own message is passed on — it is what tells a user
    // their table name is wrong.
    console.error('[connect]', error.name);
    return NextResponse.json({ error: error.message || 'The database could not be reached.' }, { status: 502 });
  } finally {
    // Not a security control on its own — V8 may have copied these already —
    // but it shortens the window in which a heap snapshot would contain them.
    if (credentials) for (const key of Object.keys(credentials)) delete credentials[key];
  }
}

export async function GET() {
  return NextResponse.json({ maxRows: MAX_ROWS, sources: IMPLEMENTED });
}
