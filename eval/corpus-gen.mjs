/**
 * Builds the scorecard corpus in `tests/corpus/`.
 *
 * Three sources, all deterministic, so a difference in the scorecard is a
 * difference in the engine and never in the data:
 *
 *   1. The ten shape datasets from `eval/datasets.mjs` (run that first), minus
 *      the entity comparison, which is already in the corpus as
 *      `ai_subscriptions.csv`. The 50,000-row sensor stream is kept at every
 *      tenth row: the same 35-day span at ten-minute resolution, which is the
 *      property it exists to test.
 *   2. The four samples the app offers, and `sales_data.csv` from the repo root.
 *   3. Twelve tables written here, each built around a trap a real file has
 *      and the engine does not yet guard against: a price only comparable
 *      within its buyer unit or currency, a stock level that must not be summed
 *      across weeks, budget and actual in one value column, one row that
 *      carries most of a measure's spread, a month of hourly data.
 *
 * Files added to the corpus by hand — `ai_subscriptions.csv`, `ai_jobs.csv`,
 * `ai_models_api_detail.csv` — are their own source and are not written here.
 *
 * The CSVs are written; the `.expect.json` beside each is written by hand,
 * because the point of an expectation is that someone decided it.
 *
 *     node eval/datasets.mjs && node eval/corpus-gen.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { SAMPLES } from '../lib/samples.js';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'tests', 'corpus');
const EVAL = path.join(ROOT, 'eval', 'data');

const w = (name, text) => fs.writeFileSync(path.join(OUT, name), text);
const cell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (header, rows) => [header.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n') + '\n';

let seed = 20260923;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const round = (x, d = 2) => Number(x.toFixed(d));
// Box–Muller, for the handful of columns that should look measured.
const normal = (mu, sd) => mu + sd * Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

/* ── 1. The shape datasets ─────────────────────────────────────────────── */
const EVAL_FILES = {
  '01-event-log.csv': 'eval_01_event_log.csv',
  '02-outcome.csv': 'eval_02_outcome.csv',
  '03-long-panel.csv': 'eval_03_long_panel.csv',
  '05-survey.csv': 'eval_05_survey.csv',
  '06-sensor-stream.csv': 'eval_06_sensor_stream.csv',
  '07-refunds.csv': 'eval_07_refunds.csv',
  '08-wide-sparse.csv': 'eval_08_wide_sparse.csv',
  '09-filthy.csv': 'eval_09_filthy.csv',
  '10-two-columns.csv': 'eval_10_two_columns.csv',
};
for (const [from, to] of Object.entries(EVAL_FILES)) {
  const source = path.join(EVAL, from);
  if (!fs.existsSync(source)) throw new Error(`${from} is missing — run node eval/datasets.mjs first`);
  let text = fs.readFileSync(source, 'utf8');
  if (from.startsWith('06')) {
    const [header, ...lines] = text.trimEnd().split('\n');
    text = [header, ...lines.filter((_, i) => i % 10 === 0)].join('\n') + '\n';
  }
  w(to, text);
}

/* ── 2. The app's samples and the repo's own small files ──────────────── */
for (const sample of SAMPLES) w(`sample_${sample.key}.csv`, sample.csv);
fs.copyFileSync(path.join(ROOT, 'sales_data.csv'), path.join(OUT, 'repo_sales_data.csv'));

/* ── 3. Trap tables ─────────────────────────────────────────────────────── */

/* g01 — a catalogue priced in five currencies. `price_local` is only
   comparable within its currency; `price_usd` is comparable everywhere. */
{
  const markets = [
    ['India', 'INR', 83.2],
    ['United States', 'USD', 1],
    ['United Kingdom', 'GBP', 0.79],
    ['Japan', 'JPY', 147.5],
    ['Germany', 'EUR', 0.92],
  ];
  const cats = { Audio: 90, Wearables: 180, Cameras: 520, Accessories: 25, Laptops: 1100 };
  const rows = [];
  for (let i = 0; i < 120; i++) {
    const [market, currency, fx] = markets[i % markets.length];
    const category = pick(Object.keys(cats));
    const usd = round(cats[category] * (0.6 + rnd() * 0.9));
    rows.push([
      `SKU-${3000 + i}`,
      `${category.slice(0, -1)} ${pick(['Nova', 'Pulse', 'Orbit', 'Vector', 'Echo', 'Prism'])} ${int(1, 9)}`,
      category,
      market,
      currency,
      round(usd * fx),
      usd,
      round(3 + rnd() * 2, 1),
      int(5, 900),
    ]);
  }
  w('gen_multi_currency_catalog.csv', csv(
    ['sku', 'product_name', 'category', 'market', 'currency', 'price_local', 'price_usd', 'rating', 'units_sold_30d'],
    rows
  ));
}

/* g02 — SaaS plans sold per user, per seat, per organisation and per
   instance. One dedicated instance costs fifty times the next plan. */
{
  const vendors = ['Northwind', 'Contoso', 'Fabrikam', 'Tailspin', 'Litware', 'Adatum'];
  const tiers = [
    ['Starter', 'user', 8, 10],
    ['Team', 'seat', 18, 100],
    ['Business', 'seat', 32, 500],
    ['Organisation', 'org', 450, 5000],
    ['Enterprise', 'org', 1400, 20000],
  ];
  const rows = [];
  for (const vendor of vendors) {
    tiers.forEach(([plan, unit, price, storage], rank) => {
      const f = 0.7 + rnd() * 0.7;
      rows.push([vendor, plan, rank + 1, unit, round(price * f), Math.round(storage * (0.6 + rnd())), int(1, 50) * 10 * (rank + 1), pick(['Email', 'Chat', 'Phone', 'Dedicated']), rank >= 2 ? 'Yes' : 'No']);
    });
  }
  rows.push(['Northwind', 'Dedicated instance', 6, 'instance', 68000, 500000, 50000, 'Dedicated', 'Yes']);
  w('gen_saas_pricing.csv', csv(
    ['vendor', 'plan', 'tier_rank', 'buyer_unit', 'monthly_price_usd', 'storage_gb', 'api_calls_k', 'support_level', 'sso'],
    rows
  ));
}

/* g03 — employees, with attrition driven by overtime and satisfaction and
   not by department. */
{
  const rows = [];
  for (let i = 0; i < 600; i++) {
    const overtime = rnd() < 0.3;
    const satisfaction = int(1, 4);
    const risk = 0.06 + (overtime ? 0.25 : 0) + (satisfaction === 1 ? 0.15 : 0);
    const level = int(1, 5);
    rows.push([
      `E${5000 + i}`,
      pick(['Engineering', 'Sales', 'Support', 'Finance', 'Operations']),
      level,
      round(Math.max(0, normal(5, 3.5)), 1),
      Math.round(normal(38000 + level * 17000, 6000)),
      overtime ? 'Yes' : 'No',
      satisfaction,
      rnd() < risk ? pick(['Yes', 'yes', 'Y']) : pick(['No', 'no', 'N']),
    ]);
  }
  w('gen_hr_attrition.csv', csv(
    ['employee_id', 'department', 'job_level', 'tenure_years', 'salary', 'overtime', 'satisfaction', 'attrition'],
    rows
  ));
}

/* g04 — an A/B test over 28 days. The whole series fits inside one month, so
   a monthly bucket draws a single point. */
{
  const start = new Date(Date.UTC(2026, 6, 1));
  const rows = [];
  for (let i = 0; i < 2000; i++) {
    const variant = i % 2 ? 'B' : 'A';
    const converted = rnd() < (variant === 'B' ? 0.118 : 0.094);
    rows.push([
      `V${100000 + i}`,
      variant,
      pick(['Desktop', 'Mobile', 'Mobile', 'Tablet']),
      iso(addDays(start, int(0, 27))),
      converted ? pick(['true', 'TRUE', '1']) : pick(['false', 'FALSE', '0']),
      converted ? round(20 + rnd() * 140) : 0,
    ]);
  }
  w('gen_ab_test.csv', csv(['visitor_id', 'variant', 'device', 'visit_date', 'converted', 'revenue'], rows));
}

/* g05 — weekly stock snapshots. `stock_on_hand` is a level: summing it
   across weeks counts the same units sixteen times. */
{
  const start = new Date(Date.UTC(2026, 0, 5));
  const skus = Array.from({ length: 30 }, (_, i) => [`SKU-${700 + i}`, pick(['Leeds', 'Reno', 'Lyon'])]);
  const rows = [];
  for (let wk = 0; wk < 16; wk++) {
    for (const [sku, warehouse] of skus) {
      const received = int(0, 120);
      const shipped = int(10, 110);
      rows.push([iso(addDays(start, wk * 7)), sku, warehouse, int(40, 600) - wk * 6, received, shipped]);
    }
  }
  w('gen_inventory_snapshots.csv', csv(
    ['week_start', 'sku', 'warehouse', 'stock_on_hand', 'units_received', 'units_shipped'],
    rows
  ));
}

/* g06 — property listings with one estate priced at 45M among homes that
   cost 200k to 2M. */
{
  const cities = { Austin: 420, Denver: 510, Seattle: 690, Phoenix: 330 };
  const rows = [];
  for (let i = 0; i < 400; i++) {
    const city = pick(Object.keys(cities));
    const sqft = int(650, 4200);
    const ppsf = Math.round(cities[city] * (0.75 + rnd() * 0.5));
    rows.push([
      `L-${9000 + i}`,
      city,
      `${city} ${pick(['North', 'South', 'East', 'West', 'Central'])}`,
      pick(['House', 'Condo', 'Townhouse']),
      int(1, 5),
      sqft,
      sqft * ppsf,
      ppsf,
      int(3, 120),
    ]);
  }
  rows.push(['L-9400', 'Austin', 'Austin West', 'Estate', 9, 21000, 45000000, 2143, 240]);
  w('gen_real_estate.csv', csv(
    ['listing_id', 'city', 'neighbourhood', 'property_type', 'bedrooms', 'sqft', 'price', 'price_per_sqft', 'days_on_market'],
    rows
  ));
}

/* g07 — daily web analytics per channel. `bounce_rate` is a percentage:
   averaged, never summed. */
{
  const start = new Date(Date.UTC(2026, 0, 1));
  const channels = { Organic: 1800, Paid: 1100, Email: 420, Social: 650 };
  const rows = [];
  for (let d = 0; d < 180; d++) {
    for (const [channel, base] of Object.entries(channels)) {
      const sessions = Math.round(base * (1 + d / 400) * (0.8 + rnd() * 0.4));
      const conversions = Math.round(sessions * (channel === 'Email' ? 0.06 : 0.025) * (0.7 + rnd() * 0.6));
      rows.push([iso(addDays(start, d)), channel, sessions, Math.round(sessions * 0.82), round(30 + rnd() * 35, 1), conversions, round(conversions * (40 + rnd() * 30))]);
    }
  }
  w('gen_web_daily.csv', csv(['date', 'channel', 'sessions', 'users', 'bounce_rate', 'conversions', 'revenue'], rows));
}

/* g08 — a three-arm trial. Improvement depends on the arm, adverse events
   on the dose. */
{
  const arms = { Placebo: [0.22, 0.05], 'Drug 10mg': [0.41, 0.09], 'Drug 20mg': [0.55, 0.19] };
  const rows = [];
  for (let i = 0; i < 300; i++) {
    const arm = Object.keys(arms)[i % 3];
    const [pImprove, pAdverse] = arms[arm];
    const improved = rnd() < pImprove;
    const baseline = Math.round(normal(62, 8));
    rows.push([
      `P-${1000 + i}`,
      arm,
      pick(['Site 1', 'Site 2', 'Site 3', 'Site 4']),
      int(24, 79),
      pick(['F', 'M']),
      baseline,
      baseline - (improved ? int(8, 20) : int(-4, 6)),
      improved ? 'Y' : 'N',
      rnd() < pAdverse ? 'Y' : 'N',
    ]);
  }
  w('gen_clinical_trial.csv', csv(
    ['patient_id', 'arm', 'site', 'age', 'sex', 'baseline_score', 'week12_score', 'improved', 'adverse_event'],
    rows
  ));
}

/* g09 — budget and actual in one `amount` column. Adding them together is
   the classic long-table mistake. */
{
  const depts = { Marketing: 120000, Engineering: 480000, Sales: 260000, Support: 90000, Finance: 70000, HR: 55000 };
  const rows = [];
  for (let m = 1; m <= 12; m++) {
    for (const [dept, budget] of Object.entries(depts)) {
      const month = `2026-${String(m).padStart(2, '0')}`;
      rows.push([dept, month, 'Budget', budget]);
      rows.push([dept, month, 'Actual', Math.round(budget * (0.82 + rnd() * 0.36))]);
    }
  }
  w('gen_budget_vs_actual.csv', csv(['department', 'month', 'scenario', 'amount'], rows));
}

/* g10 — test scores. Several measures on one 0–100 scale, one grain. */
{
  const schools = { Ashford: 4, Brookside: -3, Carlton: 7, Dunmore: -6 };
  const rows = [];
  for (let i = 0; i < 500; i++) {
    const school = pick(Object.keys(schools));
    const attendance = Math.min(100, round(normal(91, 6), 1));
    const lift = schools[school] + (attendance - 91) * 0.8;
    const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));
    rows.push([
      `S${20000 + i}`,
      school,
      int(9, 12),
      pick(['F', 'M']),
      clamp(normal(68 + lift, 11)),
      clamp(normal(71 + lift, 10)),
      clamp(normal(66 + lift, 12)),
      attendance,
    ]);
  }
  w('gen_student_scores.csv', csv(
    ['student_id', 'school', 'grade_level', 'gender', 'math', 'reading', 'science', 'attendance_pct'],
    rows
  ));
}

/* g11 — two weeks of hourly meter readings. */
{
  const start = Date.UTC(2026, 7, 3);
  const meters = [['M-1', 'Plant North'], ['M-2', 'Plant North'], ['M-3', 'Warehouse']];
  const rows = [];
  for (let h = 0; h < 14 * 24; h++) {
    const ts = new Date(start + h * 3600000);
    const hour = ts.getUTCHours();
    const temp = round(18 + 7 * Math.sin(((hour - 9) / 24) * 2 * Math.PI) + normal(0, 1), 1);
    for (const [meter, site] of meters) {
      const load = site === 'Warehouse' ? 22 : 60;
      const shift = hour >= 7 && hour <= 19 ? 1.6 : 0.7;
      rows.push([ts.toISOString().slice(0, 19) + 'Z', meter, site, round(load * shift * (0.9 + rnd() * 0.2) + temp * 0.4), temp]);
    }
  }
  w('gen_energy_hourly.csv', csv(['timestamp', 'meter_id', 'site', 'kwh', 'temperature_c'], rows));
}

/* g12 — support tickets. Resolution time is skewed, and one ticket sat open
   for three months. */
{
  const start = new Date(Date.UTC(2026, 0, 1));
  const prio = { Urgent: [4, 0.35], High: [12, 0.2], Normal: [30, 0.1], Low: [60, 0.05] };
  const rows = [];
  for (let i = 0; i < 1500; i++) {
    const priority = pick(['Urgent', 'High', 'High', 'Normal', 'Normal', 'Normal', 'Low']);
    const [hours, pBreach] = prio[priority];
    const breached = rnd() < pBreach;
    rows.push([
      `T-${40000 + i}`,
      `${iso(addDays(start, int(0, 180)))} ${String(int(0, 23)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}`,
      pick(['Email', 'Chat', 'Phone', 'Portal']),
      priority,
      pick(['Billing', 'Login', 'Reports', 'Integrations', 'Mobile app']),
      round(hours * Math.exp(normal(0, 0.6)), 1),
      breached ? pick(['Yes', 'TRUE', 'Y']) : pick(['No', 'FALSE', 'N']),
      rnd() < 0.25 ? '' : int(1, 5),
    ]);
  }
  rows.push(['T-41500', '2026-01-04 09:12', 'Email', 'Low', 'Integrations', 2210, 'Yes', 1]);
  w('gen_support_tickets.csv', csv(
    ['ticket_id', 'created_at', 'channel', 'priority', 'product_area', 'resolution_hours', 'sla_breached', 'csat'],
    rows
  ));
}

console.log(`corpus written to ${path.relative(ROOT, OUT)}`);
