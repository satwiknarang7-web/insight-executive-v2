import 'server-only';

/**
 * SQL Server, over TDS with username-and-password authentication.
 *
 * The protocol work lives in `tds.server.js`, shared with Microsoft Fabric —
 * the two speak the same wire protocol and differ only in how they prove who
 * you are. This file supplies the connection config and nothing else.
 */
import { createTdsDriver } from './tds.server.js';
import { parseSqlEndpoint } from './tdsEndpoint.js';
import { CONNECT_TIMEOUT_MS, QUERY_TIMEOUT_MS } from './guards.js';

const endpointOf = (config) => parseSqlEndpoint(config.host, Number(config.port) || 1433);

function configFor(config) {
  const { host, port } = endpointOf(config);
  return {
    server: host,
    port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    requestTimeout: QUERY_TIMEOUT_MS,
    pool: { max: 1, min: 0, idleTimeoutMillis: 1000 },
    options: {
      // Azure SQL refuses unencrypted connections outright, and an on-premise
      // server that cannot do TLS should be an explicit choice.
      encrypt: config.encrypt !== false,
      // Managed instances present certificates that rarely chain to a public
      // root from inside a serverless runtime.
      trustServerCertificate: true,
      // Without this a DATE is built at the server's local midnight and every
      // date in the dataset shifts by the offset once it is serialised.
      useUTC: true,
      enableArithAbort: true,
      appName: 'insight-analytics',
    },
  };
}

export const driver = createTdsDriver({
  id: 'sqlserver',
  dialect: 'sqlserver',
  configFor,
  hostFor: endpointOf,
});
