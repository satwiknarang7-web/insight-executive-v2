import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthSchemaMissing, isSchemaMissing, raiseIfSchemaMissing } from '../lib/auth/schema.js';
import { MAX_PAGES, PAGE_SIZE, findUserInPages } from '../lib/auth/lookup.js';

// ---------------------------------------------------------------------------
// Telling a missing migration apart from a real error
// ---------------------------------------------------------------------------

test('PostgREST’s unknown-function error is recognised, by code or by message', () => {
  assert.equal(isSchemaMissing({ code: 'PGRST202', message: 'whatever' }), true);
  assert.equal(
    isSchemaMissing({ message: 'Could not find the function public.svc_challenge_get(p_id)' }),
    true
  );
});

test('a real error is never dressed up as a deployment step', () => {
  // Each of these needs the operator to look somewhere completely different.
  for (const error of [
    { code: '42501', message: 'permission denied for function svc_challenge_get' },
    { code: 'PGRST301', message: 'JWT expired' },
    { message: 'fetch failed' },
    { message: 'Invalid API key' },
    null,
    undefined,
  ]) {
    assert.equal(isSchemaMissing(error), false, JSON.stringify(error));
  }
});

test('raising is the same decision, and carries the SQL file to run', () => {
  assert.throws(() => raiseIfSchemaMissing({ code: 'PGRST202' }), AuthSchemaMissing);
  assert.doesNotThrow(() => raiseIfSchemaMissing(null));
  assert.doesNotThrow(() => raiseIfSchemaMissing({ message: 'connection refused' }));

  try {
    raiseIfSchemaMissing({ code: 'PGRST202' });
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.name, 'AuthSchemaMissing');
    assert.match(e.message, /APPLY_TO_LIVE_PROJECT\.sql/);
  }
});

// ---------------------------------------------------------------------------
// Finding a user across pages
// ---------------------------------------------------------------------------

/** A fake admin API holding `total` users, recording which pages were asked for. */
function fakeAdmin(total, { failOnPage = null } = {}) {
  const users = Array.from({ length: total }, (_, i) => ({ id: `u${i}`, email: `user${i}@example.com` }));
  const asked = [];
  return {
    asked,
    listUsers: async ({ page, perPage }) => {
      asked.push(page);
      if (failOnPage === page) return { data: null, error: { message: 'rate limited' } };
      return { data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null };
    },
  };
}

test('a user on the first page is found without asking for a second', async () => {
  const admin = fakeAdmin(10);
  const found = await findUserInPages(admin, 'user3@example.com');
  assert.equal(found.id, 'u3');
  assert.deepEqual(admin.asked, [1]);
});

test('a user past the first page is still found', async () => {
  // The bug this replaces: only page one was ever read, so account 201 onwards
  // simply did not exist as far as sign-up and sign-in were concerned.
  const admin = fakeAdmin(PAGE_SIZE * 2 + 5);
  const found = await findUserInPages(admin, `user${PAGE_SIZE + 7}@example.com`);
  assert.equal(found.id, `u${PAGE_SIZE + 7}`);
  assert.deepEqual(admin.asked, [1, 2]);
});

test('the walk stops at a short page rather than asking for an empty one', async () => {
  const admin = fakeAdmin(PAGE_SIZE + 3);
  assert.equal(await findUserInPages(admin, 'nobody@example.com'), null);
  assert.deepEqual(admin.asked, [1, 2]);
});

test('an exactly-full last page costs one extra request and still terminates', async () => {
  const admin = fakeAdmin(PAGE_SIZE);
  assert.equal(await findUserInPages(admin, 'nobody@example.com'), null);
  assert.deepEqual(admin.asked, [1, 2]);
});

test('the walk is capped, so a huge project cannot hang a request', async () => {
  const admin = fakeAdmin(PAGE_SIZE * (MAX_PAGES + 10));
  assert.equal(await findUserInPages(admin, 'nobody@example.com'), null);
  assert.equal(admin.asked.length, MAX_PAGES);
});

test('matching is case-insensitive on both sides', async () => {
  const admin = {
    listUsers: async () => ({ data: { users: [{ id: 'u1', email: 'Sam@Example.com' }] }, error: null }),
  };
  assert.equal((await findUserInPages(admin, 'sam@example.com')).id, 'u1');
  assert.equal((await findUserInPages(admin, '  SAM@EXAMPLE.COM  ')).id, 'u1');
});

test('an API error ends the walk as "not found" rather than throwing', async () => {
  const admin = fakeAdmin(PAGE_SIZE * 3, { failOnPage: 2 });
  assert.equal(await findUserInPages(admin, `user${PAGE_SIZE + 1}@example.com`), null);
  assert.deepEqual(admin.asked, [1, 2]);
});

test('a blank address never reaches the API', async () => {
  const admin = fakeAdmin(10);
  assert.equal(await findUserInPages(admin, ''), null);
  assert.equal(await findUserInPages(admin, null), null);
  assert.deepEqual(admin.asked, []);
});
