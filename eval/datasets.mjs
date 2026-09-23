/**
 * Ten datasets chosen for their SHAPE, because "data agnostic" is a claim
 * about shape and not about subject matter. Ten spreadsheets of sales in
 * different industries would all be one test.
 *
 * Each carries deliberate dirt whose correct reading is written down in
 * `eval/expectations.mjs`, so "did it transform the data well" can be answered
 * by comparison rather than by opinion.
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, 'data');
// Gitignored, so absent on a fresh checkout — CI regenerates from here.
fs.mkdirSync(OUT, { recursive: true });
const w = (name, text) => fs.writeFileSync(path.join(OUT, name), text);
const csv = (header, rows) =>
  [header.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n') + '\n';
const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// A deterministic pseudo-random sequence, so every run of this evaluation
// produces byte-identical files and a difference in the results is a
// difference in the code.
let seed = 20260921;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

/* ── 1. Event log: a time series with money that adds up ────────────────── */
{
  const regions = ['North', 'South', 'East', 'West'];
  const cats = ['Electronics', 'Grocery', 'Apparel', 'Home'];
  const rows = [];
  for (let i = 0; i < 900; i++) {
    const month = (i % 24) + 1;
    const y = 2025 + Math.floor((month - 1) / 12);
    const m = ((month - 1) % 12) + 1;
    const d = int(1, 28);
    // Three date spellings in one column, on purpose.
    const date =
      i % 3 === 0
        ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        : i % 3 === 1
          ? `${m}/${d}/${y}`
          : `${d} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${y}`;
    const units = int(1, 40);
    const price = (int(500, 250000) / 100).toFixed(2);
    const revenue = (units * Number(price)).toFixed(2);
    // Four spellings of one region.
    const region = pick([pick(regions), pick(regions).toLowerCase(), ` ${pick(regions).toUpperCase()} `]);
    rows.push([
      date,
      region,
      pick(cats),
      units,
      // Currency symbol and thousands separator.
      Number(price) > 999 ? `$${Number(price).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : `$${price}`,
      Number(revenue) > 999 ? Number(revenue).toLocaleString('en-US', { minimumFractionDigits: 2 }) : revenue,
      `${int(0, 25)}%`,
    ]);
  }
  w('01-event-log.csv', csv(
    ['order_date', 'region', 'category', 'units_sold', 'unit_price', 'revenue', 'discount_pct'],
    rows
  ));
}

/* ── 2. Outcome table: a yes/no target, no time axis ────────────────────── */
{
  const rows = [];
  for (let i = 0; i < 900; i++) {
    const contract = pick(['Month-to-month', 'One year', 'Two year']);
    const churnRisk = contract === 'Month-to-month' ? 0.42 : contract === 'One year' ? 0.14 : 0.05;
    const churned = rnd() < churnRisk;
    // Six spellings of a boolean.
    const asText = churned
      ? pick(['Yes', 'yes', 'Y', 'TRUE', 'true', '1'])
      : pick(['No', 'no', 'N', 'FALSE', 'false', '0']);
    rows.push([
      `CUST-${10000 + i}`,
      contract,
      int(1, 72),
      (int(1800, 12000) / 100).toFixed(2),
      int(0, 9),
      pick(['Basic', 'Standard', 'Premium']),
      asText,
    ]);
  }
  w('02-outcome.csv', csv(
    ['customer_id', 'contract_type', 'tenure_months', 'monthly_charge', 'support_calls', 'plan_tier', 'churned'],
    rows
  ));
}

/* ── 3. Long format: one value column holding four different units ──────── */
{
  const countries = ['Brazil', 'China', 'Germany', 'India', 'Nigeria', 'United States'];
  const indicators = [
    ['GDP (current LCU)', 1e11, 1e13],
    ['Population, total', 8e7, 1.4e9],
    ['Life expectancy at birth', 55, 84],
    ['Inflation, consumer prices (annual %)', -1, 22],
  ];
  const rows = [];
  for (const c of countries) {
    for (let y = 2014; y <= 2025; y++) {
      for (const [ind, lo, hi] of indicators) {
        const v = lo + rnd() * (hi - lo);
        rows.push([c, y, ind, ind.includes('%') || ind.includes('expectancy') ? v.toFixed(2) : Math.round(v)]);
      }
    }
  }
  w('03-long-panel.csv', csv(['country', 'year', 'indicator', 'value'], rows));
}

/* ── 4. Entity comparison: the user's own file, copied verbatim ─────────── */
fs.copyFileSync(
  path.join(import.meta.dirname, '..', 'tests', 'corpus', 'ai_subscriptions.csv'),
  path.join(OUT, '04-entity-comparison.csv')
);

/* ── 5. Survey: a wall of 1-5 scales, free text, and a refusal option ───── */
{
  const qs = ['q1_ease','q2_speed','q3_support','q4_value','q5_trust','q6_design',
              'q7_reliability','q8_docs','q9_onboarding','q10_recommend'];
  const rows = [];
  for (let i = 0; i < 400; i++) {
    const mood = rnd();
    const answers = qs.map(() => (rnd() < 0.08 ? 'Prefer not to say' : String(Math.max(1, Math.min(5, Math.round(1 + mood * 4 + (rnd() - 0.5) * 2))))));
    rows.push([
      `R${1000 + i}`,
      pick(['18-24', '25-34', '35-44', '45-54', '55+']),
      pick(['Engineering', 'Sales', 'Finance', 'Operations', 'Marketing']),
      pick(['Trial', 'Paid', 'Churned']),
      ...answers,
      rnd() < 0.3 ? pick(['Works well overall.', 'Too slow on large files.', 'Support was quick to respond.', 'Needs better docs, otherwise fine.']) : '',
    ]);
  }
  w('05-survey.csv', csv(['respondent_id', 'age_band', 'department', 'status', ...qs, 'comments'], rows));
}

/* ── 6. High-frequency sensor stream: 50k timestamped readings ───────────── */
{
  const rows = [];
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  for (let i = 0; i < 50000; i++) {
    const t = new Date(start + i * 60000);
    const sensor = `S-${(i % 8) + 1}`;
    const base = 20 + (i % 8);
    rows.push([
      t.toISOString().replace('.000Z', 'Z'),
      sensor,
      pick(['Line A', 'Line B']),
      (base + Math.sin(i / 500) * 6 + (rnd() - 0.5)).toFixed(3),
      (40 + Math.cos(i / 800) * 15 + (rnd() - 0.5) * 2).toFixed(2),
      rnd() < 0.02 ? 'FAULT' : 'OK',
    ]);
  }
  w('06-sensor-stream.csv', csv(
    ['reading_ts', 'sensor_id', 'line', 'temperature_c', 'humidity_pct', 'status'],
    rows
  ));
}

/* ── 7. Transactions with refunds: genuine negative amounts ─────────────── */
{
  const rows = [];
  for (let i = 0; i < 1200; i++) {
    const refund = rnd() < 0.12;
    const qty = refund ? -int(1, 3) : int(1, 6);
    const unit = int(500, 40000) / 100;
    const amount = (qty * unit).toFixed(2);
    rows.push([
      `ORD-${200000 + i}`,
      `C-${int(1, 240)}`,
      `SKU-${int(1, 90)}`,
      pick(['Accessories', 'Audio', 'Computing', 'Wearables']),
      qty,
      // Parentheses for negatives, as accounting exports write them.
      refund ? `(${Math.abs(Number(amount)).toFixed(2)})` : amount,
      refund ? 'Refund' : 'Sale',
      `2026-0${int(1, 9)}-${String(int(1, 28)).padStart(2, '0')}`,
    ]);
  }
  w('07-refunds.csv', csv(
    ['order_id', 'customer_id', 'sku', 'category', 'qty', 'amount', 'txn_type', 'order_date'],
    rows
  ));
}

/* ── 8. Wide and sparse: 60 columns, most of them mostly empty ──────────── */
{
  const header = ['record_id', 'site', 'opened_on', 'status'];
  for (let i = 1; i <= 52; i++) header.push(`field_${String(i).padStart(2, '0')}`);
  header.push('always_blank_a', 'always_blank_b', 'notes', 'score');
  const rows = [];
  for (let i = 0; i < 300; i++) {
    const r = [
      `REC-${i}`,
      pick(['Leeds', 'Bristol', 'Cardiff', 'Belfast']),
      `2026-0${int(1, 9)}-${String(int(1, 28)).padStart(2, '0')}`,
      pick(['Open', 'Closed', 'Pending']),
    ];
    for (let f = 1; f <= 52; f++) r.push(rnd() < 0.18 ? int(0, 500) : '');
    r.push('', '', rnd() < 0.1 ? 'follow up' : '', int(0, 100));
    rows.push(r);
  }
  w('08-wide-sparse.csv', csv(header, rows));
}

/* ── 9. Filthy: every defect at once, small enough to check by hand ─────── */
{
  const lines = [];
  // A preamble above the header, as exported reports carry.
  lines.push('Quarterly Extract — CONFIDENTIAL');
  lines.push('Generated 2026-09-21 by ReportBuilder v4');
  lines.push('');
  // A duplicated header name and a blank header cell.
  lines.push('item,region,region,,amount,pct_change,qty,opened,flag,all_empty');
  const dates = ['2026-01-05', '02/03/2026', '7-4-2026', '15 Aug 2026', '31.12.2025'];
  const nulls = ['', 'N/A', '-', 'null', 'NULL', 'n/a', '--'];
  for (let i = 0; i < 60; i++) {
    const amount =
      i % 6 === 0 ? `(1,234.50)`                       // accounting negative
      : i % 6 === 1 ? `  2,345.00  `                   // padded, thousands
      : i % 6 === 2 ? `€1.234,56`                      // european decimal
      : i % 6 === 3 ? `1.2e3`                          // scientific
      : i % 6 === 4 ? `−567.89`                        // unicode minus
      : `890.10`;
    lines.push([
      `Item ${String(i).padStart(3, '0')}`,
      pick([' North ', 'north', 'NORTH', 'North']),
      pick(['Alpha', 'alpha']),
      '',
      amount,
      `${(int(-2500, 2500) / 100).toFixed(2)}%`,
      i % 7 === 0 ? pick(nulls) : String(int(1, 99)),
      dates[i % dates.length],
      pick(['Yes', 'no', 'Y', 'N', 'TRUE', 'false']),
      '',
    ].map(cell).join(','));
  }
  // A short row and a long row, as a hand-edited file carries.
  lines.push('Item 060,North,Alpha,,100.00');
  lines.push('Item 061,North,Alpha,,200.00,1.00%,5,2026-01-01,Yes,,extra,cells');
  w('09-filthy.csv', lines.join('\n') + '\n');
}

/* ── 10. The degenerate shape: one category, one number ─────────────────── */
{
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push([pick(['Team Alpha', 'Team Bravo', 'Team Charlie']), int(10, 900)]);
  w('10-two-columns.csv', csv(['team', 'points'], rows));
}

for (const f of fs.readdirSync(OUT).sort()) {
  const p = path.join(OUT, f);
  const text = fs.readFileSync(p, 'utf8');
  console.log(`${f.padEnd(26)} ${String(text.split('\n').length - 2).padStart(6)} rows  ${(fs.statSync(p).size / 1024).toFixed(0).padStart(5)} KB`);
}
