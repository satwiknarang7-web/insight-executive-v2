import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSqlEndpoint } from '../lib/connectors/tdsEndpoint.js';

test('a bare hostname takes the default port', () => {
  assert.deepEqual(parseSqlEndpoint('sql.example.com'), { host: 'sql.example.com', port: 1433 });
});

test('the forms different tools produce all parse the same way', () => {
  // SSMS uses a comma, JDBC a colon, and a copied URL brings a scheme.
  assert.deepEqual(parseSqlEndpoint('sql.example.com,1433'), { host: 'sql.example.com', port: 1433 });
  assert.deepEqual(parseSqlEndpoint('sql.example.com:1435'), { host: 'sql.example.com', port: 1435 });
  assert.deepEqual(parseSqlEndpoint('tcp:sql.example.com,1433'), { host: 'sql.example.com', port: 1433 });
  assert.deepEqual(parseSqlEndpoint('https://sql.example.com/db'), { host: 'sql.example.com', port: 1433 });
});

test('a Fabric endpoint parses cleanly', () => {
  assert.deepEqual(
    parseSqlEndpoint('abc123.datawarehouse.fabric.microsoft.com'),
    { host: 'abc123.datawarehouse.fabric.microsoft.com', port: 1433 }
  );
});

test('an IPv6 literal keeps its colons', () => {
  assert.deepEqual(parseSqlEndpoint('[2001:db8::1]'), { host: '2001:db8::1', port: 1433 });
  assert.deepEqual(parseSqlEndpoint('[2001:db8::1]:1435'), { host: '2001:db8::1', port: 1435 });
});

test('a path or query never becomes part of the host', () => {
  // Otherwise the SSRF check inspects a string that is not a hostname.
  assert.equal(parseSqlEndpoint('sql.example.com/database?x=1').host, 'sql.example.com');
});

test('nonsense is refused rather than half-parsed', () => {
  assert.throws(() => parseSqlEndpoint(''), /endpoint is required/);
  assert.throws(() => parseSqlEndpoint('   '), /endpoint is required/);
  assert.throws(() => parseSqlEndpoint('host:99999'), /not a valid port/);
  assert.throws(() => parseSqlEndpoint('https:///db'), /No host/);
});
