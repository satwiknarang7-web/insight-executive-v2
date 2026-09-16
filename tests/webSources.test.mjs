/**
 * The link a person pastes, and the link that serves the data.
 *
 * A Google Sheet's editing page, a GitHub file's page, a Dropbox preview: none
 * of them return bytes. The rewrite is pure and is pinned here so that a
 * source that used to work keeps working when a host changes its URL shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { WEB_SOURCES, authHeaders, fileNameFor, nameFromPath, normalizeSourceUrl, webSource } from '../lib/webSources.js';

test('a Google Sheet link becomes its CSV export, keeping the tab', () => {
  const out = normalizeSourceUrl('https://docs.google.com/spreadsheets/d/1AbC_dEf/edit#gid=1234');
  assert.equal(out.url, 'https://docs.google.com/spreadsheets/d/1AbC_dEf/export?format=csv&gid=1234');
  assert.equal(out.name, 'google-sheet.csv');
  const first = normalizeSourceUrl('https://docs.google.com/spreadsheets/d/1AbC_dEf/edit?usp=sharing');
  assert.equal(first.url, 'https://docs.google.com/spreadsheets/d/1AbC_dEf/export?format=csv');
  const published = normalizeSourceUrl('https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml');
  assert.equal(published.url, 'https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?output=csv');
});

test('a GitHub file page becomes the raw file, and a gist its raw form', () => {
  const out = normalizeSourceUrl('https://github.com/org/repo/blob/main/data/orders.csv');
  assert.equal(out.url, 'https://raw.githubusercontent.com/org/repo/main/data/orders.csv');
  assert.equal(out.name, 'orders.csv');
  assert.equal(normalizeSourceUrl('https://gist.github.com/u/abc123').url, 'https://gist.github.com/u/abc123/raw');
});

test('Dropbox and OneDrive share links are asked for the file, not the preview', () => {
  assert.match(normalizeSourceUrl('https://www.dropbox.com/s/abc/orders.xlsx?dl=0').url, /dl=1/);
  assert.match(normalizeSourceUrl('https://onedrive.live.com/view.aspx?resid=1').url, /download=1/);
});

test('an OData feed is asked for JSON; other kinds get a name the parsers recognise', () => {
  const odata = normalizeSourceUrl('https://services.odata.org/V4/Northwind/Northwind.svc/Orders', { kind: 'odata' });
  assert.match(odata.url, /%24format=json|\$format=json/);
  assert.equal(odata.name, 'Orders.json');
  assert.equal(normalizeSourceUrl('https://api.example.com/v1/things', { kind: 'restapi' }).name, 'things.json');
  assert.equal(normalizeSourceUrl('https://en.wikipedia.org/wiki/List', { kind: 'webpage' }).name, 'List.html');
});

test('a bare host gets https, and anything that is not http is refused', () => {
  assert.equal(normalizeSourceUrl('example.com/data.csv').url, 'https://example.com/data.csv');
  assert.throws(() => normalizeSourceUrl('ftp://example.com/x.csv'), /Only http/);
  assert.throws(() => normalizeSourceUrl('file:///etc/passwd'), /Only http/);
  assert.throws(() => normalizeSourceUrl(''), /Paste a link/);
});

test('file names come from the path, then from the content type', () => {
  assert.equal(nameFromPath('/a/b/orders%20q1.csv'), 'orders q1.csv');
  assert.equal(fileNameFor('orders.csv', 'text/plain'), 'orders.csv');
  assert.equal(fileNameFor('download', 'application/json; charset=utf-8'), 'download.json');
  assert.equal(fileNameFor('report', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'report.xlsx');
  assert.equal(fileNameFor('feed', 'application/atom+xml'), 'feed.xml');
  assert.equal(fileNameFor('x', 'text/csv'), 'x.csv');
});

test('auth headers are built from what was typed', () => {
  assert.deepEqual(authHeaders({ scheme: 'bearer', token: 'abc' }), { authorization: 'Bearer abc' });
  assert.deepEqual(authHeaders({ scheme: 'basic', token: 'user:pw' }), { authorization: `Basic ${Buffer.from('user:pw').toString('base64')}` });
  assert.deepEqual(authHeaders({ scheme: 'header', token: 'k', headerName: 'X-Api-Key' }), { 'X-Api-Key': 'k' });
  assert.deepEqual(authHeaders({ scheme: 'bearer', token: '' }), {});
  assert.deepEqual(authHeaders({ scheme: 'none', token: 'x' }), {});
});

test('the catalog of web sources is consistent', () => {
  const ids = WEB_SOURCES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of WEB_SOURCES) assert.ok(s.label && s.blurb && s.placeholder, `${s.id} is incomplete`);
  assert.equal(webSource('googlesheets').auth, 'none');
  assert.equal(webSource('nope'), null);
});
