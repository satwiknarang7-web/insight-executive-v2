/**
 * The measures a dashboard is built from: the business numbers, not the raw
 * columns. A senior analyst does not chart `SUM(unit_price)`; they chart
 * revenue, orders, revenue per order, the churn rate. This module turns a
 * reading of the table (fields.js) into that vocabulary, and holds the
 * reader's own measures beside it.
 *
 * A measure (see query.js) plus:
 *   label, format ('number'|'currency'|'percent'|'ratio'), scale, currency,
 *   polarity (1 higher is better, -1 lower is better, 0 neither),
 *   additive (can be split into parts that add up to the whole),
 *   importance (how central to the table, for ordering), origin
 */

import { labelOf, toNumber, words } from './fields.js';
import { lower } from './format.js';

const NEGATIVE = /\b(cost|costs|expense|expenses|spend|churn|churned|refund|refunds|return|returns|returned|defect|defects|error|errors|bug|bugs|complaint|complaints|delay|delays|late|latency|downtime|bounce|bounced|attrition|default|defaulted|risk|fraud|fraudulent|adverse|breach|breached|died|death|mortality|failure|failed|loss|losses|debt|tickets|incidents|resolution hours|wait|waiting|days on market|cancel|cancelled|canceled|unemployment|inflation|emissions|price|charge)\b/i;
const POSITIVE = /\b(revenue|sales|profit|margin|conversions?|converted|signups|users|sessions|retention|retained|satisfaction|csat|nps|score|rating|improved|recovered|success|won|wins|growth|income|units|orders|clicks|leads|deals|attendance|survived|points|gdp|population|life expectancy|intelligence)\b/i;

export function polarityOf(name) {
  const w = words(name);
  if (NEGATIVE.test(w)) return -1;
  if (POSITIVE.test(w)) return 1;
  return 0;
}

export function currencyOf(name) {
  const w = words(name);
  if (/\b(usd|dollars?)\b|\$/.test(w)) return '$';
  if (/\b(eur|euros?)\b|€/.test(w)) return '€';
  if (/\b(gbp|pounds?)\b|£/.test(w)) return '£';
  if (/\b(inr|rupees?)\b|₹/.test(w)) return '₹';
  if (/\b(jpy|yen)\b|¥/.test(w)) return '¥';
  return '';
}

const CAP = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A measure straight from one field. */
export function fieldMeasure(f, { agg = f.agg || 'sum' } = {}) {
  const label = agg === 'sum' || f.ordinal ? f.label : `${agg === 'median' ? 'Median' : 'Avg'} ${lower(f.label)}`;
  return {
    id: `${agg}:${f.name}`,
    label: agg === 'avg' && /^(avg|average|mean)\b/i.test(f.label) ? f.label : label,
    type: 'agg',
    field: f.name,
    agg,
    format: f.format,
    scale: f.scale,
    currency: f.format === 'currency' ? currencyOf(f.name) : '',
    polarity: polarityOf(f.name),
    additive: agg === 'sum',
    local: !!f.local,
    level: !!f.level,
    origin: 'field',
  };
}

const NOUNS = {
  churned: 'churn', converted: 'conversion', defaulted: 'default', survived: 'survival', retained: 'retention',
  improved: 'improvement', breached: 'breach', cancelled: 'cancellation', canceled: 'cancellation', returned: 'return',
  clicked: 'click', purchased: 'purchase', resigned: 'resignation', exited: 'exit', left: 'attrition', hired: 'hire',
  passed: 'pass', failed: 'failure', approved: 'approval', readmitted: 'readmission', escalated: 'escalation',
  renewed: 'renewal', upgraded: 'upgrade', bounced: 'bounce', unsubscribed: 'unsubscribe', delayed: 'delay', won: 'win',
};

/** "Churned" → "churn", "SLA breached" → "SLA breach", "Adverse event" stays. */
export function rateNoun(label) {
  return String(label)
    .split(' ')
    .map((t) => NOUNS[t.toLowerCase()] || t)
    .join(' ');
}

/** "units sold" → "unit", "orders" → "order", "Clicks" → "click". */
export function singular(label) {
  const w = lower(label).replace(/\s+(sold|shipped|received|made|placed|booked|delivered)$/, '');
  const parts = w.split(' ');
  const last = parts.pop();
  const one = /ies$/.test(last) ? `${last.slice(0, -3)}y` : /(ches|shes|xes)$/.test(last) ? last.slice(0, -2) : /[^s]s$/.test(last) ? last.slice(0, -1) : last;
  return [...parts, one].join(' ');
}

export function countMeasure(noun) {
  return {
    id: 'count',
    label: CAP(noun.many),
    type: 'count',
    format: 'number',
    scale: 1,
    currency: '',
    polarity: 0,
    additive: true,
    origin: 'rows',
  };
}

export function rateMeasure(f, positive) {
  const w = words(f.name);
  const isRate = /rate$/.test(w);
  // A status read for one problem level is named for that level: "Refund rate".
  const byLevel = /^how often/.test(f.why || '') && !/^(yes|true|y|1)$/i.test(String(positive));
  const base = byLevel ? labelOf(String(positive).toLowerCase()) : f.label.replace(/^(is|has)\s+/i, '');
  return {
    id: `rate:${f.name}`,
    label: isRate ? base : `${CAP(rateNoun(base))} rate`,
    type: 'rate',
    event: { field: f.name, value: positive },
    format: 'percent',
    scale: 1,
    currency: '',
    polarity: polarityOf(f.name) || polarityOf(positive),
    additive: false,
    origin: 'outcome',
  };
}

export function ratioMeasure(num, den, label, { polarity = 0, format = null } = {}) {
  return {
    id: `ratio:${num.id}/${den.id}`,
    label,
    type: 'ratio',
    num: { ...num },
    den: { ...den },
    format: format || (num.format === 'currency' ? 'currency' : 'number'),
    scale: 1,
    currency: num.currency || '',
    polarity,
    additive: false,
    origin: 'derived',
  };
}

/** Pearson r of two fields over rows where both are numbers (sampled). */
function corr(rows, a, b, limit = 5000) {
  let n = 0;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  const step = Math.max(1, Math.floor(rows.length / limit));
  for (let i = 0; i < rows.length; i += step) {
    const x = toNumber(rows[i]?.[a]);
    const y = toNumber(rows[i]?.[b]);
    if (x === null || y === null) continue;
    n++;
    sa += x;
    sb += y;
    saa += x * x;
    sbb += y * y;
    sab += x * y;
  }
  if (n < 8) return 0;
  const cov = sab / n - (sa / n) * (sb / n);
  const va = saa / n - (sa / n) ** 2;
  const vb = sbb / n - (sb / n) ** 2;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

/**
 * Does a ≈ b × c on nearly every row? Then a / b is a price-like figure (c)
 * and "a per b" is worth a measure of its own — revenue per unit.
 */
function productOf(rows, a, b, c) {
  let hit = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(rows.length / 2000));
  for (let i = 0; i < rows.length; i += step) {
    const x = toNumber(rows[i]?.[a]);
    const y = toNumber(rows[i]?.[b]);
    const z = toNumber(rows[i]?.[c]);
    if (x === null || y === null || z === null || !x) continue;
    n++;
    if (Math.abs(y * z - x) / Math.abs(x) < 0.35) hit++;
  }
  return n >= 10 && hit / n >= 0.8;
}

/**
 * Every measure the table supports, most important first.
 *
 * Importance: the money total a table is kept for, then the row count, then
 * an outcome's rate, then the ratios an analyst derives (per order, per unit,
 * conversion), then the other totals and averages in column order.
 */
export function buildMeasures(rows, ds, { custom = [] } = {}) {
  const out = [];
  const seen = new Set();
  const add = (m, importance) => {
    if (!m || seen.has(m.id)) return m;
    seen.add(m.id);
    out.push({ ...m, importance });
    return m;
  };

  const fields = ds.fields.filter((f) => f.role === 'measure' && f.stats.fill >= 0.05);
  const long = ds.long;
  const count = countMeasure(ds.noun);
  const isEntities = ds.shape === 'entities' || ds.shape === 'survey';

  // Outcome rates lead an outcome table.
  for (const [i, o] of ds.outcomes.entries()) {
    const f = ds.byName[o];
    if (f?.outcome) add(rateMeasure(f, f.outcome.positive), 100 - i * 5);
  }

  const money = fields.filter((f) => f.format === 'currency' && f.agg === 'sum' && !(long && f.name === long.value));
  const totals = fields.filter((f) => f.agg === 'sum' && !(long && f.name === long.value));
  const primary = money.sort((a, b) => b.stats.fill - a.stats.fill)[0] || null;

  if (primary && !isEntities) add(fieldMeasure(primary), 95);
  add(count, isEntities ? 60 : primary ? 90 : 92);

  // Distinct entities in an event log: customers behind the orders.
  for (const id of ds.entityIds.slice(0, 1)) {
    const f = ds.byName[id];
    const noun = f ? labelOf(id).replace(/\s*(id|key|code)$/i, '') : id;
    add(
      {
        id: `distinct:${id}`,
        label: `${CAP(noun.toLowerCase())}s`,
        type: 'distinct',
        field: id,
        format: 'number',
        scale: 1,
        currency: '',
        polarity: 1,
        additive: false,
        origin: 'distinct',
      },
      70
    );
  }

  // Per-row value of the main money total: revenue per order.
  if (primary && !isEntities && ds.shape === 'events') {
    add(ratioMeasure(fieldMeasure(primary), count, `${primary.label} per ${ds.noun.one}`, { polarity: 1 }), 80);
  }

  // A price hidden in two totals: revenue ≈ units × price → revenue per unit.
  for (const a of totals) {
    for (const b of totals) {
      if (a === b || a.format !== 'currency' || b.format === 'currency') continue;
      const c = fields.find((f) => f !== a && f !== b && productOf(rows, a.name, b.name, f.name));
      if (c) add(ratioMeasure(fieldMeasure(a), fieldMeasure(b), `${a.label} per ${singular(b.label)}`, { polarity: 0 }), 55);
    }
  }

  // A funnel: one count never above another → a conversion rate.
  const counts = totals.filter((f) => f.format !== 'currency' && f.stats.integer);
  for (const a of counts) {
    for (const b of counts) {
      if (a === b || corr(rows, a.name, b.name) < 0.3) continue;
      let ok = 0;
      let n = 0;
      const step = Math.max(1, Math.floor(rows.length / 3000));
      for (let i = 0; i < rows.length; i += step) {
        const x = toNumber(rows[i]?.[a.name]);
        const y = toNumber(rows[i]?.[b.name]);
        if (x === null || y === null) continue;
        n++;
        if (x <= y) ok++;
      }
      const sa = a.stats.mean;
      const sb = b.stats.mean;
      if (n >= 10 && ok === n && sa < sb * 0.9) {
        add(
          ratioMeasure(fieldMeasure(a), fieldMeasure(b), `${a.label} per ${singular(b.label)}`, {
            polarity: polarityOf(a.name) || 1,
            format: 'percent',
          }),
          75
        );
      }
    }
  }

  // Money over a count that is not a unit quantity: spend per conversion.
  if (money.length && ds.shape !== 'entities') {
    const spend = money.find((f) => /\b(spend|cost|budget)\b/.test(words(f.name)));
    const results = counts.filter((f) => /\b(conversions|orders|signups|leads|sales|deals|installs|clicks)\b/.test(words(f.name)));
    for (const r of results.slice(0, 2)) {
      if (spend) add(ratioMeasure(fieldMeasure(spend), fieldMeasure(r), `${spend.label} per ${singular(r.label)}`, { polarity: -1 }), 72);
    }
  }

  // Everything else from the columns.
  fields.forEach((f, i) => {
    if (long && f.name === long.value) return;
    // In a table of things, a total is still read per thing: average salary,
    // not the payroll; counts per customer are averaged too.
    const agg = isEntities && f.agg === 'sum' ? 'avg' : f.agg;
    add(fieldMeasure(f, { agg }), 50 - i * 0.5 + (f.stats.fill < 0.5 ? -30 : 0));
  });

  // The long table's value, per quantity.
  if (long) {
    const f = ds.byName[long.value];
    for (const [i, level] of long.levels.entries()) {
      add(
        {
          ...fieldMeasure(f, { agg: 'avg' }),
          id: `level:${level}`,
          label: String(level),
          where: [{ field: long.by, values: [level] }],
          format: /%|percent|rate/i.test(level) ? 'percent' : /\b(lcu|usd|\$|gdp|currency)\b/i.test(level) ? 'currency' : 'number',
          scale: /%|percent/i.test(level) ? 100 : 1,
          polarity: polarityOf(level),
          additive: false,
          local: /\blcu\b|local currency/i.test(level),
          origin: 'long',
          level,
        },
        88 - i
      );
    }
  }

  for (const m of custom) add({ ...m, origin: 'custom' }, m.importance ?? 99);

  return out.sort((a, b) => b.importance - a.importance);
}
