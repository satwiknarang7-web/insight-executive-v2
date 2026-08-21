import test from 'node:test';
import assert from 'node:assert/strict';
import { speakable, slideScript, summaryScript, deckScript, pickVoice } from '../lib/speech.js';
import { AVATARS, getAvatar } from '../lib/avatars.js';

const strategist = getAvatar('strategist');
const analyst = getAvatar('analyst');

const slide = {
  id: 'slide_1',
  pageTitle: 'Revenue by Region',
  insight_anchor: 'West leads with $1.2M.',
  insight_implication: 'That is 42% of the total.',
  insight_question: 'Check margin by region next.',
};

// ---------------------------------------------------------------------------
// The point of this module: text meant to be READ becomes text meant to be HEARD
// ---------------------------------------------------------------------------

test('currency and magnitude read as words, not letters', () => {
  assert.equal(speakable('$1.2M'), '1.2 million dollars');
  assert.equal(speakable('$450K'), '450 thousand dollars');
  assert.equal(speakable('£12'), '12 pounds');
  assert.equal(speakable('3.4B'), '3.4 billion');
});

test('percentages and quarters are spoken properly', () => {
  assert.equal(speakable('42%'), '42 percent');
  assert.equal(speakable('Q1 was flat'), 'quarter 1 was flat');
});

test('markdown never reaches the synthesiser', () => {
  assert.equal(speakable('**Verified metrics**'), 'Verified metrics');
  assert.equal(speakable('- item one'), '- item one'.replace(/[*_`#>]/g, '').trim());
  assert.doesNotMatch(speakable('### Heading with `code`'), /[#`]/);
});

test('column names read as words rather than punctuation', () => {
  assert.equal(speakable('unit_cost'), 'unit cost');
  assert.equal(speakable('Customers.region'), 'Customers region');
});

test('ranges and comparisons are spoken', () => {
  assert.equal(speakable('3719-7362'), '3719 to 7362');
  assert.equal(speakable('Revenue vs. Cost'), 'Revenue versus Cost');
});

// ---------------------------------------------------------------------------
// Persona
// ---------------------------------------------------------------------------

test('the same slide is framed differently by different avatars', () => {
  const a = slideScript(slide, strategist);
  const b = slideScript(slide, analyst);

  assert.notEqual(a, b, 'avatars must not be cosmetic');
  assert.match(a, /^Let's talk about revenue by Region/);
  assert.match(b, /^Revenue by Region/);

  // But the verified numbers survive in both, unchanged.
  for (const script of [a, b]) {
    assert.match(script, /1\.2 million dollars/);
    assert.match(script, /42 percent/);
  }
});

test('all four avatars produce a distinct opening', () => {
  const openings = AVATARS.map((a) => slideScript(slide, a).slice(0, 24));
  assert.equal(new Set(openings).size, 4, `expected four distinct openings, got ${openings.join(' | ')}`);
});

test('analyst notes are attributed, not blended into the findings', () => {
  const script = slideScript({ ...slide, analystNotes: 'Pricing changed in March.' }, strategist);
  assert.match(script, /A note from the analyst: Pricing changed in March/);
});

test('the last slide is signposted as the last', () => {
  assert.match(slideScript(slide, strategist, { index: 2, total: 3 }), /last of the findings/);
  assert.doesNotMatch(slideScript(slide, strategist, { index: 0, total: 3 }), /last of the findings/);
});

test('the summary introduces the presenter by name', () => {
  const script = summaryScript(
    { title: 'Executive Summary', macroInsights: ['Revenue grew 12%.'], strategicScorecard: { focus: 'West' } },
    strategist,
    { fileName: 'sales_workbook.xlsx', rowCount: 1800 }
  );
  assert.match(script, /I'm Nadia Reyes/);
  assert.match(script, /sales workbook/, 'underscores are spoken as spaces');
  assert.doesNotMatch(script, /\.xlsx/, 'the file extension should not be read aloud');
  assert.match(script, /12 percent/);
});

test('the deck script covers the summary plus every slide', () => {
  const scripts = deckScript({ slideZero: { macroInsights: [] }, storyboard: [slide, { ...slide, id: 'slide_2' }] }, strategist);
  assert.equal(scripts.length, 3);
  assert.equal(scripts[0].id, 'summary');
  assert.equal(scripts[2].id, 'slide_2');
  assert.ok(scripts.every((s) => typeof s.text === 'string'));
});

test('an empty slide does not produce a broken script', () => {
  assert.equal(slideScript(null, strategist), '');
  assert.equal(summaryScript(null, strategist), '');
  const bare = slideScript({ pageTitle: 'Untitled' }, strategist);
  assert.match(bare, /Untitled|untitled/);
  assert.doesNotMatch(bare, /undefined|null/);
});

// ---------------------------------------------------------------------------
// Voice selection
// ---------------------------------------------------------------------------

const voices = [
  { name: 'Microsoft David - English (United States)', lang: 'en-US' },
  { name: 'Samantha', lang: 'en-US', default: true },
  { name: 'Amelie', lang: 'fr-FR' },
];

test('an avatar gets the system voice matching its profile', () => {
  assert.equal(pickVoice(voices, strategist).name, 'Samantha');
  assert.equal(pickVoice(voices, analyst).name, 'Microsoft David - English (United States)');
});

test('voice selection degrades instead of failing', () => {
  assert.equal(pickVoice([], strategist), null, 'no voices at all is survivable');
  // No name match in the language: fall back to the default voice.
  assert.equal(pickVoice([{ name: 'Zarvox', lang: 'en-US', default: true }], analyst).name, 'Zarvox');
  // No voice in the language at all: still return something.
  assert.ok(pickVoice([{ name: 'Amelie', lang: 'fr-FR' }], analyst));
});

// ---------------------------------------------------------------------------
// Utterance chunking — Chrome silently truncates long utterances
// ---------------------------------------------------------------------------

test('a script is split into utterance-sized chunks on sentence boundaries', async () => {
  const { chunkScript } = await import('../lib/useSpeech.js');
  const script = slideScript({ ...slide, analystNotes: 'A'.repeat(50) }, strategist);
  const chunks = chunkScript(script);

  assert.ok(chunks.length > 1, 'a full slide script exceeds one utterance');
  for (const c of chunks) assert.ok(c.length <= 180, `chunk too long (${c.length}): ${c}`);
  // Nothing may be dropped: the spoken words must equal the script's words.
  assert.deepEqual(chunks.join(' ').split(/\s+/), script.split(/\s+/));
});

test('a sentence longer than the limit is still broken up', async () => {
  const { chunkScript } = await import('../lib/useSpeech.js');
  const monster = `The figure is ${Array.from({ length: 40 }, (_, i) => `item ${i}`).join(', ')}.`;
  const chunks = chunkScript(monster);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 180, `chunk too long: ${c.length}`);
});

test('empty input produces nothing to say', async () => {
  const { chunkScript } = await import('../lib/useSpeech.js');
  assert.deepEqual(chunkScript(''), []);
  assert.deepEqual(chunkScript(null), []);
  assert.deepEqual(chunkScript('   '), []);
});

test('a short script stays a single utterance', async () => {
  const { chunkScript } = await import('../lib/useSpeech.js');
  assert.deepEqual(chunkScript('Revenue grew.'), ['Revenue grew.']);
});
