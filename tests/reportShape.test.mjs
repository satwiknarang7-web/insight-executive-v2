import test from 'node:test';
import assert from 'node:assert/strict';
import { findingsOnly, narrationRequestFor } from '../lib/storyboard.js';

/* What a report is allowed to be about.

   Every case here is a defect taken from one shipped report — a comparison of
   AI subscription plans, 44 rows and 51 columns — which opened with two pages
   reading "Analysis unavailable", made the same claim three times, and headed a
   page with a chart name its own first sentence disagreed with. The dataset was
   not unusual; the report was wrong about what a dataset is for. */

const slide = (id, pageTitle, extra = {}) => ({
  id,
  pageTitle,
  chart: { chart_type: 'bar', xAxisKey: 'k', yAxisKey: 'v', resultData: [{ k: 'a', v: 1 }] },
  findings: {},
  ...extra,
});

const slicer = (id, pageTitle) => ({
  id,
  pageTitle,
  chart: { chart_type: 'slicer', xAxisKey: 'k', resultData: [{ k: 'a' }] },
  findings: {},
});

test('a filter tile is not a finding, wherever the report is built', () => {
  const board = [
    slicer('filter_1', 'Audience'),
    slicer('filter_2', 'Flagship Model'),
    slide('slide_1', 'Average Monthly Price by Provider'),
    slide('slide_2', 'Intelligence per 100 USD by Plan'),
  ];

  // The shipped report opened with "Strategic Insight 1: Audience" and
  // "Strategic Insight 2: Flagship Model", each a page of checkboxes above the
  // words "Analysis unavailable — this query returned no rows". A slicer runs
  // no aggregate, so it has no rows to return; it was never a finding.
  const findings = findingsOnly(board);
  assert.equal(findings.length, 2);
  assert.deepEqual(
    findings.map((f) => f.id),
    ['slide_1', 'slide_2']
  );
});

test('the narrator is briefed on the deck the reader will see', () => {
  const result = {
    narrationRequest: {
      focus: null,
      synthesis: {},
      findings: [
        // The planner's own names, before the analyst rewrote them.
        { id: 'slide_1', title: 'Average Monthly Price USD by Provider', finding: 'x' },
        { id: 'slide_2', title: 'Average Min Seats by Audience', finding: 'y' },
        { id: 'slide_3', title: 'Dropped by the sceptic', finding: 'z' },
      ],
    },
  };

  // What survived finalisation: one retitled, one untouched, one gone, plus a
  // slicer that was never a finding.
  const finished = [
    slicer('filter_1', 'Audience'),
    slide('slide_2', 'Average Min Seats by Audience'),
    slide('slide_1', 'Average Monthly Price by Provider'),
  ];

  const brief = narrationRequestFor(result, finished);

  // The heading the analyst wrote is the heading the narrator is given. The
  // shipped report had a page headed "Average Monthly Price by Provider" whose
  // first sentence called the same chart "Average Monthly Price USD by
  // Provider", because the sentence was commissioned before the rewrite.
  const byId = new Map(brief.findings.map((f) => [f.id, f.title]));
  assert.equal(byId.get('slide_1'), 'Average Monthly Price by Provider');

  // A slide the sceptic removed is not narrated at all.
  assert.ok(!byId.has('slide_3'), 'a dropped slide was still narrated');

  // A filter tile is not narrated either, and the order is the reader's.
  assert.deepEqual(
    brief.findings.map((f) => f.id),
    ['slide_2', 'slide_1']
  );
});

test('nothing left to narrate is not a reason to narrate the old draft', () => {
  const result = { narrationRequest: { findings: [{ id: 'a', title: 'A' }] } };
  assert.equal(narrationRequestFor(result, [slicer('filter_1', 'F')]), null);
  assert.equal(narrationRequestFor(result, []), null);
  assert.equal(narrationRequestFor({}, [slide('a', 'A')]), null);
});

test('a finding with no heading keeps the one it was briefed with', () => {
  const result = { narrationRequest: { findings: [{ id: 'a', title: 'Planned name' }] } };
  const brief = narrationRequestFor(result, [slide('a', '   ')]);
  assert.equal(brief.findings[0].title, 'Planned name');
});
