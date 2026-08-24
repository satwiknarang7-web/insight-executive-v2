import test from 'node:test';
import assert from 'node:assert/strict';
import { renameCategories, editableCategories } from '../lib/chartLabels.js';
import { updateSlide, reapplyEdits } from '../lib/storyboardEdits.js';

const rows = () => [
  { contract: 'Month-to-month', Total: 26000 },
  { contract: 'Two year', Total: 25000 },
  { contract: 'One year', Total: 24000 },
];

test('a renamed category is shown under its new name', () => {
  const out = renameCategories(rows(), 'contract', { 'Month-to-month': 'Monthly' });
  assert.equal(out[0].contract, 'Monthly');
  assert.equal(out[0].Total, 26000, 'the number is untouched');
  assert.equal(out[1].contract, 'Two year', 'names with no rename are left alone');
});

test('the original rows are never rewritten', () => {
  const original = rows();
  renameCategories(original, 'contract', { 'Month-to-month': 'Monthly' });
  assert.equal(original[0].contract, 'Month-to-month');
});

test('renaming nothing returns the very same array', () => {
  const original = rows();
  assert.equal(renameCategories(original, 'contract', null), original);
  assert.equal(renameCategories(original, 'contract', {}), original);
  // A blank name is a cleared field, not a request to erase the label.
  assert.equal(renameCategories(original, 'contract', { 'Two year': '  ' }), original);
  assert.equal(renameCategories(original, 'contract', { Nonexistent: 'x' }), original);
});

test('only real category names are offered for renaming', () => {
  assert.deepEqual(editableCategories(rows(), 'contract'), ['Month-to-month', 'Two year', 'One year']);
  // Bucket bounds and other numeric labels are not names.
  const numeric = [{ bucket: '76', n: 4 }, { bucket: '3719', n: 9 }];
  assert.deepEqual(editableCategories(numeric, 'bucket'), []);
  assert.deepEqual(editableCategories(rows(), 'missingKey'), []);
  assert.deepEqual(editableCategories(null, 'contract'), []);
});

test('a long series does not become a wall of text fields', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ name: `Item ${i}`, v: i }));
  assert.equal(editableCategories(many, 'name').length, 12);
});

test('duplicated categories are offered once', () => {
  const dupes = [{ c: 'West', v: 1 }, { c: 'West', v: 2 }, { c: 'East', v: 3 }];
  assert.deepEqual(editableCategories(dupes, 'c'), ['West', 'East']);
});

test('per-bar colouring is stored as an edit and survives a re-run', () => {
  const board = [{ id: 's1', pageTitle: 'Tenure', chart: { chart_type: 'bar', title: 'Tenure' } }];
  const edited = updateSlide(board, 's1', {
    chart: { colorBy: 'category', colors: ['#10b981', '#84cc16', '#14b8a6'] },
  });

  assert.equal(edited[0].chart.colorBy, 'category');
  assert.ok(edited[0].edits.includes('chart.colorBy'));

  const fresh = [{ id: 's1', pageTitle: 'Tenure', chart: { chart_type: 'bar', title: 'Tenure' } }];
  const merged = reapplyEdits(fresh, edited);
  assert.equal(merged[0].chart.colorBy, 'category');
  assert.deepEqual(merged[0].chart.colors, ['#10b981', '#84cc16', '#14b8a6']);
});

test('a rename is stored as an edit and survives a re-run', () => {
  const board = [{ id: 's1', pageTitle: 'Contracts', chart: { chart_type: 'bar', title: 'Contracts' } }];
  const edited = updateSlide(board, 's1', { chart: { labels: { 'Month-to-month': 'Monthly' } } });

  assert.deepEqual(edited[0].chart.labels, { 'Month-to-month': 'Monthly' });
  assert.ok(edited[0].edits.includes('chart.labels'), 'the rename is recorded as an edit');

  // A re-run rebuilds the slide from the data; the rename comes back with it.
  const fresh = [{ id: 's1', pageTitle: 'Contracts', chart: { chart_type: 'bar', title: 'Contracts' } }];
  const merged = reapplyEdits(fresh, edited);
  assert.deepEqual(merged[0].chart.labels, { 'Month-to-month': 'Monthly' });
});
