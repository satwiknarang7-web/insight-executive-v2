import 'server-only';

/**
 * ClickHouse, over its HTTP interface.
 *
 * No driver package: ClickHouse answers plain HTTP with `FORMAT JSON`, which
 * returns the column list and the rows in one body. The connection is the
 * server's HTTP(S) endpoint — port 8443 on ClickHouse Cloud, 8123 for a
 * self-hosted server without TLS — plus a user and password sent as Basic
 * auth, which is what the server expects.
 */
import { assertReadOnlySql, rowLimit } from './guards.js';
import { quoteQualified } from './dialect.js';
import { basicAuth, httpRequest, originOf } from './http.server.js';
import { normalizeRows } from './normalize.js';

const SYSTEM_DATABASES = "'system', 'INFORMATION_SCHEMA', 'information_schema'";

async function run(config, sql) {
  const { origin } = originOf(config.host, { defaultScheme: 'https', defaultPort: 8443 });
  const params = new URLSearchParams({ default_format: 'JSON', database: config.database || 'default' });
  const { json } = await httpRequest(`${origin}/?${params}`, {
    method: 'POST',
    headers: { ...basicAuth(config.user, config.password), 'content-type': 'text/plain' },
    body: sql,
  });
  const columns = (json?.meta || []).map((m) => m.name);
  return { columns, rows: json?.data || [] };
}

export async function testConnection(config) {
  const { rows } = await run(config, 'SELECT version() AS version, currentUser() AS user, currentDatabase() AS database');
  const row = rows[0] || {};
  return { ok: true, database: row.database, user: row.user, version: `ClickHouse ${row.version || ''}`.trim(), readOnlyReplica: false };
}

export async function listTables(config) {
  const { rows } = await run(
    config,
    `SELECT database AS schema, name, engine FROM system.tables WHERE database NOT IN (${SYSTEM_DATABASES}) ORDER BY database, name LIMIT 2000`
  );
  return rows.map((r) => ({ schema: r.schema, name: r.name, qualified: `${r.schema}.${r.name}`, isView: /View/i.test(r.engine || '') }));
}

export async function fetchRows(config, { sql, limit }) {
  const safeSql = assertReadOnlySql(sql);
  const cap = rowLimit(limit);
  const { columns, rows } = await run(config, `SELECT * FROM (${safeSql}) AS _insight_capped LIMIT ${cap + 1}`);
  const truncated = rows.length > cap;
  return { rows: normalizeRows(truncated ? rows.slice(0, cap) : rows), columns, truncated, cap };
}

export async function previewTable(config, { schema, name, limit = 20 }) {
  const { columns, rows } = await run(config, `SELECT * FROM ${quoteQualified('mysql', schema, name)} LIMIT ${Math.min(Number(limit) || 20, 100)}`);
  return { rows: normalizeRows(rows), columns };
}

export async function fetchTable(config, { schema, name, limit }) {
  return fetchRows(config, { sql: `SELECT * FROM ${quoteQualified('mysql', schema, name)}`, limit });
}

export const driver = { id: 'clickhouse', testConnection, listTables, previewTable, fetchRows, fetchTable };
