/**
 * Every shape a file can hold a table in, read into rows.
 *
 * JSON in its envelopes, one-object-per-line, XML with a repeated child, and
 * the tables on a web page. Each becomes the same `{ name, columns, rows }` a
 * workbook sheet becomes, and the rest of the pipeline never learns which.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  columnsOf,
  decodeEntities,
  formatOf,
  parseHtmlTables,
  parseJson,
  parseNdjson,
  parseStructuredText,
  parseXml,
  tablesInJson,
} from '../lib/ingest/formats.js';

test('a JSON array of objects is one table, nested objects flattened', () => {
  const [table] = parseJson('[{"id":1,"customer":{"name":"Ann","city":"Austin"},"tags":["a","b"]},{"id":2,"customer":{"name":"Bo"}}]');
  assert.deepEqual(table.columns, ['id', 'customer.name', 'customer.city', 'tags']);
  assert.equal(table.rows[0]['customer.city'], 'Austin');
  assert.equal(table.rows[0].tags, '["a","b"]', 'an array is one cell of text');
  assert.equal(table.rows[1]['customer.city'], undefined);
});

test('an API envelope is read from its largest array of records', () => {
  const tables = tablesInJson({ status: 'ok', meta: { page: 1 }, data: { items: [{ a: 1 }, { a: 2 }, { a: 3 }] }, errors: [] });
  assert.equal(tables.length, 1);
  assert.equal(tables[0].name, 'data_items');
  assert.equal(tables[0].rows.length, 3);
});

test('an OData reply reads from value, and two arrays come back largest first', () => {
  const tables = tablesInJson({ value: [{ x: 1 }, { x: 2 }], links: [{ rel: 'self' }] });
  assert.deepEqual(tables.map((t) => t.name), ['value', 'links']);
});

test('a single object is a one-row table, and scalars in an array are one column', () => {
  assert.equal(parseJson('{"name":"Ann","age":3}')[0].rows.length, 1);
  assert.deepEqual(parseJson('[1,2,3]')[0].columns, ['value']);
});

test('an array of arrays is a grid, with a header row when it looks like one', () => {
  const [t] = parseJson('[["region","sales"],["N",1],["S",2]]');
  assert.deepEqual(t.columns, ['region', 'sales']);
  assert.equal(t.rows[1].sales, 2);
  const [g] = parseJson('[[1,2],[3,4]]');
  assert.deepEqual(g.columns, ['column_1', 'column_2']);
});

test('NDJSON is one object per line, and a file of it is caught by parseJson', () => {
  const text = '{"a":1}\n\n{"a":2},\nnot json\n{"a":3}';
  assert.equal(parseNdjson(text)[0].rows.length, 3);
  assert.equal(parseJson(text)[0].rows.length, 3, 'JSON.parse fails, so the line reader takes over');
  assert.deepEqual(parseJson(''), []);
});

test('XML with a repeated child is a table of those children', () => {
  const xml = `<?xml version="1.0"?><!-- export -->
  <orders generated="today">
    <order id="1"><region>North</region><amount currency="USD">12.5</amount><note><![CDATA[a & b]]></note></order>
    <order id="2"><region>South</region><amount currency="EUR">7</amount><note/></order>
  </orders>`;
  const [t] = parseXml(xml);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0].id, '1', 'attributes are columns');
  assert.equal(t.rows[0].region, 'North');
  assert.equal(t.rows[0].amount, '12.5');
  assert.equal(t.rows[0]['amount.currency'], 'USD', 'an attribute on a leaf is a column beside it');
  assert.equal(t.rows[0].note, 'a & b', 'CDATA is text');
  assert.ok(t.columns.includes('note'));
});

test('an RSS feed reads as a table of items', () => {
  const rss = '<rss><channel><title>Feed</title><item><title>A</title><link>x</link></item><item><title>B</title><link>y</link></item></channel></rss>';
  const [t] = parseXml(rss);
  assert.deepEqual(t.rows.map((r) => r.title), ['A', 'B']);
});

test('HTML tables read their header from th cells, and every table on the page is found', () => {
  const html = `<html><body><script>var x = "<table>";</script>
    <table><caption>Population</caption>
      <thead><tr><th>Country</th><th>People &amp; pets</th></tr></thead>
      <tbody><tr><td><a href="#">France</a></td><td>68,000,000</td></tr><tr><td>Spain</td><td>48,000,000</td></tr></tbody>
    </table>
    <table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>
  </body></html>`;
  const tables = parseHtmlTables(html, 'page');
  assert.equal(tables.length, 2);
  assert.equal(tables[0].name, 'Population');
  assert.deepEqual(tables[0].columns, ['Country', 'People & pets']);
  assert.equal(tables[0].rows[0].Country, 'France', 'tags inside a cell are stripped');
  assert.equal(tables[0].rows[1]['People & pets'], '48,000,000');
  assert.deepEqual(tables[1].columns, ['a', 'b'], 'with no th, the first row is the header');
  assert.equal(tables[1].name, 'page_2');
});

test('a colspan header is widened and duplicate headers are made unique', () => {
  const html = '<table><tr><th colspan="2">Q1</th><th>Q1</th></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>';
  const [t] = parseHtmlTables(html);
  assert.deepEqual(t.columns, ['Q1 1', 'Q1 2', 'Q1']);
  assert.equal(t.rows[0]['Q1 2'], '2');
});

test('a table with only a header is not a table', () => {
  assert.deepEqual(parseHtmlTables('<table><tr><th>a</th></tr></table>'), []);
});

test('entities decode, including numeric ones', () => {
  assert.equal(decodeEntities('a &amp; b &#39;c&#39; &#x41;'), "a & b 'c' A");
});

test('the format is read off the name first and the content type second', () => {
  assert.equal(formatOf('orders.json'), 'json');
  assert.equal(formatOf('orders.jsonl'), 'ndjson');
  assert.equal(formatOf('feed.xml'), 'xml');
  assert.equal(formatOf('page.html'), 'html');
  assert.equal(formatOf('part.parquet'), 'parquet');
  assert.equal(formatOf('app.sqlite'), 'sqlite');
  assert.equal(formatOf('app.db'), 'sqlite');
  assert.equal(formatOf('book.xlsx'), 'workbook');
  assert.equal(formatOf('scan.pdf'), 'document');
  assert.equal(formatOf('data', 'application/json; charset=utf-8'), 'json');
  assert.equal(formatOf('data.csv'), 'delimited');
  assert.equal(formatOf('data.txt'), 'delimited');
});

test('dispatch by format', () => {
  assert.equal(parseStructuredText('json', '[{"a":1}]').length, 1);
  assert.equal(parseStructuredText('html', '<table><tr><th>a</th></tr><tr><td>1</td></tr></table>').length, 1);
  assert.deepEqual(parseStructuredText('delimited', 'a,b'), []);
  assert.deepEqual(columnsOf([{ b: 1 }, { a: 2, b: 3 }]), ['b', 'a']);
});
