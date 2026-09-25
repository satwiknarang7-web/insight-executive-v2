import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ACCENTS, DEFAULTS, PREFERENCES_SCRIPT, SCALES, MOTIONS, normalizePreferences, preferenceAttributes } from '../lib/preferences.js';

const css = fs.readFileSync(path.join(import.meta.dirname, '../app/globals.css'), 'utf8');

test('unknown stored values fall back to the defaults', () => {
  assert.deepEqual(normalizePreferences({}), DEFAULTS);
  assert.deepEqual(normalizePreferences({ accent: 'plaid', scale: 'huge', motion: 'wild' }), DEFAULTS);
  assert.equal(normalizePreferences({ accent: 'nebula' }).accent, 'nebula');
});

test('the defaults carry no attribute', () => {
  assert.deepEqual(preferenceAttributes(DEFAULTS), { 'data-accent': null, 'data-scale': null, 'data-motion': null });
  assert.deepEqual(preferenceAttributes({ accent: 'solar', scale: 'large', motion: 'reduced' }), { 'data-accent': 'solar', 'data-scale': 'large', 'data-motion': 'reduced' });
});

test('every non-default choice is applied before paint and styled in both lightings', () => {
  assert.ok(PREFERENCES_SCRIPT.includes('try'));
  for (const a of ACCENTS.filter((x) => x.id !== DEFAULTS.accent)) {
    assert.ok(PREFERENCES_SCRIPT.includes(`'${a.id}'`), `${a.id} not applied before paint`);
    assert.ok(css.includes(`[data-accent='${a.id}']:not([data-theme='light'])`), `${a.id} has no dark styles`);
    assert.ok(css.includes(`[data-accent='${a.id}'][data-theme='light']`), `${a.id} has no light styles`);
  }
  for (const s of SCALES.filter((x) => x.id !== DEFAULTS.scale)) assert.ok(css.includes(`[data-scale='${s.id}']`));
  for (const m of MOTIONS.filter((x) => x.id !== DEFAULTS.motion)) assert.ok(css.includes(`[data-motion='${m.id}']`));
});
