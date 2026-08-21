import 'server-only';

/**
 * The Oracle driver.
 *
 * Runs in node-oracledb's **thin mode** — pure JavaScript, no Oracle Instant
 * Client on the host. That is the only reason Oracle is viable here at all: a
 * thick-mode driver would need native client libraries installed alongside the
 * app, which a serverless or autoscale host does not give you. `initOracleClient`
 * is therefore never called, and must not be: calling it once switches the whole
 * process to thick mode permanently.
 *
 * Oracle's shape differs from the others in two ways that matter:
 *
 * - **Connect strings**, not host fields. A user may hand over a whole TNS
 *   descriptor, which is how Autonomous Database is reached. Host extraction
 *   for the SSRF check therefore has to parse it — see `oracleConnect.js`.
 *
 * - **No `information_schema`.** Oracle's catalog is `ALL_TABLES` / `ALL_VIEWS`,
 *   which include the database's own plumbing unless system owners are excluded.
 */
import oracledb from 'oracledb';
import {
  assertSafeHost,
  assertReadOnlySql,
  rowLimit,
  safeErrorMessage,
  QUERY_TIMEOUT_MS,
} from './guards.js';
import { normalizeRows, numericColumnsFrom } from './normalize.js';
import { quoteQualified } from './dialect.js';
import {
  buildConnectString,
  hostsIn,
  assertSafeConnectString,
  SYSTEM_SCHEMAS,
} from './oracleConnect.js';

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
// A CLOB otherwise arrives as a Lob stream that has to be drained; as a string
// it is just a value. A BLOB becomes a Buffer, which `normalizeRows` then drops
// — binary is not analysable and shipping it to the browser is pure waste.
oracledb.fetchAsString = [oracledb.CLOB];
oracledb.fetchAsBuffer = [oracledb.BLOB];

/** Open a connection, run `fn`, and close it whatever happens. */
async function withConnection(config, fn) {
  const connectString = assertSafeConnectString(buildConnectString(config));

  // A descriptor can list several failover addresses; every one is checked,
  // because the driver may dial any of them.
  for (const host of hostsIn(connectString)) {
    await assertSafeHost(host);
  }

  let connection;
  try {
    connection = await oracledb.getConnection({
      user: config.user,
      password: config.password,
      connectString,
    });
    // Bounds a runaway query at the driver, not just at the database.
    connection.callTimeout = QUERY_TIMEOUT_MS;
  } catch (error) {
    throw new Error(safeErrorMessage(error));
  }

  try {
    return await fn(connection);
  } catch (error) {
    throw new Error(safeErrorMessage(error));
  } finally {
    await connection.close().catch(() => {});
  }
}

/** Oracle reports column types as `dbTypeName`; reshape for the shared helper. */
function columnsOf(result) {
  return (result?.metaData || []).map((m) => ({ name: m.name, type: m.dbTypeName }));
}

export async function testConnection(config) {
  return withConnection(config, async (connection) => {
    const result = await connection.execute(
      `select sys_context('USERENV', 'DB_NAME')     as "database",
              sys_context('USERENV', 'SESSION_USER') as "user",
              (select banner from v$version where rownum = 1) as "version"
         from dual`
    );
    const row = result.rows?.[0] || {};
    return {
      ok: true,
      database: row.database,
      user: row.user,
      // The banner is a long marketing string; the product and version is enough.
      version: String(row.version || 'Oracle').split('Release')[0].trim().slice(0, 60),
      readOnlyReplica: false,
    };
  });
}

/**
 * The tables and views this user can see.
 *
 * `ALL_TABLES` is what the connected user has been granted, which is the honest
 * list — but it also carries Oracle's own dictionary schemas, so those are
 * excluded rather than shown as if they were the customer's data.
 */
export async function listTables(config) {
  const excluded = SYSTEM_SCHEMAS.map((s) => `'${s}'`).join(', ');

  return withConnection(config, async (connection) => {
    const result = await connection.execute(
      `select * from (
         select owner as "schema", table_name as "name", 'TABLE' as "type"
           from all_tables where owner not in (${excluded})
         union all
         select owner as "schema", view_name as "name", 'VIEW' as "type"
           from all_views  where owner not in (${excluded})
       ) order by "schema", "name"
       fetch first 2000 rows only`
    );
    return (result.rows || []).map((r) => ({
      schema: r.schema,
      name: r.name,
      qualified: `${r.schema}.${r.name}`,
      isView: r.type === 'VIEW',
    }));
  });
}

export async function previewTable(config, { schema, name, limit = 20 }) {
  return withConnection(config, async (connection) => {
    const n = Math.min(Number(limit) || 20, 100);
    const target = quoteQualified('oracle', schema, name);
    const result = await connection.execute(
      `select * from ${target} fetch first ${Math.floor(n)} rows only`,
      [],
      { maxRows: n }
    );
    return {
      rows: normalizeRows(result.rows || [], { numericColumns: numericColumnsFrom(columnsOf(result)) }),
      columns: columnsOf(result).map((c) => c.name),
    };
  });
}

/**
 * Run a user's query, bounded by the row cap.
 *
 * Bounded twice, deliberately. `FETCH FIRST` in a wrapping subquery stops the
 * database producing more rows than were asked for; `maxRows` stops the driver
 * fetching more than that across the network even if the first bound were
 * somehow ineffective. Neither is expensive, and the cost of getting this wrong
 * is a serverless function dying on a large table.
 */
export async function fetchRows(config, { sql, limit }) {
  const safeSql = assertReadOnlySql(sql);
  const cap = rowLimit(limit);

  return withConnection(config, async (connection) => {
    const bounded = `select * from (${safeSql}) _insight_capped fetch first ${cap + 1} rows only`;
    const result = await connection.execute(bounded, [], { maxRows: cap + 1 });

    const rows = result.rows || [];
    const truncated = rows.length > cap;
    const kept = truncated ? rows.slice(0, cap) : rows;

    return {
      rows: normalizeRows(kept, { numericColumns: numericColumnsFrom(columnsOf(result)) }),
      columns: columnsOf(result).map((c) => c.name),
      truncated,
      cap,
    };
  });
}

/**
 * Pull a whole table by name. Quoting preserves case, which Oracle needs as
 * much as Snowflake does: an unquoted identifier is folded to upper case, so a
 * table created as "Orders" is only reachable when quoted.
 */
export async function fetchTable(config, { schema, name, limit }) {
  return fetchRows(config, { sql: `select * from ${quoteQualified('oracle', schema, name)}`, limit });
}

export const driver = {
  id: 'oracle',
  testConnection,
  listTables,
  previewTable,
  fetchRows,
  fetchTable,
};
