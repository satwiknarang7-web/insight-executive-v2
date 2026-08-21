import 'server-only';

/**
 * The MySQL / MariaDB driver.
 *
 * Same shape as the Postgres one — check the host, connect with a timeout, do
 * one bounded read-only thing, close — because the interface is the point. The
 * differences are all in how the driver is configured.
 *
 * mysql2 has options that fix at the source what Postgres needed type parsers
 * for, so they are set here rather than patched up afterwards:
 *
 * - `dateStrings` keeps DATE and DATETIME as strings. Without it the driver
 *   builds a JS Date in the *server's* timezone, and every date in the dataset
 *   silently shifts by the offset.
 * - `decimalNumbers` returns DECIMAL as a number rather than a string, so a
 *   revenue column profiles as a measure instead of a category.
 *
 * `normalizeRows` still runs afterwards, as a net for binary columns and for
 * anything these options miss.
 */
import mysql from 'mysql2/promise';
import {
  assertSafeHost,
  assertReadOnlySql,
  rowLimit,
  safeErrorMessage,
  CONNECT_TIMEOUT_MS,
  QUERY_TIMEOUT_MS,
} from './guards.js';
import { normalizeRows, numericColumnsFrom } from './normalize.js';
import { quoteQualified } from './dialect.js';

async function connectionFor(config) {
  return mysql.createConnection({
    host: config.host,
    port: Number(config.port) || 3306,
    database: config.database,
    user: config.user,
    password: config.password,
    // Managed MySQL hosts almost universally present a certificate that does
    // not chain to a public root, so verification is relaxed rather than TLS
    // being turned off entirely.
    ssl: config.ssl === false ? undefined : { rejectUnauthorized: false },
    connectTimeout: CONNECT_TIMEOUT_MS,
    dateStrings: true,
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    // A statement that returns several result sets is a way to smuggle a second
    // query past a single-statement check.
    multipleStatements: false,
    enableKeepAlive: false,
  });
}

/** Open a connection, run `fn`, and close it whatever happens. */
async function withConnection(config, fn) {
  await assertSafeHost(config.host);

  let connection;
  try {
    connection = await connectionFor(config);
  } catch (error) {
    throw new Error(safeErrorMessage(error));
  }

  try {
    // MySQL has no per-connection statement_timeout, so it is set per session.
    await connection.query(`set session max_execution_time = ${Number(QUERY_TIMEOUT_MS) || 30000}`);
    return await fn(connection);
  } catch (error) {
    throw new Error(safeErrorMessage(error));
  } finally {
    await connection.end().catch(() => {});
  }
}

export async function testConnection(config) {
  return withConnection(config, async (connection) => {
    const [rows] = await connection.query(
      'select database() as `database`, current_user() as `user`, version() as `version`'
    );
    const row = rows?.[0] || {};
    return {
      ok: true,
      database: row.database,
      user: row.user,
      version: String(row.version || '').split('-')[0],
      readOnlyReplica: false,
    };
  });
}

/**
 * The tables and views this user can see.
 *
 * Scoped to the connected database rather than the whole server, and driven by
 * `information_schema`, so it reflects the role's actual grants.
 */
export async function listTables(config) {
  return withConnection(config, async (connection) => {
    const [rows] = await connection.query(
      `select table_schema as \`schema\`, table_name as \`name\`, table_type as \`type\`
         from information_schema.tables
        where table_schema = database()
          and table_type in ('BASE TABLE', 'VIEW')
        order by table_name
        limit 2000`
    );
    return rows.map((r) => ({
      schema: r.schema,
      name: r.name,
      qualified: `${r.schema}.${r.name}`,
      isView: r.type === 'VIEW',
    }));
  });
}

export async function previewTable(config, { schema, name, limit = 20 }) {
  return withConnection(config, async (connection) => {
    const target = `${quoteQualified('mysql', schema, name)}`;
    const [rows, fields] = await connection.query(
      `select * from ${target} limit ?`,
      [Math.min(Number(limit) || 20, 100)]
    );
    const columns = (fields || []).map((f) => f.name);
    return { rows: normalizeRows(rows, { numericColumns: numericColumnsFrom(fields) }), columns };
  });
}

/**
 * Run a user's query, bounded by the row cap.
 *
 * The cap is applied by wrapping the query in a subquery rather than appending
 * a LIMIT, so a query with its own LIMIT or ORDER BY keeps its meaning, and the
 * bound is enforced by MySQL before the rows ever reach this process.
 */
export async function fetchRows(config, { sql, limit }) {
  const safeSql = assertReadOnlySql(sql);
  const cap = rowLimit(limit);

  return withConnection(config, async (connection) => {
    const bounded = `select * from (${safeSql}) as _insight_capped limit ${cap + 1}`;
    const [rows, fields] = await connection.query(bounded);

    const columns = (fields || []).map((f) => f.name);
    const truncated = rows.length > cap;
    const kept = truncated ? rows.slice(0, cap) : rows;

    return {
      rows: normalizeRows(kept, { numericColumns: numericColumnsFrom(fields) }),
      columns,
      truncated,
      cap,
    };
  });
}

/**
 * Pull a whole table by name.
 *
 * Lives in the driver rather than the route because identifier quoting is
 * dialect-specific: Postgres uses "double quotes", MySQL `backticks` and SQL
 * Server [brackets]. Building the statement centrally would produce SQL that is
 * only valid for one of them.
 */
export async function fetchTable(config, { schema, name, limit }) {
  return fetchRows(config, { sql: `select * from ${quoteQualified('mysql', schema, name)}`, limit });
}

export const driver = {
  id: 'mysql',
  testConnection,
  listTables,
  previewTable,
  fetchRows,
  fetchTable,
};
