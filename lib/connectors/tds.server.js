import 'server-only';

/**
 * The shared TDS implementation, used by SQL Server and by Microsoft Fabric.
 *
 * Fabric's SQL analytics endpoint speaks the same wire protocol as SQL Server;
 * the only real difference is how you prove who you are. Everything else — the
 * catalog queries, the row bounding, the type handling — is identical, so it
 * lives here once and each source supplies only its own connection config.
 *
 * A driver is built by handing over two functions: one that turns a stored
 * connection config into an `mssql` config, and one that says which host the
 * result will dial so it can be checked before anything is opened.
 */
import sql from 'mssql';
import {
  assertSafeHost,
  assertReadOnlySql,
  rowLimit,
  safeErrorMessage,
} from './guards.js';
import { normalizeRows, numericColumnsFrom } from './normalize.js';
import { quoteQualified } from './dialect.js';

/**
 * `mssql` exposes column metadata as an object keyed by name. Reshaping it into
 * the list `numericColumnsFrom` expects keeps that helper driver-agnostic.
 */
function columnsOf(result) {
  const meta = result?.recordset?.columns || {};
  return Object.entries(meta).map(([name, type]) => ({ name, type: type?.type || type }));
}

const columnNames = (result) => Object.keys(result?.recordset?.columns || {});

export function createTdsDriver({ id, dialect = 'sqlserver', configFor, hostFor }) {
  /** Open a connection, run `fn`, and close it whatever happens. */
  async function withPool(config, fn) {
    const { host } = hostFor(config);
    await assertSafeHost(host);

    let pool;
    try {
      pool = await new sql.ConnectionPool(configFor(config)).connect();
    } catch (error) {
      throw new Error(safeErrorMessage(error));
    }

    try {
      return await fn(pool);
    } catch (error) {
      throw new Error(safeErrorMessage(error));
    } finally {
      await pool.close().catch(() => {});
    }
  }

  async function testConnection(config) {
    return withPool(config, async (pool) => {
      const result = await pool.request().query(
        `select db_name() as [database],
                suser_sname() as [user],
                @@version as [version]`
      );
      const row = result.recordset?.[0] || {};
      return {
        ok: true,
        database: row.database,
        user: row.user,
        // @@version is a multi-line banner; the first line names the product.
        version: String(row.version || '').split('\n')[0].split('(')[0].trim().slice(0, 60),
        readOnlyReplica: false,
      };
    });
  }

  async function listTables(config) {
    return withPool(config, async (pool) => {
      const result = await pool.request().query(
        `select top 2000
                table_schema as [schema],
                table_name   as [name],
                table_type   as [type]
           from information_schema.tables
          where table_type in ('BASE TABLE', 'VIEW')
          order by table_schema, table_name`
      );
      return (result.recordset || []).map((r) => ({
        schema: r.schema,
        name: r.name,
        qualified: `${r.schema}.${r.name}`,
        isView: r.type === 'VIEW',
      }));
    });
  }

  async function previewTable(config, { schema, name, limit = 20 }) {
    return withPool(config, async (pool) => {
      const n = Math.floor(Math.min(Number(limit) || 20, 100));
      const target = quoteQualified(dialect, schema, name);
      const result = await pool.request().query(`select top ${n} * from ${target}`);
      return {
        rows: normalizeRows(result.recordset || [], {
          numericColumns: numericColumnsFrom(columnsOf(result)),
        }),
        columns: columnNames(result),
      };
    });
  }

  /**
   * Run a user's query, bounded by the row cap.
   *
   * SQL Server has no LIMIT: the equivalent is `TOP n` on the outer SELECT.
   * Wrapping in a subquery keeps a user's own TOP or ORDER BY intact, the same
   * way LIMIT is wrapped for the other dialects, and bounds the result before
   * it is ever transferred.
   */
  async function fetchRows(config, { sql: query, limit }) {
    const safeSql = assertReadOnlySql(query);
    const cap = rowLimit(limit);

    return withPool(config, async (pool) => {
      const bounded = `select top ${cap + 1} * from (${safeSql}) as _insight_capped`;
      const result = await pool.request().query(bounded);

      const rows = result.recordset || [];
      const truncated = rows.length > cap;
      const kept = truncated ? rows.slice(0, cap) : rows;

      return {
        rows: normalizeRows(kept, { numericColumns: numericColumnsFrom(columnsOf(result)) }),
        columns: columnNames(result),
        truncated,
        cap,
      };
    });
  }

  async function fetchTable(config, { schema, name, limit }) {
    return fetchRows(config, {
      sql: `select * from ${quoteQualified(dialect, schema, name)}`,
      limit,
    });
  }

  return { id, testConnection, listTables, previewTable, fetchRows, fetchTable };
}
