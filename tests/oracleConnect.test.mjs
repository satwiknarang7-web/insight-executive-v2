import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConnectString,
  hostsIn,
  assertSafeConnectString,
} from '../lib/connectors/oracleConnect.js';

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

test('easy connect is composed from host, port and service', () => {
  assert.equal(
    buildConnectString({ host: 'db.example.com', port: 1521, serviceName: 'ORCLPDB1' }),
    '//db.example.com:1521/ORCLPDB1'
  );
});

test('the default port is used when none is given', () => {
  assert.equal(buildConnectString({ host: 'h', serviceName: 's' }), '//h:1521/s');
});

test('a descriptor is passed through untouched', () => {
  // A TNS descriptor has structure this code has no business rewriting.
  const descriptor = '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=adb.example.com)(PORT=1522))(CONNECT_DATA=(SERVICE_NAME=x)))';
  assert.equal(buildConnectString({ connectMode: 'descriptor', connectString: descriptor }), descriptor);
});

test('missing pieces are named rather than producing a broken string', () => {
  assert.throws(() => buildConnectString({ serviceName: 's' }), /host is required/);
  assert.throws(() => buildConnectString({ host: 'h' }), /service name is required/);
  assert.throws(() => buildConnectString({ connectMode: 'descriptor' }), /connect string is required/);
});

// ---------------------------------------------------------------------------
// Host extraction — this is what the SSRF check depends on
// ---------------------------------------------------------------------------

test('a host is found in an easy connect string', () => {
  assert.deepEqual(hostsIn('//db.example.com:1521/ORCL'), ['db.example.com']);
  assert.deepEqual(hostsIn('db.example.com:1521/ORCL'), ['db.example.com']);
  assert.deepEqual(hostsIn('db.example.com'), ['db.example.com']);
  assert.deepEqual(hostsIn('tcps://db.example.com:2484/ORCL'), ['db.example.com']);
});

test('query parameters do not become part of the host', () => {
  assert.deepEqual(hostsIn('//db.example.com:1521/ORCL?connect_timeout=5'), ['db.example.com']);
});

test('an IPv6 literal keeps its address rather than splitting on a colon', () => {
  assert.deepEqual(hostsIn('[2001:db8::1]:1521/ORCL'), ['2001:db8::1']);
});

test('every host in a descriptor is found, not just the first', () => {
  // A failover descriptor lists several addresses. Checking only the first
  // would leave the rest unexamined — and one of them reachable.
  const descriptor = `(DESCRIPTION=
      (ADDRESS_LIST=
        (ADDRESS=(PROTOCOL=TCP)(HOST=primary.example.com)(PORT=1521))
        (ADDRESS=(PROTOCOL=TCP)(HOST=169.254.169.254)(PORT=1521)))
      (CONNECT_DATA=(SERVICE_NAME=ORCL)))`;
  const hosts = hostsIn(descriptor);
  assert.equal(hosts.length, 2);
  assert.ok(hosts.includes('primary.example.com'));
  assert.ok(hosts.includes('169.254.169.254'), 'the metadata endpoint must be visible to the check');
});

test('descriptor parsing tolerates spacing and case', () => {
  assert.deepEqual(hostsIn('(description=(address=( host = db.example.com )(port=1521))))'), ['db.example.com']);
});

test('a repeated host is only reported once', () => {
  const descriptor = '(ADDRESS=(HOST=a.example.com))(ADDRESS=(HOST=a.example.com))';
  assert.deepEqual(hostsIn(descriptor), ['a.example.com']);
});

test('an empty connect string yields no hosts', () => {
  assert.deepEqual(hostsIn(''), []);
  assert.deepEqual(hostsIn(null), []);
});

// ---------------------------------------------------------------------------
// Refusing dangerous descriptors
// ---------------------------------------------------------------------------

test('descriptor parameters that reach the filesystem or run a program are refused', () => {
  for (const bad of [
    '(DESCRIPTION=(ADDRESS=(HOST=h)(PORT=1))(WALLET_LOCATION=/etc/passwd))',
    '(DESCRIPTION=(ADDRESS=(HOST=h))(CONNECT_DATA=(PROGRAM=/bin/sh)))',
    '(DESCRIPTION=(ADDRESS=(HOST=h))(IFILE=/etc/shadow))',
  ]) {
    assert.throws(() => assertSafeConnectString(bad), /not allowed in a connect string/);
  }
});

test('a connect string with no host at all is refused', () => {
  assert.throws(() => assertSafeConnectString('(DESCRIPTION=(CONNECT_DATA=(SERVICE_NAME=x)))'), /No host/);
});

test('an ordinary descriptor passes', () => {
  const good = '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=adb.example.com)(PORT=1522))(CONNECT_DATA=(SERVICE_NAME=x)))';
  assert.equal(assertSafeConnectString(good), good);
});
