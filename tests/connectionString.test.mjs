import test from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTION_STRING_EXAMPLES, parseConnectionString } from '../lib/connectors/connectionString.js';
import { CONNECTORS, validateConfig } from '../lib/connectors/registry.js';

test('a Postgres URI fills every field the form asks for', () => {
  const { source, config, error } = parseConnectionString(
    'postgresql://reader:s3cret@db.example.com:5432/analytics?sslmode=require'
  );
  assert.equal(error, null);
  assert.equal(source, 'postgres');
  assert.deepEqual(config, {
    host: 'db.example.com',
    port: 5432,
    database: 'analytics',
    user: 'reader',
    password: 's3cret',
    ssl: true,
  });
});

test('the host decides which Postgres it is', () => {
  // A generic "PostgreSQL" entry would be correct and unhelpful: the label, the
  // default database and the placeholder all differ.
  assert.equal(
    parseConnectionString('postgresql://u:p@ep-cool-123.eu-central-1.aws.neon.tech/neondb?sslmode=require').source,
    'neon'
  );
  assert.equal(
    parseConnectionString('postgresql://postgres.abc:p@aws-0-eu-west-1.pooler.supabase.com:6543/postgres').source,
    'supabase'
  );
  assert.equal(parseConnectionString('postgresql://u:p@db.example.com/analytics').source, 'postgres');
});

test('a missing port falls back to the one that source uses', () => {
  assert.equal(parseConnectionString('postgresql://u:p@h.example.com/db').config.port, 5432);
  assert.equal(parseConnectionString('mysql://u:p@h.example.com/db').config.port, 3306);
  assert.equal(parseConnectionString('postgresql://u:p@x.pooler.supabase.com/postgres').config.port, 6543);
});

test('a password with URL-unsafe characters survives', () => {
  // Managed providers generate these constantly, and a password decoded wrongly
  // fails to connect with an error that points at the database, not at us.
  const { config } = parseConnectionString('postgresql://u:p%40ss%3Aword%2F1@h.example.com/db');
  assert.equal(config.password, 'p@ss:word/1');
});

test('sslmode is read, and only "disable" turns TLS off', () => {
  assert.equal(parseConnectionString('postgresql://u:p@h.example.com/db?sslmode=require').config.ssl, true);
  assert.equal(parseConnectionString('postgresql://u:p@h.example.com/db?sslmode=verify-full').config.ssl, true);
  assert.equal(parseConnectionString('postgresql://u:p@h.example.com/db?sslmode=disable').config.ssl, false);
  assert.equal(parseConnectionString('postgresql://u:p@h.example.com/db').config.ssl, true, 'on by default');
});

test('a JDBC prefix and surrounding quotes are tolerated', () => {
  const bare = parseConnectionString('postgresql://u:p@h.example.com/db');
  assert.deepEqual(parseConnectionString('jdbc:postgresql://u:p@h.example.com/db').config, bare.config);
  assert.deepEqual(parseConnectionString('"postgresql://u:p@h.example.com/db"').config, bare.config);
  assert.deepEqual(parseConnectionString('  postgresql://u:p@h.example.com/db  ').config, bare.config);
});

test('the SQL Server key=value dialect is read too', () => {
  // What the Azure portal's "connection strings" tab copies.
  const { source, config, error } = parseConnectionString(
    'Server=tcp:db.database.windows.net,1433;Initial Catalog=analytics;User ID=reader;Password=s3cret;Encrypt=true'
  );
  assert.equal(error, null);
  assert.equal(source, 'sqlserver');
  assert.equal(config.host, 'db.database.windows.net');
  assert.equal(config.port, 1433);
  assert.equal(config.database, 'analytics');
  assert.equal(config.user, 'reader');
  assert.equal(config.password, 's3cret');
  assert.equal(config.encrypt, true);
});

test('Snowflake is addressed by account and carries its warehouse', () => {
  const { source, config } = parseConnectionString(
    'snowflake://reader:tok3n@ab12345.eu-west-1.snowflakecomputing.com/ANALYTICS?warehouse=WH_RO&role=ANALYST'
  );
  assert.equal(source, 'snowflake');
  assert.equal(config.account, 'ab12345.eu-west-1');
  assert.equal(config.warehouse, 'WH_RO');
  assert.equal(config.database, 'ANALYTICS');
  assert.equal(config.role, 'ANALYST');
  assert.equal(config.signInMethod, 'pat', 'a URI cannot carry a key pair');
  assert.equal(config.token, 'tok3n');
});

test('what the string left out is named, not guessed at', () => {
  const noPassword = parseConnectionString('postgresql://reader@db.example.com/analytics');
  assert.equal(noPassword.config, null);
  assert.match(noPassword.error, /missing a password/);

  const noDatabase = parseConnectionString('postgresql://reader:p@db.example.com');
  assert.match(noDatabase.error, /missing a database name/);
});

test('something that is not a connection string says so', () => {
  assert.match(parseConnectionString('').error, /Paste a connection string/);
  assert.match(parseConnectionString('just some words').error, /does not look like a connection string/);
  assert.match(parseConnectionString('redis://u:p@h.example.com/0').error, /not a database this app connects to/);
  assert.match(parseConnectionString('postgresql://').error, /no host|could not be read/);
});

test('every parsed config passes the form validation it will land in', () => {
  // The string is a faster way to fill the form in, so whatever it produces has
  // to be something the form would have accepted.
  for (const [source, example] of Object.entries(CONNECTION_STRING_EXAMPLES)) {
    const parsed = parseConnectionString(example);
    assert.equal(parsed.error, null, `${source}: ${parsed.error}`);
    assert.equal(parsed.source, source, `${source} example parsed as ${parsed.source}`);
    assert.deepEqual(validateConfig(parsed.source, parsed.config), [], `${source} config is incomplete`);
  }
});

test('there is an example for every source that can be pasted', () => {
  const pasteable = CONNECTORS.filter((c) => ['postgres', 'neon', 'supabase', 'mysql', 'sqlserver', 'snowflake'].includes(c.id));
  for (const connector of pasteable) {
    assert.ok(CONNECTION_STRING_EXAMPLES[connector.id], `${connector.id} has no example string`);
  }
});
