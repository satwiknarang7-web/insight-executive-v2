import 'server-only';

/**
 * Microsoft Fabric, through its SQL analytics endpoint.
 *
 * Fabric speaks TDS, so the query path is the SQL Server one unchanged. What
 * differs is authentication: Fabric has no password to offer, only Entra ID.
 *
 * **Why a service principal rather than a user sign-in.** The connector plan
 * assumed this phase would need a full authorization-code flow — a registered
 * app, a redirect URI, per-user tokens and refresh handling. It does not.
 * `tedious` implements the client-credentials grant directly, so an app
 * registration with a client secret is enough. That fits this product far
 * better than a delegated flow would:
 *
 * - the credential is just another secret, so the existing vault holds it with
 *   no new machinery, no callback route and no token storage;
 * - queries run as the application with one consistent set of permissions,
 *   rather than as whichever person happened to be signed in;
 * - nothing expires mid-import and needs refreshing.
 *
 * The cost is that the service principal must be granted access to the Fabric
 * workspace and to the item being queried. That is a deliberate, visible step
 * rather than an implicit inheritance of a user's rights — which for a tool
 * that pulls data on someone's behalf is the safer default.
 */
import { createTdsDriver } from './tds.server.js';
import { parseSqlEndpoint } from './tdsEndpoint.js';
import { CONNECT_TIMEOUT_MS, QUERY_TIMEOUT_MS } from './guards.js';
import {
  flattenCatalog,
  lakehousesUrl,
  parseLakehouses,
  parseToken,
  parseWarehouses,
  parseWorkspaces,
  tokenBody,
  tokenUrl,
  warehousesUrl,
  workspacesUrl,
} from './fabricApi.js';

const endpointOf = (config) => parseSqlEndpoint(config.endpoint, 1433);

function configFor(config) {
  const { host, port } = endpointOf(config);
  return {
    server: host,
    port,
    database: config.database,
    authentication: {
      type: 'azure-active-directory-service-principal-secret',
      options: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        tenantId: config.tenantId,
      },
    },
    connectionTimeout: CONNECT_TIMEOUT_MS,
    requestTimeout: QUERY_TIMEOUT_MS,
    pool: { max: 1, min: 0, idleTimeoutMillis: 1000 },
    options: {
      // Fabric is TLS-only; there is no opt-out and no reason to offer one.
      encrypt: true,
      trustServerCertificate: false,
      useUTC: true,
      enableArithAbort: true,
      appName: 'insight-analytics',
    },
  };
}

/**
 * A Fabric REST token for this service principal.
 *
 * Not cached. These are short requests made once per discovery, and a token
 * cache keyed by client id would be a place decrypted credentials linger.
 */
async function accessToken({ tenantId, clientId, clientSecret }) {
  const response = await fetch(tokenUrl(tenantId), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: tokenBody({ clientId, clientSecret }),
  });

  const { token, error } = parseToken(await response.json().catch(() => null));
  if (!token) throw new Error(`Microsoft would not issue a token: ${error}`);
  return token;
}

async function getJson(url, token) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) {
    // 401 here means the token is fine but the principal has no access, which
    // is a different fix from a bad secret and worth saying so.
    if (response.status === 401 || response.status === 403) return null;
    throw new Error(`Fabric answered ${response.status} for ${new URL(url).pathname}.`);
  }
  return response.json().catch(() => null);
}

/**
 * Every warehouse and lakehouse this service principal can reach.
 *
 * A workspace it cannot read is skipped rather than failing the whole listing:
 * a principal is routinely granted one workspace out of twenty, and refusing to
 * show that one because the other nineteen are private would be useless.
 */
export async function listItems(config) {
  const token = await accessToken(config);

  const workspaces = parseWorkspaces(await getJson(workspacesUrl(), token));
  if (!workspaces.length) {
    throw new Error(
      'That application signed in, but it can see no Fabric workspaces. Grant it access to a workspace, then try again.'
    );
  }

  const groups = [];
  for (const workspace of workspaces) {
    const [warehouses, lakehouses] = await Promise.all([
      getJson(warehousesUrl(workspace.id), token).catch(() => null),
      getJson(lakehousesUrl(workspace.id), token).catch(() => null),
    ]);
    groups.push({
      workspace,
      items: [
        ...parseWarehouses(warehouses, workspace),
        ...parseLakehouses(lakehouses, workspace),
      ],
    });
  }

  return flattenCatalog(groups);
}

const tds = createTdsDriver({
  id: 'fabric',
  dialect: 'sqlserver',
  configFor,
  hostFor: endpointOf,
});

/**
 * Every SQL method needs a target, which a freshly saved connection does not
 * have. Saying so beats a TDS error about an empty hostname.
 */
function requireTarget(config) {
  if (!config?.endpoint || !config?.database) {
    throw new Error('Choose a warehouse or lakehouse for this connection first.');
  }
}

export const driver = {
  ...tds,
  listItems,
  testConnection: async (config) => {
    // Before a target is chosen, "does this connection work" means "do these
    // credentials work" — which is exactly what listing the catalog proves.
    if (!config?.endpoint || !config?.database) {
      const items = await listItems(config);
      return {
        ok: true,
        detail: `${items.length} ${items.length === 1 ? 'item' : 'items'} available. Choose one to finish.`,
        needsTarget: true,
      };
    }
    return tds.testConnection(config);
  },
  listTables: (config, ...rest) => (requireTarget(config), tds.listTables(config, ...rest)),
  previewTable: (config, ...rest) => (requireTarget(config), tds.previewTable(config, ...rest)),
  fetchTable: (config, ...rest) => (requireTarget(config), tds.fetchTable(config, ...rest)),
  fetchRows: (config, ...rest) => (requireTarget(config), tds.fetchRows(config, ...rest)),
};
