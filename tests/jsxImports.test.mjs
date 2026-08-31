import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every component a file renders, it has to have.
 *
 * This exists because of a bug that reached a user. A logo component was
 * swapped into six files and the import was added to five of them; the sixth
 * threw `Logo is not defined` the moment someone opened the page.
 *
 * Nothing caught it. This project is plain JavaScript, so an undefined
 * identifier is not a compile error — `next build` compiled the file happily,
 * because `<Logo />` is only a reference to a variable that JSX looks up at
 * *render* time. There are no types to notice and the unit tests cannot import
 * a page, so the only signal was the page erroring in front of somebody.
 *
 * The check is therefore a source scan: for every capitalised JSX tag, the file
 * must import it, declare it, or receive it as a prop. It is the cheapest
 * stand-in for the compiler this codebase does not have, and it runs in
 * milliseconds.
 */

// fileURLToPath, not `.pathname`: this project lives in a directory whose name
// contains a space, which a URL pathname keeps as %20.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN = ['app', 'components'];

/** Every .js file under the scanned directories. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Strip comments before looking for JSX.
 *
 * This codebase explains itself at length, and its prose names components:
 * `axis.js` documents what to spread onto an `<XAxis>` and how a `<Legend>`
 * used to be hand-rolled. Neither is a render, and scanning raw source reported
 * both as missing imports — precisely the false positive that gets a check like
 * this switched off rather than fixed.
 */
export function stripComments(source) {
  const block = /\/\*[\s\S]*?\*\//g;
  const line = /(^|[^:])\/\/[^\n]*/g;
  return source.replace(block, '').replace(line, '$1');
}

/**
 * Names a file has in scope.
 *
 * Deliberately generous — the point is to catch a name that is nowhere at all,
 * not to model JavaScript scoping. A false positive here fails the suite on
 * correct code, which is worse than missing an exotic case.
 */
export function namesInScope(source) {
  const names = new Set();

  const add = (clause) => {
    for (const part of String(clause).split(',')) {
      const name = part.split(' as ').pop().replace(/[{}]/g, '').trim();
      if (name) names.add(name);
    }
  };

  // import X, { a, b as c } from '…'   and   import * as X from '…'
  for (const m of source.matchAll(/import\s+([^;]+?)\s+from\s+['"][^'"]+['"]/g)) {
    add(m[1].replace(/\*\s+as\s+/g, ''));
  }
  // Declarations, in every shape a component is written in here.
  for (const m of source.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:default\s+)?function\s+([A-Z]\w*)/g)) {
    names.add(m[1]);
  }
  for (const m of source.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var|class)\s+([A-Z]\w*)/g)) {
    names.add(m[1]);
  }
  // Renamed props: function Stat({ icon: Icon }) — the component is `Icon`.
  for (const m of source.matchAll(/\b\w+\s*:\s*([A-Z]\w*)/g)) names.add(m[1]);
  // A bare capitalised binding: ({ Icon }) or const [A, setA] = …
  for (const m of source.matchAll(/[{[]\s*([A-Z]\w*)\s*[,}\]]/g)) names.add(m[1]);

  return names;
}

/** Capitalised JSX tags, which is to say component references. */
export function componentsUsed(source) {
  const used = new Set();
  for (const m of stripComments(source).matchAll(/<([A-Z]\w*)(?:\.\w+)*[\s/>]/g)) used.add(m[1]);
  return used;
}

test('every component a file renders is in that file’s scope', () => {
  const missing = [];

  for (const dir of SCAN) {
    for (const file of walk(join(ROOT, dir))) {
      const source = readFileSync(file, 'utf8');
      const scope = namesInScope(source);
      for (const name of componentsUsed(source)) {
        if (!scope.has(name)) {
          missing.push(`${relative(ROOT, file).replace(/\\/g, '/')}: <${name}> is not imported or defined`);
        }
      }
    }
  }

  assert.deepEqual(missing, [], `\n${missing.join('\n')}\n`);
});

test('the scanner would have caught the bug it was written for', () => {
  // The exact shape that shipped: the component rendered, the import absent.
  const broken = [
    "import Link from 'next/link';",
    'export default function Shell() {',
    '  return <Link href="/"><Logo size="md" /></Link>;',
    '}',
  ].join('\n');

  assert.ok(componentsUsed(broken).has('Logo'));
  assert.ok(!namesInScope(broken).has('Logo'), 'nothing brings Logo into scope');

  const fixed = `import Logo from '../../components/shell/Logo';\n${broken}`;
  assert.ok(namesInScope(fixed).has('Logo'));
});

test('a component named only in prose is not a render', () => {
  const source = [
    '/** Returns props to spread onto `<XAxis>`, and explains `<Legend>`. */',
    '// A note about <Tooltip> in a line comment.',
    'export function axisProps() { return {}; }',
  ].join('\n');

  assert.deepEqual([...componentsUsed(source)], []);
});

test('the shapes this codebase actually uses are not false positives', () => {
  const source = [
    "import Logo, { PRODUCT_NAME } from './Logo';",
    "import * as Icons from 'lucide-react';",
    "import { Loader2 as Spinner } from 'lucide-react';",
    "const Wrapper = editing ? 'div' : Link;",
    'function Stat({ icon: Icon, label }) { return <Icon />; }',
    'export default function Page() {',
    '  return <><Logo /><Spinner /><Stat /><Wrapper /></>;',
    '}',
  ].join('\n');

  const scope = namesInScope(source);
  for (const name of componentsUsed(source)) {
    assert.ok(scope.has(name), `${name} should be recognised as in scope`);
  }
});
