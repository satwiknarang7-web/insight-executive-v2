/**
 * Parsing a SQL Server / Fabric endpoint into a host and a port.
 *
 * People paste these from wherever they found them, and the forms differ by
 * tool: SSMS writes `host,1433`, a JDBC string writes `host:1433`, the Fabric
 * portal gives a bare hostname, and a copied URL brings a scheme with it.
 * Guessing wrong means the SSRF check inspects a string that is not a host.
 */

const DEFAULT_PORT = 1433;

export function parseSqlEndpoint(value, fallbackPort = DEFAULT_PORT) {
  let text = String(value ?? '').trim();
  if (!text) throw new Error('An endpoint is required.');

  // A pasted URL: drop the scheme and anything after the host.
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  text = text.split('/')[0].split('?')[0];

  // `tcp:host,1433` is what SSMS and some connection strings produce.
  text = text.replace(/^tcp:/i, '');

  let host = text;
  let port = fallbackPort;

  // An IPv6 literal is bracketed, so its colons are not port separators.
  const bracketed = /^\[([^\]]+)\](?:[:,](\d+))?$/.exec(text);
  if (bracketed) {
    host = bracketed[1];
    if (bracketed[2]) port = Number(bracketed[2]);
  } else {
    const separated = /^([^:,]+)[:,](\d+)$/.exec(text);
    if (separated) {
      host = separated[1];
      port = Number(separated[2]);
    }
  }

  host = host.trim();
  if (!host) throw new Error('No host could be found in that endpoint.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`"${port}" is not a valid port.`);
  }
  return { host, port };
}
