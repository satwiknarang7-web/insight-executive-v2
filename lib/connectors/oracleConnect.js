/**
 * Building and inspecting Oracle connect strings.
 *
 * Oracle is the only source here where the user may hand over a whole connect
 * descriptor rather than a host and a port. That flexibility is necessary —
 * it is how Autonomous Database and TNS aliases are reached — and it is also
 * how a host gets past a check that only looks at a `host` field.
 *
 * So the host is extracted from whatever form the connect string takes, and
 * every host found is checked. Kept out of the driver, and free of
 * `server-only`, so the parsing can be tested directly.
 */

/** Owners whose tables are Oracle's own plumbing rather than anyone's data. */
export const SYSTEM_SCHEMAS = [
  'SYS', 'SYSTEM', 'XDB', 'MDSYS', 'CTXSYS', 'DBSNMP', 'OUTLN', 'ORDSYS',
  'ORDDATA', 'OLAPSYS', 'WMSYS', 'APPQOSSYS', 'AUDSYS', 'GSMADMIN_INTERNAL',
  'LBACSYS', 'DVSYS', 'OJVMSYS', 'RDSADMIN',
];

/**
 * Compose the connect string.
 *
 * `descriptor` mode passes the user's text through untouched — a TNS
 * descriptor or an Autonomous Database connect string has structure this code
 * has no business rewriting.
 */
export function buildConnectString(config = {}) {
  if (config.connectMode === 'descriptor') {
    const descriptor = String(config.connectString || '').trim();
    if (!descriptor) throw new Error('A connect string is required.');
    return descriptor;
  }

  const host = String(config.host || '').trim();
  const service = String(config.serviceName || '').trim();
  if (!host) throw new Error('A host is required.');
  if (!service) throw new Error('A service name is required.');

  const port = Number(config.port) || 1521;
  // Easy Connect. The leading // is optional but makes the form unambiguous
  // when a service name contains a colon.
  return `//${host}:${port}/${service}`;
}

const DESCRIPTOR_HOST_RE = /\(\s*HOST\s*=\s*([^)\s]+)\s*\)/gi;

/**
 * Every host a connect string would dial.
 *
 * A descriptor can carry several ADDRESS entries for failover, so all of them
 * are returned — checking only the first would let the rest go unexamined.
 */
export function hostsIn(connectString) {
  const text = String(connectString || '').trim();
  if (!text) return [];

  // TNS descriptor form: (DESCRIPTION=(ADDRESS=(HOST=...)(PORT=...))...)
  if (text.includes('(')) {
    const hosts = [];
    for (const match of text.matchAll(DESCRIPTOR_HOST_RE)) {
      const host = match[1].trim().replace(/^["']|["']$/g, '');
      if (host) hosts.push(host);
    }
    return [...new Set(hosts)];
  }

  // Easy Connect form: [protocol://]host[:port][/service][?params]
  let rest = text.replace(/^[a-z]+:\/\//i, '').replace(/^\/\//, '');
  rest = rest.split('?')[0].split('/')[0];

  // An IPv6 literal is bracketed, so the colons inside are not port separators.
  const bracketed = /^\[([^\]]+)\]/.exec(rest);
  if (bracketed) return [bracketed[1]];

  const host = rest.split(':')[0].trim();
  return host ? [host] : [];
}

/**
 * Reject a connect string that carries anything other than connection detail.
 *
 * Oracle descriptors accept a great many parameters, and a few of them point at
 * the filesystem or run a program. None of those belong in a value typed into a
 * web form.
 */
const FORBIDDEN_PARAMS = /\b(WALLET_LOCATION|SECURITY\s*=\s*\(\s*SSL_SERVER_CERT_DN|PROGRAM|SHELL|EXTPROC|IFILE)\b/i;

export function assertSafeConnectString(connectString) {
  const text = String(connectString || '');
  const hit = FORBIDDEN_PARAMS.exec(text);
  if (hit) {
    throw new Error(`"${hit[1]}" is not allowed in a connect string here.`);
  }
  if (hostsIn(text).length === 0) {
    throw new Error('No host could be found in that connect string.');
  }
  return text;
}
