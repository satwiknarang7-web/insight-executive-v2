import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from '../lib/auth/redirectTarget.js';

/**
 * The one attacker-controlled string in the OAuth callback.
 *
 * `next` decides where somebody lands *after* the route has given them a real
 * session, which is what makes it worth a test of its own: an open redirect
 * here does not leak a cookie, it forwards a freshly authenticated person to
 * whatever site asked. The route's other inputs are opaque single-use codes
 * only Supabase can redeem.
 *
 * It is tested here rather than through the endpoint because `safeNext` is
 * only reached on a *successful* code exchange, and there is no way to produce
 * one without a live Supabase project. The branch that refuses a bad `next` is
 * therefore unreachable from an integration test and reachable from this one.
 */

test('a relative path is kept', () => {
  assert.equal(safeNext('/explore'), '/explore');
  assert.equal(safeNext('/insight/slide_2'), '/insight/slide_2');
  assert.equal(safeNext('/home?tab=sources'), '/home?tab=sources');
});

test('anything that could leave this origin falls back to /home', () => {
  // Protocol-relative: a browser resolves this to another host entirely, and
  // it passes a naive "starts with a slash" check.
  assert.equal(safeNext('//evil.example/x'), '/home');
  assert.equal(safeNext('///evil.example'), '/home');
  assert.equal(safeNext('https://evil.example'), '/home');
  assert.equal(safeNext('http://evil.example'), '/home');
  // No scheme, no leading slash: resolved relative to the current directory,
  // so it is not an escape — but it is not a route either.
  assert.equal(safeNext('evil.example'), '/home');
  assert.equal(safeNext('javascript:alert(1)'), '/home');
});

test('a missing or empty parameter falls back to /home', () => {
  assert.equal(safeNext(null), '/home');
  assert.equal(safeNext(undefined), '/home');
  assert.equal(safeNext(''), '/home');
});
