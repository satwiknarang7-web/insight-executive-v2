/**
 * What each column is, and what the table is.
 *
 * The first thing an analyst does with an unfamiliar table is read it: which
 * column is the date, which are the things you split by, which are the numbers
 * you add up and which the numbers you average, which is an id nobody charts,
 * and what one row stands for. Everything the dashboard planner decides rests
 * on these answers, so they are made here, once, from the values first and the
 * names second — a name breaks a tie the values cannot settle ("price" and
 * "units" can hold the same integers).
 *
 * A field:
 *   {
 *     name, label,
 *     kind:   'number' | 'date' | 'boolean' | 'text',
 *     role:   'time' | 'dimension' | 'measure' | 'id' | 'text' | 'ignore',
 *     agg:    'sum' | 'avg'            (measures: how it combines across rows)
 *     format: 'number' | 'currency' | 'percent' | 'ratio'
 *     scale:  1 | 100                  (percent: 1 when stored as 0.21)
 *     ordinal, geo, outcome: { positive } | null,
 *     stats:  { n, filled, distinct, min, max, mean, median, ... }
 *   }
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const YES = /^(y|yes|true|t|1|active|won|success|churned|converted|retained)$/i;
const NO = /^(n|no|false|f|0|inactive|lost|failure|failed)$/i;

// Names that say "a number you average, not add". Checked on word boundaries
// after snake/camel case is split, so `separate` is not a rate.
const AVERAGED =
  /\b(rate|ratio|pct|percent|percentage|share|avg|average|mean|median|score|rating|index|price|cost per|per|age|temp|temperature|humidity|pressure|lat|latitude|lon|lng|longitude|margin|probability|prob|grade|rank|ranking|level|tenure|duration|days|hours|minutes|seconds|years|speed|weight|height|length|width|size|density|yield|capacity|salary|wage|income|nps|csat|satisfaction|expectancy|inflation|growth|elasticity|multiplier|seats)\b/i;
const ADDITIVE =
  /\b(revenue|sales|amount|total|sum|profit|cost|costs|spend|spent|expense|expenses|budget|qty|quantity|units|volume|count|orders|sessions|visits|clicks|impressions|conversions|signups|downloads|installs|leads|deals|calls|tickets|bookings|transactions|value|gmv|net|gross|tax|fees|refund|refunds|payments|paid|balance|population|gdp|emissions|hires|stock|inventory|views|users|customers|items|points|goals|wins|losses|kwh|mwh|energy|consumption|usage|shipped|received|sold)\b/i;
const MONEY = /\b(revenue|sales|amount|price|cost|costs|spend|spent|expense|expenses|budget|profit|salary|wage|income|fee|fees|tax|gmv|payment|payments|paid|refund|refunds|usd|eur|gbp|inr|jpy|dollars?|euros?|pounds?|rupees?|charge|charges|balance|value|gdp|credit|credits|mrr|arr|ltv|aov)\b/i;
const PERCENT = /(\bpct\b|\bpercent|\bpercentage\b|%|\brate\b|\bshare\b|\bratio\b|\bmargin\b|\bprobability\b|\bprob\b|\bhumidity\b|\binflation\b|\bgrowth\b)/i;
const ID_NAME = /(^|\b)(id|uuid|guid|key|code|number|no|num|ref|reference|sku|serial|hash|email|phone|url|isbn)\b/i;
const GEO = /\b(country|countries|nation|state|province|region|city|town|county|district|continent|territory|zip|postcode|postal|location|market|area|site|store|branch)\b/i;
const OUTCOME_NAME =
  /\b(churn|churned|converted|conversion|default|defaulted|survived|fraud|fraudulent|won|success|successful|approved|cancelled|canceled|attrition|outcome|target|label|clicked|purchased|returned|retained|left|exited|resigned|hired|passed|failed|readmitted|delinquent|improved|recovered|responded|response|died|death|mortality|adverse|breach|breached|escalated|late|delayed|dropped|dropout|bounced|unsubscribed|renewed|upgraded|is_[a-z]+|has_[a-z]+)\b/i;
const YEAR_NAME = /\b(year|yr|fiscal year|fy)\b/i;
const LONG_BY = /\b(indicator|metric|measure|variable|series|kpi|attribute|parameter|statistic|stat|scenario|version)\b/i;
const LONG_VALUE = /^(value|values|amount|obs_value|observation|val|figure|number)$/i;

/** snake_case / camelCase / kebab → space-separated lower words for name rules. */
export function words(name) {
  return String(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-./]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const ACRONYMS = new Set(['usd', 'eur', 'gbp', 'inr', 'jpy', 'gdp', 'nps', 'csat', 'api', 'id', 'sla', 'kpi', 'roi', 'aov', 'mrr', 'arr', 'ltv', 'cpc', 'cpa', 'cpm', 'ctr', 'sku', 'url', 'hr', 'ai', 'ml', 'sso', 'scim', 'mcp', 'kwh', 'mwh', 'co2', 'uk', 'us', 'eu', 'faq', 'crm', 'erp', 'b2b', 'b2c', 'vat', 'gst', 'ebitda', 'yoy', 'mom', 'qa', 'ux', 'ui', 'it', 'ip', 'os', 'ssn', 'dob', 'bmi']);

/** A column name as a reader would write it: `units_sold` → "Units sold". */
export function labelOf(name) {
  const w = String(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!w) return String(name);
  // Keep acronyms (USD, GDP, NPS) as written, and write the common ones that
  // arrive in lower case the way a reader expects.
  return w
    .split(' ')
    .map((t, i) => {
      if (/^[A-Z0-9]{2,}$/.test(t)) return t;
      if (ACRONYMS.has(t.toLowerCase())) return t.toUpperCase();
      if (t.toLowerCase() === 'pct') return '%';
      return i === 0 ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t.toLowerCase();
    })
    .join(' ')
    .replace(/ %$/, ' %');
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const present = (v) => v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v));

export function toNumber(v) {
  if (isNum(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/[,$€£₹¥\s]/g, '').replace(/^\((.*)\)$/, '-$1').replace(/%$/, '');
  if (!s || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Milliseconds since epoch for a date-like value, or null. */
export function toTime(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!ISO_DATE.test(s)) return null;
  const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isNaN(t) ? null : t;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Read one column's values. `sample` bounds the work on very large tables. */
export function profileField(name, rows, { sample = 20000 } = {}) {
  const n = rows.length;
  const step = n > sample ? n / sample : 1;
  const values = [];
  for (let i = 0; i < n; i += step) values.push(rows[Math.floor(i)]?.[name]);
  const filledValues = values.filter(present);
  const filled = filledValues.length;
  const fill = values.length ? filled / values.length : 0;

  const nums = [];
  const times = [];
  let bools = 0;
  let hasTime = false;
  for (const v of filledValues) {
    if (typeof v === 'boolean') bools++;
    const t = typeof v === 'string' ? toTime(v) : null;
    if (t !== null) {
      times.push(t);
      if (/T\d{2}:\d{2}/.test(v) && !/T00:00(:00(\.0+)?)?(Z|[+-]00:?00)?$/.test(v)) hasTime = true;
      continue;
    }
    const x = toNumber(v);
    if (x !== null) nums.push(x);
  }

  const counts = new Map();
  for (const v of filledValues) {
    const k = String(v);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const distinct = counts.size;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  const stats = { n: values.length, filled, fill, distinct, top, avgLength: 0 };
  let kind = 'text';
  if (filled && bools === filled) kind = 'boolean';
  else if (filled && times.length >= 0.9 * filled) kind = 'date';
  else if (filled && nums.length >= 0.95 * filled) kind = 'number';

  if (kind === 'number') {
    const sorted = [...nums].sort((a, b) => a - b);
    const mean = nums.reduce((s, x) => s + x, 0) / nums.length;
    const sd = Math.sqrt(nums.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, nums.length - 1));
    Object.assign(stats, {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean,
      median: quantile(sorted, 0.5),
      p25: quantile(sorted, 0.25),
      p75: quantile(sorted, 0.75),
      sd,
      integer: nums.every(Number.isInteger),
      negative: nums.some((x) => x < 0),
      zeros: nums.filter((x) => x === 0).length / nums.length,
      skew: sd ? (mean - quantile(sorted, 0.5)) / sd : 0,
    });
  } else if (kind === 'date') {
    const sorted = [...times].sort((a, b) => a - b);
    const uniq = [...new Set(sorted)];
    const gaps = [];
    for (let i = 1; i < uniq.length; i++) gaps.push(uniq[i] - uniq[i - 1]);
    gaps.sort((a, b) => a - b);
    Object.assign(stats, {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      spanDays: (sorted[sorted.length - 1] - sorted[0]) / 864e5,
      gapDays: gaps.length ? quantile(gaps, 0.5) / 864e5 : null,
      hasTime,
    });
  } else {
    const lengths = filledValues.slice(0, 2000).map((v) => String(v).length);
    stats.avgLength = lengths.length ? lengths.reduce((s, x) => s + x, 0) / lengths.length : 0;
  }
  return { name, label: labelOf(name), kind, stats };
}

/** Which of a two-level column's values is the event (churned, converted…). */
export function positiveLevel(levels, name = '') {
  const vals = levels.map(String);
  // Single letters only as a pair: Y/N, T/F — not M/F.
  const pair = vals.map((v) => v.trim().toLowerCase()).sort().join('');
  if (pair === 'ny') return vals.find((v) => /^y$/i.test(v.trim()));
  if (pair === 'ft') return vals.find((v) => /^t$/i.test(v.trim()));
  const yes = vals.find((v) => YES.test(v.trim()) && v.trim().length > 1);
  const no = vals.find((v) => NO.test(v.trim()) && v.trim().length > 1);
  if (yes && (no || vals.length === 1)) return yes;
  if (no && !yes) return vals.find((v) => v !== no) || null;
  if (yes) return yes;
  // "Churned"/"Stayed", "Default"/"Paid": the level that echoes an outcome name.
  const w = words(name);
  if (!OUTCOME_NAME.test(w)) return null;
  const echo = vals.find((v) => w.split(' ').some((t) => t.length > 3 && v.toLowerCase().includes(t.slice(0, 5))));
  return echo || null;
}

/** Decide one field's role from its profile. */
export function roleField(f, { rows = 0 } = {}) {
  const w = words(f.name);
  const s = f.stats;
  const out = { ...f, role: 'dimension', agg: null, format: 'number', scale: 1, ordinal: false, geo: false, outcome: null };

  if (!s.filled) return { ...out, role: 'ignore', why: 'empty' };
  if (s.distinct === 1) return { ...out, role: 'ignore', why: 'one value' };

  if (f.kind === 'date') return { ...out, role: 'time', why: 'dates' };

  if (f.kind === 'boolean') {
    const positive = positiveLevel(['true', 'false'], f.name) || 'true';
    return { ...out, role: 'dimension', outcome: { positive }, why: 'yes/no' };
  }

  if (f.kind === 'number') {
    // A year column: whole numbers in a calendar range, named like one or
    // few enough distinct values to be periods.
    if (s.integer && s.min >= 1900 && s.max <= 2100 && (YEAR_NAME.test(w) || (s.distinct <= 60 && !ADDITIVE.test(w)))) {
      return { ...out, role: 'time', timeUnit: 'year', why: 'years' };
    }
    // An id: whole numbers, one per row, named like one.
    if (s.integer && ID_NAME.test(w) && s.distinct >= 0.9 * s.filled && !ADDITIVE.test(w)) {
      return { ...out, role: 'id', why: 'unique whole numbers named like an id' };
    }
    // A rank or tier number orders things; it is not a quantity.
    if (s.integer && /\b(rank|ranking|tier|position|order|seq|sequence)\b/.test(w) && s.distinct <= 50) {
      return { ...out, role: 'dimension', ordinal: true, why: 'a rank' };
    }
    // A small ordinal scale — a rating, a tier, a 1–5 answer — is something
    // to split by as well as average. Counts like qty stay measures.
    const smallScale = s.integer && s.distinct <= 11 && s.max - s.min <= 10 && s.min >= 0;
    const isCountName = ADDITIVE.test(w) && !AVERAGED.test(w);
    const percentName = PERCENT.test(w);
    const money = MONEY.test(w);
    let agg = 'sum';
    if (smallScale && !isCountName) agg = 'avg';
    else if (AVERAGED.test(w) || percentName) agg = 'avg';
    else if (ADDITIVE.test(w)) agg = 'sum';
    else if (s.negative && !money) agg = 'avg';
    else if (smallScale) agg = 'avg';
    else if (!s.integer && s.max <= 1 && s.min >= 0) agg = 'avg';
    // A number that is not additive by name and varies like a reading.
    else if (!s.integer && !money) agg = 'avg';

    let format = money && !(smallScale && !isCountName) ? 'currency' : 'number';
    let scale = 1;
    if (percentName || (!s.integer && s.min >= 0 && s.max <= 1 && /\b(rate|share|ratio|pct|percent|margin|prob)/.test(w))) {
      format = 'percent';
      scale = s.max <= 1.0001 ? 1 : 100;
    }
    if (/\b(price|cost per|per)\b/.test(w) && money) format = 'currency';

    return {
      ...out,
      role: 'measure',
      local: /\b(lcu|local|local currency|national currency)\b/.test(w),
      agg,
      format,
      scale,
      ordinal: smallScale && !isCountName,
      smallScale,
      why: agg === 'sum' ? 'a number that adds up across rows' : 'a number to average, not add',
    };
  }

  // Text.
  const idLike = s.distinct >= Math.max(20, 0.9 * s.filled);
  if (idLike && s.avgLength > 40) return { ...out, role: 'text', why: 'free text' };
  if (idLike) return { ...out, role: 'id', why: 'a different value on almost every row' };
  // A reference to something else — customer_id on an order — named like an id.
  if (ID_NAME.test(w) && s.distinct > 20 && !/\b(name|type|category|status|code)\b/.test(w.replace(/\bid\b/, ''))) return { ...out, role: 'id', why: 'named like an id' };
  if (s.avgLength > 60 && s.distinct > 30) return { ...out, role: 'text', why: 'free text' };

  const levels = s.top.map(([v]) => v);
  // A status whose rarer level is a problem — FAULT among OK, Refund among
  // Sale — is an outcome: its rate is what the table is watched for.
  const PROBLEM = /\b(fault|faulty|error|fail|failed|failure|alarm|alert|warning|critical|defect|defective|reject|rejected|late|breach|breached|cancel|cancelled|canceled|refund|refunded|return|returned|churn|churned|lost|dropped|abandoned|fraud|overdue|default|defaulted|denied|declined|bounced)\b/i;
  if (s.distinct >= 2 && s.distinct <= 3) {
    const problem = s.top.find(([v, n]) => PROBLEM.test(String(v)) && n < 0.5 * s.filled);
    if (problem) return { ...out, role: 'dimension', outcome: { positive: problem[0] }, why: `how often it is ${problem[0]}` };
  }
  if (s.distinct === 2) {
    const positive = positiveLevel(levels, f.name);
    if (positive || OUTCOME_NAME.test(w)) {
      return { ...out, role: 'dimension', outcome: { positive: positive || levels[0] }, why: 'two levels, an outcome' };
    }
  }
  return { ...out, role: 'dimension', geo: GEO.test(w), highCardinality: s.distinct > 30, why: `${s.distinct} categories` };
}

/**
 * A long ("tidy") table: one value column holding several different
 * quantities, named by another column. GDP and population in one `value`
 * column cannot be added together or even charted on one axis.
 */
function detectLong(rows, fields) {
  const measures = fields.filter((f) => f.role === 'measure');
  const dims = fields.filter((f) => f.role === 'dimension' && f.stats.distinct >= 2 && f.stats.distinct <= 60);
  if (!measures.length || !dims.length) return null;
  for (const m of measures) {
    for (const d of dims) {
      const named = LONG_VALUE.test(m.name) && LONG_BY.test(words(d.name));
      const groups = new Map();
      for (const r of rows.slice(0, 20000)) {
        const v = toNumber(r?.[m.name]);
        if (v === null || !present(r?.[d.name])) continue;
        const k = String(r[d.name]);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(Math.abs(v));
      }
      if (groups.size < 2) continue;
      const medians = [...groups.values()].map((xs) => xs.sort((a, b) => a - b)[xs.length >> 1]).filter((x) => x > 0);
      const spread = medians.length >= 2 ? Math.max(...medians) / Math.min(...medians) : 1;
      // Each level repeats: a long table has many rows per quantity.
      const perLevel = rows.length / groups.size;
      if (perLevel >= 3 && (named || (LONG_BY.test(words(d.name)) && (spread >= 20 || LONG_VALUE.test(m.name))))) {
        // Levels on one scale (Budget and Actual) can be compared and added;
        // levels in different units (GDP and population) cannot.
        return { value: m.name, by: d.name, levels: [...groups.keys()], shared: spread < 10 };
      }
    }
  }
  return null;
}

/** Several columns on one small shared scale: the items of a survey. */
function detectSurvey(fields) {
  const scales = new Map();
  for (const f of fields) {
    if (f.role !== 'measure' || !f.smallScale) continue;
    const key = `${f.stats.min}-${f.stats.max}`;
    if (!scales.has(key)) scales.set(key, []);
    scales.get(key).push(f.name);
  }
  const best = [...scales.values()].sort((a, b) => b.length - a.length)[0] || [];
  if (best.length < 4) return null;
  for (const f of fields) if (best.includes(f.name)) Object.assign(f, { agg: 'avg', format: 'number', ordinal: true });
  return best;
}

/** Singular/plural noun for what a row is, from its id column's name. */
export function rowNoun(idName) {
  if (!idName) return { one: 'record', many: 'records' };
  const w = words(idName)
    .replace(/\b(id|uuid|guid|key|code|number|no|num|ref|name|title)\b/g, '')
    .trim()
    .split(' ')
    .pop();
  if (!w || w.length < 3) return { one: 'record', many: 'records' };
  const many = /s$/.test(w) ? w : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : /(x|ch|sh)$/.test(w) ? `${w}es` : `${w}s`;
  return { one: w, many };
}

/** Is `cols` a key of the table — one row per combination? */
function isKey(rows, cols) {
  const seen = new Set();
  const limit = Math.min(rows.length, 50000);
  for (let i = 0; i < limit; i++) {
    const k = cols.map((c) => String(rows[i]?.[c] ?? '')).join('\u0001');
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

/**
 * The whole reading: fields with roles, the time column, the key, what a row
 * is, and the table's shape — which is what decides the dashboard.
 */
/**
 * Does `field` hold one value per `entity`? True when, among entities seen on
 * several rows, nearly all show a single value — and there are enough such
 * entities for that to mean something.
 */
function constantWithin(rows, entity, field, { sample = 30000 } = {}) {
  const seen = new Map();
  const step = rows.length > sample ? rows.length / sample : 1;
  for (let i = 0; i < rows.length; i += step) {
    const r = rows[Math.floor(i)];
    const e = r?.[entity];
    const v = r?.[field];
    if (e == null || e === '' || v == null || v === '') continue;
    const k = String(e);
    const cur = seen.get(k);
    if (!cur) seen.set(k, { v: String(v), n: 1, same: true });
    else {
      cur.n++;
      if (cur.same && cur.v !== String(v)) cur.same = false;
    }
  }
  let multi = 0;
  let same = 0;
  for (const g of seen.values()) {
    if (g.n < 2) continue;
    multi++;
    if (g.same) same++;
  }
  return multi >= 20 && same >= 0.97 * multi;
}

const singularWord = (label) => String(label || 'entity').toLowerCase().replace(/\s*ids?$/, '').replace(/s$/, '') || 'entity';

export function readDataset(rows, { name = 'dataset', overrides = {} } = {}) {
  const columns = rows.length ? [...new Set(rows.slice(0, 200).flatMap((r) => Object.keys(r || {})))] : [];
  let fields = columns
    .filter((c) => c !== 'isAnomaly')
    .map((c) => roleField(profileField(c, rows), { rows: rows.length }));

  // Reader's corrections win over every inference.
  fields = fields.map((f) => {
    const o = overrides[f.name];
    if (!o) return f;
    const next = { ...f, ...o, overridden: true };
    if (o.role === 'measure' && !next.agg) next.agg = 'sum';
    return next;
  });

  // A currency column beside prices: each row's price is in its own currency,
  // unless the name says which one (price_usd).
  const currencyCol = fields.find((f) => f.role === 'dimension' && /\bcurrency\b|\bccy\b/.test(words(f.name)) && f.stats.distinct >= 2);
  if (currencyCol) {
    for (const f of fields) {
      if (f.role === 'measure' && f.format === 'currency' && !/\b(usd|eur|gbp|inr|jpy|converted)\b/.test(words(f.name))) f.local = true;
    }
  }

  // A stock or balance is a level: its total across periods counts the same
  // units again every period.
  const hasTime = fields.some((f) => f.role === 'time');
  for (const f of fields) {
    if (hasTime && f.role === 'measure' && /\b(stock|inventory|on hand|balance|headcount|backlog|level|outstanding|open|cumulative|running|ytd|to date)\b/.test(words(f.name))) f.level = true;
  }

  // A column that never changes within one customer (their birth date, their
  // lifetime order count) describes the customer, not the row. Summed over an
  // order log it counts each customer once per order; as the time axis it
  // dates the customers, not the orders. Read from the rows: only where some
  // entity repeats across rows can this be seen at all.
  const repeated = fields
    .filter((f) => f.role === 'id' && f.stats.distinct >= 20 && f.stats.distinct < 0.7 * f.stats.filled)
    .sort((a, b) => a.stats.distinct - b.stats.distinct);
  for (const ent of repeated.slice(0, 2)) {
    for (const f of fields) {
      if (f === ent || f.overridden || f.attributeOf || !(f.role === 'time' || (f.role === 'measure' && !f.ordinal))) continue;
      if (constantWithin(rows, ent.name, f.name)) {
        f.attributeOf = ent.name;
        if (f.role === 'measure' && f.agg === 'sum') {
          f.agg = 'avg';
          f.why = `the same for every row of one ${singularWord(ent.label)}`;
        }
      }
    }
  }

  // Two splits that name the same groups (plan ↔ tier rank): keep the first.
  const dimsAll = fields.filter((f) => f.role === 'dimension' && f.stats.distinct >= 2 && f.stats.distinct <= 60);
  for (let i = 0; i < dimsAll.length; i++) {
    for (let j = i + 1; j < dimsAll.length; j++) {
      const a = dimsAll[i];
      const b = dimsAll[j];
      if (a.alias || b.alias || a.stats.distinct !== b.stats.distinct) continue;
      const map = new Map();
      let same = true;
      for (const r of rows.slice(0, 20000)) {
        const x = String(r?.[a.name] ?? '');
        const y = String(r?.[b.name] ?? '');
        if (map.has(x) && map.get(x) !== y) {
          same = false;
          break;
        }
        map.set(x, y);
      }
      if (same) b.alias = a.name;
    }
  }

  const long = detectLong(rows, fields);
  const survey = detectSurvey(fields);

  // The time axis: a date that belongs to the rows rather than to who they
  // are about, then the one most rows have, then the widest span.
  const times = fields.filter((f) => f.role === 'time');
  const time =
    times.sort((a, b) => !!a.attributeOf - !!b.attributeOf || b.stats.fill - a.stats.fill || (b.stats.spanDays || b.stats.distinct || 0) - (a.stats.spanDays || a.stats.distinct || 0))[0] || null;

  // The key: an id column, else a small combination of dimensions (+ time).
  const ids = fields.filter((f) => f.role === 'id' && f.stats.fill > 0.9);
  let key = null;
  const idKey = ids.find((f) => f.stats.distinct >= 0.98 * f.stats.filled);
  if (idKey) key = [idKey.name];
  const dims = fields
    .filter((f) => (f.role === 'dimension' && !f.outcome) || (f.role === 'id' && f.stats.distinct < 0.9 * f.stats.filled))
    .sort((a, b) => a.stats.distinct - b.stats.distinct);
  if (!key && rows.length > 1) {
    const candidates = [];
    for (const d of dims.slice(0, 6)) candidates.push([d.name]);
    if (time) {
      candidates.push([time.name]);
      for (const d of dims.slice(0, 4)) candidates.push([d.name, time.name]);
      if (long) for (const d of dims.filter((x) => x.name !== long.by).slice(0, 3)) candidates.push([d.name, time.name, long.by]);
    }
    for (let i = 0; i < Math.min(dims.length, 5); i++) for (let j = i + 1; j < Math.min(dims.length, 5); j++) candidates.push([dims[i].name, dims[j].name]);
    key = candidates.find((c) => isKey(rows, c)) || null;
  }

  // The entity a row belongs to in an event log — the customer of an order.
  const entityIds = fields.filter((f) => f.role === 'id' && (!key || !key.includes(f.name)) && f.stats.distinct < 0.9 * f.stats.filled && f.stats.distinct >= 5);

  const measures = fields.filter((f) => f.role === 'measure' && (!long || f.name === long.value || true));
  const additive = measures.filter((f) => f.agg === 'sum');
  // Yes/no columns are outcomes only when they are few or named as one; a
  // table with a dozen of them is a feature matrix (SSO: yes, SCIM: no).
  let outcomes = fields.filter((f) => f.outcome && f.role === 'dimension');
  // In a table of priced offers, yes/no columns are what the offer includes.
  const priced = fields.some((f) => f.role === 'measure' && f.format === 'currency' && f.agg === 'avg');
  if (priced && !time) outcomes = outcomes.filter((f) => /^how often/.test(f.why || '') || OUTCOME_NAME.test(words(f.name)) && !/\b(sso|scim|api|mcp)\b/.test(words(f.name)));
  const named = outcomes.filter((f) => OUTCOME_NAME.test(words(f.name)) || /^how often/.test(f.why || ''));
  if (named.length || outcomes.length > 2) outcomes = named;
  // Named outcomes first, later columns first (what happened comes after).
  outcomes = outcomes.sort((a, b) => OUTCOME_NAME.test(words(b.name)) - OUTCOME_NAME.test(words(a.name)) || columns.indexOf(b.name) - columns.indexOf(a.name));
  for (const f of fields) if (f.outcome && !outcomes.includes(f)) f.outcome = null;

  // What one row is.
  const keyNoun = key && key.length === 1 ? rowNoun(key[0]) : null;
  let shape;
  if (long) shape = 'long';
  else if (survey) shape = 'survey';
  else if (time && key && key.length === 2 && key.includes(time.name)) shape = 'panel';
  else if (time && key && key.length === 1 && key[0] === time.name) shape = 'series';
  else if (time && (additive.length || !key || entityIds.length || (time.stats.distinct || 0) < 0.8 * rows.length || fields.find((f) => f.name === key?.[0])?.role === 'id')) shape = 'events';
  else shape = 'entities';
  if (shape === 'events' && time && key && key[0] && fields.find((f) => f.name === key[0])?.role !== 'id' && !additive.length) shape = 'events';

  const noun =
    keyNoun && keyNoun.one !== 'record'
      ? keyNoun
      : shape === 'events' && time
        ? { one: 'event', many: 'events' }
        : shape === 'survey'
          ? { one: 'response', many: 'responses' }
          : shape === 'panel'
            ? { one: 'row', many: 'rows' }
            : { one: 'record', many: 'records' };

  return {
    name,
    rowCount: rows.length,
    fields,
    byName: Object.fromEntries(fields.map((f) => [f.name, f])),
    time: time ? time.name : null,
    key,
    entityIds: entityIds.map((f) => f.name),
    long,
    survey,
    outcomes: outcomes.map((f) => f.name),
    shape,
    noun,
  };
}
