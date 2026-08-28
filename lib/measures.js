/**
 * Measures — named calculations, written in plain English.
 *
 * Power BI has DAX for this: you write `Profit Margin := DIVIDE(SUM(Sales) -
 * SUM(Cost), SUM(Sales))` once, and from then on it is a thing you can drop on
 * a card or a chart. The value of that is not the formula language — it is that
 * the calculation stops being retyped and starts being *named*.
 *
 * So this module keeps the naming and throws the language away. A measure here
 * is created by typing what you want ("profit as a percentage of revenue") and
 * is stored as a small, validated SQL aggregate expression that the same engine
 * behind every chart and KPI card already runs. Two paths produce that
 * expression:
 *
 *   1. `parseMeasurePhrase` — a deterministic English parser: no network, no
 *      API key. It handles the shapes people actually type — totals, averages,
 *      counts, differences, ratios, percentages, and a trailing `where` filter.
 *   2. The model, via /api/measure, for anything the parser does not recognise.
 *
 * Whichever produced it, the expression goes through `compileMeasure` before it
 * is allowed near the engine. That check is the important part of this file: an
 * unvalidated expression from either source is a string the user did not write
 * being executed against their data.
 */
import { formatNumber } from './format.js';

/** The table every query in the app runs against (the joined analysis view). */
const TABLE = 'SalesData';

/** Aggregates a measure can be built from. Anything else collapses rows wrong. */
const AGGREGATES = new Set(['SUM', 'AVG', 'COUNT', 'MIN', 'MAX']);

/** Scalar helpers allowed inside — or around — an aggregate. */
const SCALARS = new Set([
  'ABS', 'ROUND', 'FLOOR', 'CEIL', 'CEILING', 'SQRT', 'COALESCE', 'IFNULL', 'GREATEST', 'LEAST',
]);

/** Bare words that are structure rather than a function call. */
const KEYWORDS = new Set([
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN',
  'LIKE', 'DISTINCT', 'BETWEEN', 'TRUE', 'FALSE',
]);

/** Anything that would make this more than one read-only expression. */
const FORBIDDEN =
  /\b(select|from|insert|update|delete|drop|alter|create|attach|truncate|merge|replace|union|join|into|exec|pragma)\b/i;

export const MEASURE_FORMATS = [
  { key: 'number', label: 'Number' },
  { key: 'currency', label: 'Currency' },
  { key: 'percent', label: 'Percent' },
];

// ---------------------------------------------------------------------------
// Tokenising
// ---------------------------------------------------------------------------

/**
 * Split an expression into tokens.
 *
 * Bracketed identifiers come first in the alternation so a column called
 * "Order Date" or "Customers.Region" stays one token instead of becoming a
 * word, a space and a word — those columns are routine once sheets are joined.
 *
 * Returns null when a character is reached that no rule matches, which is how a
 * stray semicolon or backtick is caught before the validator even runs.
 */
export function tokenize(expr) {
  const re = /\s*(\[[^\]]*\]|'(?:[^']|'')*'|\d+(?:\.\d+)?|>=|<=|<>|!=|[-+*/%(),<>=]|[A-Za-z_][A-Za-z0-9_]*)/y;
  const source = String(expr ?? '');
  const tokens = [];
  let pos = 0;

  while (pos < source.length) {
    re.lastIndex = pos;
    const m = re.exec(source);
    if (!m) {
      // Trailing whitespace is not a failure; a real character is.
      if (!source.slice(pos).trim()) break;
      return null;
    }
    const raw = m[1];
    pos = re.lastIndex;
    if (raw.startsWith('[')) tokens.push({ kind: 'column', value: raw.slice(1, -1) });
    else if (raw.startsWith("'")) tokens.push({ kind: 'string', value: raw });
    else if (/^\d/.test(raw)) tokens.push({ kind: 'number', value: raw });
    else if (/^[A-Za-z_]/.test(raw)) tokens.push({ kind: 'word', value: raw });
    else tokens.push({ kind: 'op', value: raw });
  }
  return tokens;
}

/** Case- and punctuation-insensitive key for comparing names people typed. */
const normalize = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Resolve a written column name to the real one, tolerating case and spacing. */
export function resolveColumn(name, columns = []) {
  const target = normalize(name);
  if (!target) return null;
  return columns.find((c) => normalize(c) === target) || null;
}

/** Resolve a written name to a stored measure, with the same tolerance. */
export function resolveMeasure(name, measures = []) {
  const target = normalize(name);
  if (!target) return null;
  return measures.find((m) => normalize(m.name) === target) || null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Check one expression, in one of two dialects.
 *
 * `measure` — an aggregate expression. Every column reference must sit inside
 *   an aggregate, because a measure is a single number over whatever rows are
 *   in scope: `[Revenue] / SUM([Revenue])` is not a smaller version of that, it
 *   is a mistake alasql will quietly answer with the first row's value.
 *
 * `filter` — a row predicate for the WHERE clause. The rule inverts: columns
 *   are bare, and aggregates are refused, because a row filter cannot depend on
 *   an aggregate of the rows it is choosing.
 *
 * Returns { ok, error, columns, measures } — the two lists being what the
 * expression actually referenced, which the caller uses to expand references
 * and to show a measure's dependencies.
 */
export function validateExpression(expr, { columns = [], measures = [], mode = 'measure' } = {}) {
  const text = String(expr ?? '').trim();
  if (!text) return { ok: false, error: 'The formula is empty.' };
  if (text.includes(';')) return { ok: false, error: 'A measure is one expression — no semicolons.' };
  if (text.includes('--') || text.includes('/*')) return { ok: false, error: 'Comments are not allowed in a formula.' };
  if (FORBIDDEN.test(text)) {
    return { ok: false, error: 'A measure is a calculation, not a query — no SELECT, FROM or JOIN.' };
  }

  const tokens = tokenize(text);
  if (!tokens) return { ok: false, error: 'The formula contains a character that is not allowed.' };
  if (!tokens.length) return { ok: false, error: 'The formula is empty.' };

  const usedColumns = [];
  const usedMeasures = [];
  let depth = 0; // parenthesis depth
  let aggregateDepth = 0; // > 0 while inside an aggregate call
  const aggregateEnds = []; // the depth each open aggregate closes at
  let aggregateCount = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];

    if (t.kind === 'column') {
      const measure = resolveMeasure(t.value, measures);
      if (measure) {
        // A reference to another measure. It expands to an aggregate of its
        // own, so it satisfies the "inside an aggregate" rule by itself — and
        // must not be nested inside one, which would aggregate an aggregate.
        if (aggregateDepth > 0) {
          return { ok: false, error: `[${measure.name}] is already a measure — it cannot go inside SUM, AVG or COUNT.` };
        }
        usedMeasures.push(measure.name);
        aggregateCount++;
        continue;
      }
      const column = resolveColumn(t.value, columns);
      if (!column) return { ok: false, error: `There is no column or measure called "${t.value}".` };
      if (mode === 'measure' && aggregateDepth === 0) {
        return {
          ok: false,
          error: `[${column}] needs an aggregate around it — try SUM([${column}]) or AVG([${column}]).`,
        };
      }
      usedColumns.push(column);
      continue;
    }

    if (t.kind === 'word') {
      const upper = t.value.toUpperCase();
      const isCall = next && next.kind === 'op' && next.value === '(';

      if (AGGREGATES.has(upper)) {
        if (!isCall) return { ok: false, error: `${upper} has to be called with a column: ${upper}([Column]).` };
        if (mode === 'filter') return { ok: false, error: 'A filter picks rows, so it cannot use SUM, AVG or COUNT.' };
        if (aggregateDepth > 0) return { ok: false, error: 'One aggregate cannot contain another.' };
        aggregateDepth++;
        aggregateEnds.push(depth);
        aggregateCount++;
        continue;
      }
      if (SCALARS.has(upper)) {
        if (!isCall) return { ok: false, error: `${upper} has to be called with a value: ${upper}(...).` };
        continue;
      }
      if (KEYWORDS.has(upper)) continue;

      // A bare word is almost always an unbracketed column name, and saying so
      // is more useful than "unsupported token".
      const guess = resolveColumn(t.value, columns);
      if (guess) return { ok: false, error: `Write column names in brackets: [${guess}].` };
      return { ok: false, error: `"${t.value}" is not a column or a function this formula understands.` };
    }

    if (t.kind === 'op') {
      if (t.value === '(') depth++;
      else if (t.value === ')') {
        depth--;
        if (depth < 0) return { ok: false, error: 'There is a closing bracket with nothing to close.' };
        if (aggregateDepth > 0 && aggregateEnds[aggregateEnds.length - 1] === depth) {
          aggregateEnds.pop();
          aggregateDepth--;
        }
      }
    }
  }

  if (depth !== 0) return { ok: false, error: 'The brackets in the formula do not close.' };
  if (mode === 'measure' && aggregateCount === 0) {
    return { ok: false, error: 'A measure has to aggregate something — SUM, AVG, COUNT, MIN or MAX.' };
  }

  return { ok: true, error: null, columns: [...new Set(usedColumns)], measures: [...new Set(usedMeasures)] };
}

// ---------------------------------------------------------------------------
// Reference expansion
// ---------------------------------------------------------------------------

/**
 * Replace `[Other Measure]` with the expression it stands for.
 *
 * This is what lets measures be built out of measures — "Profit" defined once,
 * then "Profit Margin" written in terms of it — without the engine needing to
 * know measures exist at all. Each substitution is parenthesised so a measure
 * defined as `A - B` cannot change the meaning of a formula that divides by it,
 * and the recursion is depth-limited so two measures that refer to each other
 * report a cycle instead of hanging the tab.
 */
export function expandReferences(expr, measures = [], seen = [], depth = 0) {
  if (depth > 10) throw new Error('These measures refer to each other in a circle.');
  const tokens = tokenize(expr);
  if (!tokens) return String(expr ?? '');

  const parts = [];
  for (const t of tokens) {
    if (t.kind === 'column') {
      const measure = resolveMeasure(t.value, measures);
      if (measure) {
        if (seen.includes(measure.name)) throw new Error(`[${measure.name}] refers back to itself.`);
        parts.push(`(${expandReferences(measure.expr, measures, [...seen, measure.name], depth + 1)})`);
      } else {
        parts.push(`[${t.value}]`);
      }
      continue;
    }
    parts.push(t.value);
  }
  return joinTokens(parts);
}

/**
 * Re-emit tokens as readable SQL.
 *
 * Spacing is cosmetic to alasql but not to the person reading the formula the
 * app generated for them — `SUM ( [Revenue] )` looks like machine output,
 * `SUM([Revenue])` looks like something they could have written.
 */
const OPERATOR = /^(?:[-+*/%(,]|<=?|>=?|=|<>|!=)$/;

function joinTokens(parts) {
  let out = '';
  for (const part of parts) {
    if (!out) {
      out = part;
      continue;
    }
    const prev = out.slice(-1);
    const tight =
      part === ')' || part === ',' || // nothing precedes a closer or a comma
      prev === '(' || // nothing follows an opener
      (part === '(' && !OPERATOR.test(previousToken(out))); // a call's bracket hugs its name
    out += tight ? part : ` ${part}`;
  }
  return out;
}

/** The last token already emitted, used only to tell a call bracket from a group. */
function previousToken(out) {
  const m = out.match(/(\]|\)|[A-Za-z0-9_]+|[-+*/%(,]|<=|>=|<>|!=|[<>=])\s*$/);
  return m ? m[1] : '';
}

// ---------------------------------------------------------------------------
// Compiling
// ---------------------------------------------------------------------------

/**
 * Turn a stored measure into something runnable, or explain why it is not.
 *
 * Everything that executes a measure goes through here first — the preview in
 * the builder, the KPI card, the chart. There is deliberately no second path.
 */
export function compileMeasure(measure, { columns = [], measures = [] } = {}) {
  if (!measure || !measure.expr) return { ok: false, error: 'This measure has no formula.' };

  // A measure must not see itself in the list it may reference.
  const others = measures.filter((m) => m.id !== measure.id);

  const checked = validateExpression(measure.expr, { columns, measures: others, mode: 'measure' });
  if (!checked.ok) return checked;

  if (measure.filter) {
    const filter = validateExpression(measure.filter, { columns, measures: [], mode: 'filter' });
    if (!filter.ok) return { ok: false, error: `Filter: ${filter.error}` };
  }

  try {
    return {
      ok: true,
      error: null,
      // Expansion sees every measure, including this one, so that a pair that
      // refer to each other in a circle is caught here rather than emitted as
      // SQL naming a column that does not exist.
      expr: expandReferences(measure.expr, measures, measure.name ? [measure.name] : []),
      filter: measure.filter ? expandReferences(measure.filter, []) : null,
      dependsOn: checked.measures,
      columns: checked.columns,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const alias = (name) => String(name || 'Value').replace(/[[\]]/g, '').trim() || 'Value';

/** The single-value query behind a measure — the number on a KPI card. */
export function measureSql(measure, context = {}) {
  const compiled = compileMeasure(measure, context);
  if (!compiled.ok) return { sql: null, error: compiled.error };
  const where = compiled.filter ? ` WHERE ${compiled.filter}` : '';
  return { sql: `SELECT ${compiled.expr} AS [Value] FROM ${TABLE}${where}`, error: null };
}

/**
 * The same measure, broken out by a dimension — a measure on a chart.
 *
 * The measure's own filter becomes the WHERE clause, which is what makes a
 * filtered measure ("revenue where region is West") behave the way people
 * expect when they group by something else as well: the filter narrows the
 * rows, the GROUP BY splits what is left.
 */
export function measureByDimensionSql(
  measure,
  { dimension, limit = 10, direction = 'DESC' } = {},
  context = {}
) {
  const compiled = compileMeasure(measure, context);
  if (!compiled.ok) return { sql: null, error: compiled.error };
  if (!dimension) return { sql: null, error: 'Choose a column to break the measure out by.' };

  const column = resolveColumn(dimension, context.columns || []) || dimension;
  const label = alias(measure.name);
  const where = compiled.filter ? ` WHERE ${compiled.filter}` : '';
  const order = direction === 'ASC' ? 'ASC' : 'DESC';

  return {
    sql:
      `SELECT [${column}], ${compiled.expr} AS [${label}] FROM ${TABLE}${where} ` +
      `GROUP BY [${column}] ORDER BY [${label}] ${order} LIMIT ${Number(limit) || 10}`,
    error: null,
    xAxisKey: column,
    yAxisKey: label,
  };
}

// ---------------------------------------------------------------------------
// Reading and formatting the result
// ---------------------------------------------------------------------------

/**
 * Pull the single number out of a result set.
 *
 * A ratio whose denominator filtered down to nothing comes back as Infinity or
 * NaN; a card reading "NaN" is worse than a card that says it has no value, so
 * those are refused here rather than formatted.
 */
export function readMeasureValue(rows) {
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row !== 'object') return null;
  const raw = row.Value !== undefined ? row.Value : Object.values(row)[0];
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!isFinite(n)) return null;
  return n;
}

/** Render a measure's value the way its format says to. */
export function formatMeasureValue(value, format = 'number') {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!isFinite(n)) return '—';
  if (format === 'percent') {
    // A rate of 0.0207% is not zero, and rounding it to "0.0%" says it is —
    // which reads as a broken measure rather than a small number, and sends
    // someone looking for a bug in the query. Small magnitudes keep enough
    // digits to be distinguishable from nothing.
    const abs = Math.abs(n);
    if (n !== 0 && abs < 0.1) return `${n.toPrecision(2)}%`;
    return `${n.toFixed(1)}%`;
  }
  if (format === 'currency') return `$${formatNumber(n)}`;
  return String(formatNumber(n));
}
