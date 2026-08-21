/**
 * The safety rails every connector runs behind.
 *
 * Accepting a hostname and a query from a user, then dialling out from your
 * server, is a request forger unless it is fenced. Three fences live here:
 *
 *   1. where the server is allowed to connect  (SSRF)
 *   2. what the query is allowed to be         (read-only)
 *   3. how much it is allowed to return        (row and time caps)
 *
 * All of it is pure and synchronous apart from the DNS lookup, so it can be
 * tested directly rather than inferred from a driver's behaviour.
 */
import dns from 'node:dns/promises';
import net from 'node:net';

/** Rows a single import may pull. The browser engine holds them all in memory. */
export const MAX_ROWS = Number(process.env.CONNECTOR_MAX_ROWS || 50000);
/** How long a query may run before it is cancelled, in milliseconds. */
export const QUERY_TIMEOUT_MS = Number(process.env.CONNECTOR_QUERY_TIMEOUT_MS || 30000);
/** How long to wait for a connection to open. */
export const CONNECT_TIMEOUT_MS = Number(process.env.CONNECTOR_CONNECT_TIMEOUT_MS || 10000);

/**
 * Whether the server may reach private address space.
 *
 * True suits a self-hosted deployment, where the database is usually on the
 * same private network as the app and refusing to reach it would make the
 * product useless. A shared, multi-tenant deployment must set this to `false`:
 * there, a user-supplied host reaching 10.0.0.0/8 is someone else's database.
 */
export const ALLOW_PRIVATE_HOSTS = process.env.CONNECTOR_ALLOW_PRIVATE_HOSTS !== 'false';

export class BlockedHost extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlockedHost';
    this.status = 400;
  }
}

export class UnsafeQuery extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsafeQuery';
    this.status = 400;
  }
}

// ---------------------------------------------------------------------------
// Where the server may connect
// ---------------------------------------------------------------------------

/**
 * Classify an IP address into the categories that matter for egress policy.
 *
 * `metadata` is called out separately from `link-local` because 169.254.169.254
 * is the cloud instance-metadata endpoint — the single most valuable SSRF
 * target there is, since it hands out credentials for the host itself. It is
 * never a legitimate database, so it is refused whatever the policy says.
 */
export function classifyAddress(ip) {
  const address = String(ip || '').trim();

  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);

    if (address === '169.254.169.254') return 'metadata';
    if (a === 127) return 'loopback';
    if (a === 0) return 'unspecified';
    if (a === 10) return 'private';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 169 && b === 254) return 'link-local';
    if (a === 100 && b >= 64 && b <= 127) return 'private'; // carrier-grade NAT
    if (a >= 224) return 'multicast';
    return 'public';
  }

  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::1') return 'loopback';
    if (lower === '::') return 'unspecified';
    // IPv4-mapped (::ffff:10.0.0.1) must be judged on the address it carries,
    // or every v4 rule above is trivially bypassed.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return classifyAddress(mapped[1]);
    if (lower.startsWith('fe80')) return 'link-local';
    if (/^f[cd]/.test(lower)) return 'private'; // unique local
    if (lower.startsWith('ff')) return 'multicast';
    return 'public';
  }

  return 'unknown';
}

/** Categories nothing may ever reach, whatever the deployment's policy. */
const ALWAYS_BLOCKED = new Set(['metadata', 'multicast', 'unspecified', 'unknown']);
/** Categories only a permissive (self-hosted) deployment may reach. */
const PRIVATE_CATEGORIES = new Set(['private', 'loopback', 'link-local']);

/**
 * Resolve a hostname and refuse it if any address it maps to is off-limits.
 *
 * Every address is checked, not just the first: a host that resolves to one
 * public and one internal address would otherwise pass here and connect to the
 * internal one, which is precisely the DNS-rebinding trick this exists to stop.
 */
export async function assertSafeHost(host, { allowPrivate = ALLOW_PRIVATE_HOSTS, resolver = null } = {}) {
  const name = String(host || '').trim();
  if (!name) throw new BlockedHost('A host is required.');

  // A literal address needs no lookup.
  const literal = net.isIP(name) ? [name] : null;
  let addresses;

  if (literal) {
    addresses = literal;
  } else {
    try {
      const lookup = resolver || ((h) => dns.lookup(h, { all: true, verbatim: true }));
      const results = await lookup(name);
      addresses = (Array.isArray(results) ? results : [results]).map((r) =>
        typeof r === 'string' ? r : r.address
      );
    } catch {
      throw new BlockedHost(`${name} could not be resolved.`);
    }
  }

  if (addresses.length === 0) throw new BlockedHost(`${name} resolved to no addresses.`);

  for (const address of addresses) {
    const kind = classifyAddress(address);

    if (ALWAYS_BLOCKED.has(kind)) {
      throw new BlockedHost(
        kind === 'metadata'
          ? 'That host points at the cloud metadata endpoint, which is never a database.'
          : `${name} resolves to an address this server will not connect to.`
      );
    }
    if (PRIVATE_CATEGORIES.has(kind) && !allowPrivate) {
      throw new BlockedHost(
        `${name} resolves to a private address. This deployment only connects to public hosts.`
      );
    }
  }

  return addresses;
}

// ---------------------------------------------------------------------------
// What the query may be
// ---------------------------------------------------------------------------

/**
 * Remove comments and string literals so keyword matching cannot be fooled by
 * a semicolon or a `DROP` sitting inside quoted text.
 */
export function stripLiterals(sql) {
  let out = '';
  let i = 0;
  const s = String(sql ?? '');

  while (i < s.length) {
    const two = s.slice(i, i + 2);

    if (two === '--') {
      const end = s.indexOf('\n', i);
      i = end === -1 ? s.length : end;
      continue;
    }
    if (two === '/*') {
      const end = s.indexOf('*/', i + 2);
      i = end === -1 ? s.length : end + 2;
      continue;
    }
    if (s[i] === "'" || s[i] === '"') {
      const quote = s[i];
      i++;
      while (i < s.length) {
        if (s[i] === quote) {
          // A doubled quote is an escaped quote, not the end of the literal.
          if (s[i + 1] === quote) i += 2;
          else {
            i++;
            break;
          }
        } else i++;
      }
      out += ' ';
      continue;
    }
    out += s[i];
    i++;
  }
  return out;
}

/** Statements that must never run through a connector, whatever the role allows. */
const FORBIDDEN = /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|merge|call|do|copy|vacuum|reindex|comment|set|begin|commit|rollback|listen|notify|lock)\b/i;

/**
 * Accept exactly one read-only statement.
 *
 * This is defence in depth, not the actual control — the real one is connecting
 * with a read-only database role, which the UI tells users to do. A parser can
 * always be outwitted; a role that lacks INSERT cannot.
 */
export function assertReadOnlySql(sql) {
  const raw = String(sql ?? '').trim();
  if (!raw) throw new UnsafeQuery('A query is required.');

  const bare = stripLiterals(raw).trim().replace(/;\s*$/, '');

  if (bare.includes(';')) {
    throw new UnsafeQuery('Only one statement can be run at a time.');
  }
  if (!/^\s*(select|with)\b/i.test(bare)) {
    throw new UnsafeQuery('Only SELECT queries are allowed.');
  }
  const forbidden = FORBIDDEN.exec(bare);
  if (forbidden) {
    throw new UnsafeQuery(`"${forbidden[1].toUpperCase()}" is not allowed here — this connection is read-only.`);
  }
  // `WITH x AS (INSERT ... RETURNING)` is a writable CTE and would be caught
  // above; this catches the SELECT INTO form, which creates a table.
  if (/\binto\b/i.test(bare) && !/\binsert\b/i.test(bare)) {
    throw new UnsafeQuery('SELECT INTO writes a new table, which is not allowed here.');
  }
  return bare;
}

/**
 * Cap how many rows a query may return.
 *
 * Applied by the driver as a hard fetch limit rather than by rewriting the SQL,
 * because appending LIMIT to arbitrary user SQL is its own source of bugs.
 */
export function rowLimit(requested) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return MAX_ROWS;
  return Math.min(Math.floor(n), MAX_ROWS);
}

/**
 * Strip anything that could carry a credential out of a driver error before it
 * is logged or returned. Postgres in particular echoes the connection string.
 */
export function safeErrorMessage(error) {
  const message = String(error?.message || 'The database could not be reached.');
  return message
    .replace(/password=[^\s;]+/gi, 'password=***')
    .replace(/:\/\/[^@\s]+@/g, '://***@')
    .slice(0, 300);
}
