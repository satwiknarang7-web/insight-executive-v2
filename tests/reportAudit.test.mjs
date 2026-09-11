import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planCharts } from '../lib/analystPlanner.js';
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

/**
 * The audit block reads fields off the storyboard, and a storyboard slide is
 * `{ findings: { metrics }, chart }` rather than a flat finding. Reading the
 * wrong path returns undefined for every slide and the page reports nothing —
 * silently, with no error and no empty state. So the shape is pinned here
 * against a storyboard the real pipeline built.
 */
test('every field the audit page reads exists on a real storyboard', () => {
  const rows = [];
  for (let i = 0; i < 400; i++) {
    rows.push({
      Sport: ['Rowing', 'Judo', 'Archery'][i % 3],
      Athlete: `a${i}`,
      Weight: 55 + (i % 30),
      Medal_Binary: i % 3 === 0 ? 1 : 0,
    });
  }

  const charts = planCharts(rows, { max: 6 }).map((c) => ({ ...c, resultData: [{ x: 'A', y: 1 }] }));
  const { perChart, synthesis } = analyzeStoryboard(charts, rows);
  const { slideZero, storyboard } = buildStoryboard({ charts, perChart, synthesis, narrative: null });

  assert.ok(storyboard.length > 0, 'the fixture produces a deck');
  assert.equal(typeof slideZero.rowsAnalyzed, 'number');
  assert.equal(slideZero.rowsAnalyzed, 400);

  // The two paths the audit block walks.
  const withSql = storyboard.filter((slide) => slide?.chart?.sql).length;
  assert.equal(withSql, storyboard.length, 'every slide carries the query behind it');

  const tiers = storyboard
    .map((slide) => slide?.findings?.metrics?.evidence)
    .filter(Boolean);
  assert.ok(tiers.length > 0, 'evidence tiers are reachable at findings.metrics.evidence');
  for (const tier of tiers) {
    assert.ok(['strong', 'moderate', 'indicative', 'thin'].includes(tier), `unexpected tier ${tier}`);
  }
});

test('the audit block reads the storyboard, not a flat finding', () => {
  // Guards the specific slip: slide.sql and slide.metrics are both undefined on
  // a real slide, so a page reading them reports 0 queries and no evidence.
  assert.doesNotMatch(SOURCE, /slide\?\.sql/);
  assert.doesNotMatch(SOURCE, /slide\.metrics\?\./);
  assert.match(SOURCE, /slide\?\.chart\?\.sql/);
  assert.match(SOURCE, /slide\?\.findings\?\.metrics\?\.evidence/);
});
