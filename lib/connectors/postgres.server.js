import 'server-only';

/**
 * The PostgreSQL driver — and, unchanged, the Supabase one.
 *
 * Supabase *is* Postgres, so the only difference is which host and port the
 * user types. That was the cheapest win available in the whole connector plan
 * and it costs nothing to take.
 *
 * Every method here follows the same order: check the host, open a connection
 * with a timeout, do one bounded read-only thing, close. Connections are not
 * pooled, deliberately: this runs on serverless hosts where the process may be
 * frozen or discarded between requests, and a pool that outlives the request
 * leaks sockets on the database side.
 */
import pg from 'pg';
import {
  assertSafeHost,
  assertReadOnlySql,
  rowLimit,
  safeErrorMessage,
  CONNECT_TIMEOUT_MS,
  QUERY_TIMEOUT_MS,
} from './guards.js';
import { configureTypeParsers } from './pgTypes.js';
import { quoteQualified } from './dialect.js';

configureTypeParsers(pg.types);

function clientFor(config) {
  return new pg.Client({
    host: config.host,
    port: Number(config.port) || 5432,
    database: config.database,
    user: config.user,
    password: config.password,
    // TLS on unless explicitly turned off. `rejectUnauthorized: false` accepts
    // the self-signed certificates most managed Postgres hosts present; without
    // it, RDS and Supabase both fail to connect out of the box.
    ssl: config.ssl === false ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    application_name: 'insight-analytics',
  });
}

/** Open a connection, run `fn`, and close it whatever happens. */
async function withClient(config, fn) {
  await assertSafeHost(config.host);
  const client = clientFor(config);

  try {
    await client.connect();
  } catch (error) {
    throw new Error(safeErrorMessage(error));
  }

  try {
    return await fn(client);
  } catch (error) {
    throw new Error(safeErrorMessage(error));
  } finally {
    // A failed end() must not mask the real error.
    await client.end().catch(() => {});
  }
}

/** Can we reach it, and who are we when we get there? */
export async function testConnection(config) {
  return withClient(config, async (client) => {
    const { rows } = await client.query(
      `select current_database() as database,
              current_user      as "user",
              version()         as version,
              pg_is_in_recovery() as read_only`
    );
    const row = rows[0] || {};
    return {
      ok: true,
      database: row.database,
      user: row.user,
      // Just the product and version, not the full build string with paths.
      version: String(row.version || '').split(' ').slice(0, 2).join(' '),
      readOnlyReplica: !!row.read_only,
    };
  });
}

/**
 * The tables and views the connected role can actually see.
 *
 * Driven by `information_schema`, so it reflects that role's grants rather than
 * everything in the database — if the user followed the advice to connect with
 * a read-only role, this is the honest list of what they can analyse.
 */
export async function listTables(config) {
  return withClient(config, async (client) => {
    const { rows } = await client.query(
      `select table_schema as schema,
              table_name   as name,
              table_type   as type
         from information_schema.tables
        where table_schema not in ('pg_catalog', 'information_schema')
          and table_type in ('BASE TABLE', 'VIEW')
        order by table_schema, table_name
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

/** A few rows from one table, for the "is this the right table?" step. */
export async function previewTable(config, { schema, name, limit = 20 }) {
  return withClient(config, async (client) => {
    // Identifiers cannot be parameterised, so they are quoted — and they came
    // from listTables, not from free text.
    const target = quoteQualified('postgres', schema, name);
    const { rows, fields } = await client.query(`select * from ${target} limit $1`, [
      Math.min(Number(limit) || 20, 100),
    ]);
    return { rows, columns: fields.map((f) => f.name) };
  });
}

/**
 * Run a user's query and return the rows, bounded server-side.
 *
 * The cap is enforced by wrapping the query in a subquery with a LIMIT rather
 * than by fetching everything and slicing. Slicing is far too late: the whole
 * result would already be materialised in the function's memory, and on a
 * warehouse table that is what kills the process long before any response-size
 * limit is reached.
 *
 * Wrapping, rather than appending, is what makes this safe against a query that
 * already ends in its own LIMIT or ORDER BY — those stay inside the subquery
 * and keep their meaning. `cap + 1` is requested so one extra row reveals that
 * more existed, without fetching them.
 */
export async function fetchRows(config, { sql, limit }) {
  const safeSql = assertReadOnlySql(sql);
  const cap = rowLimit(limit);

  return withClient(config, async (client) => {
    const bounded = `select * from (${safeSql}) as _insight_capped limit ${cap + 1}`;
    const result = await client.query({ text: bounded, rowMode: 'array' });

    const columns = (result.fields || []).map((f) => f.name);
    const truncated = result.rows.length > cap;
    const kept = truncated ? result.rows.slice(0, cap) : result.rows;

    // rowMode 'array' avoids building an object per row twice — once by the
    // driver and once by us — on result sets that can run to tens of thousands.
    const rows = kept.map((values) => {
      const row = {};
      for (let i = 0; i < columns.length; i++) row[columns[i]] = values[i];
      return row;
    });

    return { rows, columns, truncated, cap };
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
  return fetchRows(config, { sql: `select * from ${quoteQualified('postgres', schema, name)}`, limit });
}

export const driver = {
  id: 'postgres',
  testConnection,
  listTables,
  previewTable,
  fetchRows,
  fetchTable,
};
