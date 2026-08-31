import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentValue, reject, setVariable } from '../scripts/root-setup.mjs';

/* Rewriting somebody's environment file.
 *
 * The prompt and the printing are not the risk here — losing a line of a
 * working .env.local is, and it would be discovered later and somewhere else. */

test('an existing variable is replaced in place, and nothing else moves', () => {
  const before = [
    '# Supabase',
    'NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co',
    'ROOT_EMAIL=old@example.com',
    '',
    '# Mail',
    'SMTP_USER=someone@gmail.com',
    '',
  ].join('\n');

  const after = setVariable(before, 'ROOT_EMAIL', 'new@example.com');
  assert.match(after, /^ROOT_EMAIL=new@example\.com$/m);
  assert.doesNotMatch(after, /old@example\.com/);
  // Every other line survives, comments and blank lines included.
  for (const line of ['# Supabase', 'NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co', '# Mail', 'SMTP_USER=someone@gmail.com']) {
    assert.ok(after.includes(line), `lost: ${line}`);
  }
  assert.equal(after.split('\n').length, before.split('\n').length);
});

test('a variable that is not there yet is appended', () => {
  const after = setVariable('EXISTING=1\n', 'ROOT_PASSWORD', 'a-passphrase');
  assert.equal(after, 'EXISTING=1\nROOT_PASSWORD=a-passphrase\n');
});

test('a file with no trailing newline does not have two lines run together', () => {
  const after = setVariable('EXISTING=1', 'ROOT_EMAIL', 'a@b.com');
  assert.equal(after, 'EXISTING=1\nROOT_EMAIL=a@b.com\n');
});

test('an empty file becomes a file with one line', () => {
  assert.equal(setVariable('', 'ROOT_EMAIL', 'a@b.com'), 'ROOT_EMAIL=a@b.com\n');
});

test('a name that is a prefix of another is not mistaken for it', () => {
  // ROOT_EMAIL must not be found or rewritten by a pass over ROOT_EMAIL_BACKUP,
  // and setting one must leave the other alone.
  const before = 'ROOT_EMAIL_BACKUP=spare@example.com\nROOT_EMAIL=main@example.com\n';
  assert.equal(currentValue(before, 'ROOT_EMAIL'), 'main@example.com');

  const after = setVariable(before, 'ROOT_EMAIL', 'changed@example.com');
  assert.match(after, /^ROOT_EMAIL=changed@example\.com$/m);
  assert.match(after, /^ROOT_EMAIL_BACKUP=spare@example\.com$/m);
});

test('reading a value that is not set returns nothing, not undefined text', () => {
  assert.equal(currentValue('OTHER=1\n', 'ROOT_EMAIL'), '');
  assert.equal(currentValue('', 'ROOT_EMAIL'), '');
  assert.equal(currentValue('ROOT_EMAIL=\n', 'ROOT_EMAIL'), '');
});

test('a password below the length the app enforces is refused here', () => {
  // The app treats a short password as no password and answers 404, which is
  // right for a stranger and impossible to debug for the person deploying it.
  // Catching it at the point of setting is the only place it can be explained.
  assert.match(reject('', 'a@b.com'), /Nothing was entered/);
  assert.match(reject('short', 'a@b.com'), /Too short: 5 characters/);
  assert.match(reject('elevenchars', 'a@b.com'), /needs 12/);
  assert.equal(reject('twelvechars!', 'a@b.com'), null);
});

test('and so are the two passwords nobody meant to set', () => {
  assert.match(reject('operator@example.com', 'operator@example.com'), /the email address/);
  assert.match(reject('aaaaaaaaaaaaaa', 'a@b.com'), /one character repeated/);
  // A long passphrase with a repeated run in it is fine.
  assert.equal(reject('aaaa-not-just-aaaa', 'a@b.com'), null);
});
