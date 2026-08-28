import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The middleware's matcher decides which requests reach the sign-in check, so
 * a path it excludes is a path with no session check at all. That makes it part
 * of the auth surface and worth a test — and it is exactly the kind of thing
 * review cannot catch, because the defect lived in the difference between what
 * the source *looks* like and the string JavaScript actually produces.
 *
 * The bug: `'...\.(?:svg|png|...)$'` in a single-quoted string. `\.` collapses
 * to `.`, so the pattern matched any character before those letters, and
 * `/insight/[id]` — a real dynamic route — let `/insight/abcpng` past the door.
 *
 * `middleware.js` cannot be imported here: it pulls in `next/server`, which
 * only resolves inside Next's own build. So the matcher is read out of the
 * source, which is the right level anyway — the question under test is what
 * string Next is handed.
 */
function matcherFromSource() {
  const source = readFileSync(new URL('../middleware.js', import.meta.url), 'utf8');
  const found = /matcher:\s*\[\s*'((?:[^'\\]|\\.)*)'/.exec(source);
  assert.ok(found, 'no single-quoted matcher found in middleware.js — update this test');

  // Undo JavaScript's string escaping the way the engine does, so `\\.` in the
  // source becomes the `\.` the pattern needs — and, crucially, so a lone `\.`
  // becomes the bare `.` that caused the bug. JSON.parse would have been
  // stricter than JavaScript here and rejected `\.` outright, which fails the
  // test for the right reason with the wrong message: the point is that the
  // engine accepts it and quietly drops the backslash.
  const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };
  return found[1].replace(/\\(.)/g, (_, ch) => ESCAPES[ch] ?? ch);
}

/**
 * Next wraps the matcher in its own prefix and suffix, but for a pattern of
 * this shape — one anchored group with a negative lookahead — the wrapper makes
 * no difference to which paths match. Verified against the regex the build
 * emits into .next/server/middleware-manifest.json.
 */
const compiled = () => new RegExp(`^${matcherFromSource()}$`);

/** Does a request at this path reach the middleware, and so the auth check? */
const guarded = (pathname) => compiled().test(pathname);

test('every page and API route is behind the middleware', () => {
  for (const path of [
    '/',
    '/dashboard',
    '/explore',
    '/ask',
    '/measures',
    '/quality',
    '/model',
    '/present',
    '/report',
    '/report/print',
    '/profile',
    '/sign-in', // reaches the middleware, which then lets it through by name
    '/insight/abc',
    '/api/narrate',
    '/api/connect',
    '/api/analyses/abc/share',
  ]) {
    assert.ok(guarded(path), `${path} must reach the middleware`);
  }
});

test('a dynamic id ending in an image extension does not skip the auth check', () => {
  // The reported bug, and the two shapes of it. `/insight/[id]` is a catch-all
  // for whatever the id happens to be, so no rule that reads the end of a path
  // can tell one of these from a static file.
  assert.ok(guarded('/insight/abcpng'), 'an id merely ending in "png"');
  assert.ok(guarded('/insight/abc.png'), 'an id ending in ".png"');

  for (const ext of ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'woff', 'woff2']) {
    assert.ok(guarded(`/insight/report.${ext}`), `an id ending in ".${ext}"`);
    assert.ok(guarded(`/insight/report${ext}`), `an id ending in "${ext}"`);
  }
});

test('the excluded paths are the ones this app actually serves files from', () => {
  assert.equal(guarded('/_next/static/chunks/main.js'), false);
  assert.equal(guarded('/_next/image'), false);
  assert.equal(guarded('/favicon.ico'), false);
  assert.equal(guarded('/avatars/analyst.jpg'), false);
});

test('an exclusion matches the file or directory it names, not a lookalike', () => {
  // Unescaped, `favicon.ico` also excused `faviconXico`; unanchored, `avatars`
  // excused any path merely starting with those letters. Neither is a route
  // today, which is the point — they should not be waved through on the chance
  // that one day one is.
  assert.ok(guarded('/faviconXico'));
  assert.ok(guarded('/avatarsX'));

  // `_next/` is deliberately not held to that standard. It is Next's own
  // reserved namespace, so no route of this app can ever be served from it and
  // there is nothing there to leave unguarded.
  assert.equal(guarded('/_next/staticX'), false);
});
