/**
 * The functions a transform may call, made safe for real data.
 *
 * alasql ships UPPER, TRIM, SUBSTRING and YEAR, and every one of them throws
 * or lies on a null: `UPPER(null)` crashes the query, `YEAR(null)` answers
 * 1970, `CAST('1,234' AS FLOAT)` is NaN. A blank cell is the most ordinary
 * thing in a spreadsheet, so a transform layer built on those as they come
 * would fail on the first column with a gap in it — and fail the whole step,
 * because one thrown row is one thrown query.
 *
 * So each function here answers a blank with a blank. Registering them under
 * the standard names (where alasql's grammar permits — `LEFT` and `RIGHT` are
 * reserved for joins) means a person who knows SQL writes what they expect,
 * and it works on the data they actually have.
 *
 * The implementations are plain functions, exported so they can be tested
 * without a database and read without knowing alasql. `registerEngineFunctions`
 * wires them in; `pipeline.js` calls it once on import, so every query the
 * engine runs — transforms, charts, measures, the SQL console — sees the same
 * set.
 */

const blank = (v) => v === null || v === undefined || v === '';
const text = (v) => (blank(v) ? null : String(v));

/** A date from whatever the cleaner left: an ISO string, a Date, or nothing. */
export function toDate(v) {
  if (blank(v)) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') {
    // A year on its own is a year, not a millisecond count.
    if (v >= 1800 && v <= 2200 && Number.isInteger(v)) return new Date(Date.UTC(v, 0, 1));
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  const s = String(v).trim();
  if (!s) return null;
  // The cleaner writes ISO. Anything else is read the way `new Date` reads it,
  // anchored at UTC when it is a bare calendar date so the day does not drift.
  const bare = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (bare) {
    const d = new Date(Date.UTC(+bare[1], +bare[2] - 1, +bare[3]));
    return isNaN(d) ? null : d;
  }
  const d = new Date(s);
  if (isNaN(d)) return null;
  // "March 15, 2024" names a day, not an instant. `new Date` reads it in local
  // time, and turning that into ISO would move it a day for anyone east of
  // Greenwich — so the calendar reading is re-anchored at UTC, the way the
  // cleaner does for the same input.
  if (!/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s) && !s.includes('T')) {
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()));
  }
  return d;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n) => String(n).padStart(2, '0');

/**
 * A number from text people typed: `1,234.50`, `$12`, `(45)`, `12%`, `1 234`.
 *
 * Anything that is not a number once the dressing is removed is null, never
 * zero — a zero that was really "n/a" is the kind of value that makes a total
 * quietly wrong.
 */
export function toNumber(v) {
  if (blank(v)) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  let s = String(v).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[\s,$€£¥₹%]/g, '').replace(/^[A-Za-z]{1,3}(?=[-\d.])/, '');
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  if (!isFinite(n)) return null;
  return negative ? -n : n;
}

export const FUNCTIONS = {
  // ---- text --------------------------------------------------------------
  UPPER: (v) => (blank(v) ? null : String(v).toUpperCase()),
  LOWER: (v) => (blank(v) ? null : String(v).toLowerCase()),
  TRIM: (v) => (blank(v) ? null : String(v).trim()),
  /** Title case, the way a name or a city is written. */
  PROPER: (v) =>
    blank(v)
      ? null
      : String(v)
          .toLowerCase()
          .replace(/(^|[\s\-'(/])(\p{L})/gu, (m, before, letter) => before + letter.toUpperCase()),
  LEN: (v) => (blank(v) ? null : String(v).length),
  LENGTH: (v) => (blank(v) ? null : String(v).length),
  /** 1-based, like every SQL dialect; a length past the end just stops there. */
  SUBSTRING: (v, start, length) => {
    const s = text(v);
    if (s === null) return null;
    const from = Math.max(1, Number(start) || 1) - 1;
    if (length === undefined || length === null) return s.slice(from);
    return s.slice(from, from + Math.max(0, Number(length) || 0));
  },
  REPLACE: (v, find, replacement) => {
    const s = text(v);
    if (s === null) return null;
    const needle = String(find ?? '');
    if (!needle) return s;
    return s.split(needle).join(String(replacement ?? ''));
  },
  CONCAT: (...parts) => parts.map((p) => (blank(p) ? '' : String(p))).join(''),
  /** Join with a separator, skipping blanks — "City, " is not an address. */
  TEXT_JOIN: (sep, ...parts) =>
    parts.filter((p) => !blank(p)).map(String).join(String(sep ?? '')) || null,
  /** 1-based position of `find`, 0 when absent — the SQL convention. */
  INSTR: (v, find) => {
    const s = text(v);
    if (s === null) return null;
    return s.indexOf(String(find ?? '')) + 1;
  },
  /** The nth piece (1-based) after splitting on a separator. */
  SPLIT_PART: (v, sep, index) => {
    const s = text(v);
    if (s === null) return null;
    const parts = s.split(String(sep ?? ','));
    const i = (Number(index) || 1) - 1;
    const part = parts[i];
    return part === undefined ? null : part.trim();
  },
  /** Text before the first occurrence of a separator (the whole text if absent). */
  TEXT_BEFORE: (v, sep) => {
    const s = text(v);
    if (s === null) return null;
    const i = s.indexOf(String(sep ?? ''));
    return (i < 0 ? s : s.slice(0, i)).trim();
  },
  /** Text after the LAST occurrence of a separator (null if absent). */
  TEXT_AFTER: (v, sep) => {
    const s = text(v);
    if (s === null) return null;
    const needle = String(sep ?? '');
    const i = s.lastIndexOf(needle);
    return i < 0 ? null : s.slice(i + needle.length).trim();
  },
  CONTAINS: (v, find) => {
    const s = text(v);
    if (s === null) return false;
    return s.toLowerCase().includes(String(find ?? '').toLowerCase());
  },
  STARTS_WITH: (v, find) => {
    const s = text(v);
    if (s === null) return false;
    return s.toLowerCase().startsWith(String(find ?? '').toLowerCase());
  },
  ENDS_WITH: (v, find) => {
    const s = text(v);
    if (s === null) return false;
    return s.toLowerCase().endsWith(String(find ?? '').toLowerCase());
  },
  IS_BLANK: (v) => blank(v) || (typeof v === 'string' && !v.trim()),

  // ---- conversion --------------------------------------------------------
  TO_NUMBER: toNumber,
  TO_INTEGER: (v) => {
    const n = toNumber(v);
    return n === null ? null : Math.trunc(n);
  },
  TO_TEXT: (v) => (blank(v) ? null : v instanceof Date ? v.toISOString() : String(v)),
  /** An ISO timestamp, which is how the cleaner stores every date. */
  TO_DATE: (v) => {
    const d = toDate(v);
    return d ? d.toISOString() : null;
  },
  IIF: (cond, a, b) => (cond ? a : b),
  NULLIF: (a, b) => (a === b ? null : a),
  COALESCE: (...parts) => {
    for (const p of parts) if (!blank(p)) return p;
    return null;
  },

  // ---- numbers -----------------------------------------------------------
  ROUND: (v, places) => {
    const n = toNumber(v);
    if (n === null) return null;
    const f = 10 ** Math.max(0, Number(places) || 0);
    return Math.round(n * f) / f;
  },
  FLOOR: (v) => {
    const n = toNumber(v);
    return n === null ? null : Math.floor(n);
  },
  CEIL: (v) => {
    const n = toNumber(v);
    return n === null ? null : Math.ceil(n);
  },
  CEILING: (v) => {
    const n = toNumber(v);
    return n === null ? null : Math.ceil(n);
  },
  ABS: (v) => {
    const n = toNumber(v);
    return n === null ? null : Math.abs(n);
  },
  SQRT: (v) => {
    const n = toNumber(v);
    return n === null || n < 0 ? null : Math.sqrt(n);
  },
  POWER: (v, p) => {
    const n = toNumber(v);
    const e = toNumber(p);
    if (n === null || e === null) return null;
    const r = n ** e;
    return isFinite(r) ? r : null;
  },
  LOG: (v) => {
    const n = toNumber(v);
    return n === null || n <= 0 ? null : Math.log(n);
  },
  LOG10: (v) => {
    const n = toNumber(v);
    return n === null || n <= 0 ? null : Math.log10(n);
  },
  /** Division that answers a zero or blank denominator with null, not Infinity. */
  SAFE_DIVIDE: (a, b) => {
    const n = toNumber(a);
    const d = toNumber(b);
    if (n === null || d === null || d === 0) return null;
    return n / d;
  },
  GREATEST: (...parts) => {
    const nums = parts.map(toNumber).filter((n) => n !== null);
    return nums.length ? Math.max(...nums) : null;
  },
  LEAST: (...parts) => {
    const nums = parts.map(toNumber).filter((n) => n !== null);
    return nums.length ? Math.min(...nums) : null;
  },

  // ---- dates -------------------------------------------------------------
  YEAR: (v) => toDate(v)?.getUTCFullYear() ?? null,
  MONTH: (v) => {
    const d = toDate(v);
    return d ? d.getUTCMonth() + 1 : null;
  },
  DAY: (v) => toDate(v)?.getUTCDate() ?? null,
  QUARTER: (v) => {
    const d = toDate(v);
    return d ? Math.floor(d.getUTCMonth() / 3) + 1 : null;
  },
  /** 1 = Sunday … 7 = Saturday, as every SQL dialect counts it. */
  DAYOFWEEK: (v) => {
    const d = toDate(v);
    return d ? d.getUTCDay() + 1 : null;
  },
  WEEKDAY_NAME: (v) => {
    const d = toDate(v);
    return d ? DAYS[d.getUTCDay()] : null;
  },
  MONTH_NAME: (v) => {
    const d = toDate(v);
    return d ? MONTHS[d.getUTCMonth()] : null;
  },
  /** `2024-03` — sorts correctly and reads as a month. */
  YEAR_MONTH: (v) => {
    const d = toDate(v);
    return d ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` : null;
  },
  /** `2024-Q1`. */
  YEAR_QUARTER: (v) => {
    const d = toDate(v);
    return d ? `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}` : null;
  },
  /** `2024-03-15` — the calendar day, time dropped. */
  DATE_ONLY: (v) => {
    const d = toDate(v);
    return d ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` : null;
  },
  HOUR: (v) => toDate(v)?.getUTCHours() ?? null,
  /** Whole days from `a` to `b` (positive when b is later). */
  DAYS_BETWEEN: (a, b) => {
    const from = toDate(a);
    const to = toDate(b);
    if (!from || !to) return null;
    return Math.round((to - from) / 86_400_000);
  },
  /** Whole months from `a` to `b`, by calendar month. */
  MONTHS_BETWEEN: (a, b) => {
    const from = toDate(a);
    const to = toDate(b);
    if (!from || !to) return null;
    return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  },
  ADD_DAYS: (v, n) => {
    const d = toDate(v);
    const days = toNumber(n);
    if (!d || days === null) return null;
    return new Date(d.getTime() + days * 86_400_000).toISOString();
  },
  TODAY: () => new Date().toISOString().slice(0, 10),
};

/** Names alasql implements inline, which its parser resolves before `fn`. */
const STANDARD = new Set([
  'UPPER', 'LOWER', 'TRIM', 'LEN', 'LENGTH', 'SUBSTRING', 'REPLACE', 'CONCAT', 'INSTR',
  'COALESCE', 'NULLIF', 'IIF', 'ROUND', 'FLOOR', 'CEIL', 'CEILING', 'ABS', 'SQRT', 'POWER',
  'LOG', 'LOG10', 'GREATEST', 'LEAST', 'YEAR', 'MONTH', 'DAY', 'DAYOFWEEK', 'HOUR',
]);

/**
 * The functions a formula may call, by name. Read by the expression validator,
 * so a formula cannot name a function the engine does not have — and the two
 * lists cannot drift, because there is one.
 */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

let registered = null;

/**
 * Install the functions on an alasql instance. Idempotent.
 *
 * alasql resolves a name in two places: `stdfn` for the ones it ships, then
 * `fn` for user functions. Ours go in both, so the null-safe version wins
 * whichever path the compiled query takes.
 */
export function registerEngineFunctions(alasql) {
  if (!alasql || registered === alasql) return;
  alasql.fn = alasql.fn || {};
  alasql.stdfn = alasql.stdfn || {};
  for (const [name, impl] of Object.entries(FUNCTIONS)) {
    alasql.fn[name] = impl;
    if (STANDARD.has(name)) alasql.stdfn[name] = impl;
  }
  registered = alasql;
}
