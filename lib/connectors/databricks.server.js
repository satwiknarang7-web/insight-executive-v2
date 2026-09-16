import 'server-only';

/**
 * Databricks SQL, through the Statement Execution API.
 *
 * A SQL warehouse answers REST: post a statement, get a statement id, poll
 * until it has finished, read the rows inline. No JDBC, no driver package,
 * and the token is a personal access token or a service principal's OAuth
 * token — either goes in the same header.
 */
import { assertReadOnlySql, rowLimit, QUERY_TIMEOUT_MS } from './guards.js';
import { quoteQualified } from './dialect.js';
import { httpRequest, originOf, rowsFromArrays } from './http.server.js';
import { normalizeRows } from './normalize.js';

const POLL_MS = 1000;

async function run(config, sql, cap) {
  const { origin } = originOf(config.host);
  const headers = { authorization: `Bearer ${config.token}` };
  const started = Date.now();

  let { json: statement } = await httpRequest(`${origin}/api/2.0/sql/statements`, {
    method: 'POST',
    headers,
    body: {
      statement: sql,
      warehouse_id: config.warehouseId,
      catalog: config.catalog || undefined,
      schema: config.schema || undefined,
      wait_timeout: '30s',
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
      row_limit: cap ? cap + 1 : undefined,
    },
  });

  while (['PENDING', 'RUNNING'].includes(statement?.status?.state)) {
    if (Date.now() - started > QUERY_TIMEOUT_MS * 2) {
      await httpRequest(`${origin}/api/2.0/sql/statements/${statement.statement_id}/cancel`, { method: 'POST', headers }).catch(() => {});
      throw new Error('The query did not finish in time.');
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
    ({ json: statement } = await httpRequest(`${origin}/api/2.0/sql/statements/${statement.statement_id}`, { headers }));
  }

  const state = statement?.status?.state;
  if (state !== 'SUCCEEDED') {
    throw new Error(statement?.status?.error?.message || `The query ${String(state || 'failed').toLowerCase()}.`);
  }
  const columns = (statement.manifest?.schema?.columns || []).map((c) => c.name);
  return { columns, arrays: statement.result?.data_array || [] };
}

export async function testConnection(config) {
  const { arrays } = await run(config, 'SELECT current_version().dbsql_version AS version, current_user() AS user, current_catalog() AS catalog');
  const [version, user, catalog] = arrays[0] || [];
  return { ok: true, database: catalog, user, version: `Databricks SQL ${version || ''}`.trim(), readOnlyReplica: false };
}

export async function listTables(config) {
  const catalog = config.catalog ? `AND table_catalog = '${String(config.catalog).replace(/'/g, "''")}'` : '';
  const { arrays } = await run(
    config,
    `SELECT table_schema, table_name, table_type FROM system.information_schema.tables WHERE table_schema NOT IN ('information_schema') ${catalog} ORDER BY table_schema, table_name LIMIT 2000`
  );
  return arrays.map(([schema, name, type]) => ({ schema, name, qualified: `${schema}.${name}`, isView: /VIEW/i.test(type || '') }));
}

export async function fetchRows(config, { sql, limit }) {
  const safeSql = assertReadOnlySql(sql);
  const cap = rowLimit(limit);
  const { columns, arrays } = await run(config, `SELECT * FROM (${safeSql}) AS _insight_capped LIMIT ${cap + 1}`, cap);
  const built = rowsFromArrays(columns, arrays, cap);
  return { ...built, rows: normalizeRows(built.rows) };
}

export async function previewTable(config, { schema, name, limit = 20 }) {
  const cap = Math.min(Number(limit) || 20, 100);
  const { columns, arrays } = await run(config, `SELECT * FROM ${quoteQualified('mysql', schema, name)} LIMIT ${cap}`, cap);
  return { columns, rows: normalizeRows(rowsFromArrays(columns, arrays, cap).rows) };
}

export async function fetchTable(config, { schema, name, limit }) {
  return fetchRows(config, { sql: `SELECT * FROM ${quoteQualified('mysql', schema, name)}`, limit });
}

export const driver = { id: 'databricks', testConnection, listTables, previewTable, fetchRows, fetchTable };
