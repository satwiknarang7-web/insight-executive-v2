import test from 'node:test';
import assert from 'node:assert/strict';
import { dimensionRole, allowsPortfolioFraming, shareConsequence } from '../lib/dimensionRoles.js';
import { analyzeStoryboard } from '../lib/insightEngine.js';

test('people, cycles and segments are told apart', () => {
  for (const name of ['Sex', 'gender', 'Age_Band', 'Marital Status', 'ethnicity', 'Age']) {
    assert.equal(dimensionRole(name), 'demographic', name);
  }
  for (const name of ['Season', 'Quarter', 'Month', 'Weekday', 'day_of_week']) {
    assert.equal(dimensionRole(name), 'cyclical', name);
  }
  for (const name of ['Product Category', 'Channel', 'Sport', 'store', 'Passenger_Class']) {
    assert.equal(dimensionRole(name), 'segment', name);
  }
});

test('geography stays a segment, because that concentration is real', () => {
  // "84% of revenue comes from one region" is a genuine exposure with a genuine
  // decision attached, and must keep the warning the others lose.
  for (const name of ['Region', 'Country', 'State', 'City']) {
    assert.ok(allowsPortfolioFraming(name), name);
  }
});

test('a word merely containing those letters is not a demographic', () => {
  // The boundaries are what make this safe to apply by name.
  for (const name of ['average_order', 'package_type', 'usage_tier', 'Coverage', 'Message']) {
    assert.equal(dimensionRole(name), 'segment', name);
  }
});

test('an unknown dimension keeps the existing framing', () => {
  // A false negative costs nothing that is not already the status quo.
  assert.equal(dimensionRole('Widget Family'), 'segment');
  assert.equal(dimensionRole(''), 'segment');
  assert.equal(dimensionRole(null), 'segment');
});

test('only a segment keeps the caller\'s own sentence', () => {
  assert.equal(shareConsequence('Region', 'EMEA', 'the total'), null);
  assert.match(shareConsequence('Sex', 'M', 'the total'), /not a position to rebalance/);
  assert.match(shareConsequence('Season', 'Summer', 'the total'), /shape of the season/);
});

const shareChart = (dim, a, b) => ({
  id: 'slide_1',
  title: `Record Count Share by ${dim}`,
  chart_type: 'donut',
  xAxisKey: dim,
  yAxisKey: 'Record Count',
  resultData: [
    { [dim]: a, 'Record Count': 135100 },
    { [dim]: b, 'Record Count': 67500 },
  ],
});

const summarise = (dim, a, b) =>
  analyzeStoryboard([shareChart(dim, a, b)], new Array(202616).fill({}));

test('a demographic split is not filed as a risk to hedge', () => {
  // The reported case: "Concentration risk: M carries an outsized share (66.7%)"
  // put a fact about who the dataset covers under a heading asking the reader
  // to act on it.
  const { synthesis } = summarise('Sex', 'M', 'F');
  const all = [synthesis.strategicScorecard.risk, ...(synthesis.macroInsights || [])].join(' ');
  assert.doesNotMatch(all, /Concentration risk/i);
  assert.doesNotMatch(all, /independent bets|diversification/i);
  assert.doesNotMatch(all, /bad quarter/i);
});

test('a cycle is not a portfolio either', () => {
  const { synthesis } = summarise('Season', 'Summer', 'Winter');
  const all = [synthesis.strategicScorecard.risk, ...(synthesis.macroInsights || [])].join(' ');
  assert.doesNotMatch(all, /Concentration risk/i);
  assert.doesNotMatch(all, /bad quarter/i);
});

test('a real segment concentration still gets the full warning', () => {
  // The guard has to keep the sentence where it belongs, or it has traded one
  // wrong summary for a silent one.
  const { synthesis } = summarise('Region', 'EMEA', 'APAC');
  const all = [synthesis.strategicScorecard.risk, ...(synthesis.macroInsights || [])].join(' ');
  assert.match(all, /Concentration risk/i);
  assert.match(all, /EMEA/);
});

test('no number is withheld, whatever the dimension', () => {
  // This governs the verb, not the arithmetic: every share is still reported.
  for (const [dim, a, b] of [['Sex', 'M', 'F'], ['Season', 'Summer', 'Winter'], ['Region', 'EMEA', 'APAC']]) {
    const { perChart, synthesis } = summarise(dim, a, b);
    const all = [
      perChart[0].narrative || perChart[0].headline || '',
      ...(synthesis.macroInsights || []),
    ].join(' ');
    assert.match(all, /66\.7%/, `${dim} should still state the share`);
    assert.match(all, new RegExp(a), `${dim} should still name the leader`);
  }
});

test('a demographic still says the trend is about that group', () => {
  const consequence = shareConsequence('Sex', 'M', 'the total');
  assert.match(consequence, /describe M more than/);
  assert.match(consequence, /meant to analyse/);
});
