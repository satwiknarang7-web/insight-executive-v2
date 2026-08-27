import test from 'node:test';
import assert from 'node:assert/strict';
import { namesColumn, questionRelevance } from '../lib/askIntent.js';

const columns = ['track', 'artist', 'is_collaboration', 'billed_artist_count', 'daily_streams', 'rank'];
const ask = (q) => questionRelevance(q, { columns });

test('the reported case is turned away, not answered with a chart', () => {
  // "hello how are you" returned a bar chart of billed artist count labelled
  // "closest available chart", with a confident sentence under it.
  const result = ask('hello how are you');
  assert.equal(result.answerable, false);
  assert.match(result.reason, /not a question about this dataset/i);
  assert.match(result.reason, /which category has the highest total/i, 'it says what to do instead');
});

test('other small talk is turned away too', () => {
  for (const q of ['hi', 'hey there', 'good morning', 'thanks!', 'ok', 'test', 'sup', "what's up"]) {
    assert.equal(ask(q).answerable, false, q);
  }
});

test('questions about the tool are turned away', () => {
  for (const q of ['who are you', 'what can you do', 'are you an AI', 'tell me a joke', 'write me a poem']) {
    assert.equal(ask(q).answerable, false, q);
  }
});

test('a real question is answered', () => {
  for (const q of [
    'which artist has the most daily streams?',
    'total billed artist count by is_collaboration',
    'how many collaborations are there',
    'show me the trend over time',
    'what is the average rank',
    'compare streams between collaborations and solo tracks',
    'top 10 tracks',
  ]) {
    assert.equal(ask(q).answerable, true, q);
  }
});

test('a greeting attached to a real question does not disqualify it', () => {
  // Small talk is only small talk when it is the whole message.
  assert.equal(ask('hi, which artist has the most streams?').answerable, true);
  assert.equal(ask('hello — total daily streams by artist please').answerable, true);
});

test('a question naming a column is answerable however it is phrased', () => {
  // No analytic vocabulary at all, but it is plainly about the data.
  assert.equal(ask('daily streams').answerable, true);
  assert.equal(ask('billed artist count').answerable, true);
  assert.equal(ask('tell me about is_collaboration').answerable, true);
});

test('an off-topic question with no column is turned away with a useful reason', () => {
  const result = ask('what is the capital of France');
  assert.equal(result.answerable, false);
  assert.match(result.reason, /matches a column/i);
  assert.match(result.reason, /Explore/, 'it points at where the column names are');
});

test('an empty question asks for one', () => {
  assert.equal(ask('').answerable, false);
  assert.equal(ask('   ').answerable, false);
  assert.match(ask('').reason, /Type a question/);
});

test('column matching tolerates the way people write column names', () => {
  assert.equal(namesColumn('how many billed artists', columns), true, 'underscores and plurals');
  assert.equal(namesColumn('daily streams by artist', columns), true);
  assert.equal(namesColumn('is collaboration', columns), true);
  assert.equal(namesColumn('what about the weather', columns), false);
});

test('a common word shared with a column name is not a match on its own', () => {
  // Every dataset has a `name` or a `date`; matching on those would make any
  // sentence look like a question about the data.
  assert.equal(namesColumn('what is your name', ['name', 'revenue']), false);
  assert.equal(namesColumn('what is the date today', ['date', 'revenue']), false);
});
