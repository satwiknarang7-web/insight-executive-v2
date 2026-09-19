/**
 * Make `server-only` resolvable to the test runner.
 *
 * `server-only` is not a library; it is a build-time tripwire. The package
 * exists so that importing a server module from a client bundle fails loudly
 * during compilation, and Next resolves it itself — which means plain Node has
 * never heard of it, and a `.server.js` module cannot be imported by a test at
 * all. The result, until now, was that anything behind that import got tested
 * by reading its source as a string.
 *
 * So the specifier is answered with an empty module here. Nothing is being
 * worked around: the guard's whole job is to fail in a client bundle, there is
 * no bundle in a test run, and the module underneath is ordinary JavaScript
 * that can be run and checked like any other.
 *
 * Registered per test file rather than globally, so it only ever applies where
 * a test deliberately asked for it.
 */
export function resolve(specifier, context, next) {
  if (specifier === 'server-only') {
    return { url: new URL('./serverOnlyStub.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
