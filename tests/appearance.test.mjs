/**
 * How the app looks, as data.
 *
 * Two independent choices — the lighting and the material — and the reason
 * they are independent is the thing most worth pinning: somebody who likes
 * clay and turns the lights on wants dark clay to become light clay, not to
 * lose their material. The attribute mapping is pinned too, because the
 * blocking script in the document head and the stylesheet have to agree about
 * it exactly, and neither can see the other.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  APPEARANCE_SCRIPT,
  DEFAULT_MODE,
  DEFAULT_SURFACE,
  MODES,
  MODE_KEY,
  SURFACES,
  SURFACE_KEY,
  appearanceAttributes,
  isMode,
  isSurface,
  normalizeAppearance,
  surfaceInfo,
} from '../lib/appearance.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('the three materials the settings page offers are the three that exist', () => {
  assert.deepEqual(SURFACES.map((s) => s.id), ['glass', 'clay', 'neu']);
  for (const s of SURFACES) {
    assert.ok(s.label && s.blurb && s.detail, `${s.id} is missing its description`);
    assert.ok(!/^\s*$/.test(s.blurb));
  }
  assert.deepEqual(MODES.map((m) => m.id), ['dark', 'light']);
});

test('anything stored that is not one of them falls back to the default', () => {
  assert.deepEqual(normalizeAppearance({}), { mode: 'dark', surface: 'glass' });
  assert.deepEqual(normalizeAppearance({ mode: 'sepia', surface: 'brutalist' }), {
    mode: DEFAULT_MODE,
    surface: DEFAULT_SURFACE,
  });
  assert.deepEqual(normalizeAppearance({ mode: 'light', surface: 'neu' }), { mode: 'light', surface: 'neu' });
  assert.equal(isMode('light'), true);
  assert.equal(isMode('Light'), false, 'the stored value is exact, not forgiving');
  assert.equal(isSurface('clay'), true);
  assert.equal(surfaceInfo('nope').id, 'glass');
});

test('the defaults carry no attribute, so a first paint needs nothing applied', () => {
  assert.deepEqual(appearanceAttributes({ mode: 'dark', surface: 'glass' }), {
    'data-theme': null,
    'data-surface': null,
  });
});

test('each choice maps to exactly one attribute, and they do not interfere', () => {
  assert.deepEqual(appearanceAttributes({ mode: 'light', surface: 'glass' }), {
    'data-theme': 'light',
    'data-surface': null,
  });
  assert.deepEqual(appearanceAttributes({ mode: 'dark', surface: 'clay' }), {
    'data-theme': null,
    'data-surface': 'clay',
  });
  // The pair that proves they are orthogonal: turning the lights on must not
  // take the material away.
  assert.deepEqual(appearanceAttributes({ mode: 'light', surface: 'neu' }), {
    'data-theme': 'light',
    'data-surface': 'neu',
  });
});

test('the blocking script writes the same attributes, from the same keys', () => {
  assert.ok(APPEARANCE_SCRIPT.includes(MODE_KEY), 'the script reads a key nothing writes');
  assert.ok(APPEARANCE_SCRIPT.includes(SURFACE_KEY));
  assert.ok(APPEARANCE_SCRIPT.includes('data-theme'));
  assert.ok(APPEARANCE_SCRIPT.includes('data-surface'));
  // Every non-default value has to appear in it, or that material simply never
  // survives a reload.
  for (const s of SURFACES.filter((x) => x.id !== DEFAULT_SURFACE)) {
    assert.ok(APPEARANCE_SCRIPT.includes(`'${s.id}'`), `${s.id} is never applied before paint`);
  }
  assert.ok(APPEARANCE_SCRIPT.includes('try'), 'storage can throw, and a thrown head script blanks the page');
});

test('the stylesheet styles every material the settings page can choose', () => {
  const css = read('../app/appearance.css');
  for (const s of SURFACES.filter((x) => x.id !== DEFAULT_SURFACE)) {
    assert.ok(css.includes(`[data-surface='${s.id}']`), `${s.id} has no styles`);
    // And in both lightings: a material that only exists in the dark is a
    // material somebody loses the moment they open the blinds.
    assert.ok(
      css.includes(`[data-surface='${s.id}'][data-theme='light']`),
      `${s.id} has no light-mode values`
    );
  }
  for (const s of SURFACES) {
    assert.ok(css.includes(`data-preview='${s.id}'`), `${s.id} has no swatch to choose from`);
  }
});

test('a card is defined once, in tokens the materials set', () => {
  const globals = read('../app/globals.css');
  const card = globals.slice(globals.indexOf('\n.card {'), globals.indexOf('\n.card {') + 260);
  for (const token of ['--card-bg', '--card-border', '--radius-panel', '--lift-panel', '--panel-blur']) {
    assert.ok(card.includes(token), `.card hardcodes what ${token} is for`);
  }
  // The materials have to supply every token the card reads, or one of them
  // inherits a value meant for another.
  const css = read('../app/appearance.css');
  for (const token of ['--radius-panel', '--lift-panel', '--panel-blur', '--card-bg']) {
    assert.ok(css.includes(token), `${token} is read by .card and set by no material`);
  }
});

test('neumorphism turns the borders off, because that is the whole material', () => {
  const css = read('../app/appearance.css');
  const neu = css.slice(css.indexOf("data-surface='neu'"));
  assert.match(neu, /border-color:\s*transparent/);
  assert.ok(css.includes('--wash-a: transparent'), 'a lit ground shows through a surface its own colour');
});
