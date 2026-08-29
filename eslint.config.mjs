import next from 'eslint-config-next/core-web-vitals';

/**
 * Linting, restored.
 *
 * `next lint` was removed in Next 16, so the old script silently ran
 * `next <dir>` against a directory called "lint" and errored out — which meant
 * nothing had linted this code for some time. This is the flat config that
 * replaces it, extending the same rules `next lint` used to run.
 *
 * ESLint is pinned to 9.x deliberately. On 10.x the parser that
 * eslint-config-next brings produces a scope manager the new core cannot use,
 * and every file fails with "scopeManager.addGlobals is not a function". 9.x is
 * the maintenance line and works; this can move once the Next config supports
 * ESLint 10.
 */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'scratch/**',
      'public/**',
      'supabase/**',
    ],
  },
  ...next,
  {
    name: 'insight/advisories',
    rules: {
      /**
       * The React Compiler-era rules, as warnings rather than errors.
       *
       * eslint-plugin-react-hooks 7 added a set of rules about effects, refs,
       * purity and memoization that did not exist when this code was written,
       * and they currently flag around thirty places. Most are genuine advice —
       * reading localStorage in an effect, mirroring state into a ref — and
       * some are deliberate and commented as such at the call site.
       *
       * They are warnings so that they are visible on every `npm run lint` and
       * in CI output, without turning the first green build red over a backlog
       * nobody has triaged. Working through them is real work with real risk to
       * rendering behaviour, and it belongs in its own change rather than
       * hidden inside "make the linter run".
       *
       * `rules-of-hooks` is deliberately NOT in this list. It stays an error:
       * it catches hooks called conditionally, which is a crash rather than a
       * style question, and it found two real ones.
       */
      /**
       * A name that is used and never defined is a crash, not a style
       * question. `ComposedDualChart` called `formatDateLabel` without
       * importing it, so every combo chart in the app threw a ReferenceError
       * and rendered "could not draw this chart" — and the linter had nothing
       * to say about it, because eslint-config-next leaves this rule off.
       */
      'no-undef': 'error',

      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
];

export default config;
