import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeStoryboard } from '../lib/insightEngine.js';
import { buildStoryboard } from '../lib/storyboard.js';

const RAW = fs.readFileSync(path.join(process.cwd(), 'app/report/print/page.js'), 'utf8');

/**
 * The page with its comments removed.
 *
 * The comments explain what these fields used to claim and why they went, so
 * they quote the inventions verbatim — and a test searching the raw file then
 * fails on its own documentation. What matters is what the page RENDERS, so the
 * prose is stripped before looking. Block comments cover both JSDoc and the
 * `{/* ... *\/}` form JSX uses.
 */
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * The audit page is the one a sceptical reader turns to, so it is the one page
 * that has to be true. These pin the claims it used to make.
 */
test('the printed report asserts nothing nobody computed', () => {
  for (const invention of [
    'NL2QUERY_PRO_V2',
    'ENTROPY_SCORE',
    'LATENCY_EXEC',
    'CLOUD_REPLICATED_DB',
    'Multi-Model Cross-Validation',
  ]) {
    assert.doesNotMatch(SOURCE, new RegExp(invention), `${invention} is not computed anywhere`);
  }
});

test('the report does not invoke a contract that does not exist', () => {
  assert.doesNotMatch(SOURCE, /master service agreement/i);
});

test('no single sentence is printed beside every finding', () => {
  // "Immediate reallocation of resources toward high-impact categories is
  // recommended to optimize ROI" appeared on all six insight pages of a real
  // export, unchanged, next to charts it was not derived from.
  assert.doesNotMatch(SOURCE, /reallocation of resources/i);
  assert.doesNotMatch(SOURCE, /optimize ROI/i);
  // Two of the three badges said nothing measurable.
  assert.doesNotMatch(SOURCE, /Top 10 Precision/);
  assert.doesNotMatch(SOURCE, /Aggregated Logic/);
});

test('the audit block reads the storyboard, not a flat finding', () => {
  // Guards the specific slip: slide.sql and slide.metrics are both undefined on
  // a real slide, so a page reading them reports 0 queries and no evidence.
  assert.doesNotMatch(SOURCE, /slide\?\.sql/);
  assert.doesNotMatch(SOURCE, /slide\.metrics\?\./);
  assert.match(SOURCE, /slide\?\.chart\?\.sql/);
  assert.match(SOURCE, /slide\?\.findings\?\.metrics\?\.evidence/);
});
