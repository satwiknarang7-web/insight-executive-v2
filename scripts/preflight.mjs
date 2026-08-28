/**
 * Check the dependencies are actually installed, before a test run tries to
 * import them.
 *
 * Without this, an install that failed part-way shows up as a wall of
 * `ERR_MODULE_NOT_FOUND` from the test runner — one per test file, naming
 * whichever package that file happened to import first. That reads as broken
 * code rather than a missing install, and it sends whoever hit it looking in
 * the wrong place.
 *
 * `xlsx` is called out by name because it is the one dependency that does not
 * come from the npm registry, and so the one most likely to be the thing that
 * failed. See "A note on xlsx" in README.md.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** One package per kind of failure, rather than the whole dependency list. */
const REQUIRED = ['alasql', 'react', 'next', 'papaparse', 'xlsx'];

/**
 * Resolve the package itself, not its package.json.
 *
 * `require.resolve('alasql/package.json')` throws even when alasql is installed:
 * its `exports` map does not list `./package.json`, so Node refuses the subpath.
 * Checking that way reported a missing dependency on a perfectly good install —
 * which is precisely the failure this script exists to prevent, pointed the
 * other way.
 *
 * Only a resolution failure counts as missing. Anything else — a package that
 * resolves but cannot be loaded — is a different problem, and swallowing it
 * here would put the wrong message on it.
 */
const missing = REQUIRED.filter((name) => {
  try {
    require.resolve(name);
    return false;
  } catch (error) {
    return error?.code === 'MODULE_NOT_FOUND' || error?.code === 'ERR_MODULE_NOT_FOUND';
  }
});

if (missing.length > 0) {
  const lines = [
    `Dependencies are missing: ${missing.join(', ')}.`,
    '',
    'Run `npm install` and check it finished. If it stopped on a 403 for',
    'cdn.sheetjs.com, that is the `xlsx` dependency: SheetJS publishes to its',
    'own CDN rather than to npm, so a network that blocks it fails the whole',
    'install. See "A note on xlsx" in README.md — the npm-hosted version is',
    'three years old and carries two high-severity advisories, so pinning back',
    'to it is not a fix.',
  ];
  console.error(lines.join('\n'));
  process.exit(1);
}
