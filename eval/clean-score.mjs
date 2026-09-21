import fs from 'node:fs';
import path from 'node:path';
import { ingest } from './chain.mjs';

const DIR = path.join(import.meta.dirname, 'data');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const distinct = (rows, col) => [...new Set(rows.map((r) => r[col]))];
const typesOf = (rows, col) => [...new Set(rows.map((r) => (r[col] === null ? 'null' : typeof r[col])))].sort();

let pass = 0;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`    PASS  ${label}`); }
  else { fail++; console.log(`    FAIL  ${label}${detail ? `  →  ${detail}` : ''}`); }
};

const cache = {};
const load = (f) => (cache[f] ||= ingest(read(f)));

const banner = (f) => {
  const { rows, columns, metrics } = load(f);
  console.log(`\n══ ${f}  (${rows.length} rows, ${columns.length} cols)`);
  console.log(`    coerced=${metrics.typesCoerced} nulls=${metrics.nullsFound} unified=${metrics.valuesUnified}` +
    ` outliers=${metrics.outlierRows ?? 0} dropped=${(metrics.emptyColumns || []).length}` +
    ` malformed=${metrics.malformedRows?.length ?? metrics.malformedCount ?? 0}`);
  return load(f);
};

/* 1 ── event log */
{
  const { rows, metrics } = banner('01-event-log.csv');
  check('unit_price "$1,299.00" became a number', typesOf(rows, 'unit_price').every((t) => t === 'number'), typesOf(rows, 'unit_price').join('/'));
  check('revenue "12,345.00" became a number', typesOf(rows, 'revenue').every((t) => t === 'number'), typesOf(rows, 'revenue').join('/'));
  check('discount_pct "17%" became a number', typesOf(rows, 'discount_pct').every((t) => t === 'number'), typesOf(rows, 'discount_pct').join('/'));
  const regions = distinct(rows, 'region');
  check('12 spellings of 4 regions folded to 4', regions.length === 4, JSON.stringify(regions));
  const dates = distinct(rows, 'order_date');
  check('all three date spellings parsed to one shape',
    dates.every((d) => /^\d{4}-\d{2}-\d{2}/.test(String(d))),
    JSON.stringify(dates.filter((d) => !/^\d{4}-\d{2}-\d{2}/.test(String(d))).slice(0, 4)));
  check('no date landed outside 2025-2026', dates.every((d) => /^202[56]-/.test(String(d))),
    JSON.stringify(dates.filter((d) => !/^202[56]-/.test(String(d))).slice(0, 4)));
}

/* 2 ── outcome */
{
  const { rows } = banner('02-outcome.csv');
  const ch = distinct(rows, 'churned').map(String).sort();
  check('six spellings of true/false folded to two', ch.length === 2, JSON.stringify(ch));
  check('monthly_charge is numeric', typesOf(rows, 'monthly_charge').every((t) => t === 'number'), typesOf(rows, 'monthly_charge').join('/'));
}

/* 3 ── long panel */
{
  const { rows } = banner('03-long-panel.csv');
  check('value column is numeric', typesOf(rows, 'value').every((t) => t === 'number'), typesOf(rows, 'value').join('/'));
  check('year stayed a year, not a measure to add up', rows.every((r) => r.year >= 2014 && r.year <= 2025));
  const inds = distinct(rows, 'indicator');
  check('the four indicator names survived intact', inds.length === 4, JSON.stringify(inds));
}

/* 4 ── entity comparison */
{
  const { rows } = banner('04-entity-comparison.csv');
  check('"1M" context window became 1000000', rows[0]['Context Window'] === 1000000, String(rows[0]['Context Window']));
  check('blank prices are null, not zero', rows.some((r) => r['Monthly Price USD'] === null));
  check('Intelligence Index survived as a number', typeof rows[0]['Intelligence Index'] === 'number');
}

/* 5 ── survey */
{
  const { rows } = banner('05-survey.csv');
  const q1 = typesOf(rows, 'q1_ease');
  check('a Likert column with 8% refusals is still numeric', q1.every((t) => t === 'number' || t === 'null'), q1.join('/'));
  check('"Prefer not to say" became null rather than a level',
    !distinct(rows, 'q1_ease').includes('Prefer not to say'),
    JSON.stringify(distinct(rows, 'q1_ease').slice(0, 8)));
}

/* 6 ── sensor stream */
{
  const t0 = Date.now();
  const { rows } = banner('06-sensor-stream.csv');
  console.log(`    ingest took ${Date.now() - t0} ms`);
  check('all 50,000 rows survived', rows.length === 50000, String(rows.length));
  check('temperature is numeric', typesOf(rows, 'temperature_c').every((t) => t === 'number'));
  check('timestamps kept their time of day', String(rows[5].reading_ts).includes(':'), String(rows[5].reading_ts));
}

/* 7 ── refunds */
{
  const { rows } = banner('07-refunds.csv');
  check('amount is numeric', typesOf(rows, 'amount').every((t) => t === 'number'), typesOf(rows, 'amount').join('/'));
  const neg = rows.filter((r) => Number(r.amount) < 0).length;
  check('accounting negatives "(123.45)" read as negative', neg > 100, `${neg} negative rows`);
  check('a refund row kept its sign on both columns',
    rows.every((r) => (r.txn_type === 'Refund' ? Number(r.qty) < 0 && Number(r.amount) < 0 : true)),
    JSON.stringify(rows.filter((r) => r.txn_type === 'Refund' && !(Number(r.amount) < 0)).slice(0, 2)));
}

/* 8 ── wide sparse */
{
  const { rows, columns, metrics } = banner('08-wide-sparse.csv');
  check('both all-blank columns were dropped',
    !columns.includes('always_blank_a') && !columns.includes('always_blank_b'),
    JSON.stringify(columns.filter((c) => c.startsWith('always_blank'))));
  check('the drop was reported, not silent', (metrics.emptyColumns || []).length >= 2, JSON.stringify(metrics.emptyColumns));
  check('the sparse fields survived as numbers',
    typesOf(rows, 'field_01').every((t) => t === 'number' || t === 'null'), typesOf(rows, 'field_01').join('/'));
}

/* 9 ── filthy */
{
  const { rows, columns, metrics } = banner('09-filthy.csv');
  console.log(`    columns: ${JSON.stringify(columns)}`);
  console.log(`    preambleRows=${metrics.preambleRows ?? '(not set)'}`);
  console.log(`    first row: ${JSON.stringify(rows[0])}`);
  const amounts = rows.map((r) => r.amount);
  check('the header was found under three preamble lines', columns.includes('item'), JSON.stringify(columns.slice(0, 3)));
  check('the duplicated "region" header did not overwrite its twin',
    columns.filter((c) => /^region/.test(c)).length === 2, JSON.stringify(columns.filter((c) => /^region/.test(c))));
  check('amount is numeric throughout', typesOf(rows, 'amount').every((t) => t === 'number' || t === 'null'), typesOf(rows, 'amount').join('/'));
  check('"(1,234.50)" read as -1234.5', amounts.includes(-1234.5), JSON.stringify([...new Set(amounts)].slice(0, 8)));
  check('"  2,345.00  " read as 2345', amounts.includes(2345), '');
  check('"1.2e3" read as 1200', amounts.includes(1200), '');
  check('unicode minus "−567.89" read as -567.89', amounts.includes(-567.89), '');
  check('"€1.234,56" read as 1234.56', amounts.includes(1234.56), '');
  const q = distinct(rows, 'qty');
  check('N/A, -, null, --, n/a all became null',
    q.filter((v) => v !== null && typeof v !== 'number').length === 0, JSON.stringify(q.filter((v) => v !== null && typeof v !== 'number')));
  const regions = distinct(rows, columns.find((c) => /^region/.test(c)));
  check('four spellings of North folded to one', regions.filter((v) => v !== null).length === 1, JSON.stringify(regions));
  const dates = distinct(rows, 'opened');
  check('five date spellings parsed to one shape',
    dates.every((d) => d === null || /^\d{4}-\d{2}-\d{2}/.test(String(d))),
    JSON.stringify(dates));
  check('the all-blank column was dropped', !columns.includes('all_empty'), JSON.stringify(columns));
}

/* 10 ── two columns */
{
  const { rows } = banner('10-two-columns.csv');
  check('points is numeric', typesOf(rows, 'points').every((t) => t === 'number'));
  check('three teams', distinct(rows, 'team').length === 3, JSON.stringify(distinct(rows, 'team')));
}

console.log(`\n──────── cleaning: ${pass} pass, ${fail} fail ────────`);
