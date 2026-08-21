import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseServerUrl,
  signInBody,
  parseSignIn,
  parseDataSources,
  fieldsFromMetadata,
  queryBody,
  rowsFromQuery,
  numericFields,
} from '../lib/connectors/tableauApi.js';

// ---------------------------------------------------------------------------
// Server URL
// ---------------------------------------------------------------------------

test('a bare hostname is assumed to be HTTPS', () => {
  assert.deepEqual(parseServerUrl('10ax.online.tableau.com'), {
    origin: 'https://10ax.online.tableau.com',
    host: '10ax.online.tableau.com',
  });
});

test('a path or trailing slash does not become part of the origin', () => {
  assert.equal(parseServerUrl('https://tableau.example.com/#/site/marketing').origin,
    'https://tableau.example.com');
  assert.equal(parseServerUrl('https://tableau.example.com/').origin, 'https://tableau.example.com');
});

test('plain HTTP is refused, because the token would cross the network in the clear', () => {
  assert.throws(() => parseServerUrl('http://tableau.example.com'), /over HTTPS/);
});

test('nonsense is refused rather than half-parsed', () => {
  assert.throws(() => parseServerUrl(''), /required/);
  assert.throws(() => parseServerUrl('   '), /required/);
  assert.throws(() => parseServerUrl('https://'), /not a valid/);
});

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

test('the sign-in body carries the token and the site', () => {
  const body = signInBody({ patName: 'bot', patSecret: 'shh', site: 'marketing' });
  assert.equal(body.credentials.personalAccessTokenName, 'bot');
  assert.equal(body.credentials.personalAccessTokenSecret, 'shh');
  assert.equal(body.credentials.site.contentUrl, 'marketing');
});

test('a blank site means the Default site', () => {
  assert.equal(signInBody({ patName: 'b', patSecret: 's' }).credentials.site.contentUrl, '');
  assert.equal(signInBody({ patName: 'b', patSecret: 's', site: '  ' }).credentials.site.contentUrl, '');
});

test('a missing token is reported before a request is made', () => {
  assert.throws(() => signInBody({ patName: 'bot' }), /name and secret/);
  assert.throws(() => signInBody({ patSecret: 'shh' }), /name and secret/);
});

test('a session is read out of the sign-in response', () => {
  const { token, siteId } = parseSignIn({
    credentials: { token: 'abc', site: { id: 'site-1' } },
  });
  assert.equal(token, 'abc');
  assert.equal(siteId, 'site-1');
});

test('a response without a session fails with something actionable', () => {
  // A 200 with no token is what a wrong site content URL produces.
  assert.throws(() => parseSignIn({ credentials: {} }), /Check the token and site/);
  assert.throws(() => parseSignIn({}), /Check the token and site/);
});

// ---------------------------------------------------------------------------
// Data sources
// ---------------------------------------------------------------------------

test('published data sources become table descriptors carrying their LUID', () => {
  const sources = parseDataSources({
    datasources: {
      datasource: [
        { id: 'luid-1', name: 'Sales', project: { name: 'Finance' } },
        { id: 'luid-2', name: 'Headcount' },
      ],
    },
  });

  assert.equal(sources.length, 2);
  // Tableau addresses a data source by LUID, not by schema and table, so the
  // opaque ref has to survive the round trip through the UI.
  assert.equal(sources[0].ref, 'luid-1');
  assert.equal(sources[0].qualified, 'Finance.Sales');
  assert.equal(sources[1].schema, 'Published', 'a data source with no project still lists');
});

test('a single data source is not mistaken for a list of characters', () => {
  // Tableau's XML-derived JSON collapses a one-element list into an object.
  const sources = parseDataSources({ datasources: { datasource: { id: 'x', name: 'Only' } } });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].ref, 'x');
});

test('no data sources is an empty list, not a crash', () => {
  assert.deepEqual(parseDataSources({}), []);
  assert.deepEqual(parseDataSources({ datasources: {} }), []);
});

// ---------------------------------------------------------------------------
// Querying
// ---------------------------------------------------------------------------

test('metadata becomes a field list', () => {
  const fields = fieldsFromMetadata({
    data: [
      { fieldName: 'Region', fieldCaption: 'Region', dataType: 'STRING' },
      { fieldName: 'sum_sales', fieldCaption: 'Sales', dataType: 'REAL' },
      { fieldCaption: '', dataType: 'STRING' },
    ],
  });
  assert.equal(fields.length, 2, 'a field with no caption cannot be queried');
  assert.equal(fields[1].caption, 'Sales');
});

test('a query names every field, because VDS has no SELECT *', () => {
  const body = queryBody('luid-1', [{ caption: 'Region' }, { caption: 'Sales' }]);
  assert.equal(body.datasource.datasourceLuid, 'luid-1');
  assert.deepEqual(body.query.fields, [{ fieldCaption: 'Region' }, { fieldCaption: 'Sales' }]);
});

test('querying without a data source or fields fails before the request', () => {
  assert.throws(() => queryBody(null, [{ caption: 'a' }]), /data source is required/);
  assert.throws(() => queryBody('luid', []), /no fields to query/);
});

test('column order comes from the requested fields, not from key order', () => {
  const fields = [{ caption: 'Region' }, { caption: 'Sales' }];
  const { rows, columns } = rowsFromQuery({ data: [{ Sales: 10, Region: 'West' }] }, fields);
  assert.deepEqual(columns, ['Region', 'Sales']);
  assert.equal(rows[0].Region, 'West');
});

test('an empty result is an empty list of rows', () => {
  assert.deepEqual(rowsFromQuery({}, [{ caption: 'a' }]).rows, []);
});

test('measures are recognised so they profile as measures, not categories', () => {
  const numeric = numericFields([
    { caption: 'Region', dataType: 'STRING' },
    { caption: 'Sales', dataType: 'REAL' },
    { caption: 'Units', dataType: 'INTEGER' },
    { caption: 'Day', dataType: 'DATE' },
  ]);
  assert.ok(numeric.has('Sales') && numeric.has('Units'));
  assert.ok(!numeric.has('Region'));
  assert.ok(!numeric.has('Day'), 'a date is not a measure');
});
