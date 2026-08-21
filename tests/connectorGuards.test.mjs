import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAddress,
  assertSafeHost,
  assertReadOnlySql,
  stripLiterals,
  rowLimit,
  safeErrorMessage,
  BlockedHost,
  UnsafeQuery,
  MAX_ROWS,
} from '../lib/connectors/guards.js';

// A stand-in resolver so these tests never touch the network.
const resolves = (...addresses) => async () => addresses.map((address) => ({ address }));

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

test('the cloud metadata endpoint is in a category of its own', () => {
  assert.equal(classifyAddress('169.254.169.254'), 'metadata');
  assert.equal(classifyAddress('169.254.1.1'), 'link-local');
});

test('private ranges are recognised', () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1']) {
    assert.equal(classifyAddress(ip), 'private', ip);
  }
  // 172.32 is outside the private block.
  assert.equal(classifyAddress('172.32.0.1'), 'public');
  assert.equal(classifyAddress('127.0.0.1'), 'loopback');
});

test('public addresses are allowed through', () => {
  assert.equal(classifyAddress('8.8.8.8'), 'public');
  assert.equal(classifyAddress('2606:4700::1111'), 'public');
});

test('IPv4-mapped IPv6 cannot smuggle a private address past the check', () => {
  // Judging ::ffff:10.0.0.1 as "just an IPv6 address" would bypass every v4 rule.
  assert.equal(classifyAddress('::ffff:10.0.0.1'), 'private');
  assert.equal(classifyAddress('::ffff:169.254.169.254'), 'metadata');
  assert.equal(classifyAddress('::1'), 'loopback');
  assert.equal(classifyAddress('fd00::1'), 'private');
});

test('nonsense is not treated as public', () => {
  assert.equal(classifyAddress('not-an-ip'), 'unknown');
  assert.equal(classifyAddress(''), 'unknown');
});

// ---------------------------------------------------------------------------
// Host policy
// ---------------------------------------------------------------------------

test('the metadata endpoint is refused even when private hosts are allowed', async () => {
  await assert.rejects(
    () => assertSafeHost('evil.example.com', { allowPrivate: true, resolver: resolves('169.254.169.254') }),
    (e) => e instanceof BlockedHost && /metadata endpoint/.test(e.message)
  );
});

test('a self-hosted deployment may reach its own private network', async () => {
  const addresses = await assertSafeHost('db.internal', {
    allowPrivate: true,
    resolver: resolves('10.1.2.3'),
  });
  assert.deepEqual(addresses, ['10.1.2.3']);
});

test('a shared deployment may not', async () => {
  await assert.rejects(
    () => assertSafeHost('db.internal', { allowPrivate: false, resolver: resolves('10.1.2.3') }),
    (e) => e instanceof BlockedHost && /private address/.test(e.message)
  );
});

test('every resolved address is checked, not just the first', async () => {
  // The rebinding trick: one public address to pass the check, one internal to
  // actually connect to.
  await assert.rejects(
    () =>
      assertSafeHost('sneaky.example.com', {
        allowPrivate: false,
        resolver: resolves('93.184.216.34', '10.0.0.1'),
      }),
    (e) => e instanceof BlockedHost
  );
});

test('a literal address needs no lookup and is still judged', async () => {
  await assert.rejects(
    () => assertSafeHost('127.0.0.1', { allowPrivate: false }),
    (e) => e instanceof BlockedHost
  );
  assert.deepEqual(await assertSafeHost('8.8.8.8', { allowPrivate: false }), ['8.8.8.8']);
});

test('an unresolvable host is refused rather than attempted', async () => {
  await assert.rejects(
    () =>
      assertSafeHost('nowhere.invalid', {
        resolver: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    (e) => e instanceof BlockedHost && /could not be resolved/.test(e.message)
  );
  await assert.rejects(() => assertSafeHost('', {}), (e) => e instanceof BlockedHost);
});

// ---------------------------------------------------------------------------
// Query policy
// ---------------------------------------------------------------------------

test('a plain SELECT is accepted', () => {
  assert.ok(assertReadOnlySql('SELECT region, SUM(revenue) FROM orders GROUP BY region'));
  assert.ok(assertReadOnlySql('  select 1  '));
  assert.ok(assertReadOnlySql('SELECT * FROM t;'), 'a single trailing semicolon is fine');
});

test('a read-only CTE is accepted', () => {
  assert.ok(assertReadOnlySql('WITH recent AS (SELECT * FROM orders) SELECT * FROM recent'));
});

test('writes are refused', () => {
  for (const sql of [
    'DELETE FROM orders',
    'UPDATE orders SET total = 0',
    'INSERT INTO orders VALUES (1)',
    'DROP TABLE orders',
    'TRUNCATE orders',
    'GRANT ALL ON orders TO public',
  ]) {
    assert.throws(() => assertReadOnlySql(sql), UnsafeQuery, sql);
  }
});

test('stacked statements are refused', () => {
  assert.throws(
    () => assertReadOnlySql('SELECT 1; DROP TABLE orders'),
    (e) => e instanceof UnsafeQuery && /one statement/.test(e.message)
  );
});

test('a writable CTE is refused', () => {
  assert.throws(
    () => assertReadOnlySql('WITH x AS (DELETE FROM orders RETURNING *) SELECT * FROM x'),
    UnsafeQuery
  );
});

test('SELECT INTO is refused because it creates a table', () => {
  assert.throws(() => assertReadOnlySql('SELECT * INTO copy_of_orders FROM orders'), UnsafeQuery);
  // But INTO inside a string, or a column called "into_bucket", is fine.
  assert.ok(assertReadOnlySql("SELECT 'into' AS word FROM t"));
});

test('a semicolon inside a string literal does not look like a second statement', () => {
  assert.ok(assertReadOnlySql("SELECT * FROM t WHERE note = 'a; b'"));
  assert.ok(assertReadOnlySql("SELECT * FROM t WHERE note = 'DROP TABLE x'"));
});

test('comments cannot hide a second statement', () => {
  assert.throws(() => assertReadOnlySql('SELECT 1 -- ok\n; DROP TABLE t'), UnsafeQuery);
  assert.ok(assertReadOnlySql('SELECT 1 /* just a comment */'));
});

test('literal stripping keeps the structure it is asked about', () => {
  assert.equal(stripLiterals("SELECT 'a;b' FROM t").includes(';'), false);
  assert.equal(stripLiterals('SELECT 1 -- ; drop\n FROM t').includes(';'), false);
  assert.equal(stripLiterals("SELECT 'it''s fine' FROM t").includes(';'), false);
});

test('an empty query is refused', () => {
  assert.throws(() => assertReadOnlySql(''), UnsafeQuery);
  assert.throws(() => assertReadOnlySql(null), UnsafeQuery);
});

// ---------------------------------------------------------------------------
// Caps and error hygiene
// ---------------------------------------------------------------------------

test('the row cap cannot be raised by the caller', () => {
  assert.equal(rowLimit(10), 10);
  assert.equal(rowLimit(MAX_ROWS * 10), MAX_ROWS);
  assert.equal(rowLimit(0), MAX_ROWS);
  assert.equal(rowLimit('nonsense'), MAX_ROWS);
  assert.equal(rowLimit(-5), MAX_ROWS);
});

test('credentials are scrubbed out of driver errors', () => {
  assert.equal(
    safeErrorMessage(new Error('connection to postgres://admin:hunter2@db:5432 failed')),
    'connection to postgres://***@db:5432 failed'
  );
  assert.ok(!safeErrorMessage(new Error('bad password=hunter2 here')).includes('hunter2'));
});

test('an error with no message still produces something usable', () => {
  assert.match(safeErrorMessage(null), /could not be reached/);
});
