/**
 * Configure the root portal's credential — here, and on the deployment.
 *
 *   npm run root:setup                          -- keep the current address
 *   npm run root:setup you@example.com          -- set the address too
 *
 * There is no account to create. The portal authenticates against
 * `ROOT_EMAIL` and `ROOT_PASSWORD` directly and keeps no row anywhere, which is
 * the point: it is a break-glass login that works when the product's own auth
 * does not, and a credential in a table is a credential that a database outage
 * can lock you out of. So "seeding the root user" is setting two environment
 * variables, and this writes them where the app reads them.
 *
 * That also answers the deployment question. Vercel reads its own environment,
 * so nothing needs to run at build time to bring the account into existence —
 * it exists on the next deploy after the variables are set, and it survives
 * every deploy after that. What this script does instead is print the exact
 * commands to set them there, and `npm run root:status` reports on any
 * environment, including a build log, whether the portal is on.
 *
 * The password is read from a prompt with the echo turned off, or from stdin
 * when a pipe is more convenient. It is never generated here, never printed,
 * and never passed as an argument — an argument would sit in the shell history
 * of whoever ran it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ENV_PATH = fileURLToPath(new URL('../.env.local', import.meta.url));

/** The rule the app itself applies; below this the portal reports itself off. */
const MIN_LENGTH = 12;

// Piping this into `head` closes stdout early, and an unhandled EPIPE prints a
// stack trace — into a terminal at best and a deployment log at worst. There is
// nothing to recover from: the reader has stopped reading.
process.stdout.on('error', (error) => {
  if (error?.code === 'EPIPE') process.exit(0);
  throw error;
});

const say = (line = '') => process.stdout.write(`${line}\n`);

/**
 * Read a secret without putting it on the screen.
 *
 * Node has no built-in hidden prompt. With a TTY the terminal's echo is turned
 * off for the duration; without one — a pipe, or CI — the line is simply read,
 * because there is nothing to hide it from.
 */
async function readSecret(prompt) {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) {
      rl.close();
      return line;
    }
    return '';
  }

  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve) => {
    let value = '';
    // Written as codes rather than escapes so that no editor, patch or shell
    // between here and the file can quietly turn one of them into whitespace.
    const ENTER = [String.fromCharCode(13), String.fromCharCode(10)];
    const INTERRUPT = String.fromCharCode(3); // Ctrl-C
    const EOT = String.fromCharCode(4); // Ctrl-D
    const BACKSPACE = [String.fromCharCode(127), String.fromCharCode(8)];
    const NEWLINE = String.fromCharCode(10);

    const onData = (chunk) => {
      const char = chunk.toString('utf8');

      if (ENTER.includes(char) || char === EOT) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off('data', onData);
        process.stdout.write(NEWLINE);
        resolve(value);
        return;
      }
      if (char === INTERRUPT) {
        process.stdin.setRawMode(false);
        process.stdout.write(NEWLINE);
        process.exit(130);
      }
      if (BACKSPACE.includes(char)) {
        value = value.slice(0, -1);
        return;
      }
      // Ignore the remaining control codes; take everything else verbatim.
      if (char >= ' ') value += char;
    };
    process.stdin.on('data', onData);
  });
}

/**
 * Replace a variable in the file, or append it.
 *
 * The rest of the file is left untouched, comments and order included: this is
 * somebody's working environment, not a file this script owns.
 */
export function setVariable(text, name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, line);
  const separator = text.endsWith('\n') || text === '' ? '' : '\n';
  return `${text}${separator}${line}\n`;
}

export function currentValue(text, name) {
  const match = text.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return match ? match[1].trim() : '';
}

/** What is wrong with this password, if anything. */
export function reject(password, email) {
  if (password.length === 0) return 'Nothing was entered.';
  if (password.length < MIN_LENGTH) {
    return `Too short: ${password.length} characters, and the portal needs ${MIN_LENGTH}. Below that it reports itself as unconfigured and answers 404 with nothing to say why.`;
  }
  if (email && password.toLowerCase() === email.toLowerCase()) {
    return 'That is the email address.';
  }
  if (/^(.)\1+$/.test(password)) return 'That is one character repeated.';
  return null;
}

async function main() {
  let text = '';
  try {
    text = await readFile(ENV_PATH, 'utf8');
  } catch {
    say('No .env.local yet — creating one.');
  }

  const email = (process.argv[2] || currentValue(text, 'ROOT_EMAIL')).trim();
  if (!email) {
    say('No address to configure.');
    say('');
    say('  npm run root:setup you@example.com');
    process.exitCode = 1;
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    say(`"${email}" does not look like an email address.`);
    process.exitCode = 1;
    return;
  }

  say('');
  say(`Root portal address:  ${email}`);
  say('');
  say('This is an operator login. It is not a product account, it grants nothing');
  say('inside the app, and no account of the same name is affected by it.');
  say('');

  const password = await readSecret(`Password (${MIN_LENGTH}+ characters, not shown): `);
  const problem = reject(password, email);
  if (problem) {
    say('');
    say(problem);
    say('Nothing was changed.');
    process.exitCode = 1;
    return;
  }

  if (process.stdin.isTTY) {
    const again = await readSecret('Again: ');
    if (again !== password) {
      say('');
      say('Those did not match. Nothing was changed.');
      process.exitCode = 1;
      return;
    }
  }

  text = setVariable(text, 'ROOT_EMAIL', email);
  text = setVariable(text, 'ROOT_PASSWORD', password);
  await writeFile(ENV_PATH, text, { mode: 0o600 });

  say('');
  say('Written to .env.local, which is gitignored. Restart the dev server —');
  say('environment variables are read once, at boot.');
  say('');
  say('For the deployment, set the same two there. Vercel keeps its own');
  say('environment, so the portal exists on the next deploy and on every deploy');
  say('after it; nothing runs at build time to create it.');
  say('');
  say('  vercel env add ROOT_EMAIL production');
  say('  vercel env add ROOT_PASSWORD production');
  say('  vercel env add ROOT_SESSION_SECRET production   # optional, see below');
  say('');
  say('Add them as Secret rather than Config. Without ROOT_SESSION_SECRET the');
  say('signing key falls back to VAULT_MASTER_KEY, which works but ties two');
  say('unrelated secrets together — rotating one then ends root sessions too.');
  say('');
  say('To change either later, run this again. Changing the password also ends');
  say('every root session that is currently open, which is what you want from a');
  say('credential like this.');
  say('');
}

/**
 * Only when run, not when imported.
 *
 * The three functions above are exported so they can be tested directly —
 * rewriting somebody's environment file is the part of this that could do
 * quiet damage, and it should be checked without a prompt in the way.
 */
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('root-setup.mjs');
if (invokedDirectly) {
  main().catch((error) => {
    // Never let a failure print what was being written.
    say(`Could not write the configuration: ${String(error?.code || error?.name || 'error')}`);
    process.exitCode = 1;
  });
}
