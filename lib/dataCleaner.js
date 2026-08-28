/**
 * Data sanitisation: PII redaction, type coercion, null handling and outlier
 * flagging.
 *
 * Split into a per-chunk pass (`sanitizeChunk`) and a finalisation pass
 * (`finalizeMetrics`) so a large CSV can be cleaned incrementally as it streams
 * in, instead of materialising the raw array and the cleaned array at once.
 *
 * Hot-path note: the per-cell regexes are guarded by cheap character checks.
 * Running three global regexes twice (test + replace) over every cell of a
 * 200k-row file was one of the biggest costs in the old ingestion path; most
 * cells cannot possibly contain an email or a phone number, and skipping them
 * outright is roughly an order of magnitude faster.
 */

export const cleanFloatingPoints = (text) => {
  if (!text) return text;
  // Trim runaway precision (3+ decimal places) in generated prose.
  return text.replace(/\d+\.\d{3,}/g, (match) => parseFloat(match).toFixed(2));
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
/**
 * A phone number, and only a phone number.
 *
 * The previous pattern had no boundaries, so any ten-digit run matched wherever
 * it appeared — including inside an identifier. On a real export whose order
 * keys are `ORD0000000001`, every one of 250,000 rows was rewritten to
 * `ORD[REDACTED_PHONE]`: one distinct value where there had been a quarter of a
 * million, which silently turned every count of orders into 1 and every
 * per-order figure into the total. Redaction is the one transformation that
 * cannot be undone by looking again, so it has to be the most conservative
 * thing in this file.
 *
 * Three rules now. The run may not be glued to a letter or digit on either
 * side, so digits inside `ORD0000000001` or the first ten of a thirteen-digit
 * key are left alone. A country code counts as one only when it carries a `+`
 * or a separator, so a long numeric id cannot be read as one. And the leading
 * boundary is captured rather than consumed, so it survives the replacement.
 */
const PHONE_RE =
  /(^|[^A-Za-z0-9])((?:\+\d{1,3}[-.\s]?|\d{1,3}[-.\s])?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})(?![A-Za-z0-9])/g;
const SENSITIVE_ID_RE = /\b(?:\d{3}-\d{2}-\d{4}|\d{4}-\d{4}-\d{4}-\d{4})\b/g;

const NULL_TOKENS = new Set(['', 'null', 'undefined', 'n/a', 'na', '-', '--', 'none', 'nan', 'nil']);

/**
 * The digit part of a number, in either of the two groupings a spreadsheet
 * exports. Spelled out as alternatives rather than a loose `[0-9,.]*` so that
 * genuinely malformed values — `1,2,3`, `1.234.567` — are still refused instead
 * of reaching parseFloat, which would answer with a plausible wrong number.
 *
 * The dot-grouped form requires its decimal comma: without one, `1.234` is
 * indistinguishable from an ordinary decimal, and reading it as 1234 would be
 * the same hundredfold error this all exists to prevent. So it stays text, as
 * it always has.
 */
const NUM_BODY =
  '(?:' +
  '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?' + // 1,234        1,234.56    (comma-grouped)
  '|\\d{1,3}(?:\\.\\d{3})+,\\d+' + //     1.234,56                 (dot-grouped)
  '|\\d+(?:[.,]\\d+)?' + //               42   3.14   900,50
  '|\\.\\d+' + //                         .5
  ')';

const NUMERIC_RE = new RegExp(`^[\\$€£¥]?\\s?[\\-+]?${NUM_BODY}([eE][\\-+]?[0-9]+)?%?$`);
const ACCOUNTING_RE = new RegExp(`^\\([\\$€£¥]?${NUM_BODY}\\)$`);
// Only strings actually shaped like a date are handed to the Date constructor.
const DATE_SHAPE_RE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/;

const DIGIT_RE = /\d/;

export function createMetrics(columnNames, totalRows = 0) {
  const columnStats = {};
  for (const col of columnNames) {
    columnStats[col] = {
      type: 'unknown',
      nullCount: 0,
      distinctCount: 0,
      piiCount: 0,
      // Set while streaming when a number-shaped value carries a comma, so the
      // finalisation pass knows which columns still need one decided for them.
      commaNumbers: false,
      commaConvention: null,
    };
  }
  return {
    totalRows,
    droppedRows: 0,
    anomalies: 0,
    redactedPII: 0,
    nullsFound: 0,
    typesCoerced: 0,
    outliersCount: 0,
    totalAnomalies: 0,
    totalCells: totalRows * columnNames.length,
    // Columns read as decimal-comma, and columns whose commas contradicted each
    // other and were therefore left as text. Both are reported on /quality.
    decimalCommaColumns: [],
    ambiguousCommaColumns: [],
    columnStats,
  };
}

function redact(val, metrics, key) {
  let out = val;
  let hit = false;

  if (out.indexOf('@') !== -1) {
    const next = out.replace(EMAIL_RE, '[REDACTED_EMAIL]');
    if (next !== out) {
      out = next;
      hit = true;
    }
  }
  if (DIGIT_RE.test(out)) {
    let next = out.replace(SENSITIVE_ID_RE, '[REDACTED_ID]');
    if (next !== out) {
      out = next;
      hit = true;
    }
    next = out.replace(PHONE_RE, '$1[REDACTED_PHONE]');
    if (next !== out) {
      out = next;
      hit = true;
    }
  }

  if (hit) {
    metrics.redactedPII++;
    metrics.columnStats[key].piiCount++;
  }
  return out;
}

/**
 * Clean one batch of parsed rows in place-ish, appending results to `out`.
 * Mutates `metrics`. Safe to call repeatedly as chunks stream in.
 */
export function sanitizeChunk(rows, columnNames, metrics, out) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cleanedRow = {};
    let nonNull = 0;

    for (let c = 0; c < columnNames.length; c++) {
      const key = columnNames[c];
      let val = row[key];

      if (typeof val === 'string') {
        if (val.length > 0) val = redact(val, metrics, key);

        const trimmed = val.trim();
        if (NULL_TOKENS.has(trimmed.toLowerCase())) {
          val = null;
          metrics.nullsFound++;
        } else if (NUMERIC_RE.test(trimmed) || ACCOUNTING_RE.test(trimmed)) {
          if (trimmed.includes(',')) {
            // A comma cannot be read one cell at a time. "900,50" is ninety
            // thousand and fifty in en-US and nine hundred and a half in de-DE,
            // and nothing in this cell says which. Left as text and decided for
            // the whole column in resolveCommaNumbers, once every value is in
            // view. Guessing here was a silent hundredfold error.
            val = trimmed;
            metrics.columnStats[key].commaNumbers = true;
          } else if (looksLikeIdentifier(trimmed)) {
            // Zip codes, zero-padded codes and long digit strings are
            // identifiers, not measures. Coercing them to Number drops leading
            // zeros and, past 15 digits, silently loses precision — so a stable
            // key would stop matching across tables. Keep them as text.
            val = trimmed;
          } else {
            val = parseNumber(trimmed);
            if (val === null) metrics.nullsFound++;
            else metrics.typesCoerced++;
          }
        } else if (DATE_SHAPE_RE.test(trimmed)) {
          const iso = parseDateISO(trimmed) || parseDateTimeISO(trimmed);
          if (iso) {
            val = iso;
            metrics.typesCoerced++;
          } else {
            val = trimmed;
          }
        } else {
          val = trimmed;
        }
      } else if (val === null || val === undefined) {
        val = null;
        metrics.nullsFound++;
      }

      if (val === null) metrics.columnStats[key].nullCount++;
      else nonNull++;

      cleanedRow[key] = val;
    }

    // A row of nothing but blanks carries no information.
    if (nonNull === 0) {
      metrics.droppedRows++;
      continue;
    }
    out.push(cleanedRow);
  }
  return out;
}

/**
 * What one value's commas prove about the convention its column is written in.
 *
 * Returns 'thousands', 'decimal', or null when the value is genuinely
 * ambiguous. Only positional facts count as evidence — never a guess:
 *
 *   1,234.56   a dot after a comma is the decimal point, so commas group
 *   1.234,56   a dot before a comma is the group separator, so the comma is the point
 *   1,234,567  two commas can only be grouping
 *   900,50     a group separator is always followed by exactly three digits
 *   1,234      one comma, three digits: 1234 in en-US, 1.234 in de-DE. Unknowable.
 */
export function commaEvidence(value) {
  // Currency, signs, percent and brackets carry no information about grouping.
  const core = String(value ?? '').replace(/[^\d.,]/g, '');
  if (!core.includes(',')) return null;

  if (/,[\d,]*\./.test(core)) return 'thousands';
  if (/\.[\d.]*,/.test(core)) return 'decimal';
  if ((core.match(/,/g) || []).length > 1) return 'thousands';
  return /,\d{3}$/.test(core) ? null : 'decimal';
}

/**
 * Decide one column's convention from every comma-bearing value in it.
 *
 * 'mixed' means the column contradicts itself — some values prove grouping and
 * others prove a decimal point — and there is no reading that makes all of them
 * true. Those stay text rather than half of them being wrong.
 *
 * With no evidence either way the answer is 'thousands', which is both the
 * commoner export format and the behaviour every existing file already got.
 */
export function commaConvention(values) {
  let thousands = false;
  let decimal = false;

  for (const value of values) {
    const evidence = commaEvidence(value);
    if (evidence === 'thousands') thousands = true;
    else if (evidence === 'decimal') decimal = true;
    if (thousands && decimal) return 'mixed';
  }

  return decimal ? 'decimal' : 'thousands';
}

/**
 * Turn the deferred comma numbers into numbers, one column at a time.
 *
 * This is the second half of the fix that `sanitizeChunk` starts. The streaming
 * pass cannot see a whole column, so it leaves every comma-bearing value as
 * text; here the column is complete and the convention can be established from
 * the values themselves rather than assumed.
 *
 * Runs before type inference, because the whole point is that these cells are
 * numbers by the time their column's type is decided.
 */
export function resolveCommaNumbers(rows, columnNames, metrics) {
  for (const col of columnNames) {
    const stat = metrics.columnStats[col];
    if (!stat?.commaNumbers) continue;

    const pending = [];
    for (let i = 0; i < rows.length; i++) {
      const value = rows[i][col];
      if (typeof value !== 'string' || !value.includes(',')) continue;
      if (NUMERIC_RE.test(value) || ACCOUNTING_RE.test(value)) pending.push(i);
    }
    if (pending.length === 0) continue;

    const convention = commaConvention(pending.map((i) => rows[i][col]));
    stat.commaConvention = convention;

    if (convention === 'mixed') {
      metrics.ambiguousCommaColumns.push(col);
      continue;
    }
    if (convention === 'decimal') metrics.decimalCommaColumns.push(col);

    for (const i of pending) {
      const raw = rows[i][col];
      if (looksLikeIdentifier(raw, convention)) continue;
      const num = parseNumber(raw, convention);
      if (num === null) continue;
      rows[i][col] = num;
      metrics.typesCoerced++;
    }
  }
}

/**
 * Infer column types, count distinct values and flag statistical outliers
 * (|z| > 2.5). Runs once, after every chunk has been cleaned.
 */
export function finalizeMetrics(cleanedData, columnNames, metrics) {
  const n = cleanedData.length;

  // Before anything is typed: a column of "900,50" is a column of numbers or a
  // column of text, and which one it is has to be settled first.
  resolveCommaNumbers(cleanedData, columnNames, metrics);

  for (const col of columnNames) {
    const stat = metrics.columnStats[col];
    let numCount = 0;
    let strCount = 0;
    let otherCount = 0;
    // Cap the distinct-value set so a unique-per-row column cannot balloon memory.
    const distinct = new Set();
    let distinctCapped = false;

    for (let i = 0; i < n; i++) {
      const v = cleanedData[i][col];
      if (v === null || v === undefined) continue;
      const t = typeof v;
      if (t === 'number') numCount++;
      else if (t === 'string') strCount++;
      else otherCount++;
      if (distinct.size < 10000) distinct.add(v);
      else distinctCapped = true;
    }

    // Dominant-type inference, not "any string makes it mixed". A measure with a
    // few stray text cells (a rogue "N/A", a "pending") was previously demoted
    // to 'mixed' and dropped from numeric analysis, so its outliers went
    // unflagged and downstream it read as a category. A 90% threshold — matching
    // the one `describeSchema` reports to the LLM — keeps the two views agreeing.
    const typed = numCount + strCount + otherCount;
    if (typed === 0) stat.type = 'unknown';
    else if (otherCount === typed) stat.type = 'object';
    else if (numCount / typed >= 0.9) stat.type = 'number';
    else if (strCount / typed >= 0.9) stat.type = 'string';
    else if (numCount > 0 && strCount > 0) stat.type = 'mixed';
    else if (numCount > 0) stat.type = 'number';
    else stat.type = 'string';
    stat.numericShare = typed ? numCount / typed : 0;

    stat.distinctCount = distinct.size;
    stat.distinctCapped = distinctCapped;
  }

  // Outlier flagging on genuinely numeric columns.
  metrics.outliersCount = 0;
  for (const col of columnNames) {
    if (metrics.columnStats[col].type !== 'number') continue;

    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const v = cleanedData[i][col];
      if (typeof v === 'number') {
        sum += v;
        count++;
      }
    }
    if (count <= 5) continue;

    const mean = sum / count;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const v = cleanedData[i][col];
      if (typeof v === 'number') sq += (v - mean) * (v - mean);
    }
    const stdDev = Math.sqrt(sq / count);
    if (stdDev <= 0) continue;

    const hi = mean + 2.5 * stdDev;
    const lo = mean - 2.5 * stdDev;
    for (let i = 0; i < n; i++) {
      const v = cleanedData[i][col];
      if (typeof v === 'number' && (v > hi || v < lo)) {
        cleanedData[i].isAnomaly = true;
        metrics.outliersCount++;
      }
    }
  }

  // Integrity: only missing values and outliers count against the score.
  // Type coercion (string -> number) is normal ETL, not an integrity failure.
  metrics.totalAnomalies = metrics.nullsFound + metrics.outliersCount;
  metrics.anomalies = metrics.typesCoerced;
  metrics.cleanRows = n;
  return metrics;
}

/**
 * One-shot convenience wrapper (used by tests and any non-streaming caller).
 */
export function sanitizeDataset(rawDataArray, onProgress = () => {}) {
  if (!Array.isArray(rawDataArray) || rawDataArray.length === 0) {
    return { cleanedData: [], metrics: createMetrics([], 0) };
  }
  const columnNames = Object.keys(rawDataArray[0]);
  const metrics = createMetrics(columnNames, rawDataArray.length);
  const cleanedData = [];

  const BATCH = 2000;
  for (let i = 0; i < rawDataArray.length; i += BATCH) {
    sanitizeChunk(rawDataArray.slice(i, i + BATCH), columnNames, metrics, cleanedData);
    onProgress({ stage: 'Sanitizing & redacting', rowsProcessed: Math.min(i + BATCH, rawDataArray.length), totalRows: rawDataArray.length });
  }

  finalizeMetrics(cleanedData, columnNames, metrics);
  return { cleanedData, metrics };
}

/**
 * Parse one number-shaped string.
 *
 * `convention` says what a comma means in this value's column, and is only
 * consulted for values that actually contain one — a plain `3.14` is read the
 * same way in either, so a column decided to be decimal-comma cannot turn an
 * ordinary decimal into three hundred and fourteen.
 */
function parseNumber(str, convention = 'thousands') {
  const resolved = str.includes(',')
    ? convention === 'decimal'
      // The dot is the group separator here, so it goes; the first comma is the
      // decimal point. Any further comma would have made this 'thousands'.
      ? str.replace(/\./g, '').replace(',', '.')
      : str.replace(/,/g, '')
    : str;

  let cleaned = resolved.replace(/[^\d.eE\-+()]/g, '');
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = '-' + cleaned.slice(1, -1);
  }
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return str.includes('%') ? num / 100 : num;
}

/**
 * A number-shaped string that should stay text, because turning it into a
 * Number would corrupt it: a leading zero on a multi-digit value (a zip code, a
 * zero-padded SKU) is lost, and any integer longer than 15 digits (an account
 * or card-shaped number) exceeds the exact range of a double. Values with a
 * decimal point, exponent or percent are always genuine measures — and in a
 * column written decimal-comma, the comma is that decimal point, so `0,5` is
 * half rather than a zero-padded code.
 */
function looksLikeIdentifier(s, convention = 'thousands') {
  if (/[.eE%]/.test(s)) return false;
  if (convention === 'decimal' && s.includes(',')) return false;
  const digits = s.replace(/[^\d]/g, '');
  if (!digits) return false;
  return /^0\d/.test(digits) || digits.length > 15;
}

/**
 * Parse a date-only string to a stable ISO instant, timezone-independent.
 *
 * `new Date()` parses ISO dates as UTC but slash-dates as LOCAL, so the old path
 * produced an instant whose calendar day drifted by one for anyone east of UTC,
 * and left month/day order entirely to the engine. This reads the components
 * itself, disambiguates day-from-month where a value makes it unambiguous
 * (defaulting to US month-first otherwise), and anchors at UTC midnight so the
 * date on screen is the date in the file, wherever the browser runs.
 */
function parseDateISO(s) {
  let m;
  let y;
  let mo;
  let da;
  if ((m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s))) {
    y = +m[1];
    mo = +m[2];
    da = +m[3];
  } else if ((m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(s))) {
    const a = +m[1];
    const b = +m[2];
    y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    // a>12 forces day-first (D/M); b>12 forces month-first (M/D); otherwise
    // assume month-first, matching the engine's prior behaviour.
    if (a > 12 && b <= 12) {
      da = a;
      mo = b;
    } else {
      mo = a;
      da = b;
    }
  } else {
    return null;
  }

  const d = new Date(Date.UTC(y, mo - 1, da));
  // Reject values that rolled over (month 13, day 32, ...).
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) return null;
  return d.toISOString();
}

/**
 * Fallback for strings that carry a time component. These keep an explicit
 * instant, so `new Date()` is used as-is; date-only strings never reach here.
 */
function parseDateTimeISO(s) {
  if (!/[T ]\d{1,2}:\d{2}/.test(s)) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * A readable, typed schema description for the LLM: type, analytical role,
 * cardinality and a couple of real sample values per column.
 */
export function describeSchema(rows, tableName = 'SalesData') {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]).filter((h) => h !== 'isAnomaly');
  const idLike = /(^id$|_id$|key|code|guid|uuid|index|^row$|sr|sno|serial)/i;
  const sampleSize = Math.min(rows.length, 5000);

  const lines = headers.map((h) => {
    const distinct = new Set();
    const samples = [];
    let numeric = 0;
    let seen = 0;
    for (let i = 0; i < sampleSize; i++) {
      const v = rows[i][h];
      if (v === null || v === undefined || v === '') continue;
      seen++;
      if (typeof v === 'number') numeric++;
      if (distinct.size < 1000) distinct.add(v);
      if (samples.length < 3) samples.push(v);
    }
    const isNumeric = seen > 0 && numeric / seen > 0.9;
    const type = isNumeric ? 'DECIMAL' : 'VARCHAR';
    const role = isNumeric
      ? idLike.test(h)
        ? 'identifier'
        : 'measure'
      : distinct.size <= 20
        ? 'category'
        : 'high-cardinality category';
    return `- ${h} (${type}, ${role}, ${distinct.size}${distinct.size >= 1000 ? '+' : ''} distinct) — e.g. ${samples.join(', ')}`;
  });

  return `Table: ${tableName}\nColumns:\n${lines.join('\n')}`;
}

/**
 * Blank the stray non-numeric cells in columns that are measures.
 *
 * A measure is a column that is *essentially* numeric — a handful of "unknown"
 * cells among 200,000 heights does not make height a category. But those few
 * cells are not harmless: alasql's AVG returns no row at all when it meets one,
 * so a single stray string silently empties every average taken over the
 * column, in a KPI card and in a generated chart alike. SUM and MIN quietly
 * skip it, which is worse — the same dirty column then reports some aggregates
 * and not others, with nothing to say why.
 *
 * They are nulled rather than guessed at: the cell said "unknown", and null is
 * what this pipeline already means by that. Mutates `rows` in place, since the
 * point is that every later reader sees the cleaned value.
 *
 * @returns {number} how many cells were blanked
 */
export function nullifyStrayValues(rows, measures) {
  if (!Array.isArray(rows) || !Array.isArray(measures) || measures.length === 0) return 0;

  let cleared = 0;
  for (const row of rows) {
    if (!row) continue;
    for (const col of measures) {
      const value = row[col];
      if (value === null || value === undefined) continue;
      if (typeof value === 'number' && isFinite(value)) continue;
      row[col] = null;
      cleared++;
    }
  }
  return cleared;
}
