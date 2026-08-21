import 'server-only';

/**
 * The connection repository.
 *
 * Every function here that touches the vault follows the same shape, and the
 * order is the whole security model:
 *
 *   1. establish who is calling            (userClient — RLS answers)
 *   2. authorise them against the org      (membership — RLS answers)
 *   3. only then use the service role      (bypasses RLS)
 *   4. write an audit row                  (server-side, unforgeable)
 *
 * Step 2 is not optional and cannot be skipped for convenience. The service
 * client will read any organisation's credentials without complaint, so the
 * database has stopped protecting us by the time step 3 runs.
 */
import { membership, serviceClient, userClient } from './supabase.server.js';
import { sealCredential, openCredential, stripSecrets, extractSecrets } from './crypto.js';

/** Thrown when the caller may not do what they asked. Distinct from "not found". */
export class Forbidden extends Error {
  constructor(message = 'You do not have access to that connection.') {
    super(message);
    this.name = 'Forbidden';
    this.status = 403;
  }
}

export class NotFound extends Error {
  constructor(message = 'Connection not found.') {
    super(message);
    this.name = 'NotFound';
    this.status = 404;
  }
}

const WRITE_ROLES = new Set(['owner', 'admin']);

/**
 * Record what happened. Written with the service role so a client cannot forge
 * or suppress it, and deliberately never awaited into the failure path — a
 * broken audit write must not make a legitimate operation look like it failed.
 */
async function audit(svc, { orgId, connectionId = null, userId, action, detail = {} }) {
  const { error } = await svc.from('connection_audit').insert({
    org_id: orgId,
    connection_id: connectionId,
    user_id: userId,
    action,
    // stripSecrets is applied defensively: `detail` should never contain a
    // credential, but the audit table is readable by the whole organisation and
    // this is the last place to catch a mistake.
    detail: stripSecrets(detail),
  });
  if (error) console.error('[vault] audit write failed:', error.message);
}

/** List an organisation's connections. Metadata only — no secrets involved. */
export async function listConnections(orgId) {
  const who = await membership(orgId);
  if (!who) throw new Forbidden();

  const supabase = await userClient();
  const { data, error } = await supabase
    .from('connections')
    .select('id, name, source, config, created_at, updated_at, last_used_at, revoked_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Create or replace a connection.
 *
 * `config` arrives whole from the form; it is split here so that only the
 * non-secret half is ever written to a table the browser can read back.
 */
export async function saveConnection({ orgId, name, source, config, connectionId = null }) {
  const who = await membership(orgId);
  if (!who) throw new Forbidden();
  if (!WRITE_ROLES.has(who.role)) throw new Forbidden('Only an owner or admin can change connections.');

  const safeConfig = stripSecrets(config);
  const secrets = extractSecrets(config);
  if (Object.keys(secrets).length === 0) {
    throw new Error('That connection has no credentials. Nothing would be stored in the vault.');
  }

  const sealed = sealCredential(secrets);
  const svc = serviceClient();

  const { data, error } = await svc.schema('app_private').rpc('upsert_connection_secret', {
    p_org_id: orgId,
    p_name: name,
    p_source: source,
    p_config: safeConfig,
    p_created_by: who.userId,
    p_ciphertext: toHex(sealed.ciphertext),
    p_iv: toHex(sealed.iv),
    p_auth_tag: toHex(sealed.auth_tag),
    p_dek_wrapped: toHex(sealed.dek_wrapped),
    p_dek_iv: toHex(sealed.dek_iv),
    p_dek_tag: toHex(sealed.dek_tag),
    p_key_version: sealed.key_version,
    p_connection_id: connectionId,
  });

  if (error) throw new Error(error.message);

  const id = data;
  await audit(svc, {
    orgId,
    connectionId: id,
    userId: who.userId,
    action: connectionId ? 'updated' : 'created',
    detail: { source, name },
  });
  return { id, name, source, config: safeConfig };
}

/**
 * Decrypt a connection's credentials for use by the connector runtime.
 *
 * The return value must never reach a response body, a log line or an error
 * message. Every call is audited, because "who read which credential, and when"
 * is the first question asked after an incident.
 */
export async function openConnection(connectionId, { orgId, reason = 'used' }) {
  const who = await membership(orgId);
  if (!who) throw new Forbidden();

  const svc = serviceClient();

  // Confirm the connection really belongs to the organisation the caller was
  // authorised against. Without this, a valid member of org A could pass a
  // connection id belonging to org B and the service role would fetch it.
  const { data: row, error: rowError } = await svc
    .from('connections')
    .select('id, org_id, name, source, config, revoked_at')
    .eq('id', connectionId)
    .maybeSingle();

  if (rowError) throw new Error(rowError.message);
  if (!row) throw new NotFound();
  if (row.org_id !== orgId) throw new Forbidden();
  if (row.revoked_at) throw new Forbidden('That connection has been revoked.');

  const { data: secretRows, error: secretError } = await svc
    .schema('app_private')
    .rpc('read_connection_secret', { p_connection_id: connectionId });

  if (secretError) throw new Error(secretError.message);
  const secret = Array.isArray(secretRows) ? secretRows[0] : secretRows;
  if (!secret) throw new NotFound('That connection has no stored credentials.');

  const credentials = openCredential(secret);

  await audit(svc, {
    orgId,
    connectionId,
    userId: who.userId,
    action: reason === 'tested' ? 'tested' : 'secret_read',
    detail: { name: row.name, source: row.source },
  });
  await svc.from('connections').update({ last_used_at: new Date().toISOString() }).eq('id', connectionId);

  return { ...row.config, ...credentials, __source: row.source };
}

/**
 * Revoke a connection. Deliberately not a delete: the audit trail references
 * it, and "this credential was withdrawn on Tuesday" is worth more than a row
 * quietly vanishing.
 */
export async function revokeConnection(connectionId, { orgId }) {
  const who = await membership(orgId);
  if (!who) throw new Forbidden();
  if (!WRITE_ROLES.has(who.role)) throw new Forbidden('Only an owner or admin can revoke a connection.');

  const svc = serviceClient();
  const { data, error } = await svc
    .from('connections')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', connectionId)
    .eq('org_id', orgId)
    .select('id, name')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new NotFound();

  // The credential itself goes immediately; a revoked connection has no reason
  // to keep one, and the metadata row is what the audit trail points at.
  await svc.schema('app_private').from('connection_secrets').delete().eq('connection_id', connectionId);

  await audit(svc, { orgId, connectionId, userId: who.userId, action: 'revoked', detail: { name: data.name } });
  return { id: data.id, revoked: true };
}

/** The audit trail for one organisation, newest first. */
export async function connectionAudit(orgId, { limit = 100 } = {}) {
  const who = await membership(orgId);
  if (!who) throw new Forbidden();

  const supabase = await userClient();
  const { data, error } = await supabase
    .from('connection_audit')
    .select('id, connection_id, user_id, action, detail, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 500));

  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * PostgREST sends bytea as text. The `\x`-prefixed hex form is what Postgres
 * parses back into bytes; a raw Buffer would arrive JSON-serialised as an
 * object of byte values and be stored as that literal text instead.
 */
function toHex(buffer) {
  return `\\x${Buffer.from(buffer).toString('hex')}`;
}
