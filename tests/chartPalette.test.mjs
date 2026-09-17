import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ORDINAL,
  MAX_SERIES,
  OTHER_COLOR,
  PALETTES,
  categoryColor,
  foldToOther,
  ordinalRamp,
  paletteFor,
  seriesColor,
} from '../lib/chartPalette.js';

/* The palette rules. The colour values themselves are checked by the validator
   that produced them; what is checked here is that nothing in the code can put
   the same colour on two different things. */

test('every theme offers the same eight hues, in its own order', () => {
  const signature = (list) => [...list].sort().join();
  const base = signature(PALETTES[0].light);
  for (const theme of PALETTES) {
    assert.equal(theme.light.length, MAX_SERIES, `${theme.name} light`);
    assert.equal(theme.dark.length, MAX_SERIES, `${theme.name} dark`);
    assert.equal(signature(theme.light), base, `${theme.name} draws from the same hues`);
    assert.equal(new Set(theme.light).size, MAX_SERIES, `${theme.name} has no duplicate slot`);
    assert.equal(new Set(theme.dark).size, MAX_SERIES, `${theme.name} has no duplicate slot in dark`);
  }
});

test('the themes differ from each other, or they would not be a choice', () => {
  const orders = new Set(PALETTES.map((p) => p.light.join()));
  assert.equal(orders.size, PALETTES.length);
});

test('each surface gets its own steps', () => {
  assert.notDeepEqual(paletteFor('default', 'light'), paletteFor('default', 'dark'));
  assert.deepEqual(paletteFor('default', 'dark'), PALETTES[0].dark);
  // An unknown theme is the default rather than nothing.
  assert.deepEqual(paletteFor('nonsense', 'dark'), PALETTES[0].dark);
});

test('colours are never reused for a different series', () => {
  const palette = paletteFor('default', 'dark');
  const seen = new Map();
  for (let i = 0; i < MAX_SERIES; i++) {
    const color = seriesColor(palette, i, 'dark');
    assert.ok(!seen.has(color), `slot ${i} repeats the colour of slot ${seen.get(color)}`);
    seen.set(color, i);
  }
});

test('running out of colours shows as neutral, not as slot one again', () => {
  const palette = paletteFor('default', 'dark');
  // The bug this replaces: palette[8 % 8] is palette[0], so the ninth series
  // was drawn in the first series' colour and the legend called them different.
  assert.notEqual(seriesColor(palette, 8, 'dark'), palette[0]);
  assert.equal(seriesColor(palette, 8, 'dark'), OTHER_COLOR.dark);
  assert.equal(seriesColor(palette, 40, 'dark'), OTHER_COLOR.dark);
  assert.equal(seriesColor(palette, 8, 'light'), OTHER_COLOR.light);
});

test('a short list is left alone', () => {
  const rows = [{ k: 'a', v: 3 }, { k: 'b', v: 2 }];
  assert.equal(foldToOther(rows, 'k', 'v', 8), rows);
  assert.deepEqual(foldToOther([], 'k', 'v'), []);
  assert.deepEqual(foldToOther(null, 'k', 'v'), []);
});

test('a long list keeps its total when the tail is folded', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ k: `c${i}`, v: 12 - i }));
  const before = rows.reduce((s, r) => s + r.v, 0);

  const folded = foldToOther(rows, 'k', 'v', 8);
  assert.equal(folded.length, 8, 'never more slices than there are colours');
  assert.equal(folded.reduce((s, r) => s + r.v, 0), before, 'the whole is still the whole');

  const last = folded[folded.length - 1];
  assert.match(last.k, /^Other \(5\)$/, 'and it says how many it stands for');
  assert.equal(last.isOther, true);
  assert.deepEqual(folded.slice(0, 7), rows.slice(0, 7), 'the leaders are untouched');
});

test('a non-numeric value does not poison the folded total', () => {
  const rows = [
    ...Array.from({ length: 7 }, (_, i) => ({ k: `c${i}`, v: 10 })),
    { k: 'x', v: 5 },
    { k: 'y', v: null },
    { k: 'z', v: 4 },
  ];
  const folded = foldToOther(rows, 'k', 'v', 8);
  assert.equal(folded[folded.length - 1].v, 9);
});

test('an ordinal ramp reads light to dark and stops where it stops working', () => {
  for (const mode of ['light', 'dark']) {
    for (let n = 2; n <= MAX_ORDINAL; n++) {
      const ramp = ordinalRamp(n, mode);
      assert.equal(ramp.length, n, `${mode} ${n}`);
      assert.equal(new Set(ramp).size, n, `${mode} ${n} steps are all different`);
    }
    // Past the point where the eye can rank the steps it declines, so the
    // caller falls back to colouring by identity.
    assert.equal(ordinalRamp(MAX_ORDINAL + 1, mode), null);
    assert.equal(ordinalRamp(1, mode).length, 1);
  }
});

test('the ramp runs in opposite directions on the two surfaces', () => {
  // The two are not mirror images — each is drawn from the part of the ramp
  // that stays readable against its own background — but each has to be
  // monotone, or it is not a ramp at all.
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const light = ordinalRamp(5, 'light').map(luminance);
  const dark = ordinalRamp(5, 'dark').map(luminance);

  for (let i = 1; i < light.length; i++) {
    assert.ok(light[i] < light[i - 1], 'on white the ramp darkens as it goes');
    assert.ok(dark[i] > dark[i - 1], 'on the dark surface it lightens');
  }
  assert.notDeepEqual(ordinalRamp(5, 'light'), ordinalRamp(5, 'dark'));
});

test('a bar chart coloured per category cycles instead of going neutral', () => {
  const palette = paletteFor('default', 'dark');

  // The first lap is the palette itself, untouched.
  for (let i = 0; i < MAX_SERIES; i++) {
    assert.equal(categoryColor(palette, i, 'dark'), palette[i], `bar ${i}`);
  }

  // The ninth bar is not grey, and not the first bar's colour either. The bug
  // this replaces: bars nine and ten were both OTHER_COLOR, so two unrelated
  // categories were painted the same on a chart where colour is decoration.
  const ninth = categoryColor(palette, MAX_SERIES, 'dark');
  assert.notEqual(ninth, OTHER_COLOR.dark);
  assert.notEqual(ninth, palette[0]);
  assert.notEqual(ninth, categoryColor(palette, MAX_SERIES + 1, 'dark'));
  assert.match(ninth, /^#[0-9a-f]{6}$/);

  // Sixteen bars, sixteen colours.
  const colours = Array.from({ length: 16 }, (_, i) => categoryColor(palette, i, 'dark'));
  assert.equal(new Set(colours).size, 16);
});

test('the second lap moves away from the surface it is drawn on', () => {
  const luminance = (hex) =>
    [1, 3, 5].reduce((sum, at) => sum + parseInt(hex.slice(at, at + 2), 16), 0);

  const dark = paletteFor('default', 'dark');
  assert.ok(
    luminance(categoryColor(dark, MAX_SERIES, 'dark')) > luminance(dark[0]),
    'on a dark surface the second lap is lighter'
  );

  const light = paletteFor('default', 'light');
  assert.ok(
    luminance(categoryColor(light, MAX_SERIES, 'light')) < luminance(light[0]),
    'on a light surface the second lap is darker'
  );
});

test('colour still names the series everywhere colour is the only name', () => {
  // categoryColor is the exception, not a replacement: a legend, a donut and a
  // stack still go neutral past the eighth, because there the colour is the
  // only thing tying a mark to its label.
  const palette = paletteFor('default', 'dark');
  assert.equal(seriesColor(palette, MAX_SERIES, 'dark'), OTHER_COLOR.dark);
});
