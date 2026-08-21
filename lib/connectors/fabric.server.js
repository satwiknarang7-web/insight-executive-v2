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

export const driver = createTdsDriver({
  id: 'fabric',
  dialect: 'sqlserver',
  configFor,
  hostFor: endpointOf,
});
