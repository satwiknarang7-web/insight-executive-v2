/**
 * Say whether the root portal is switched on, wherever this runs.
 *
 *   npm run root:status
 *
 * The portal is deliberately silent when it is not configured: every one of its
 * routes answers 404, because a login that announces itself as "not set up yet"
 * is a login someone knows to come back to. That is right for a stranger and
 * unhelpful for the person deploying it, who gets a 404 and no way to tell a
 * missing variable from a typo in one.
 *
 * So this reports the same decision the app makes, from the same variables,
 * without ever printing their values. It runs after a build as well, which is
 * how a Vercel deployment comes to say in its log whether the portal it just
 * shipped is reachable.
 *
 * It never fails a build. A deployment whose root portal is off is a normal
 * deployment — most of them are — and turning that into a red cross would
 * teach everybody to ignore the check.
 */
const MIN_LENGTH = 12;

const email = String(process.env.ROOT_EMAIL || '').trim();
const password = String(process.env.ROOT_PASSWORD || '');
const say = (line = '') => process.stdout.write(`${line}\n`);

/**
 * Which secret the session cookie would be signed with.
 *
 * Only the name is reported. Knowing that sessions are keyed off
 * `VAULT_MASTER_KEY` tells the operator that rotating it will sign everyone
 * out; knowing its value tells them nothing they should be reading from a
 * build log.
 */
function signingSource() {
  for (const name of [
    'ROOT_SESSION_SECRET',
    'AUTH_OTP_PEPPER',
    'VAULT_MASTER_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]) {
    if (String(process.env[name] || '').length > 0) return name;
  }
  return null;
}

say('');
say('Root portal');

if (!email && !password) {
  say('  off — ROOT_EMAIL and ROOT_PASSWORD are not set.');
  say('  Every /root route answers 404. Run `npm run root:setup you@example.com`,');
  say('  or set both in the deployment environment.');
} else if (!email) {
  say('  off — ROOT_PASSWORD is set but ROOT_EMAIL is not.');
} else if (password.length === 0) {
  say(`  off — ROOT_EMAIL is ${email} but ROOT_PASSWORD is empty.`);
} else if (password.length < MIN_LENGTH) {
  say(`  off — the password is ${password.length} characters and needs ${MIN_LENGTH}.`);
  say('  This is the failure that looks like nothing at all: the portal treats a');
  say('  short password as unset, so it answers 404 rather than "too short".');
} else {
  const source = signingSource();
  say(`  on — ${email}`);
  say(
    source
      ? `  Sessions signed with ${source}; rotating it, or the password, ends them all.`
      : '  Sessions signed from the password alone — no ROOT_SESSION_SECRET, ' +
        'AUTH_OTP_PEPPER, VAULT_MASTER_KEY or SUPABASE_SERVICE_ROLE_KEY is set.'
  );
}

say('');
