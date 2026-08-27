/**
 * Turning a connection string into the fields the form asks for.
 *
 * Nobody types a host, a port, a database, a user and a password one box at a
 * time when their provider has already handed them a single line that contains
 * all five. Neon, Supabase, Render, Railway and every managed Postgres put a
 * `postgresql://…` URI on the dashboard with a copy button next to it; MySQL
 * and SQL Server do the same in their own dialects. Retyping that into six
 * fields is transcription work, and transcription is where the typo comes from.
 *
 * So this parses the string into a config the existing form can show, and the
 * user still sees every field before anything is saved — the string is a faster
 * way to fill the form in, not a way to bypass it. That matters: the password
 * goes to the vault exactly as it would have if it were typed, and the user can
 * see what they are about to store.
 *
 * The source is inferred from the scheme and then narrowed by the host, because
 * `postgresql://…@ep-x.neon.tech/db` is Neon and `…@aws-0-eu.pooler.supabase.com`
 * is Supabase, and picking the right one means the right defaults and the right
 * label rather than a generic "PostgreSQL" entry the user has to correct.
 *
 * Pure: no imports, no network, no side effects.
 */

/** URI schemes, and the source each one means before the host is considered. */
const SCHEMES = {
  postgres: 'postgres',
  postgresql: 'postgres',
  mysql: 'mysql',
  mariadb: 'mysql',
  mssql: 'sqlserver',
  sqlserver: 'sqlserver',
  jdbc: null, // handled below — the real scheme is the next segment
  snowflake: 'snowflake',
};

/** Host patterns that identify a specific managed provider. */
const BY_HOST = [
  { test: /\.neon\.tech$/i, source: 'neon' },
  { test: /\.pooler\.supabase\.com$|\.supabase\.co$/i, source: 'supabase' },
];

const fail = (error) => ({ source: null, config: null, error });

/** Percent-decoding that does not throw on a stray % in a password. */
function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Read a `key=value;key=value` string — the ADO.NET / ODBC shape.
 *
 * SQL Server and Azure SQL hand out this rather than a URI, and it is what the
 * Azure portal's "connection strings" tab copies.
 */
function parseKeyValue(text) {
  const out = {};
  for (const part of text.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const key = part.slice(0, at).trim().toLowerCase().replace(/\s+/g, '');
    const value = part.slice(at + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

const pick = (bag, ...names) => {
  for (const name of names) {
    if (bag[name] !== undefined && bag[name] !== '') return bag[name];
  }
  return undefined;
};

/** Does this string carry TLS instructions, and do they say yes? */
function tlsFrom(params, fallback = true) {
  const mode = String(
    params.get?.('sslmode') ?? params.get?.('ssl') ?? params.sslmode ?? params.ssl ?? params.encrypt ?? ''
  ).toLowerCase();
  if (!mode) return fallback;
  if (['disable', 'false', 'off', 'no', '0'].includes(mode)) return false;
  return true;
}

/**
 * Parse a connection string into `{ source, config, error }`.
 *
 * `error` is a sentence for the user; `config` is shaped exactly like the one
 * the form builds, so the caller can drop it straight into the field state.
 */
export function parseConnectionString(text) {
  let raw = String(text ?? '').trim();
  if (!raw) return fail('Paste a connection string first.');

  // A JDBC URL is the same thing with a prefix: jdbc:postgresql://…
  if (/^jdbc:/i.test(raw)) raw = raw.slice(5);

  // Wrapped in quotes by a shell or a docs page.
  raw = raw.replace(/^["']|["']$/g, '');

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    // Not a URI. The key=value dialect is the other thing people paste.
    if (raw.includes('=')) return fromKeyValue(raw);
    return fail('That does not look like a connection string. It usually starts with postgresql:// or mysql://.');
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return fail('That connection string could not be read. Check it was copied whole.');
  }

  const scheme = url.protocol.replace(/:$/, '').toLowerCase();
  if (!(scheme in SCHEMES) || !SCHEMES[scheme]) {
    return fail(`“${scheme}” is not a database this app connects to.`);
  }

  const host = url.hostname;
  if (!host) return fail('That connection string has no host in it.');

  let source = SCHEMES[scheme];
  if (source === 'postgres') {
    source = BY_HOST.find((h) => h.test.test(host))?.source || 'postgres';
  }

  const user = decode(url.username || '');
  const password = decode(url.password || '');
  const database = decode(url.pathname.replace(/^\//, ''));
  const params = url.searchParams;

  if (source === 'snowflake') return snowflakeConfig({ host, user, password, database, params });

  const port = Number(url.port) || defaultPort(source);
  const config = { host, port, database, user, password };

  if (source === 'sqlserver') config.encrypt = tlsFrom(params, true);
  else config.ssl = tlsFrom(params, true);

  const missing = required(source, config);
  if (missing) return fail(missing);
  return { source, config, error: null };
}

/** Snowflake is addressed by account, not host, and needs a warehouse. */
function snowflakeConfig({ host, user, password, database, params }) {
  const account = host.replace(/\.snowflakecomputing\.com$/i, '');
  const config = {
    account,
    warehouse: params.get('warehouse') || '',
    database: database || params.get('db') || '',
    schema: params.get('schema') || 'PUBLIC',
    role: params.get('role') || '',
    user,
    // A password in the URI is a programmatic access token as far as this app
    // is concerned; key-pair sign-in cannot be expressed in a connection string.
    signInMethod: 'pat',
    token: password,
  };
  if (!config.account) return fail('That Snowflake string has no account in it.');
  if (!config.user) return fail('That Snowflake string has no user in it.');
  return { source: 'snowflake', config, error: null };
}

function fromKeyValue(text) {
  const bag = parseKeyValue(text);
  const server = pick(bag, 'server', 'datasource', 'addr', 'address', 'host') || '';
  if (!server) return fail('That connection string has no server in it.');

  // "tcp:host,1433" is how the Azure portal writes it.
  const cleaned = server.replace(/^tcp:/i, '');
  const [hostPart, portPart] = cleaned.split(/[,:]/);

  const config = {
    host: hostPart,
    port: Number(portPart) || 1433,
    database: pick(bag, 'database', 'initialcatalog') || '',
    user: pick(bag, 'user', 'userid', 'uid', 'username') || '',
    password: pick(bag, 'password', 'pwd') || '',
    encrypt: tlsFrom(bag, true),
  };

  const missing = required('sqlserver', config);
  if (missing) return fail(missing);
  return { source: 'sqlserver', config, error: null };
}

function defaultPort(source) {
  if (source === 'mysql') return 3306;
  if (source === 'sqlserver') return 1433;
  if (source === 'supabase') return 6543;
  return 5432;
}

/** What the string left out, said in the words the form uses. */
function required(source, config) {
  const missing = [];
  if (!config.host) missing.push('a host');
  if (!config.database) missing.push('a database name');
  if (!config.user) missing.push('a user');
  if (!config.password) missing.push('a password');
  if (!missing.length) return null;
  return `That connection string is missing ${list(missing)}. Fill the rest in below.`;
}

function list(items) {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** An example for each source, shown as the textarea's placeholder. */
export const CONNECTION_STRING_EXAMPLES = {
  postgres: 'postgresql://user:password@db.example.com:5432/analytics?sslmode=require',
  neon: 'postgresql://user:password@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require',
  supabase: 'postgresql://postgres.abcdefgh:password@aws-0-eu-west-1.pooler.supabase.com:6543/postgres',
  mysql: 'mysql://user:password@db.example.com:3306/analytics',
  sqlserver: 'Server=tcp:db.example.com,1433;Database=analytics;User Id=reader;Password=…;Encrypt=true',
  snowflake: 'snowflake://user:token@ab12345.eu-west-1.snowflakecomputing.com/ANALYTICS?warehouse=WH&role=ANALYST_RO',
};
