import 'server-only';

/**
 * MongoDB, and anything that speaks its wire protocol (Atlas, DocumentDB,
 * Cosmos DB for Mongo).
 *
 * Not SQL. A collection is read as a table by flattening each document one
 * level — `address.city` becomes a column called `address.city` — and turning
 * ObjectIds and dates into strings the cleaner can read. Documents in one
 * collection need not share a shape, so the column list is the union of the
 * keys seen, in the order they were first seen.
 */
import { MongoClient } from 'mongodb';
import { assertSafeHost, CONNECT_TIMEOUT_MS, QUERY_TIMEOUT_MS, rowLimit, safeErrorMessage } from './guards.js';
import { normalizeRows } from './normalize.js';

const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);

function uriFor(config) {
  const host = String(config.host || '').trim().replace(/^mongodb(\+srv)?:\/\//i, '');
  const scheme = config.srv === false ? 'mongodb' : 'mongodb+srv';
  const credentials = config.user ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password || '')}@` : '';
  const port = scheme === 'mongodb' && config.port ? `:${config.port}` : '';
  const options = config.srv === false ? 'directConnection=true' : 'retryWrites=false';
  return `${scheme}://${credentials}${host}${port}/${config.database || ''}?${options}`;
}

async function withClient(config, fn) {
  const host = String(config.host || '').replace(/^mongodb(\+srv)?:\/\//i, '').split('/')[0].split(',')[0].split(':')[0];
  // An SRV name resolves through a TXT/SRV record rather than an A record, so
  // the guard is applied to the hosts the driver actually dials, below.
  if (config.srv === false) await assertSafeHost(host);

  const client = new MongoClient(uriFor(config), {
    serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
    connectTimeoutMS: CONNECT_TIMEOUT_MS,
    socketTimeoutMS: QUERY_TIMEOUT_MS,
    maxPoolSize: 2,
    appName: 'insight-analytics',
  });
  try {
    await client.connect();
    if (config.srv !== false) {
      const hosts = client.topology?.s?.description?.servers ? [...client.topology.s.description.servers.keys()] : [];
      for (const h of hosts) await assertSafeHost(String(h).split(':')[0]);
    }
    return await fn(client);
  } catch (error) {
    throw new Error(safeErrorMessage(error));
  } finally {
    await client.close().catch(() => {});
  }
}

/** One document, as one flat row. */
export function flattenDocument(doc, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(doc || {})) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) out[name] = null;
    else if (value instanceof Date) out[name] = value.toISOString();
    else if (typeof value === 'object' && typeof value.toHexString === 'function') out[name] = value.toHexString();
    else if (Array.isArray(value)) out[name] = JSON.stringify(value);
    else if (typeof value === 'object' && !prefix) flattenDocument(value, name, out);
    else if (typeof value === 'object') out[name] = JSON.stringify(value);
    else out[name] = value;
  }
  return out;
}

function tableOf(documents, cap) {
  const truncated = documents.length > cap;
  const kept = truncated ? documents.slice(0, cap) : documents;
  const columns = [];
  const seen = new Set();
  const rows = kept.map((d) => {
    const row = flattenDocument(d);
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
    }
    return row;
  });
  return { rows: normalizeRows(rows), columns, truncated, cap };
}

export async function testConnection(config) {
  return withClient(config, async (client) => {
    const info = await client.db(config.database || 'admin').command({ buildInfo: 1 }).catch(() => ({}));
    return { ok: true, database: config.database || '', user: config.user || '', version: `MongoDB ${info.version || ''}`.trim(), readOnlyReplica: false };
  });
}

export async function listTables(config) {
  return withClient(config, async (client) => {
    const names = config.database ? [config.database] : (await client.db().admin().listDatabases()).databases.map((d) => d.name);
    const out = [];
    for (const db of names.filter((n) => !SYSTEM_DATABASES.has(n))) {
      const collections = await client.db(db).listCollections({}, { nameOnly: true }).toArray();
      for (const c of collections) {
        if (c.type === 'view' && c.name.startsWith('system.')) continue;
        out.push({ schema: db, name: c.name, qualified: `${db}.${c.name}`, ref: `${db}/${c.name}`, isView: c.type === 'view' });
      }
    }
    return out.sort((a, b) => a.qualified.localeCompare(b.qualified));
  });
}

function target(config, { schema, name, ref }) {
  if (ref) {
    const [db, ...rest] = String(ref).split('/');
    return { db, collection: rest.join('/') };
  }
  return { db: schema || config.database, collection: name };
}

export async function previewTable(config, spec) {
  const { db, collection } = target(config, spec);
  const cap = Math.min(Number(spec.limit) || 20, 100);
  return withClient(config, async (client) => {
    const docs = await client.db(db).collection(collection).find({}).limit(cap).toArray();
    const { rows, columns } = tableOf(docs, cap);
    return { rows, columns };
  });
}

export async function fetchRows() {
  throw new Error('MongoDB does not run SQL. Choose a collection instead of writing a query.');
}

export async function fetchTable(config, spec) {
  const { db, collection } = target(config, spec);
  if (!db || !collection) throw new Error('Choose a collection.');
  const cap = rowLimit(spec.limit);
  return withClient(config, async (client) => {
    const docs = await client.db(db).collection(collection).find({}).limit(cap + 1).toArray();
    return tableOf(docs, cap);
  });
}

export const driver = {
  id: 'mongodb',
  capabilities: { sql: false, byRef: true },
  testConnection,
  listTables,
  previewTable,
  fetchRows,
  fetchTable,
};
