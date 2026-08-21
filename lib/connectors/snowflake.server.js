import 'server-only';

/**
 * The Snowflake driver.
 *
 * The first source in this plan that is not a password-and-a-socket. Two things
 * make it different:
 *
 * **Authentication.** Snowflake is withdrawing single-factor password sign-in
 * through 2026 — by the final milestone every service user must use key-pair,
 * OAuth, a programmatic access token or workload identity. So this driver never
 * offers a password: key-pair (`SNOWFLAKE_JWT`) is the default and a PAT is the
 * alternative. Building a password field would be building something Snowflake
 * is actively switching off.
 *
 * **Billing.** A query runs on a warehouse, and a running warehouse costs money
 * whether or not anyone is reading the result. That is why every statement here
 * is bounded and why the connection is destroyed rather than left idle: an
 * abandoned session can hold a warehouse awake.
 *
 * The SDK is callback-based, so each operation is promisified at the boundary.
 */
import snowflake from 'snowflake-sdk';
import {
  assertSafeHost,
  assertReadOnlySql,
  rowLimit,
  safeErrorMessage,
  QUERY_TIMEOUT_MS,
} from './guards.js';
import { normalizeRows, numericColumnsFrom } from './normalize.js';
import { quoteQualified } from './dialect.js';

// The SDK logs connection detail at info level by default, which on a shared
// host means account identifiers in the platform log.
try {
  snowflake.configure({ logLevel: 'ERROR', additionalLogToConsole: false });
} catch {
  /* older SDKs expose no configure(); the default is acceptable */
}

/** Account identifiers are `org-account`, `ab12345.region` or `ab12345.region.cloud`. */
const ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;

/**
 * The hostname the SDK will dial.
 *
 * Snowflake builds this from the account identifier, so validating the
 * identifier and then checking the derived host is what stops a crafted account
 * string from pointing the connection somewhere else entirely.
 */
function hostFor(account) {
  const id = String(account || '').trim();
  if (!ACCOUNT_RE.test(id)) {
    throw new Error('That does not look like a Snowflake account identifier.');
  }
  if (id.includes('/') || id.includes('@')) {
    throw new Error('An account identifier cannot contain a URL.');
  }
  return `${id}.snowflakecomputing.com`;
}

function connectionFor(config) {
  const base = {
    account: String(config.account).trim(),
    username: config.user,
    warehouse: config.warehouse,
    database: config.database,
    schema: config.schema || 'PUBLIC',
    role: config.role || undefined,
    timeout: QUERY_TIMEOUT_MS,
    clientSessionKeepAlive: false,
    application: 'insight-analytics',
  };

  if (config.signInMethod === 'pat') {
    // A programmatic access token is presented as a bearer token rather than a
    // password, so the authenticator has to say so.
    return { ...base, token: config.token, authenticator: 'PROGRAMMATIC_ACCESS_TOKEN' };
  }

  return {
    ...base,
    authenticator: 'SNOWFLAKE_JWT',
    privateKey: config.privateKey,
    privateKeyPass: config.privateKeyPassphrase || undefined,
  };
}

/** Promisified connect. */
function connect(connection) {
  return new Promise((resolve, reject) => {
    connection.connect((err, conn) => (err ? reject(err) : resolve(conn)));
  });
}

/** Promisified execute, returning both rows and column metadata. */
function execute(connection, sqlText) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText,
      complete: (err, statement, rows) => {
        if (err) return reject(err);
        const columns = (statement.getColumns() || []).map((c) => ({
          name: c.getName(),
          type: c.getType(),
        }));
        resolve({ rows: rows || [], columns });
      },
    });
  });
}

/** Open a session, run `fn`, and tear it down whatever happens. */
async function withConnection(config, fn) {
  await assertSafeHost(hostFor(config.account));

  let connection;
  try {
    connection = snowflake.createConnection(connectionFor(config));
    await connect(connection);
  } catch (error) {
    throw new Error(safeErrorMessage(error));
  }

  try {
    return await fn(connection);
  } catch (error) {
    throw new Error(safeErrorMessage(error));
  } finally {
    // An abandoned session can hold a warehouse awake, and a warehouse that is
    // awake is being billed.
    await new Promise((resolve) => {
      try {
        connection.destroy(() => resolve());
      } catch {
        resolve();
      }
    });
  }
}

export async function testConnection(config) {
  return withConnection(config, async (connection) => {
    const { rows } = await execute(
      connection,
      `select current_database() as "database",
              current_user()     as "user",
              current_warehouse() as "warehouse",
              current_role()     as "role",
              current_version()  as "version"`
    );
    const row = rows[0] || {};

    // A connection with no warehouse authenticates fine and then fails on the
    // first real query, which is a confusing way to find out.
    if (!row.warehouse) {
      throw new Error(
        'Connected, but no warehouse is active for this user. Set one on the connection or grant a default.'
      );
    }

    return {
      ok: true,
      database: row.database,
      user: row.user,
      warehouse: row.warehouse,
      role: row.role,
      version: row.version ? `Snowflake ${row.version}` : 'Snowflake',
      readOnlyReplica: false,
    };
  });
}

export async function listTables(config) {
  return withConnection(config, async (connection) => {
    const { rows } = await execute(
      connection,
      `select table_schema as "schema",
              table_name   as "name",
              table_type   as "type"
         from information_schema.tables
        where table_schema not in ('INFORMATION_SCHEMA')
        order by table_schema, table_name
        limit 2000`
    );
    return rows.map((r) => ({
      schema: r.schema,
      name: r.name,
      qualified: `${r.schema}.${r.name}`,
      isView: String(r.type || '').toUpperCase().includes('VIEW'),
    }));
  });
}

export async function previewTable(config, { schema, name, limit = 20 }) {
  return withConnection(config, async (connection) => {
    const n = Math.min(Number(limit) || 20, 100);
    const target = quoteQualified('snowflake', schema, name);
    const { rows, columns } = await execute(connection, `select * from ${target} limit ${Math.floor(n)}`);
    return {
      rows: normalizeRows(rows, { numericColumns: numericColumnsFrom(columns) }),
      columns: columns.map((c) => c.name),
    };
  });
}

/**
 * Run a user's query, bounded by the row cap.
 *
 * Wrapped in a subquery rather than having a LIMIT appended, for the same
 * reason as every other driver: a query with its own LIMIT or ORDER BY keeps
 * its meaning, and the bound is enforced by the warehouse before the rows are
 * ever transferred — which on Snowflake is what the transfer is billed on.
 */
export async function fetchRows(config, { sql, limit }) {
  const safeSql = assertReadOnlySql(sql);
  const cap = rowLimit(limit);

  return withConnection(config, async (connection) => {
    const bounded = `select * from (${safeSql}) as _insight_capped limit ${cap + 1}`;
    const { rows, columns } = await execute(connection, bounded);

    const truncated = rows.length > cap;
    const kept = truncated ? rows.slice(0, cap) : rows;

    return {
      rows: normalizeRows(kept, { numericColumns: numericColumnsFrom(columns) }),
      columns: columns.map((c) => c.name),
      truncated,
      cap,
    };
  });
}

/**
 * Pull a whole table by name. Quoting preserves case, which matters here more
 * than elsewhere: Snowflake folds unquoted identifiers to upper case, so a
 * table created as "Orders" is only reachable when quoted.
 */
export async function fetchTable(config, { schema, name, limit }) {
  return fetchRows(config, { sql: `select * from ${quoteQualified('snowflake', schema, name)}`, limit });
}

export const driver = {
  id: 'snowflake',
  testConnection,
  listTables,
  previewTable,
  fetchRows,
  fetchTable,
};
