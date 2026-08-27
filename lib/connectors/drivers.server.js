import 'server-only';

/**
 * Which driver serves which source.
 *
 * Imports are dynamic so a request for Postgres never loads the MySQL or SQL
 * Server driver — each pulls in a sizeable dependency tree, and a serverless
 * cold start pays for every module it touches.
 *
 * Several sources deliberately share a driver, or most of one. Supabase and
 * Neon *are* Postgres — they differ only in which host you type and what the
 * defaults should be, which is the registry's business rather than the driver's.
 * Fabric and SQL Server both speak TDS and share everything except how they
 * authenticate, which is why the protocol work lives in `tds.server.js` and
 * each of them supplies only a connection config.
 */

const LOADERS = {
  postgres: () => import('./postgres.server.js'),
  supabase: () => import('./postgres.server.js'),
  neon: () => import('./postgres.server.js'),
  mysql: () => import('./mysql.server.js'),
  sqlserver: () => import('./sqlserver.server.js'),
  snowflake: () => import('./snowflake.server.js'),
  oracle: () => import('./oracle.server.js'),
  fabric: () => import('./fabric.server.js'),
  tableau: () => import('./tableau.server.js'),
};

/** Sources that can actually run a query today. */
export const IMPLEMENTED = Object.freeze(Object.keys(LOADERS));

/** Load the driver for a source, or null when none is built yet. */
export async function driverFor(source) {
  const load = LOADERS[source];
  if (!load) return null;
  return (await load()).driver;
}

export function isImplemented(source) {
  return Object.prototype.hasOwnProperty.call(LOADERS, source);
}
