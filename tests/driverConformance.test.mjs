import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Driver conformance, checked against the source text.
 *
 * The drivers import `server-only`, which resolves through a Next internal
 * alias and cannot load in plain Node, so they cannot be imported here. That is
 * not a reason to leave them unchecked: the interface and the security
 * invariants are both visible in the source, and drift in either is exactly the
 * kind of thing that ships quietly and breaks one database out of six.
 *
 * Some drivers delegate to a shared module — SQL Server and Fabric both build
 * on `tds.server.js` — so the checks run against the driver's own source *plus*
 * whatever local modules it imports. Without that, extracting shared code would
 * silently switch these guarantees off.
 */

// Tableau is not a database: it has no SQL and no identifiers to quote, so the
// SQL-specific invariants below genuinely do not apply to it. Splitting the
// list keeps those checks meaningful instead of loosening them for everyone.
const SQL_DRIVERS = ['postgres', 'mysql', 'sqlserver', 'snowflake', 'oracle', 'fabric'];
const DRIVERS = [...SQL_DRIVERS, 'tableau'];
const REQUIRED = ['testConnection', 'listTables', 'previewTable', 'fetchRows', 'fetchTable'];

const dir = path.join('lib', 'connectors');
const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');

/** A driver's own source plus every local module it pulls in, one level deep. */
function effectiveSource(name) {
  const own = read(`${name}.server.js`);
  const imported = [...own.matchAll(/from '\.\/([\w.]+\.js)'/g)]
    .map((m) => m[1])
    .filter((file) => fs.existsSync(path.join(dir, file)))
    .map(read);
  return [own, ...imported].join('\n');
}

test('every driver exposes the whole interface', () => {
  for (const name of DRIVERS) {
    const s = effectiveSource(name);
    for (const method of REQUIRED) {
      assert.ok(s.includes(method), `${name} neither defines nor inherits ${method}`);
    }
    assert.match(read(`${name}.server.js`), /export const driver\b/, `${name} exports no driver`);
  }
});

test('every driver declares its own id', () => {
  for (const name of DRIVERS) {
    assert.match(
      read(`${name}.server.js`),
      new RegExp(`id: '${name}'`),
      `${name} has the wrong driver id`
    );
  }
});

// ---------------------------------------------------------------------------
// Security invariants — the whole point of a shared interface
// ---------------------------------------------------------------------------

test('every driver checks the host before connecting', () => {
  // Missing this in one driver reopens SSRF for that source alone, which is
  // precisely the bug nobody notices.
  for (const name of DRIVERS) {
    assert.match(effectiveSource(name), /assertSafeHost\(/, `${name} never calls assertSafeHost`);
  }
});

test('every SQL driver enforces read-only SQL before running a query', () => {
  for (const name of SQL_DRIVERS) {
    assert.match(
      effectiveSource(name),
      /assertReadOnlySql\(/,
      `${name} runs queries without the read-only check`
    );
  }
});

test('every SQL driver bounds the row count in SQL, not after the fact', () => {
  // Slicing a fully materialised result is too late — the memory is already
  // spent, which is what kills a serverless function on a warehouse table.
  for (const name of SQL_DRIVERS) {
    const s = effectiveSource(name);
    assert.match(s, /rowLimit\(/, `${name} does not apply the row cap`);
    assert.match(s, /_insight_capped/, `${name} does not wrap the query in a bounded subquery`);
    assert.match(s, /cap \+ 1/, `${name} cannot detect truncation without fetching one extra row`);
  }
});

test('every driver scrubs credentials out of its errors', () => {
  for (const name of DRIVERS) {
    assert.match(
      effectiveSource(name),
      /safeErrorMessage\(/,
      `${name} could leak a connection string in an error`
    );
  }
});

test('no SQL driver builds identifiers by hand', () => {
  // Postgres uses "quotes", MySQL `backticks`, SQL Server [brackets]. A driver
  // rolling its own is how the wrong dialect's quoting ends up in its SQL.
  for (const name of SQL_DRIVERS) {
    assert.match(
      effectiveSource(name),
      /quoteQualified\(/,
      `${name} does not use the shared quoting helper`
    );
    assert.ok(
      !/function quoteIdent\(/.test(read(`${name}.server.js`)),
      `${name} still defines its own quoteIdent`
    );
  }
});

test('Oracle never switches the process into thick mode', () => {
  // One call to initOracleClient() is irreversible for the process and then
  // demands Oracle Instant Client on the host, which serverless does not have.
  const code = read('oracle.server.js')
    .split('\n')
    .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
    .join('\n');
  assert.ok(!/initOracleClient\s*\(/.test(code), 'oracle must never call initOracleClient');
});

test('Tableau declares that it cannot run SQL, and refuses rather than pretending', () => {
  const tableau = read('tableau.server.js');
  assert.match(tableau, /capabilities:\s*\{[^}]*sql:\s*false/, 'Tableau must declare sql: false');
  // Silently ignoring a query someone wrote and returning something else would
  // be worse than failing.
  assert.match(tableau, /does not run SQL/);
  // The token must never travel in a URL, where it lands in proxy logs.
  assert.match(tableau, /'X-Tableau-Auth'/);
  // A Tableau session persists server-side until it expires; abandoning them
  // leaks sessions against the site's limit.
  assert.match(tableau, /auth\/signout/);
});

test('Fabric offers no password, because Entra ID is the only way in', () => {
  const fabric = read('fabric.server.js');
  assert.match(fabric, /azure-active-directory-service-principal-secret/);
  assert.ok(!/password:/.test(fabric), 'Fabric has no password to send');
  assert.match(fabric, /encrypt: true/, 'Fabric is TLS-only, with no opt-out');
});

test('the registry advertises exactly the sources that have a driver', () => {
  const registry = read('drivers.server.js');
  // Supabase and Neon both share the Postgres driver. Neon stores as `postgres`
  // so it does not normally reach its own entry; the entry is kept so that a row
  // stored under `neon` — by an older build, or a widened constraint — still
  // resolves to a driver rather than to nothing.
  for (const name of [...DRIVERS, 'supabase', 'neon']) {
    assert.match(registry, new RegExp(`\\b${name}:`), `${name} is missing from the driver registry`);
  }
  // Every planned source now has a driver, so the registry should list
  // exactly these and nothing more.
  const listed = [...registry.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(
    [...listed].sort(),
    [...DRIVERS, 'supabase', 'neon'].sort(),
    'the driver registry and the driver list have drifted apart'
  );
});
