import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const KEY_A = crypto.randomBytes(32).toString('base64');
const KEY_B = crypto.randomBytes(32).toString('base64');

/** Load the module with a specific key environment. */
async function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('VAULT_MASTER_KEY')) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  }
  Object.assign(process.env, env);
  try {
    // Cache-busted so the module re-reads the environment each time.
    const mod = await import(`../lib/vault/crypto.js?t=${Math.random()}`);
    return await fn(mod);
  } finally {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('VAULT_MASTER_KEY')) delete process.env[k];
    }
    Object.assign(process.env, saved);
  }
}

const credential = { password: 'hunter2', user: 'analytics_ro' };

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

test('a credential survives a seal and open round trip', async () => {
  await withEnv({ VAULT_MASTER_KEY: KEY_A }, ({ sealCredential, openCredential }) => {
    const sealed = sealCredential(credential);
    assert.deepEqual(openCredential(sealed), credential);
  });
});

test('the plaintext never appears in the stored record', async () => {
  await withEnv({ VAULT_MASTER_KEY: KEY_A }, ({ sealCredential }) => {
    const sealed = sealCredential(credential);
    const blob = Buffer.concat([sealed.ciphertext, sealed.dek_wrapped]).toString('latin1');
    assert.ok(!blob.includes('hunter2'), 'the password must not be recoverable from the ciphertext');
    assert.ok(!blob.includes('analytics_ro'));
  });
});

test('every credential gets its own data key', async () => {
  await withEnv({ VAULT_MASTER_KEY: KEY_A }, ({ sealCredential }) => {
    const a = sealCredential(credential);
    const b = sealCredential(credential);
    assert.notDeepEqual(a.ciphertext, b.ciphertext, 'identical input must not produce identical ciphertext');
    assert.notDeepEqual(a.dek_wrapped, b.dek_wrapped, 'the DEK must be fresh per credential');
  });
});

// ---------------------------------------------------------------------------
// Tamper resistance — the reason for GCM over CBC
// ---------------------------------------------------------------------------

test('a tampered ciphertext fails loudly rather than decrypting to garbage', async () => {
  await withEnv({ VAULT_MASTER_KEY: KEY_A }, ({ sealCredential, openCredential }) => {
    const sealed = sealCredential(credential);
    const tampered = { ...sealed, ciphertext: Buffer.from(sealed.ciphertext) };
    tampered.ciphertext[0] ^= 0xff;
    assert.throws(() => openCredential(tampered));
  });
});

test('a tampered wrapped key fails too', async () => {
  await withEnv({ VAULT_MASTER_KEY: KEY_A }, ({ sealCredential, openCredential }) => {
    const sealed = sealCredential(credential);
    const tampered = { ...sealed, dek_wrapped: Buffer.from(sealed.dek_wrapped) };
    tampered.dek_wrapped[0] ^= 0xff;
    assert.throws(() => openCredential(tampered));
  });
});

test('the wrong master key cannot open a credential', async () => {
  const sealed = await withEnv({ VAULT_MASTER_KEY: KEY_A }, ({ sealCredential }) => sealCredential(credential));
  await withEnv({ VAULT_MASTER_KEY: KEY_B }, ({ openCredential }) => {
    assert.throws(() => openCredential(sealed));
  });
});

// ---------------------------------------------------------------------------
// Rotation — the whole reason for the envelope
// ---------------------------------------------------------------------------

test('rotation re-wraps the key without touching the credential ciphertext', async () => {
  const sealed = await withEnv({ VAULT_MASTER_KEY: KEY_A }, ({ sealCredential }) => sealCredential(credential));
  assert.equal(sealed.key_version, 1);

  // The new key is current; the old one stays available as V1 during rotation.
  await withEnv(
    { VAULT_MASTER_KEY: KEY_B, VAULT_MASTER_KEY_VERSION: '2', VAULT_MASTER_KEY_V1: KEY_A },
    ({ rewrapCredential, openCredential }) => {
      const rewrapped = rewrapCredential(sealed);
      assert.equal(rewrapped.key_version, 2);

      const stored = { ...sealed, ...rewrapped };
      // The expensive part is untouched — that is the point of the envelope.
      assert.deepEqual(stored.ciphertext, sealed.ciphertext);
      assert.deepEqual(openCredential(stored), credential);
    }
  );
});

test('a credential wrapped under a key this deployment lacks fails with a useful message', async () => {
  const sealed = await withEnv({ VAULT_MASTER_KEY: KEY_A }, ({ sealCredential }) => sealCredential(credential));
  await withEnv({ VAULT_MASTER_KEY: KEY_B, VAULT_MASTER_KEY_VERSION: '2' }, ({ openCredential }) => {
    assert.throws(() => openCredential(sealed), /VAULT_MASTER_KEY_V1/);
  });
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

test('a missing key is reported, not silently skipped', async () => {
  await withEnv({}, ({ sealCredential, isVaultConfigured }) => {
    assert.equal(isVaultConfigured(), false);
    assert.throws(() => sealCredential(credential), /No vault master key configured/);
  });
});

test('a wrong-sized key is rejected with the command to generate a right one', async () => {
  await withEnv({ VAULT_MASTER_KEY: Buffer.from('too short').toString('base64') }, ({ sealCredential }) => {
    assert.throws(() => sealCredential(credential), /openssl rand -base64 32/);
  });
});

// ---------------------------------------------------------------------------
// Splitting config from secrets
// ---------------------------------------------------------------------------

test('secrets are kept out of the browser-readable config', async () => {
  await withEnv({ VAULT_MASTER_KEY: KEY_A }, ({ stripSecrets, extractSecrets }) => {
    const config = {
      host: 'warehouse.example.com',
      port: 5432,
      database: 'analytics',
      user: 'ro',
      password: 'hunter2',
      sslKey: 'PRIVATE',
      options: { authToken: 'abc', schema: 'public' },
    };

    const safe = stripSecrets(config);
    assert.deepEqual(safe, {
      host: 'warehouse.example.com',
      port: 5432,
      database: 'analytics',
      user: 'ro',
      options: { schema: 'public' },
    });

    const secret = extractSecrets(config);
    assert.deepEqual(secret, { password: 'hunter2', sslKey: 'PRIVATE', options: { authToken: 'abc' } });

    // Nothing may fall through the gap between the two.
    const seen = JSON.stringify(safe);
    for (const leak of ['hunter2', 'PRIVATE', 'abc']) {
      assert.ok(!seen.includes(leak), `${leak} leaked into the stored config`);
    }
  });
});

test('unknown secret-shaped fields are excluded by default', async () => {
  await withEnv({ VAULT_MASTER_KEY: KEY_A }, ({ stripSecrets }) => {
    // A connector added later invents a field nobody classified.
    const safe = stripSecrets({ host: 'h', privateKeyPassphrase: 'x', accessToken: 'y', region: 'eu' });
    assert.deepEqual(safe, { host: 'h', region: 'eu' });
  });
});
