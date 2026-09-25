/**
 * Numbers as a reader expects them: 22.4M, $1,284, 13.2%, 4.1.
 * One formatter for tiles, axes, KPIs and sentences, so a figure reads the
 * same wherever it appears.
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function trim(s) {
  return s.includes('.') ? s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1') : s;
}

export function compact(v, { digits = 1 } = {}) {
  if (!isNum(v)) return '–';
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e12) return `${sign}${trim((a / 1e12).toFixed(digits))}T`;
  if (a >= 1e9) return `${sign}${trim((a / 1e9).toFixed(digits))}B`;
  if (a >= 1e6) return `${sign}${trim((a / 1e6).toFixed(digits))}M`;
  if (a >= 1e4) return `${sign}${trim((a / 1e3).toFixed(digits))}K`;
  if (a >= 1000) return `${sign}${Math.round(a).toLocaleString('en-US')}`;
  if (a >= 100) return `${sign}${Math.round(a)}`;
  if (a >= 10) return `${sign}${trim(a.toFixed(1))}`;
  if (a >= 1) return `${sign}${trim(a.toFixed(2))}`;
  if (a === 0) return '0';
  return `${sign}${trim(a.toPrecision(2))}`;
}

/** A value of a measure. `m` carries format, scale and currency. */
export function formatValue(v, m = {}, opts = {}) {
  if (!isNum(v)) return '–';
  if (m.format === 'percent') {
    const pct = v * (m.scale === 100 ? 1 : 100);
    const a = Math.abs(pct);
    return `${a >= 10 ? trim(pct.toFixed(opts.precise ? 1 : 0)) : trim(pct.toFixed(1))}%`;
  }
  const body = compact(v, opts);
  if (m.format === 'currency' && m.currency) return body.startsWith('−') ? `−${m.currency}${body.slice(1)}` : `${m.currency}${body}`;
  return body;
}

/** A change between two values, as a signed percent: "+12%", "−3.4%". */
export function formatChange(pct) {
  if (!isNum(pct)) return '–';
  const a = Math.abs(pct);
  const s = a >= 10 ? a.toFixed(0) : a.toFixed(1);
  return `${pct >= 0 ? '+' : '−'}${trim(s)}%`;
}

/** A difference in points between two percentages: "+4.2 pts". */
export function formatPoints(delta, m = {}) {
  const d = delta * (m.scale === 100 ? 1 : 100);
  return `${d >= 0 ? '+' : '−'}${trim(Math.abs(d).toFixed(1))} pts`;
}

/** A ratio between two values: "3.8×". */
export function formatTimes(x) {
  if (!isNum(x)) return '–';
  return `${trim(x >= 10 ? x.toFixed(0) : x.toFixed(1))}×`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A time bucket key (from query.bucketTime) as a short label. */
export function formatPeriod(key, grain) {
  const s = String(key);
  if (grain === 'month' && /^\d{4}-\d{2}$/.test(s)) return `${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
  if ((grain === 'day' || grain === 'week') && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
  }
  if (grain === 'quarter') return s.replace('-', ' ');
  return s;
}

/** Short tick label for a period on an axis. */
export function formatTick(key, grain) {
  const s = String(key);
  if (grain === 'month' && /^\d{4}-\d{2}$/.test(s)) return `${MONTHS[Number(s.slice(5, 7)) - 1]} '${s.slice(2, 4)}`;
  if ((grain === 'day' || grain === 'week') && /^\d{4}-\d{2}-\d{2}$/.test(s)) return `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]}`;
  if (grain === 'hour') return s.slice(5);
  if (grain === 'quarter') return s.replace(/^\d{2}(\d{2})-/, "'$1 ");
  return s;
}

/** English list: "a, b and c". */
export function list(items) {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs[0] || '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

export function lower(s) {
  const t = String(s || '');
  return /^[A-Z0-9]{2,}\b/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1);
}

export function plural(word) {
  const w = String(word);
  if (/s$/i.test(w)) return w;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  if (/(x|ch|sh)$/i.test(w)) return `${w}es`;
  return `${w}s`;
}
