/**
 * The code and the database have to agree on what a code can be for.
 *
 * They did not, once. `recover` was added to the application and not to the
 * CHECK constraint on `app_private.auth_challenges.purpose`, so every password
 * reset failed on that constraint — inside the `catch` that exists to keep the
 * route from revealing whether an address has an account, and which therefore
 * kept it from revealing this either. The screen said "a code is on its way",
 * no mail was sent, and nothing anywhere said otherwise.
 *
 * Nothing in the test suite could have caught it, because nothing in the suite
 * reads the migrations. This does: it takes the list the application works from
 * and the constraint the database actually enforces, and refuses to let them
 * differ. No database connection required — the migrations are the record of
 * what the database has been told.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { CHALLENGE_PURPOSES } from '../lib/auth/otp.js';

const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations');

/**
 * The purposes the database allows, according to the last migration that says.
 *
 * Migrations are applied in filename order, so the last mention wins — the same
 * way the database sees it.
 */
async function constraintPurposes() {
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  let latest = null;

  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS, file), 'utf8');
    // Both spellings the project uses: the inline `check (...)` on the column
    // and the named `add constraint ... check (...)` that alters it later.
    const matches = [...sql.matchAll(/purpose[\s\S]{0,40}?check\s*\(\s*purpose\s+in\s*\(([^)]*)\)/gi)];
    if (matches.length) latest = { file, body: matches[matches.length - 1][1] };
  }

  assert.ok(latest, 'no migration defines a purpose constraint');
  const purposes = [...latest.body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return { purposes, file: latest.file };
}

test('every purpose the app can raise is one the database will accept', async () => {
  const { purposes, file } = await constraintPurposes();

  for (const purpose of CHALLENGE_PURPOSES) {
    assert.ok(
      purposes.includes(purpose),
      `the app raises '${purpose}' but ${file} does not allow it — ` +
        `every challenge with that purpose will fail on the constraint`
    );
  }
});

test('the database allows nothing the app does not use', async () => {
  const { purposes, file } = await constraintPurposes();

  for (const purpose of purposes) {
    assert.ok(
      CHALLENGE_PURPOSES.includes(purpose),
      `${file} allows '${purpose}' but nothing raises it — ` +
        `either the branch that handles it was removed, or the constraint is wider than it needs to be`
    );
  }
});

/*
 * `createChallenge` also refuses an unknown purpose itself, so the failure is
 * named at the call site rather than surfacing as an opaque row violation. That
 * guard is not exercised here: `challenges.server.js` imports `server-only`,
 * which will not load outside Next. The two tests above are the ones that catch
 * the bug it guards against anyway — they compare what the app can raise with
 * what the database will take.
 */
