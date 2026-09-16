import 'server-only';

/**
 * Airtable, through its REST API on a personal access token.
 *
 * Not SQL. A base is a schema, a table is a table, and the rows are records
 * whose `fields` object is the row — a column an individual record does not
 * fill is simply absent, so the column list comes from the table's own
 * declared fields rather than from the records. Records arrive a page at a
 * time with an offset cursor, followed until the cap.
 */
import { rowLimit } from './guards.js';
import { httpRequest } from './http.server.js';
import { normalizeRows } from './normalize.js';

const API = 'https://api.airtable.com/v0';
const PAGE = 100;

const auth = (config) => ({ authorization: `Bearer ${config.token}` });

async function bases(config) {
  if (config.baseId) return [{ id: config.baseId, name: config.baseId }];
  const { json } = await httpRequest(`${API}/meta/bases`, { headers: auth(config) });
  return json?.bases || [];
}

export async function testConnection(config) {
  const list = await bases(config);
  return { ok: true, database: list.map((b) => b.name).slice(0, 3).join(', ') || 'no bases visible', user: 'token', version: 'Airtable REST v0', readOnlyReplica: true };
}

export async function listTables(config) {
  const out = [];
  for (const base of await bases(config)) {
    const { json } = await httpRequest(`${API}/meta/bases/${base.id}/tables`, { headers: auth(config) });
    for (const t of json?.tables || []) {
      out.push({
        schema: base.name,
        name: t.name,
        qualified: `${base.name}.${t.name}`,
        ref: `${base.id}/${t.id}`,
        isView: false,
        fields: (t.fields || []).map((f) => f.name),
      });
    }
  }
  if (!out.length) throw new Error('No tables are visible to this token. Give it access to a base and the data.records:read scope.');
  return out;
}

function flatten(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    // Attachments and linked records are arrays of objects; a linked-record
    // array is an array of ids. Either way one cell reads as text.
    return value.map((v) => (v && typeof v === 'object' ? v.name || v.filename || v.url || v.id || JSON.stringify(v) : v)).join(', ');
  }
  if (typeof value === 'object') return value.name || value.email || JSON.stringify(value);
  return value;
}

async function records(config, ref, cap) {
  const [baseId, tableId] = String(ref || '').split('/');
  if (!baseId || !tableId) throw new Error('Choose a table.');
  const meta = await httpRequest(`${API}/meta/bases/${baseId}/tables`, { headers: auth(config) });
  const table = (meta.json?.tables || []).find((t) => t.id === tableId);
  const declared = (table?.fields || []).map((f) => f.name);

  const rows = [];
  let offset = null;
  do {
    const params = new URLSearchParams({ pageSize: String(Math.min(PAGE, cap + 1 - rows.length)) });
    if (offset) params.set('offset', offset);
    const { json } = await httpRequest(`${API}/${baseId}/${tableId}?${params}`, { headers: auth(config) });
    for (const r of json?.records || []) {
      const row = { id: r.id };
      for (const name of declared) row[name] = flatten(r.fields?.[name]);
      for (const [k, v] of Object.entries(r.fields || {})) if (!(k in row)) row[k] = flatten(v);
      rows.push(row);
    }
    offset = json?.offset || null;
  } while (offset && rows.length <= cap);

  const truncated = rows.length > cap;
  const kept = truncated ? rows.slice(0, cap) : rows;
  const columns = ['id', ...declared, ...Object.keys(kept[0] || {}).filter((k) => k !== 'id' && !declared.includes(k))];
  return { rows: normalizeRows(kept), columns, truncated, cap };
}

export async function previewTable(config, { ref, limit = 20 }) {
  const { rows, columns } = await records(config, ref, Math.min(Number(limit) || 20, 100));
  return { rows, columns };
}

export async function fetchRows() {
  throw new Error('Airtable does not run SQL. Choose a table instead of writing a query.');
}

export async function fetchTable(config, { ref, limit }) {
  return records(config, ref, rowLimit(limit));
}

export const driver = {
  id: 'airtable',
  capabilities: { sql: false, byRef: true },
  testConnection,
  listTables,
  previewTable,
  fetchRows,
  fetchTable,
};
