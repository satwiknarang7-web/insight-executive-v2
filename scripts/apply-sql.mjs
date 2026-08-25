/**
 * Apply a .sql file to the project's Supabase database.
 *
 * The Supabase JS client cannot do this: it speaks PostgREST, which routes to
 * tables and functions but has no way to CREATE one. Applying a migration needs
 * a real Postgres connection, which needs the database password — a different
 * credential from the API keys in .env.local, and one this script deliberately
 * never asks for interactively. Set SUPABASE_DB_URL and it is used; that is the
 * whole configuration.
 *
 *   node scripts/apply-sql.mjs supabase/APPLY_TO_LIVE_PROJECT.sql
 *
 * The file is sent as one string, so it runs in a single implicit transaction
 * and dollar-quoted function bodies arrive intact — splitting on semicolons,
 * the obvious approach, cuts every `$$ ... $$` block in half.
 */
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const CONNECTION_VAR = 'SUPABASE_DB_URL';

const HELP = `
Set ${CONNECTION_VAR} to the project's Postgres connection string, then re-run.

  Supabase dashboard -> Project Settings -> Database -> Connection string -> URI
  (the "Session pooler" URI works from anywhere; it carries the database
  password, which is not the same as the service-role key)

Put it in .env.local as a single line:

  ${CONNECTION_VAR}=postgresql://postgres.<ref>:<password>@<host>:5432/postgres
`;

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/apply-sql.mjs <file.sql>');
    process.exit(2);
  }

  const url = process.env[CONNECTION_VAR];
  if (!url) {
    console.error(`${CONNECTION_VAR} is not set.${HELP}`);
    process.exit(2);
  }

  const sql = await readFile(file, 'utf8');
  // Supabase terminates TLS with a certificate this client has no root for, and
  // the connection is to a host named in the URL over the public internet.
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

  console.log(`Applying ${file} …`);
  await client.connect();
  try {
    const results = await client.query(sql);
    const sets = Array.isArray(results) ? results : [results];

    // Notices are how this file reports a skipped section, so they are worth
    // more than "done": they say which half actually ran.
    const last = sets.filter((r) => r?.rows?.length).pop();
    if (last) console.table(last.rows);
    console.log(`Applied ${file}.`);
  } finally {
    await client.end();
  }
}

// A failure here is a database refusing a statement; the message is the useful
// part and a stack trace over it helps nobody.
main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  if (error.position) console.error(`at character ${error.position} of the file`);
  process.exit(1);
});
