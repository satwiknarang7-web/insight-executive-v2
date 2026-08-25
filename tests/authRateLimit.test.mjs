import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAll, clientKey, reset, sweep, take } from '../lib/auth/rateLimit.js';

test('a bucket allows exactly its limit, then refuses with a wait', () => {
  clearAll();
  const opts = { limit: 3, windowMs: 60_000, now: 1_000 };
  assert.equal(take('a', opts).allowed, true);
  assert.equal(take('a', opts).allowed, true);
  const last = take('a', opts);
  assert.equal(last.allowed, true);
  assert.equal(last.remaining, 0);

  const refused = take('a', opts);
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSeconds > 0, 'a refusal must say when to retry');
});

test('the window reopens once it has passed', () => {
  clearAll();
  const base = { limit: 1, windowMs: 60_000 };
  assert.equal(take('b', { ...base, now: 1_000 }).allowed, true);
  assert.equal(take('b', { ...base, now: 2_000 }).allowed, false);
  assert.equal(take('b', { ...base, now: 62_000 }).allowed, true);
});

test('keys do not interfere with each other', () => {
  clearAll();
  const opts = { limit: 1, windowMs: 60_000, now: 5 };
  assert.equal(take('one', opts).allowed, true);
  assert.equal(take('two', opts).allowed, true);
  assert.equal(take('one', opts).allowed, false);
});

test('a successful login clears its own strikes', () => {
  clearAll();
  const opts = { limit: 1, windowMs: 60_000, now: 10 };
  take('c', opts);
  assert.equal(take('c', opts).allowed, false);
  reset('c');
  assert.equal(take('c', opts).allowed, true);
});

test('sweeping drops expired buckets but keeps live ones', () => {
  clearAll();
  take('old', { limit: 1, windowMs: 10, now: 0 });
  take('new', { limit: 1, windowMs: 10_000, now: 0 });
  sweep(1_000);
  // The expired key is forgotten, so it gets a full allowance again.
  assert.equal(take('old', { limit: 1, windowMs: 10, now: 1_000 }).allowed, true);
  assert.equal(take('new', { limit: 1, windowMs: 10_000, now: 1_000 }).allowed, false);
});

test('missing configuration never blocks a request', () => {
  clearAll();
  assert.equal(take('', { limit: 1, windowMs: 1 }).allowed, true);
  assert.equal(take('x', {}).allowed, true);
});

test('the client key uses the first forwarded address and is scoped', () => {
  const request = { headers: new Map([['x-forwarded-for', '203.0.113.5, 10.0.0.1']]) };
  request.headers.get = (k) => Map.prototype.get.call(request.headers, k) || null;
  assert.equal(clientKey(request, 'signin'), '203.0.113.5:signin');
});

test('an unknown caller still yields a usable key', () => {
  const request = { headers: { get: () => null } };
  assert.equal(clientKey(request, 'verify'), 'unknown:verify');
});
