/**
 * What each data source needs to be asked for.
 *
 * This is the half of the connector interface that has no driver behind it yet:
 * the field definitions the connection form renders and the vault splits on. It
 * is deliberately separate from the drivers so the form, the validation and the
 * secret classification exist and can be tested before any database is dialled.
 *
 * Field naming is load-bearing. `lib/vault/crypto.js` decides what goes into
 * the vault by matching field names against a secret-shaped pattern, so a field
 * marked `secret: true` here must also *look* secret to that matcher. There is
 * a test asserting exactly that, because the failure mode is a plaintext
 * password sitting in a table the browser can read.
 */

/** Phase from the connector plan; the UI uses it to say what is real yet. */
export const CONNECTORS = [
  {
    id: 'postgres',
    label: 'PostgreSQL',
    blurb: 'Any Postgres 12 or later, including RDS and Cloud SQL.',
    phase: 1,
    fields: [
      { name: 'host', label: 'Host', type: 'text', required: true, placeholder: 'db.example.com' },
      { name: 'port', label: 'Port', type: 'number', required: true, default: 5432 },
      { name: 'database', label: 'Database', type: 'text', required: true, placeholder: 'analytics' },
      { name: 'user', label: 'User', type: 'text', required: true, placeholder: 'analytics_ro' },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
      { name: 'ssl', label: 'Require TLS', type: 'boolean', default: true },
    ],
  },
  {
    id: 'supabase',
    label: 'Supabase',
    blurb: 'Postgres under the hood — use the connection pooler details from your project settings.',
    phase: 1,
    fields: [
      { name: 'host', label: 'Pooler host', type: 'text', required: true, placeholder: 'aws-0-region.pooler.supabase.com' },
      { name: 'port', label: 'Port', type: 'number', required: true, default: 6543 },
      { name: 'database', label: 'Database', type: 'text', required: true, default: 'postgres' },
      { name: 'user', label: 'User', type: 'text', required: true, placeholder: 'postgres.project-ref' },
      { name: 'password', label: 'Database password', type: 'password', required: true, secret: true },
      { name: 'ssl', label: 'Require TLS', type: 'boolean', default: true },
    ],
  },
  {
    id: 'mysql',
    label: 'MySQL / MariaDB',
    blurb: 'MySQL 5.7 or later, and MariaDB.',
    phase: 2,
    fields: [
      { name: 'host', label: 'Host', type: 'text', required: true },
      { name: 'port', label: 'Port', type: 'number', required: true, default: 3306 },
      { name: 'database', label: 'Database', type: 'text', required: true },
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
      { name: 'ssl', label: 'Require TLS', type: 'boolean', default: true },
    ],
  },
  {
    id: 'sqlserver',
    label: 'SQL Server',
    blurb: 'SQL Server 2016 or later, and Azure SQL.',
    phase: 2,
    fields: [
      { name: 'host', label: 'Server', type: 'text', required: true },
      { name: 'port', label: 'Port', type: 'number', required: true, default: 1433 },
      { name: 'database', label: 'Database', type: 'text', required: true },
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
      { name: 'encrypt', label: 'Encrypt connection', type: 'boolean', default: true },
    ],
  },
  {
    id: 'snowflake',
    label: 'Snowflake',
    blurb:
      'Needs a warehouse and role as well as a database — Snowflake bills against the warehouse. ' +
      'Password sign-in is being withdrawn for service users through 2026, so this uses key-pair or a ' +
      'programmatic access token.',
    phase: 3,
    fields: [
      { name: 'account', label: 'Account identifier', type: 'text', required: true, placeholder: 'ab12345.eu-west-1' },
      { name: 'warehouse', label: 'Warehouse', type: 'text', required: true },
      { name: 'database', label: 'Database', type: 'text', required: true },
      { name: 'schema', advanced: true, label: 'Schema', type: 'text', default: 'PUBLIC' },
      { name: 'role', advanced: true, label: 'Role', type: 'text', placeholder: 'ANALYST_RO' },
      { name: 'user', label: 'User', type: 'text', required: true },
      {
        // NOT `authMethod`: that contains "auth", which the vault's name
        // matcher reads as secret-shaped, so the chosen method would be
        // encrypted and the form could never show it back.
        name: 'signInMethod',
        label: 'Sign-in method',
        type: 'select',
        default: 'keypair',
        options: [
          { value: 'keypair', label: 'Key pair (recommended)' },
          { value: 'pat', label: 'Programmatic access token' },
        ],
      },
      {
        name: 'privateKey',
        label: 'Private key (PEM)',
        type: 'textarea',
        secret: true,
        requiredWhen: { signInMethod: 'keypair' },
        placeholder: '-----BEGIN PRIVATE KEY-----',
      },
      {
        name: 'privateKeyPassphrase',
        label: 'Key passphrase',
        type: 'password',
        secret: true,
        placeholder: 'only if the key is encrypted',
      },
      {
        name: 'token',
        label: 'Access token',
        type: 'password',
        secret: true,
        requiredWhen: { signInMethod: 'pat' },
      },
    ],
  },
  {
    id: 'oracle',
    label: 'Oracle',
    blurb:
      'Uses the pure-JavaScript thin driver, so no Oracle client install is needed. ' +
      'For Autonomous Database, paste the connect string from your tnsnames.ora.',
    phase: 4,
    fields: [
      {
        name: 'connectMode',
        label: 'How to connect',
        type: 'select',
        default: 'easy',
        options: [
          { value: 'easy', label: 'Host and service name' },
          { value: 'descriptor', label: 'Full connect string (TNS / Autonomous DB)' },
        ],
      },
      { name: 'host', label: 'Host', type: 'text', requiredWhen: { connectMode: 'easy' } },
      { name: 'port', label: 'Port', type: 'number', default: 1521, requiredWhen: { connectMode: 'easy' } },
      {
        name: 'serviceName',
        label: 'Service name',
        type: 'text',
        placeholder: 'ORCLPDB1',
        requiredWhen: { connectMode: 'easy' },
      },
      {
        name: 'connectString',
        label: 'Connect string',
        type: 'textarea',
        requiredWhen: { connectMode: 'descriptor' },
        placeholder: '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=...)(PORT=1522))(CONNECT_DATA=(SERVICE_NAME=...)))',
      },
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
    ],
  },
  {
    id: 'fabric',
    label: 'Microsoft Fabric',
    blurb:
      'Signs in with Entra ID rather than a password. Register an application, give it a client secret, ' +
      'and grant it access to the workspace — queries run as that application, not as you.',
    phase: 5,
    oauth: true,
    fields: [
      {
        name: 'endpoint',
        label: 'SQL analytics endpoint',
        type: 'text',
        required: true,
        placeholder: 'abc123.datawarehouse.fabric.microsoft.com',
      },
      { name: 'database', label: 'Warehouse or lakehouse', type: 'text', required: true },
      { name: 'tenantId', label: 'Directory (tenant) ID', type: 'text', required: true },
      { name: 'clientId', label: 'Application (client) ID', type: 'text', required: true },
      { name: 'clientSecret', label: 'Client secret', type: 'password', required: true, secret: true },
    ],
  },
  {
    id: 'tableau',
    label: 'Tableau',
    blurb: 'Reads published data sources only — data inside an unpublished workbook is not reachable.',
    phase: 6,
    fields: [
      { name: 'server', label: 'Server URL', type: 'text', required: true, placeholder: 'https://10ax.online.tableau.com' },
      { name: 'site', label: 'Site content URL', type: 'text', placeholder: 'leave blank for Default' },
      // Named `patName` rather than `personalAccessTokenName` on purpose: the
      // latter contains "token" and would be vaulted as a secret, so the UI
      // could never show the user which token they had configured.
      { name: 'patName', label: 'Access token name', type: 'text', required: true },
      { name: 'patSecret', label: 'Access token secret', type: 'password', required: true, secret: true },
    ],
  },
];

export function getConnector(id) {
  return CONNECTORS.find((c) => c.id === id) || null;
}

/** Field names that must end up in the vault for this source. */
export function secretFields(id) {
  return (getConnector(id)?.fields || []).filter((f) => f.secret).map((f) => f.name);
}

/** A blank config with the declared defaults applied. */
export function defaultConfig(id) {
  const out = {};
  for (const field of getConnector(id)?.fields || []) {
    if (field.default !== undefined) out[field.name] = field.default;
  }
  return out;
}

/**
 * Check a submitted config against the declared fields.
 * Returns a list of human-readable problems; empty means it is usable.
 */
export function validateConfig(id, config = {}) {
  const connector = getConnector(id);
  if (!connector) return [`Unknown source "${id}".`];

  const problems = [];
  for (const field of connector.fields) {
    const value = config[field.name];
    const missing = value === undefined || value === null || String(value).trim() === '';

    // `requiredWhen` covers a field that only matters for one sign-in method —
    // a private key is required for key-pair and meaningless for a token.
    const conditionallyRequired =
      field.requiredWhen &&
      Object.entries(field.requiredWhen).every(([key, expected]) => config[key] === expected);

    if ((field.required || conditionallyRequired) && missing) {
      problems.push(`${field.label} is required.`);
    }
    if (!missing && field.type === 'number' && Number.isNaN(Number(value))) {
      problems.push(`${field.label} must be a number.`);
    }
    if (!missing && field.type === 'select' && field.options) {
      const allowed = field.options.map((o) => o.value);
      if (!allowed.includes(value)) problems.push(`${field.label} must be one of: ${allowed.join(', ')}.`);
    }
  }
  return problems;
}
