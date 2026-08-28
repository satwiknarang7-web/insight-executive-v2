import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Who the "notify by email" step sends the report to.
 *
 * The bug: `emailReport` searched the refreshed share list for a row whose
 * handle or label matched the share just written. A recipient who has not
 * chosen a username has `handle: null`, so the first clause compared
 * `null === null` against every other handle-less recipient and matched the
 * earliest of them — the list is ordered oldest first — short-circuiting before
 * the label clause that would have been correct. Share with alice, then share
 * with bob and tick notify, and the report went to alice.
 *
 * These are source assertions rather than behavioural ones, which is weaker and
 * worth naming. Neither module can be imported by the test runner:
 * `lib/analyses.server.js` pulls in `server-only` and `next/headers`, which
 * only resolve inside Next's own build, and `emailReport` is not exported.
 * Reaching the real behaviour would need Supabase, a mail server and a headless
 * Chrome. So what is pinned here is the invariant that made the bug possible:
 * identity must be carried from the write, never rediscovered from strings that
 * are legitimately null.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

/**
 * Drop comments, so a comment describing the old approach does not read as the
 * old approach. The fix deliberately names what it replaced — that explanation
 * is worth keeping, and it should not trip a check looking for the code.
 *
 * Crude, and fine for the job: it only needs to be right about the two function
 * bodies below, neither of which contains a regex literal or a string with `//`
 * in it.
 */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/** The body of a named function, from its declaration to the closing brace. */
function functionBody(source, declaration) {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `could not find "${declaration}" — update this test`);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, `could not find the end of "${declaration}" — update this test`);
  return stripComments(source.slice(start, end));
}

test('shareAnalysis reports which user it granted access to', () => {
  // Without this, the notification has nothing unambiguous to address: a handle
  // is null for anyone who has not chosen one, and a label is whatever the
  // owner happened to type.
  const body = functionBody(read('../lib/analyses.server.js'), 'export async function shareAnalysis');
  const returned = /return \{([\s\S]*?)\};/.exec(body);
  assert.ok(returned, 'shareAnalysis must return an object describing the share');
  assert.match(returned[1], /\buserId\b/, 'that object must carry the recipient user id');
});

test('the notification addresses the recipient by id, not by handle or label', () => {
  const body = functionBody(read('../app/api/analyses/[id]/share/route.js'), 'async function emailReport');

  assert.match(body, /findUserById\(shared\.userId\)/, 'the address is looked up from the resolved id');

  // The specific shape of the bug: rediscovering the recipient by scanning the
  // share list for a matching display string.
  assert.ok(
    !/shares\s*\|\|\s*\[\]|\.find\(/.test(body),
    'emailReport must not re-select the recipient out of the share list'
  );
  assert.ok(
    !/\.handle\s*===|\.sharedAs\s*===/.test(body),
    'a handle or label is not an identity — both are null for a real recipient'
  );
});

test('the share route no longer hands the list to the notification', () => {
  // The parameter going away is what makes the old approach unavailable rather
  // than merely unused.
  const source = read('../app/api/analyses/[id]/share/route.js');
  const call = /emailReport\(\{([^}]*)\}\)/.exec(source);
  assert.ok(call, 'could not find the emailReport call — update this test');
  assert.ok(!/\bshares\b/.test(call[1]), 'emailReport should not receive the share list at all');
});
