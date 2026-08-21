import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  CONNECTORS,
  getConnector,
  secretFields,
  defaultConfig,
  validateConfig,
} from '../lib/connectors/registry.js';

process.env.VAULT_MASTER_KEY = crypto.randomBytes(32).toString('base64');
const { stripSecrets, extractSecrets } = await import('../lib/vault/crypto.js');

// ---------------------------------------------------------------------------
// The coupling that matters: a field the registry calls secret must actually be
// classified as one by the vault, or it ends up in a browser-readable table.
// ---------------------------------------------------------------------------

test('every field marked secret is vaulted, not stored in the config', () => {
  for (const connector of CONNECTORS) {
    const config = {};
    for (const field of connector.fields) config[field.name] = `value-for-${field.name}`;

    const safe = stripSecrets(config);
    const vaulted = extractSecrets(config);

    for (const field of connector.fields) {
      if (field.secret) {
        assert.ok(
          field.name in vaulted,
          `${connector.id}.${field.name} is marked secret but the vault would not store it`
        );
        assert.ok(
          !(field.name in safe),
          `${connector.id}.${field.name} is marked secret but would be written to public.connections`
        );
      }
    }
  }
});

test('non-secret fields survive into the config the UI reads back', () => {
  for (const connector of CONNECTORS) {
    const config = {};
    for (const field of connector.fields) config[field.name] = `value-for-${field.name}`;
    const safe = stripSecrets(config);

    for (const field of connector.fields) {
      if (field.secret) continue;
      assert.ok(
        field.name in safe,
        `${connector.id}.${field.name} is not secret but was stripped — the UI could never show it`
      );
    }
  }
});

test('every source that authenticates has something to vault', () => {
  for (const connector of CONNECTORS) {
    if (connector.oauth) continue; // Fabric authenticates through Entra ID.
    assert.ok(
      secretFields(connector.id).length > 0,
      `${connector.id} declares no secret field, so saving it would store nothing in the vault`
    );
  }
});

// ---------------------------------------------------------------------------
// Registry shape
// ---------------------------------------------------------------------------

test('connector ids are unique and match the database check constraint', () => {
  const ids = CONNECTORS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate connector id');

  // public.connections has a CHECK on exactly this set; drift means an insert
  // fails at runtime with a constraint violation.
  const allowed = new Set([
    'postgres', 'supabase', 'mysql', 'sqlserver',
    'oracle', 'snowflake', 'fabric', 'tableau',
  ]);
  for (const id of ids) assert.ok(allowed.has(id), `${id} is not permitted by the connections CHECK constraint`);
  assert.equal(ids.length, allowed.size, 'the registry and the CHECK constraint have drifted apart');
});

test('field names are unique within a connector', () => {
  for (const connector of CONNECTORS) {
    const names = connector.fields.map((f) => f.name);
    assert.equal(new Set(names).size, names.length, `${connector.id} has a duplicate field name`);
  }
});

test('defaults come through as declared', () => {
  assert.equal(defaultConfig('postgres').port, 5432);
  assert.equal(defaultConfig('supabase').port, 6543);
  assert.equal(defaultConfig('postgres').ssl, true);
  assert.deepEqual(defaultConfig('nope'), {});
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('missing required fields are named, not just counted', () => {
  const problems = validateConfig('postgres', { host: 'db.example.com' });
  assert.ok(problems.some((p) => /Database is required/.test(p)));
  assert.ok(problems.some((p) => /Password is required/.test(p)));
  assert.ok(!problems.some((p) => /Host is required/.test(p)));
});

test('a complete config validates clean', () => {
  const problems = validateConfig('postgres', {
    host: 'db.example.com',
    port: 5432,
    database: 'analytics',
    user: 'ro',
    password: 'secret',
  });
  assert.deepEqual(problems, []);
});

test('a non-numeric port is rejected', () => {
  const problems = validateConfig('postgres', {
    host: 'h', port: 'not-a-port', database: 'd', user: 'u', password: 'p',
  });
  assert.ok(problems.some((p) => /Port must be a number/.test(p)));
});

test('an unknown source is rejected rather than silently accepted', () => {
  assert.deepEqual(validateConfig('mongodb', {}), ['Unknown source "mongodb".']);
  assert.equal(getConnector('mongodb'), null);
});

test("Tableau's token name stays readable while its secret does not", () => {
  // The obvious name, `personalAccessTokenName`, contains "token" and would be
  // vaulted — leaving the UI unable to show which token was configured.
  const config = { patName: 'analytics-bot', patSecret: 'xyz' };
  assert.equal(stripSecrets(config).patName, 'analytics-bot');
  assert.ok(!('patName' in extractSecrets(config)));
  assert.equal(extractSecrets(config).patSecret, 'xyz');
});

// ---------------------------------------------------------------------------
// Snowflake: key-pair and PAT, never a password
// ---------------------------------------------------------------------------

test('Snowflake offers no password field', async () => {
  // Snowflake is withdrawing single-factor password sign-in for service users
  // through 2026. A password field here would be a dead end by design.
  const snowflake = getConnector('snowflake');
  assert.ok(
    !snowflake.fields.some((f) => f.name === 'password'),
    'Snowflake must not ask for a password'
  );
  const methods = snowflake.fields.find((f) => f.name === 'signInMethod');
  assert.ok(methods, 'Snowflake needs a sign-in method selector');
  assert.deepEqual(methods.options.map((o) => o.value), ['keypair', 'pat']);
  assert.equal(methods.default, 'keypair', 'key-pair is the recommended default');
});

test('the sign-in method is readable, not vaulted', async () => {
  // `authMethod` would have matched the vault's secret-name pattern on "auth",
  // encrypting a non-secret the form has to be able to show back.
  const config = { signInMethod: 'keypair', privateKey: 'PEM', token: 'x' };
  assert.equal(stripSecrets(config).signInMethod, 'keypair');
  assert.ok(!('signInMethod' in extractSecrets(config)));
  assert.ok('privateKey' in extractSecrets(config));
  assert.ok('token' in extractSecrets(config));
});

test('a private key is required for key-pair and irrelevant for a token', () => {
  const base = { account: 'ab12345.eu-west-1', warehouse: 'WH', database: 'DB', user: 'svc' };

  const keypairMissing = validateConfig('snowflake', { ...base, signInMethod: 'keypair' });
  assert.ok(keypairMissing.some((p) => /Private key/.test(p)));

  const keypairOk = validateConfig('snowflake', { ...base, signInMethod: 'keypair', privateKey: 'PEM' });
  assert.deepEqual(keypairOk, []);

  const patMissing = validateConfig('snowflake', { ...base, signInMethod: 'pat' });
  assert.ok(patMissing.some((p) => /Access token/.test(p)));
  assert.ok(!patMissing.some((p) => /Private key/.test(p)), 'a token user is not asked for a key');

  const patOk = validateConfig('snowflake', { ...base, signInMethod: 'pat', token: 'abc' });
  assert.deepEqual(patOk, []);
});

test('an unknown sign-in method is rejected', () => {
  const problems = validateConfig('snowflake', {
    account: 'a', warehouse: 'w', database: 'd', user: 'u', signInMethod: 'password', privateKey: 'x',
  });
  assert.ok(problems.some((p) => /Sign-in method must be one of/.test(p)));
});

// ---------------------------------------------------------------------------
// Oracle: two connect modes
// ---------------------------------------------------------------------------

test('Oracle asks for host and service in easy mode, and neither in descriptor mode', () => {
  const base = { user: 'analytics_ro', password: 'x' };

  const easyMissing = validateConfig('oracle', { ...base, connectMode: 'easy' });
  assert.ok(easyMissing.some((p) => /Host is required/.test(p)));
  assert.ok(easyMissing.some((p) => /Service name is required/.test(p)));
  assert.ok(!easyMissing.some((p) => /Connect string/.test(p)));

  const easyOk = validateConfig('oracle', {
    ...base, connectMode: 'easy', host: 'db.example.com', port: 1521, serviceName: 'ORCLPDB1',
  });
  assert.deepEqual(easyOk, []);

  const descriptorMissing = validateConfig('oracle', { ...base, connectMode: 'descriptor' });
  assert.ok(descriptorMissing.some((p) => /Connect string is required/.test(p)));
  assert.ok(!descriptorMissing.some((p) => /Host is required/.test(p)), 'a descriptor carries its own host');

  const descriptorOk = validateConfig('oracle', {
    ...base, connectMode: 'descriptor', connectString: '(DESCRIPTION=(ADDRESS=(HOST=h)(PORT=1521)))',
  });
  assert.deepEqual(descriptorOk, []);
});

test('the Oracle connect string is not treated as a secret', () => {
  // It carries a host and a service name, not a credential, and the form has to
  // be able to show it back.
  const config = { connectString: '(DESCRIPTION=(ADDRESS=(HOST=h)))', password: 'hunter2' };
  assert.ok('connectString' in stripSecrets(config));
  assert.ok(!('connectString' in extractSecrets(config)));
  assert.ok('password' in extractSecrets(config));
});
