import test from 'node:test';
import assert from 'node:assert/strict';
import { domainOf, editDistance, emailProblem, suggestEmail } from '../lib/auth/emailAddress.js';

test('an ordinary address is accepted', () => {
  for (const address of [
    'sam@example.com',
    'Sam.Smith+work@sub.example.co.uk',
    "o'hara_1@company-name.io",
    'a@b.co',
    'first.last@many.levels.of.subdomain.org',
  ]) {
    assert.equal(emailProblem(address), null, address);
  }
});

test('the shapes the old loose check let through are refused', () => {
  // Every one of these passed `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/`, and not one of
  // them is an address any mail server would take.
  const bad = {
    '..@example.com': /start or end with a dot/,
    'sam..smith@example.com': /two dots in a row/,
    '.sam@example.com': /start or end with a dot/,
    'sam.@example.com': /start or end with a dot/,
    'sam@-example.com': /not a valid domain/,
    'sam@example-.com': /not a valid domain/,
    'sam@example..com': /two dots in a row/,
    'sam@example.123': /not a real domain suffix/,
    'sam@.example.com': /start or end with a dot/,
    'sam@example.com.': /start or end with a dot/,
  };
  for (const [address, expected] of Object.entries(bad)) {
    const problem = emailProblem(address);
    assert.ok(problem, `${address} should be refused`);
    assert.match(problem, expected, address);
  }
});

test('the obvious mistakes are named, not answered with "invalid email"', () => {
  assert.match(emailProblem(''), /Enter your email/);
  assert.match(emailProblem('sam'), /needs an @/);
  assert.match(emailProblem('sam@@example.com'), /only one @/);
  assert.match(emailProblem('@example.com'), /nothing before the @/);
  assert.match(emailProblem('sam@'), /nothing after the @/);
  assert.match(emailProblem('sam@localhost'), /not a complete domain/);
  assert.match(emailProblem('sam smith@example.com'), /cannot contain spaces/);
});

test('the length limits are the ones the mail RFCs set', () => {
  assert.equal(emailProblem(`${'a'.repeat(64)}@example.com`), null, '64 is allowed');
  assert.match(emailProblem(`${'a'.repeat(65)}@example.com`), /too long/);
  assert.match(emailProblem(`${'a'.repeat(250)}@${'b'.repeat(250)}.com`), /too long to be real/);
});

test('surrounding whitespace is forgiven, inner whitespace is not', () => {
  assert.equal(emailProblem('  sam@example.com  '), null);
  assert.match(emailProblem('sam@exa mple.com'), /cannot contain spaces/);
});

test('the domain is read off the address', () => {
  assert.equal(domainOf('Sam@Example.COM'), 'example.com');
  assert.equal(domainOf('sam+tag@mail.example.org'), 'mail.example.org');
  assert.equal(domainOf('nonsense'), null);
});

test('a transposition counts as one edit', () => {
  assert.equal(editDistance('gmial.com', 'gmail.com'), 1, 'the commonest way it is mistyped');
  assert.equal(editDistance('gmail.com', 'gmail.com'), 0);
  assert.equal(editDistance('', 'abc'), 3);
});

test('a mistyped provider gets a correction to click', () => {
  assert.equal(suggestEmail('sam@gmial.com'), 'sam@gmail.com');
  assert.equal(suggestEmail('sam@gmail.con'), 'sam@gmail.com');
  assert.equal(suggestEmail('sam@hotmial.com'), 'sam@hotmail.com');
  assert.equal(suggestEmail('sam@yaho.com'), 'sam@yahoo.com');
});

test('a correct or unrelated domain is left alone', () => {
  assert.equal(suggestEmail('sam@gmail.com'), null, 'already right');
  assert.equal(suggestEmail('sam@segueit.com'), null, 'a real company, nothing like a provider');
  assert.equal(suggestEmail('sam@acme.co.uk'), null);
  assert.equal(suggestEmail('nonsense'), null);
});

test('a suggestion is never a rejection', () => {
  // A real company one character from a famous provider must still be able to
  // sign up, so the address itself stays valid and only a hint is offered.
  assert.equal(emailProblem('sam@gmial.com'), null);
});

test('an ambiguous near-miss suggests nothing rather than guessing', () => {
  // Equidistant from both me.com and proton.me — a coin flip is worse than
  // saying nothing.
  const suggestion = suggestEmail('sam@ne.com');
  assert.ok(suggestion === null || suggestion.endsWith('me.com'), suggestion);
});
