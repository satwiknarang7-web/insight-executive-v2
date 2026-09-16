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
    id: 'neon',
    label: 'Neon',
    // Stored as a Postgres connection, because it is one.
    //
    // `public.connections.source` carries a CHECK constraint listing the
    // permitted sources, so a connector the database has not been told about
    // cannot be saved at all — the insert fails with a check violation. That
    // makes adding a connector a schema migration, which is a poor trade for
    // something that is a label and a set of defaults over an existing driver.
    //
    // Neon speaks plain Postgres and uses the Postgres driver unchanged, so it
    // stores as `postgres` and remembers what it is in `config.provider`.
    // Everything the user sees — the label, the host placeholder, the default
    // database — still comes from this entry.
    storeAs: 'postgres',
    blurb:
      'Serverless Postgres. Everything below is on the project dashboard under Connect — or paste the ' +
      'connection string it offers and the fields fill themselves in.',
    phase: 1,
    fields: [
      {
        name: 'host',
        label: 'Host',
        type: 'text',
        required: true,
        placeholder: 'ep-cool-name-123456.eu-central-1.aws.neon.tech',
        help: 'The pooled host ends in -pooler; either works.',
      },
      { name: 'port', label: 'Port', type: 'number', required: true, default: 5432 },
      { name: 'database', label: 'Database', type: 'text', required: true, default: 'neondb' },
      { name: 'user', label: 'Role', type: 'text', required: true, placeholder: 'neondb_owner' },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
      // Neon terminates TLS at the endpoint and refuses plaintext, so this is
      // not really optional — it is shown so the form does not look different
      // from every other Postgres, and turning it off simply will not connect.
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
    id: 'redshift',
    label: 'Amazon Redshift',
    storeAs: 'postgres',
    blurb: 'Speaks Postgres on port 5439. Use the cluster endpoint from the Redshift console.',
    phase: 1,
    fields: [
      { name: 'host', label: 'Host', type: 'text', required: true, placeholder: 'cluster.abc123.eu-west-1.redshift.amazonaws.com' },
      { name: 'port', label: 'Port', type: 'number', required: true, default: 5439 },
      { name: 'database', label: 'Database', type: 'text', required: true, default: 'dev' },
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
      { name: 'ssl', label: 'Require TLS', type: 'boolean', default: true },
    ],
  },
  {
    id: 'cockroachdb',
    label: 'CockroachDB',
    storeAs: 'postgres',
    blurb: 'Postgres-compatible. Cockroach Cloud clusters need TLS, which is on by default here.',
    phase: 1,
    fields: [
      { name: 'host', label: 'Host', type: 'text', required: true, placeholder: 'cluster.aws-eu-west-1.cockroachlabs.cloud' },
      { name: 'port', label: 'Port', type: 'number', required: true, default: 26257 },
      { name: 'database', label: 'Database', type: 'text', required: true, default: 'defaultdb' },
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
      { name: 'ssl', label: 'Require TLS', type: 'boolean', default: true },
    ],
  },
  {
    id: 'timescale',
    label: 'Timescale',
    storeAs: 'postgres',
    blurb: 'Postgres with time-series tables. Everything below is on the service page under Connection info.',
    phase: 1,
    fields: [
      { name: 'host', label: 'Host', type: 'text', required: true, placeholder: 'service.tsdb.cloud.timescale.com' },
      { name: 'port', label: 'Port', type: 'number', required: true, default: 5432 },
      { name: 'database', label: 'Database', type: 'text', required: true, default: 'tsdb' },
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
      { name: 'ssl', label: 'Require TLS', type: 'boolean', default: true },
    ],
  },
  {
    id: 'alloydb',
    label: 'AlloyDB',
    storeAs: 'postgres',
    blurb: 'Postgres from Google Cloud. Connect through the Auth Proxy or a private address the server can reach.',
    phase: 1,
    fields: [
      { name: 'host', label: 'Host', type: 'text', required: true, placeholder: '10.0.0.5' },
      { name: 'port', label: 'Port', type: 'number', required: true, default: 5432 },
      { name: 'database', label: 'Database', type: 'text', required: true, default: 'postgres' },
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
      { name: 'ssl', label: 'Require TLS', type: 'boolean', default: true },
    ],
  },
  {
    id: 'rds-postgres',
    label: 'Amazon RDS / Aurora (Postgres)',
    storeAs: 'postgres',
    blurb: 'The writer or a reader endpoint from the RDS console. A reader is the better choice for analysis.',
    phase: 1,
    fields: [
      { name: 'host', label: 'Host', type: 'text', required: true, placeholder: 'db.cluster-ro-abc123.eu-west-1.rds.amazonaws.com' },
      { name: 'port', label: 'Port', type: 'number', required: true, default: 5432 },
      { name: 'database', label: 'Database', type: 'text', required: true, default: 'postgres' },
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
      { name: 'ssl', label: 'Require TLS', type: 'boolean', default: true },
    ],
  },
  {
    id: 'mariadb',
    label: 'MariaDB',
    storeAs: 'mysql',
    blurb: 'MariaDB 10.3 or later, through the MySQL driver.',
    phase: 2,
    fields: [
      { name: 'host', label: 'Host', type: 'text', required: true, placeholder: 'db.example.com' },
      { name: 'port', label: 'Port', type: 'number', required: true, default: 3306 },
      { name: 'database', label: 'Database', type: 'text', required: true },
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
      { name: 'ssl', label: 'Require TLS', type: 'boolean', default: true },
    ],
  },
  {
    id: 'tidb',
    label: 'TiDB',
    storeAs: 'mysql',
    blurb: 'MySQL-compatible. TiDB Cloud serverless needs TLS and a user of the form prefix.root.',
    phase: 2,
    fields: [
      { name: 'host', label: 'Host', type: 'text', required: true, placeholder: 'gateway01.eu-central-1.prod.aws.tidbcloud.com' },
      { name: 'port', label: 'Port', type: 'number', required: true, default: 4000 },
      { name: 'database', label: 'Database', type: 'text', required: true },
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
      { name: 'ssl', label: 'Require TLS', type: 'boolean', default: true },
    ],
  },
  {
    id: 'planetscale',
    label: 'PlanetScale',
    storeAs: 'mysql',
    blurb: 'MySQL-compatible. Create a password in the PlanetScale console and paste the host it shows.',
    phase: 2,
    fields: [
      { name: 'host', label: 'Host', type: 'text', required: true, placeholder: 'aws.connect.psdb.cloud' },
      { name: 'port', label: 'Port', type: 'number', required: true, default: 3306 },
      { name: 'database', label: 'Database', type: 'text', required: true },
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
      { name: 'ssl', label: 'Require TLS', type: 'boolean', default: true },
    ],
  },
  {
    id: 'singlestore',
    label: 'SingleStore',
    storeAs: 'mysql',
    blurb: 'MySQL-compatible. Use the workspace endpoint from the SingleStore portal.',
    phase: 2,
    fields: [
      { name: 'host', label: 'Host', type: 'text', required: true, placeholder: 'svc-abc123-dml.aws-eu-central-1.svc.singlestore.com' },
      { name: 'port', label: 'Port', type: 'number', required: true, default: 3306 },
      { name: 'database', label: 'Database', type: 'text', required: true },
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
      { name: 'ssl', label: 'Require TLS', type: 'boolean', default: true },
    ],
  },
  {
    id: 'rds-mysql',
    label: 'Amazon RDS / Aurora (MySQL)',
    storeAs: 'mysql',
    blurb: 'The writer or a reader endpoint from the RDS console.',
    phase: 2,
    fields: [
      { name: 'host', label: 'Host', type: 'text', required: true, placeholder: 'db.cluster-ro-abc123.eu-west-1.rds.amazonaws.com' },
      { name: 'port', label: 'Port', type: 'number', required: true, default: 3306 },
      { name: 'database', label: 'Database', type: 'text', required: true },
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
      { name: 'ssl', label: 'Require TLS', type: 'boolean', default: true },
    ],
  },
  {
    id: 'azuresql',
    label: 'Azure SQL',
    storeAs: 'sqlserver',
    blurb: 'Azure SQL Database and Managed Instance, through the SQL Server driver. Encryption is required.',
    phase: 2,
    fields: [
      { name: 'host', label: 'Server', type: 'text', required: true, placeholder: 'myserver.database.windows.net' },
      { name: 'port', label: 'Port', type: 'number', required: true, default: 1433 },
      { name: 'database', label: 'Database', type: 'text', required: true },
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
      { name: 'encrypt', label: 'Encrypt connection', type: 'boolean', default: true },
    ],
  },
  {
    id: 'clickhouse',
    label: 'ClickHouse',
    blurb: 'Over the HTTP interface, so no driver is installed. ClickHouse Cloud listens on 8443; a self-hosted server on 8123.',
    phase: 7,
    fields: [
      { name: 'host', label: 'HTTP endpoint', type: 'text', required: true, placeholder: 'https://abc123.eu-central-1.aws.clickhouse.cloud:8443' },
      { name: 'database', label: 'Database', type: 'text', default: 'default' },
      { name: 'user', label: 'User', type: 'text', required: true, default: 'default' },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
    ],
  },
  {
    id: 'databricks',
    label: 'Databricks SQL',
    blurb: 'A SQL warehouse, through the Statement Execution API. The warehouse id is the last part of its HTTP path.',
    phase: 7,
    fields: [
      { name: 'host', label: 'Workspace URL', type: 'text', required: true, placeholder: 'https://adb-1234567890123456.7.azuredatabricks.net' },
      { name: 'warehouseId', label: 'SQL warehouse id', type: 'text', required: true, placeholder: 'abc123def456' },
      { name: 'catalog', advanced: true, label: 'Catalog', type: 'text', placeholder: 'main' },
      { name: 'schema', advanced: true, label: 'Schema', type: 'text', placeholder: 'default' },
      { name: 'token', label: 'Access token', type: 'password', required: true, secret: true },
    ],
  },
  {
    id: 'trino',
    label: 'Trino / Presto / Starburst',
    blurb: 'The REST endpoint of the coordinator. Basic auth over HTTPS, or a bare user name on a cluster without authentication.',
    phase: 7,
    fields: [
      { name: 'host', label: 'Coordinator URL', type: 'text', required: true, placeholder: 'https://trino.example.com:8443' },
      { name: 'catalog', label: 'Catalog', type: 'text', required: true, placeholder: 'hive' },
      { name: 'schema', advanced: true, label: 'Schema', type: 'text', placeholder: 'default' },
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', secret: true, placeholder: 'leave blank if the cluster has no authentication' },
    ],
  },
  {
    id: 'mongodb',
    label: 'MongoDB',
    blurb: 'Atlas, DocumentDB and Cosmos DB for Mongo. Collections are read as tables, one level of nesting flattened into columns.',
    phase: 8,
    fields: [
      { name: 'host', label: 'Cluster host', type: 'text', required: true, placeholder: 'cluster0.abc12.mongodb.net' },
      { name: 'srv', label: 'SRV connection (Atlas)', type: 'boolean', default: true },
      { name: 'port', advanced: true, label: 'Port (non-SRV only)', type: 'number', default: 27017 },
      { name: 'database', label: 'Database', type: 'text', placeholder: 'leave blank to list every database' },
      { name: 'user', label: 'User', type: 'text', required: true },
      { name: 'password', label: 'Password', type: 'password', required: true, secret: true },
    ],
  },
  {
    id: 'airtable',
    label: 'Airtable',
    blurb: 'A personal access token with data.records:read and schema.bases:read. Every base the token can see is listed.',
    phase: 8,
    fields: [
      { name: 'baseId', label: 'Base id', type: 'text', placeholder: 'leave blank to list every base the token can read' },
      { name: 'token', label: 'Personal access token', type: 'password', required: true, secret: true },
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
    // Three fields, and no target.
    //
    // A SQL analytics endpoint is a generated hostname buried several clicks
    // into the Fabric portal, different for every warehouse and lakehouse, and
    // nobody has it to hand. Asking for it made this form look like it wanted a
    // database administrator — when the application credentials alone are
    // enough to go and *list* everything the service principal can read. So the
    // warehouse or lakehouse is chosen from a dropdown once these three work,
    // and its endpoint comes from the API, which is the only place that value
    // is authoritative anyway. `discovers` is what tells the UI to do that.
    discovers: 'fabricItems',
    fields: [
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

/**
 * Phases that have a driver behind them and may be named in public.
 *
 * Two pages make a claim about what the product supports. Both used to make it
 * from a hand-typed list, on the reasoning that a marketing claim should not
 * change silently because a driver appeared behind a feature flag. That is a
 * fair concern and the wrong remedy: both lists drifted anyway — each had
 * dropped Supabase and renamed three of the others — so the pages advertised
 * something different from the dropdown beside them.
 *
 * Deriving the list from here fixes the drift, and the phase gate keeps the
 * guarantee the typed lists were reaching for: a connector added at a phase
 * that has not shipped is absent from this set and cannot leak into a claim.
 */
export const AVAILABLE_PHASES = new Set([1, 2, 3, 4, 5, 6, 7, 8]);

/** Is this connector shipped, as opposed to planned? */
export function isAvailable(connector) {
  return AVAILABLE_PHASES.has(connector?.phase);
}

/** The connectors a customer can actually use today, in registry order. */
export function availableConnectors() {
  return CONNECTORS.filter(isAvailable);
}

export function getConnector(id) {
  return CONNECTORS.find((c) => c.id === id) || null;
}

/**
 * The value written to `connections.source` for a connector.
 *
 * Most store under their own id. One that declares `storeAs` is a flavour of
 * another — same driver, different defaults — and stores under the base source
 * so that adding it never requires a migration.
 */
export function storedSource(id) {
  return getConnector(id)?.storeAs || id;
}

/**
 * Which connector a saved row should be shown as.
 *
 * The stored source says which driver runs it; `config.provider` says which
 * flavour it was set up as. Reading the second first is what keeps a Neon
 * connection labelled "Neon" rather than collapsing into "PostgreSQL".
 */
export function connectorFor(connection) {
  return (
    getConnector(connection?.config?.provider) || getConnector(connection?.source) || null
  );
}

/** Does this saved row belong to the connector currently selected? */
export function connectionIsFor(connection, id) {
  return connectorFor(connection)?.id === id;
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
