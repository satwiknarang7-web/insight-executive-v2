import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Light mode's muted text is navy, and stays readable.
 *
 * The app expresses foreground as `white` at low alpha and re-points
 * `--color-white` at navy for light mode, which is right for borders and
 * surface tints and wrong for text: an alpha is a blend toward the page, not a
 * shade of the ink. `text-white/40`, the most-used muted class in the app,
 * composited to #9da8b5 on a white page — a light grey at 2.4:1, well under the
 * 4.5:1 a reader needs. `text-white/30` came out at 1.9:1.
 *
 * globals.css maps those alpha steps onto an opaque navy ramp. These tests hold
 * the mapping to three things it is easy to break by adding one class in a
 * component: every alpha the app actually uses is mapped, every step of the
 * ramp clears AA, and the override cannot outrank a hover or focus variant.
 */

const CSS = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
// `.pathname` on a file URL is a URL path, not a filesystem path: on Windows it
// comes back as "/C:/dev/Insight/", and joining that produced "C:\C:\dev\...".
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

const channel = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

function luminance(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every `--ink-N: #hex` declared in the light theme, in ramp order. */
function inkRamp() {
  const ramp = [];
  for (const [, step, hex] of CSS.matchAll(/--ink-(\d+):\s*(#[0-9a-f]{6})/gi)) {
    ramp[Number(step) - 1] = hex.toLowerCase();
  }
  return ramp;
}

/** Alpha steps used as *text* anywhere in the app, e.g. `text-white/40`. */
function alphasUsedInSource() {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.git' || entry === '.next') continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(js|jsx|ts|tsx)$/.test(entry)) continue;
      const source = readFileSync(path, 'utf8');
      for (const [, alpha] of source.matchAll(/\btext-white\/(\d+)\b/g)) found.add(Number(alpha));
    }
  };
  for (const dir of ['app', 'components', 'lib']) walk(join(ROOT, dir));
  return [...found].sort((a, b) => a - b);
}

test('the navy ramp is defined, ordered, and readable at every step', () => {
  const ramp = inkRamp();
  assert.ok(ramp.length >= 6, `expected a full ramp, got ${ramp.length} steps`);
  assert.ok(ramp.every(Boolean), 'no gaps in the ramp');

  for (const [i, hex] of ramp.entries()) {
    // Against the page and against the raised surface cards sit on.
    for (const ground of ['#ffffff', '#f6f8fb']) {
      const ratio = contrast(hex, ground);
      assert.ok(ratio >= 4.5, `--ink-${i + 1} (${hex}) is ${ratio.toFixed(2)}:1 on ${ground}`);
    }
    // Navy, not grey: the blue channel has to lead by a clear margin.
    const [r, , b] = [0, 2, 4].map((k) => parseInt(hex.slice(1 + k, 3 + k), 16));
    assert.ok(b - r > 40, `--ink-${i + 1} (${hex}) is not recognisably navy`);
  }

  // The ramp gets lighter step by step, which is what preserves the hierarchy
  // the design was drawn with once the alphas are gone.
  const ratios = ramp.map((hex) => contrast(hex, '#ffffff'));
  for (let i = 1; i < ratios.length; i++) {
    assert.ok(ratios[i] < ratios[i - 1], `--ink-${i + 1} is not lighter than --ink-${i}`);
  }
});

test('every muted text alpha the app uses is mapped to the ramp', () => {
  const used = alphasUsedInSource();
  assert.ok(used.length > 5, 'sanity: the app uses alpha text utilities');

  for (const alpha of used) {
    const rule = new RegExp(`\\.text-white\\\\/${alpha}\\b`);
    assert.ok(rule.test(CSS), `text-white/${alpha} has no light-mode navy mapping`);
  }
});

test('an unmapped alpha would still be caught by the light theme', () => {
  // Guards the guard: if the source scan silently returned nothing, the test
  // above would pass while every class went unmapped.
  assert.ok(alphasUsedInSource().includes(40), 'text-white/40 is the most-used muted class');
  assert.doesNotMatch(CSS, /\.text-white\\\/99\b/, 'and an alpha nobody uses is not mapped');
});

test('the overrides sit in the utilities layer, so variants still win', () => {
  // Two cascade facts this depends on. Unlayered CSS beats every layered rule
  // regardless of specificity, so an unlayered override would silently kill
  // `hover:text-accent-300` on any element that also carried a muted class.
  // And `:where()` contributes no specificity, so each rule weighs exactly what
  // the utility it replaces weighs and wins only on source order — leaving a
  // `hover:` or `focus:` variant, which carries one more pseudo-class, ahead.
  const block = CSS.slice(CSS.indexOf('@layer utilities'));
  assert.ok(block.length > 0, 'the overrides are inside @layer utilities');

  const overrides = [...CSS.matchAll(/^\s*(:root\[data-theme='light'\]|:where\([^)]*\))\s*\.text-white\\\/\d+/gm)];
  assert.ok(overrides.length > 0, 'sanity: overrides were found');
  for (const [line] of overrides) {
    assert.match(line, /^\s*:where\(/, `theme guard must be specificity-free: ${line.trim()}`);
  }

  // Variants compile to their own class names, so they need their own rules.
  for (const variant of ['hover\\:text-white', 'placeholder\\:text-white', 'disabled\\:text-white']) {
    assert.ok(CSS.includes(variant), `no light-mode rule for ${variant.replace('\\', '')} variants`);
  }
});

test('chart axes and section labels are navy too', () => {
  const light = CSS.slice(CSS.indexOf(":root[data-theme='light']"));
  const axis = /--chart-axis:\s*(#[0-9a-f]{6})/i.exec(light);
  assert.ok(axis, 'light mode sets its own axis colour');
  assert.ok(contrast(axis[1], '#ffffff') >= 4.5, `axis text is ${axis[1]}`);

  // `.label` mixes its own 35% alpha, so the utility remap cannot reach it.
  assert.match(CSS, /:root\[data-theme='light'\]\s*\.label\s*\{[^}]*--ink-/);
});
