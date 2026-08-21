import 'server-only';

/**
 * The Tableau connector.
 *
 * Not a database, and the interface bends to say so. There is no SQL, no schema
 * and no table: there are published data sources addressed by an opaque LUID,
 * and you query one by naming the fields you want. So `listTables` returns data
 * sources, `fetchTable` takes the LUID as a `ref`, and `fetchRows` — which
 * exists to run a user's SQL — is not supported at all rather than pretending.
 *
 * Two limits are inherent rather than chosen, and both are surfaced rather than
 * hidden:
 *
 * - **Published data sources only.** Data living inside an unpublished workbook
 *   is not reachable through this API. If a user's data is not published, this
 *   connector cannot help them, and it says so.
 *
 * - **The row cap cannot be pushed down.** Every other connector bounds its
 *   result in the query itself, so the source never produces more rows than
 *   were asked for. VizQL Data Service exposes no row limit, so the cap is
 *   applied after the response arrives. That is genuinely weaker: a very large
 *   data source is transferred in full before being trimmed. Selecting fewer
 *   fields is the only real lever, and a truncated result is reported loudly.
 */
import {
  assertSafeHost,
  rowLimit,
  safeErrorMessage,
  QUERY_TIMEOUT_MS,
} from './guards.js';
import { normalizeRows } from './normalize.js';
import {
  REST_VERSION,
  parseServerUrl,
  signInBody,
  parseSignIn,
  parseDataSources,
  fieldsFromMetadata,
  queryBody,
  rowsFromQuery,
  numericFields,
} from './tableauApi.js';

/** One HTTP call with a timeout, returning parsed JSON. */
async function request(url, { method = 'GET', token = null, body = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        // The token goes in a header, never in the URL — a query string ends up
        // in proxy logs and browser history.
        ...(token ? { 'X-Tableau-Auth': token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      // Tableau nests its message; fall back to the status when it does not.
      const detail =
        payload?.error?.detail || payload?.message || `Tableau returned ${response.status}.`;
      throw new Error(String(detail).slice(0, 300));
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Tableau did not respond in time.');
    throw new Error(safeErrorMessage(error));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sign in, run `fn`, and sign out again.
 *
 * Signing out matters more here than closing a socket does elsewhere: a Tableau
 * session persists server-side until it expires, and abandoning them leaks
 * sessions against the site's limit.
 */
async function withSession(config, fn) {
  const { origin, host } = parseServerUrl(config.server);
  await assertSafeHost(host);

  const signIn = await request(`${origin}/api/${REST_VERSION}/auth/signin`, {
    method: 'POST',
    body: signInBody({
      patName: config.patName,
      patSecret: config.patSecret,
      site: config.site,
    }),
  });
  const { token, siteId } = parseSignIn(signIn);

  try {
    return await fn({ origin, token, siteId });
  } finally {
    await request(`${origin}/api/${REST_VERSION}/auth/signout`, { method: 'POST', token }).catch(
      () => {}
    );
  }
}

export async function testConnection(config) {
  return withSession(config, async ({ origin, token, siteId }) => {
    const payload = await request(`${origin}/api/${REST_VERSION}/sites/${siteId}`, { token });
    const site = payload?.site || {};
    return {
      ok: true,
      database: site.name || 'Default site',
      user: config.patName,
      version: `Tableau REST ${REST_VERSION}`,
      readOnlyReplica: true, // Tableau is read-only through this connector by nature.
    };
  });
}

/** Published data sources, presented where the UI expects tables. */
export async function listTables(config) {
  return withSession(config, async ({ origin, token, siteId }) => {
    const payload = await request(
      `${origin}/api/${REST_VERSION}/sites/${siteId}/datasources?pageSize=1000`,
      { token }
    );
    const sources = parseDataSources(payload);
    if (sources.length === 0) {
      throw new Error(
        'No published data sources found on this site. Data inside an unpublished workbook cannot be read.'
      );
    }
    return sources;
  });
}

/** Read a data source's fields, then query them. */
async function queryDataSource({ origin, token }, ref, cap) {
  const metadata = await request(`${origin}/api/v1/vizql-data-service/read-metadata`, {
    method: 'POST',
    token,
    body: { datasource: { datasourceLuid: ref } },
  });
  const fields = fieldsFromMetadata(metadata);

  const result = await request(`${origin}/api/v1/vizql-data-service/query-datasource`, {
    method: 'POST',
    token,
    body: queryBody(ref, fields),
  });

  const { rows, columns } = rowsFromQuery(result, fields);
  const truncated = rows.length > cap;
  const kept = truncated ? rows.slice(0, cap) : rows;

  return {
    rows: normalizeRows(kept, { numericColumns: numericFields(fields) }),
    columns,
    truncated,
    cap,
  };
}

export async function previewTable(config, { ref, limit = 20 }) {
  const cap = Math.min(Number(limit) || 20, 100);
  return withSession(config, async (session) => {
    const { rows, columns } = await queryDataSource(session, ref, cap);
    return { rows, columns };
  });
}

/**
 * Arbitrary SQL has no meaning here.
 *
 * Every other connector runs a user's query; Tableau exposes a field-selection
 * API instead. Failing loudly is better than silently ignoring a query someone
 * wrote and returning something else.
 */
export async function fetchRows() {
  throw new Error(
    'Tableau does not run SQL. Choose a published data source instead of writing a query.'
  );
}

export async function fetchTable(config, { ref, limit }) {
  if (!ref) throw new Error('Choose a published data source.');
  const cap = rowLimit(limit);
  return withSession(config, (session) => queryDataSource(session, ref, cap));
}

export const driver = {
  id: 'tableau',
  // Declared so the UI and the route can tell that the SQL console and the
  // query path do not apply to this source, rather than offering them and
  // failing at the last moment.
  capabilities: { sql: false, byRef: true },
  testConnection,
  listTables,
  previewTable,
  fetchRows,
  fetchTable,
};
