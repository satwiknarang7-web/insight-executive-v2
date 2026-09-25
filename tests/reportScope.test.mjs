import test from 'node:test';
import assert from 'node:assert/strict';
import { describeFilters, filteredReportBoard } from '../lib/engine/reportScope.js';

const fields = [{ name: 'contract', label: 'Contract type' }, { name: 'd', label: 'Order date' }];

test('filters are described in the words the dashboard uses', () => {
  assert.equal(describeFilters([{ field: 'contract', values: ['Month-to-month'] }, { field: 'd', from: '2024-01-01', to: '2024-06-30' }], fields), 'Contract type: Month-to-month; Order date: 2024-01-01 to 2024-06-30');
  assert.equal(describeFilters([], fields), '');
});

test('a filtered report drops the all-rows headline and uses the filtered captions', () => {
  const board = { headline: 'Overall churn is 24%', aiSummary: ['24% churn'], findings: [{ text: 'overall 24%' }], sections: [{ tiles: [{ insight: 'Filtered: 52%' }, { insight: 'Filtered: 52%' }, { insight: null }, { dim: 'contract', insight: 'Only one contract type has data.' }] }] };
  const out = filteredReportBoard(board, [{ field: 'contract', values: ['Month-to-month'] }], fields);
  assert.equal(out.headline, null);
  assert.equal(out.aiSummary, null);
  assert.deepEqual(out.findings.map((f) => f.text), ['Filtered: 52%']);
  assert.match(out.filterNote, /Month-to-month/);
  assert.equal(filteredReportBoard(board, [], fields), board);
});

test('a firm finding leads a hedged one', () => {
  const board = { sections: [{ tiles: [{ id: 'a', insight: 'X ranges from 41% to 56%, but the groups are too small to be sure the gap is real.' }, { id: 'b', insight: 'Y is highest at 60%.' }] }] };
  const out = filteredReportBoard(board, [{ field: 'c', values: ['v'] }], []);
  assert.equal(out.findings[0].tileId, 'b');
});
