/**
 * Run the dev server the way a deployment with no Supabase keys runs.
 *
 * `middleware.js` skips both the session refresh and the sign-in gate when
 * Supabase is not configured, deliberately: gating on an auth system that does
 * not exist would make such a deployment unreachable, with no way in and no way
 * to see why. A deployment with no Supabase keys parses files in the browser
 * and needs no account — which is the configuration the README describes and
 * the one most of this app's behaviour can be checked in.
 *
 * The awkward case is a machine that HAS the keys. Sign-in then requires a
 * one-time code by email, so a developer without SMTP configured — or without
 * the mailbox — cannot reach any page of the product they are working on. The
 * front door is real and there is no key under the mat, which is correct in
 * production and unhelpful on a laptop.
 *
 * So this runs the server with those three variables blanked in the
 * environment. Nothing is written, `.env.local` is not touched, and the next
 * plain `npm run dev` is gated exactly as before. It changes no auth code and
 * weakens no deployment: it only declines to supply credentials that the
 * middleware already has a defined, documented behaviour for lacking.
 *
 * What is unavailable here is everything that genuinely needs the backend —
 * accounts, saved analyses, the connection vault. Uploading a file, the whole
 * analysis pipeline, the dashboard, the report and the deck all work, because
 * none of them ever needed an account.
 *
 * Blanked rather than deleted: Next reads `.env.local` into `process.env`
 * without overwriting keys that are already present, so an empty string stays
 * empty. Deleting them would let the file put them straight back.
 */

import { spawn } from 'node:child_process';

const WITHOUT = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const env = { ...process.env };
for (const key of WITHOUT) env[key] = '';

console.log('Starting the dev server with no Supabase configuration.');
console.log('  Sign-in is not gated: middleware.js skips the door when auth is absent.');
console.log('  Accounts, saved analyses and stored connections are unavailable.');
console.log('  .env.local is unchanged — `npm run dev` is gated as usual.\n');

const child = spawn('npx', ['--no-install', 'next', 'dev', '--turbo', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  // npx resolves through a shell script on Windows.
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
