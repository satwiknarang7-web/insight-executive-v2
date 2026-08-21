/**
 * Envelope encryption for stored connection credentials.
 *
 * Server-only. This module must never be imported into client code — it reads
 * the master key from the environment, and bundling it would ship that key to
 * the browser.
 *
 * The shape:
 *
 *   credential JSON --AES-256-GCM--> ciphertext   (key: a random per-credential DEK)
 *   DEK             --AES-256-GCM--> dek_wrapped  (key: the master KEK from env)
 *
 * The indirection exists for rotation. With one key encrypting everything,
 * rotating it means decrypting and re-encrypting every credential in the vault
 * — a long, interruptible migration over exactly the data you least want to
 * corrupt. With an envelope, rotation re-wraps a handful of 32-byte keys and
 * never touches the credential ciphertext.
 *
 * GCM is used rather than CBC because it authenticates as well as encrypts: a
 * tampered ciphertext fails to decrypt instead of yielding plausible garbage.
 */
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits, the size GCM is defined for
const TAG_BYTES = 16;

/**
 * Master keys by version, parsed from the environment.
 *
 * `VAULT_MASTER_KEY` is the current key. `VAULT_MASTER_KEY_V1`,
 * `_V2`, … hold superseded keys so a rotation can still open credentials
 * wrapped under the old one while it works through them.
 */
function masterKeys() {
  const keys = new Map();

  for (const [name, value] of Object.entries(process.env)) {
    const m = /^VAULT_MASTER_KEY_V(\d+)$/.exec(name);
    if (m && value) keys.set(Number(m[1]), parseKey(value, name));
  }

  const current = process.env.VAULT_MASTER_KEY;
  if (current) {
    const version = Number(process.env.VAULT_MASTER_KEY_VERSION || 1);
    keys.set(version, parseKey(current, 'VAULT_MASTER_KEY'));
    return { keys, currentVersion: version };
  }

  // Highest configured version wins when only historical keys are present.
  const versions = [...keys.keys()].sort((a, b) => b - a);
  return { keys, currentVersion: versions[0] ?? null };
}

function parseKey(value, name) {
  let raw;
  try {
    raw = Buffer.from(String(value).trim(), 'base64');
  } catch {
    throw new Error(`${name} is not valid base64.`);
  }
  if (raw.length !== KEY_BYTES) {
    throw new Error(
      `${name} must decode to ${KEY_BYTES} bytes, got ${raw.length}. Generate one with: openssl rand -base64 32`
    );
  }
  return raw;
}

/** Is the vault configured? Used to fail loudly at startup rather than at first write. */
export function isVaultConfigured() {
  try {
    const { currentVersion } = masterKeys();
    return currentVersion !== null;
  } catch {
    return false;
  }
}

function requireKey(version) {
  const { keys, currentVersion } = masterKeys();
  if (currentVersion === null) {
    throw new Error(
      'No vault master key configured. Set VAULT_MASTER_KEY to a base64 32-byte value (openssl rand -base64 32).'
    );
  }
  const wanted = version ?? currentVersion;
  const key = keys.get(wanted);
  if (!key) {
    throw new Error(
      `No master key for version ${wanted}. A credential was wrapped under a key this deployment does not have; ` +
        `set VAULT_MASTER_KEY_V${wanted} to decrypt it.`
    );
  }
  return { key, version: wanted };
}

function encryptWith(key, plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decryptWith(key, { ciphertext, iv, tag }) {
  if (!Buffer.isBuffer(iv) || iv.length !== IV_BYTES) throw new Error('Malformed record: bad IV.');
  if (!Buffer.isBuffer(tag) || tag.length !== TAG_BYTES) throw new Error('Malformed record: bad auth tag.');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Encrypt a credential object into the columns `app_private.connection_secrets`
 * expects. The plaintext is never returned and never logged.
 */
export function sealCredential(credential) {
  if (!credential || typeof credential !== 'object') {
    throw new Error('A credential must be an object.');
  }
  const { key: kek, version } = requireKey(null);

  const dek = crypto.randomBytes(KEY_BYTES);
  try {
    const payload = encryptWith(dek, Buffer.from(JSON.stringify(credential), 'utf8'));
    const wrapped = encryptWith(kek, dek);

    return {
      ciphertext: payload.ciphertext,
      iv: payload.iv,
      auth_tag: payload.tag,
      dek_wrapped: wrapped.ciphertext,
      dek_iv: wrapped.iv,
      dek_tag: wrapped.tag,
      key_version: version,
    };
  } finally {
    // The DEK has done its job; don't leave it sitting in the heap waiting to
    // turn up in a core dump.
    dek.fill(0);
  }
}

/** Decrypt a stored record back into the credential object. */
export function openCredential(record) {
  if (!record) throw new Error('No credential record supplied.');
  const { key: kek } = requireKey(record.key_version ?? 1);

  let dek = null;
  try {
    dek = decryptWith(kek, {
      ciphertext: toBuffer(record.dek_wrapped),
      iv: toBuffer(record.dek_iv),
      tag: toBuffer(record.dek_tag),
    });
    const plaintext = decryptWith(dek, {
      ciphertext: toBuffer(record.ciphertext),
      iv: toBuffer(record.iv),
      tag: toBuffer(record.auth_tag),
    });
    return JSON.parse(plaintext.toString('utf8'));
  } finally {
    dek?.fill(0);
  }
}

/**
 * Re-wrap a credential's DEK under the current master key, leaving the
 * credential ciphertext untouched. This is the whole point of the envelope: a
 * rotation reads and writes a few dozen bytes per credential.
 */
export function rewrapCredential(record) {
  const { key: oldKek } = requireKey(record.key_version ?? 1);
  const { key: newKek, version } = requireKey(null);

  let dek = null;
  try {
    dek = decryptWith(oldKek, {
      ciphertext: toBuffer(record.dek_wrapped),
      iv: toBuffer(record.dek_iv),
      tag: toBuffer(record.dek_tag),
    });
    const wrapped = encryptWith(newKek, dek);
    return {
      dek_wrapped: wrapped.ciphertext,
      dek_iv: wrapped.iv,
      dek_tag: wrapped.tag,
      key_version: version,
    };
  } finally {
    dek?.fill(0);
  }
}

/** Postgres bytea round-trips as a Buffer or as a \x-prefixed hex string. */
function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') {
    return value.startsWith('\\x')
      ? Buffer.from(value.slice(2), 'hex')
      : Buffer.from(value, 'base64');
  }
  throw new Error('Malformed record: expected binary data.');
}

/**
 * Strip anything secret out of a config object before it is stored in
 * `public.connections` or written to a log.
 *
 * Deny-by-pattern rather than allow-by-list, because a new connector will add
 * fields nobody remembers to classify, and the failure mode of guessing wrong
 * here is a plaintext password in a table the browser can read.
 */
const SECRET_KEY_RE = /(pass|pwd|secret|token|key|credential|auth|sas|connstr|connection_string)/i;

export function stripSecrets(config) {
  if (!config || typeof config !== 'object') return {};
  const safe = {};
  for (const [k, v] of Object.entries(config)) {
    if (SECRET_KEY_RE.test(k)) continue;
    safe[k] = v && typeof v === 'object' && !Array.isArray(v) ? stripSecrets(v) : v;
  }
  return safe;
}

/** The inverse: just the fields that must go into the vault. */
export function extractSecrets(config) {
  if (!config || typeof config !== 'object') return {};
  const secret = {};
  for (const [k, v] of Object.entries(config)) {
    if (SECRET_KEY_RE.test(k)) secret[k] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = extractSecrets(v);
      if (Object.keys(nested).length) secret[k] = nested;
    }
  }
  return secret;
}
