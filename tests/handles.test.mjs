import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmailAddress, normalizeHandle, parseRecipient, suggestHandle } from '../lib/handles.js';

test('a username is folded to its canonical form', () => {
  assert.equal(normalizeHandle('  @Sam_99 '), 'sam_99');
  assert.equal(normalizeHandle('SAM'), 'sam');
});

test('a username that breaks the rules is refused rather than repaired', () => {
  assert.equal(normalizeHandle('ab'), null, 'too short');
  assert.equal(normalizeHandle('a'.repeat(25)), null, 'too long');
  assert.equal(normalizeHandle('sam smith'), null, 'no spaces');
  assert.equal(normalizeHandle('sam-smith'), null, 'no punctuation');
  assert.equal(normalizeHandle(''), null);
});

test('an address is recognised as an address', () => {
  assert.ok(isEmailAddress('sam@example.com'));
  assert.ok(isEmailAddress('  Sam.Smith+work@sub.example.co.uk  '));
  assert.ok(!isEmailAddress('sam'));
  assert.ok(!isEmailAddress('sam@example'), 'no dot in the domain');
  assert.ok(!isEmailAddress('sam @example.com'), 'no spaces');
});

test('the share box tells a username from an address', () => {
  assert.deepEqual(parseRecipient('sam'), { kind: 'handle', value: 'sam' });
  assert.deepEqual(parseRecipient('@Sam'), { kind: 'handle', value: 'sam' });
  assert.deepEqual(parseRecipient('Sam@Example.com'), { kind: 'email', value: 'sam@example.com' });
});

test('a half-typed address is reported as an address, not as a bad username', () => {
  // Telling someone who clearly typed an address that their *username* is
  // invalid sends them looking for a problem that is not there.
  assert.equal(parseRecipient('sam@example').kind, 'bad-email');
  assert.equal(parseRecipient('sam@').kind, 'bad-email');
  assert.equal(parseRecipient('sam smith').kind, 'bad-handle');
  assert.equal(parseRecipient('   ').kind, 'none');
});

test('a suggested username is derived from the address, and always usable', () => {
  assert.equal(suggestHandle('Sam.Smith@example.com'), 'samsmith');
  assert.match(suggestHandle('ab@example.com'), /^user_[a-z0-9]+$/, 'too short to use as-is');
  assert.ok(normalizeHandle(suggestHandle('a.b@example.com')), 'the suggestion is always valid');
});
