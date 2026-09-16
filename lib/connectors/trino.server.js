import 'server-only';

/**
 * Trino (and Presto, and Starburst), through the coordinator's REST protocol.
 *
 * A statement is posted once and then followed: each response carries the
 * rows produced so far and a `nextUri` to fetch the rest from, until there is
 * no next. Columns arrive on whichever response first has them, which for an
 * empty result is the last one.
 */
import { assertReadOnlySql, rowLimit, QUERY_TIMEOUT_MS } from './guards.js';
import { quoteQualified } from './dialect.js';
import { basicAuth, httpRequest, originOf, rowsFromArrays } from './http.server.js';
import { normalizeRows } from './normalize.js';

async function run(config, sql, cap = null) {
  const { origin } = originOf(config.host, { defaultScheme: 'https', defaultPort: 8443 });
  const headers = {
    ...basicAuth(config.user, config.password),
    'x-trino-user': config.user || 'insight',
    ...(config.catalog ? { 'x-trino-catalog': config.catalog } : {}),
    ...(config.schema ? { 'x-trino-schema': config.schema } : {}),
    'x-trino-source': 'insight-analytics',
    'content-type': 'text/plain',
  };
  const started = Date.now();
  let { json: page } = await httpRequest(`${origin}/v1/statement`, { method: 'POST', headers, body: sql });

  let columns = null;
  const arrays = [];
  for (;;) {
    if (page?.error) throw new Error(page.error.message || 'The query failed.');
    if (!columns && Array.isArray(page?.columns)) columns = page.columns.map((c) => c.name);
    for (const row of page?.data || []) {
      arrays.push(row);
      if (cap && arrays.length > cap) break;
    }
    if (!page?.nextUri || (cap && arrays.length > cap)) {
      if (page?.nextUri) await httpRequest(page.nextUri, { method: 'DELETE', headers }).catch(() => {});
      break;
    }
    if (Date.now() - started > QUERY_TIMEOUT_MS * 2) {
      await httpRequest(page.nextUri, { method: 'DELETE', headers }).catch(() => {});
      throw new Error('The query did not finish in time.');
    }
    ({ json: page } = await httpRequest(page.nextUri, { headers }));
  }
  return { columns: columns || [], arrays };
}

export async function testConnection(config) {
  const { arrays } = await run(config, 'SELECT version() AS version, current_user AS user, current_catalog AS catalog');
  const [version, user, catalog] = arrays[0] || [];
  return { ok: true, database: catalog || config.catalog, user, version: `Trino ${version || ''}`.trim(), readOnlyReplica: false };
}

export async function listTables(config) {
  const { arrays } = await run(
    config,
    `SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('information_schema') ORDER BY table_schema, table_name LIMIT 2000`
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
  const { columns, arrays } = await run(config, `SELECT * FROM ${quoteQualified('postgres', schema, name)} LIMIT ${cap}`, cap);
  return { columns, rows: normalizeRows(rowsFromArrays(columns, arrays, cap).rows) };
}

export async function fetchTable(config, { schema, name, limit }) {
  return fetchRows(config, { sql: `SELECT * FROM ${quoteQualified('postgres', schema, name)}`, limit });
}

export const driver = { id: 'trino', testConnection, listTables, previewTable, fetchRows, fetchTable };
