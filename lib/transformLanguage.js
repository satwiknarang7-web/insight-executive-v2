/**
 * The English side of a transform step.
 *
 * "Split city on the comma into City and State" has to become a step object
 * before anything can plan it. A model does that well, but this app works with
 * no API key at all, and a shaping layer that only worked with a provider would
 * be the first feature that did not. So this is a small, honest parser for the
 * shapes people actually type — the same bargain `measureLanguage.js` makes:
 *
 *   rename revenue to net sales
 *   drop the customer id column
 *   keep only region, revenue and units
 *   add margin = [revenue] - [cost]
 *   keep rows where region is West and units > 0
 *   remove rows where status is Cancelled
 *   extract the month from order date          → a year-month column
 *   split city on "," into City and State
 *   combine first name and last name into Full name with " "
 *   trim / uppercase / lowercase / proper case the name column
 *   replace "N/A" with blank in region
 *   fill blanks in units with 0
 *   remove duplicates by order id
 *   sort by revenue descending
 *   keep the top 100 rows by revenue
 *   read units as a number
 *   band age at 18, 30, 50, 65 as age band
 *   group by region: total revenue, average units, number of orders
 *   remove blank rows
 *   add a row number
 *
 * Anything it does not recognise returns `{ ok: false }` with the reason, and
 * the caller falls through to the model. It never guesses: a phrase naming a
 * column that is not in the data is an error, not a silent substitution.
 */
import { matchColumn, parseFilter } from './measureLanguage.js';
import { resolveColumn } from './measures.js';
import {
  BLANKS,
  BUCKET,
  DATEPART,
  DATE_PARTS,
  DEDUPE,
  DERIVE,
  DROP,
  FILL,
  FILTER,
  GROUP,
  INDEX,
  KEEP,
  LIMIT,
  MERGE,
  RENAME,
  REPLACE,
  RETYPE,
  SORT,
  SPLIT,
  TEXT,
  validateTransform,
} from './transforms.js';

const clean = (s) => String(s ?? '').trim().replace(/[.?!]+$/, '').trim();
const unquote = (s) => String(s ?? '').trim().replace(/^["'“”‘’]|["'“”‘’]$/g, '');
const stripArticles = (s) =>
  String(s ?? '')
    .replace(/\b(?:the|a|an|my|our|this|that|column|columns|field|fields)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** "a, b and c" → ['a', 'b', 'c'] */
const listOf = (s) =>
  String(s ?? '')
    .split(/\s*,\s*|\s+and\s+|\s*&\s*/i)
    .map(unquote)
    .map((x) => x.trim())
    .filter(Boolean);

/** Words people use for a separator, and what they mean. */
const SEPARATOR_WORDS = {
  comma: ',',
  commas: ',',
  space: ' ',
  spaces: ' ',
  dash: '-',
  hyphen: '-',
  slash: '/',
  pipe: '|',
  semicolon: ';',
  colon: ':',
  underscore: '_',
  dot: '.',
  period: '.',
  tab: '\t',
};

function separatorFrom(text) {
  // Quoted, the separator is exactly what is inside the quotes — " / " keeps
  // its spaces, because that is what they were typed for.
  const quoted = String(text ?? '').trim().match(/^["'“”‘’](.*)["'“”‘’]$/);
  if (quoted) return quoted[1].length >= 1 && quoted[1].length <= 5 ? quoted[1] : null;
  const raw = String(text ?? '').trim();
  const word = raw.toLowerCase().replace(/^(?:the|a)\s+/, '');
  if (SEPARATOR_WORDS[word] !== undefined) return SEPARATOR_WORDS[word];
  if (raw.length >= 1 && raw.length <= 5) return raw;
  return null;
}

const DATE_PART_WORDS = [
  { re: /\byear[\s-]?(?:and[\s-])?month\b|\bmonth[\s-]?(?:and[\s-])?year\b|\byyyy-?mm\b/i, part: 'year_month' },
  { re: /\byear[\s-]?(?:and[\s-])?quarter\b|\bquarter[\s-]?(?:and[\s-])?year\b/i, part: 'year_quarter' },
  { re: /\bmonth[\s-]?names?\b|\bname of (?:the )?month\b/i, part: 'month_name' },
  { re: /\bday of (?:the )?week\b|\bweekday\b|\bday[\s-]?names?\b/i, part: 'weekday' },
  { re: /\bday of (?:the )?month\b|\bday\b/i, part: 'day' },
  { re: /\bhour\b/i, part: 'hour' },
  { re: /\bquarter\b/i, part: 'quarter' },
  { re: /\bmonth\b/i, part: 'month' },
  { re: /\byear\b/i, part: 'year' },
  { re: /\bdate\b/i, part: 'date' },
];

const TEXT_WORDS = [
  { re: /\b(?:trim|strip)\b/i, op: 'trim' },
  { re: /\b(?:upper[\s-]?case|uppercase|capitali[sz]e all|all caps)\b/i, op: 'upper' },
  { re: /\b(?:lower[\s-]?case|lowercase)\b/i, op: 'lower' },
  { re: /\b(?:proper[\s-]?case|title[\s-]?case|capitali[sz]e)\b/i, op: 'proper' },
];

const TYPE_WORDS = [
  { re: /\b(?:whole number|integer|int)\b/i, to: 'integer' },
  { re: /\b(?:number|numeric|decimal|float|amount)\b/i, to: 'number' },
  { re: /\b(?:date|datetime|timestamp)\b/i, to: 'date' },
  { re: /\b(?:text|string|words?)\b/i, to: 'text' },
];

const GROUP_WORDS = [
  { re: /^(?:count of distinct|distinct count of|number of distinct|number of unique|unique|distinct)\s+(.+)$/i, fn: 'COUNT_DISTINCT' },
  { re: /^(?:number of|count of|count|how many)\s+(.+)$/i, fn: 'COUNT' },
  { re: /^(?:average|avg|mean)\s+(?:of\s+)?(.+)$/i, fn: 'AVG' },
  { re: /^(?:median)\s+(?:of\s+)?(.+)$/i, fn: 'MEDIAN' },
  { re: /^(?:max|maximum|highest|largest)\s+(?:of\s+)?(.+)$/i, fn: 'MAX' },
  { re: /^(?:min|minimum|lowest|smallest)\s+(?:of\s+)?(.+)$/i, fn: 'MIN' },
  { re: /^(?:total|sum of|sum|overall)\s+(?:of\s+)?(.+)$/i, fn: 'SUM' },
  { re: /^(?:first)\s+(?:of\s+)?(.+)$/i, fn: 'FIRST' },
];
const ROW_WORDS = /^(?:rows?|records?|orders?|entries|items?|transactions?|lines?)$/i;

/** Title-case a column name the way this app names derived ones. */
const titled = (s) =>
  String(s || '')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * A row condition, in the measure parser's grammar plus the one thing a
 * measure filter never needs: "is blank" and "is not blank".
 */
function filterExpr(text, ctx) {
  const pieces = String(text).split(/\s+(and|or)\s+/i);
  let out = '';
  for (let i = 0; i < pieces.length; i += 2) {
    const piece = pieces[i].trim();
    const blank = piece.match(/^(.+?)\s+(?:is|are)\s+(not\s+)?(?:blank|empty|missing|null)$/i);
    let expr;
    if (blank) {
      const c = column(blank[1], ctx);
      if (c.error) return c;
      expr = `${blank[2] ? 'NOT ' : ''}IS_BLANK([${c.column}])`;
    } else {
      const parsed = parseFilter(piece, ctx);
      if (parsed.error) return parsed;
      expr = parsed.expr;
    }
    out += (i === 0 ? '' : ` ${pieces[i - 1].toUpperCase()} `) + expr;
  }
  return { expr: out };
}

/**
 * Find a column in a fragment, or explain which words did not match.
 */
function column(text, ctx) {
  const fragment = stripArticles(unquote(text));
  const exact = resolveColumn(fragment, ctx.columns);
  if (exact) return { column: exact };
  const found = matchColumn(fragment, ctx.columns);
  if (found) return { column: found };
  return { error: `I could not find a column matching "${fragment}".` };
}

// ---------------------------------------------------------------------------
// The rules, each a regex and a builder. First match wins, so the specific
// shapes ("keep rows where") come before the general ones ("keep").
// ---------------------------------------------------------------------------

const RULES = [
  // rename X to Y / call X Y
  {
    re: /^(?:rename|call)\s+(.+?)\s+(?:to|as)\s+(.+)$/i,
    build: (m, ctx) => {
      const from = column(m[1], ctx);
      if (from.error) return from;
      return { kind: RENAME, column: from.column, to: unquote(m[2]) };
    },
  },
  // add a row number [called X]
  {
    re: /^(?:add|insert|create)\s+(?:a\s+|an\s+)?(?:row\s+)?(?:number|index|numbering)(?:\s+column)?(?:\s+(?:called|named|as)\s+(.+))?$/i,
    build: (m) => ({ kind: INDEX, name: unquote(m[1] || 'Row') }),
  },
  // remove blank rows / remove rows where X is blank
  {
    re: /^(?:remove|drop|delete)\s+(?:the\s+)?(?:blank|empty)\s+rows$/i,
    build: () => ({ kind: BLANKS, columns: [] }),
  },
  {
    re: /^(?:remove|drop|delete)\s+rows?\s+(?:where|with|whose|if)\s+(.+?)\s+(?:is|are)\s+(?:blank|empty|missing|null)$/i,
    build: (m, ctx) => {
      const cols = [];
      for (const part of listOf(m[1])) {
        const c = column(part, ctx);
        if (c.error) return c;
        cols.push(c.column);
      }
      return { kind: BLANKS, columns: cols };
    },
  },
  // remove duplicates [by X, Y]
  {
    re: /^(?:remove|drop|delete|de-?dupe|dedup(?:licate)?)\s+(?:the\s+)?duplicate(?:s|d rows| rows)?(?:\s+(?:by|on|using|based on)\s+(.+))?$/i,
    build: (m, ctx) => {
      const cols = [];
      for (const part of listOf(m[1] || '')) {
        const c = column(part, ctx);
        if (c.error) return c;
        cols.push(c.column);
      }
      return { kind: DEDUPE, columns: cols };
    },
  },
  // keep rows where … / only rows where … / filter to …
  {
    re: /^(?:keep|only keep|filter(?:\s+to)?|show only|show|only)\s+(?:only\s+)?(?:the\s+)?rows?\s+(?:where|with|whose|if|when)\s+(.+)$/i,
    build: (m, ctx) => {
      const f = filterExpr(m[1], ctx);
      if (f.error) return f;
      return { kind: FILTER, mode: 'keep', expr: f.expr };
    },
  },
  {
    re: /^(?:remove|drop|delete|exclude)\s+(?:the\s+)?rows?\s+(?:where|with|whose|if|when)\s+(.+)$/i,
    build: (m, ctx) => {
      const f = filterExpr(m[1], ctx);
      if (f.error) return f;
      return { kind: FILTER, mode: 'remove', expr: f.expr };
    },
  },
  // keep the top N rows [by X]
  {
    re: /^(?:keep|take|show)\s+(?:only\s+)?(?:the\s+)?(?:top|first|highest|largest)\s+(\d+)(?:\s+rows?)?(?:\s+(?:by|on)\s+(.+))?$/i,
    build: (m, ctx) => {
      const op = { kind: LIMIT, count: Number(m[1]) };
      if (m[2]) {
        const c = column(m[2], ctx);
        if (c.error) return c;
        op.by = c.column;
        op.direction = 'desc';
      }
      return op;
    },
  },
  {
    re: /^(?:keep|take|show)\s+(?:only\s+)?(?:the\s+)?(?:bottom|lowest|smallest)\s+(\d+)(?:\s+rows?)?\s+(?:by|on)\s+(.+)$/i,
    build: (m, ctx) => {
      const c = column(m[2], ctx);
      if (c.error) return c;
      return { kind: LIMIT, count: Number(m[1]), by: c.column, direction: 'asc' };
    },
  },
  // sort by X [descending][, Y ascending]
  {
    re: /^(?:sort|order)(?:\s+(?:the\s+)?rows)?\s+by\s+(.+)$/i,
    build: (m, ctx) => {
      const by = [];
      for (const part of listOf(m[1])) {
        const desc = /\b(?:desc(?:ending)?|highest first|largest first|high to low|z to a)\b/i.test(part);
        const text = part.replace(/\b(?:desc(?:ending)?|asc(?:ending)?|highest first|largest first|lowest first|high to low|low to high|a to z|z to a)\b/gi, '').trim();
        const c = column(text, ctx);
        if (c.error) return c;
        by.push({ column: c.column, direction: desc ? 'desc' : 'asc' });
      }
      return { kind: SORT, by };
    },
  },
  // group by X, Y: total revenue, average units
  {
    re: /^(?:group|summari[sz]e|roll up|aggregate)(?:\s+(?:the\s+)?rows)?\s+by\s+(.+?)\s*(?::|;|-|—|with|showing|and calculate|and compute|,\s*(?=(?:total|sum|average|avg|mean|count|number of|max|min|median|first|distinct|unique)))\s*(.+)$/i,
    build: (m, ctx) => {
      const by = [];
      for (const part of listOf(m[1])) {
        const c = column(part, ctx);
        if (c.error) return c;
        by.push(c.column);
      }
      const aggregates = [];
      for (const part of listOf(m[2])) {
        let matched = null;
        for (const rule of GROUP_WORDS) {
          const hit = part.match(rule.re);
          if (hit) {
            matched = { fn: rule.fn, rest: hit[1] };
            break;
          }
        }
        if (!matched) return { error: `I could not tell what "${part}" should calculate. Try "total revenue" or "number of orders".` };
        if (matched.fn === 'COUNT' && ROW_WORDS.test(stripArticles(matched.rest))) {
          aggregates.push({ fn: 'COUNT', name: titled(`Number of ${matched.rest}`) });
          continue;
        }
        const c = column(matched.rest, ctx);
        if (c.error) return c;
        const fn = matched.fn === 'COUNT' ? 'COUNT_DISTINCT' : matched.fn;
        const label = { SUM: 'Total', AVG: 'Average', MIN: 'Min', MAX: 'Max', MEDIAN: 'Median', FIRST: 'First', COUNT_DISTINCT: 'Distinct' }[fn];
        aggregates.push({ fn, column: c.column, name: titled(`${label} ${c.column}`) });
      }
      return { kind: GROUP, by, aggregates };
    },
  },
  // extract the month from order date [as X] / add the year and month of order date
  {
    // "from" splits first; failing that, the LAST "of" does, so "day of the
    // week of order date" reads as a part and a column rather than two halves.
    re: /^(?:extract|pull|take|get|add)\s+(?:the\s+)?(?:(.+?)\s+(?:from|out of)\s+(.+?)|(.+)\s+of\s+(.+?))(?:\s+(?:as|called|named|into)\s+(.+))?$/i,
    build: (raw, ctx) => {
      const m = [raw[0], raw[1] ?? raw[3], raw[2] ?? raw[4], raw[5]];
      const partText = m[1];
      const hit = DATE_PART_WORDS.find((d) => d.re.test(partText));
      if (!hit) return { error: `"${partText}" is not a part of a date I know — try year, quarter, month, day or weekday.` };
      const c = column(m[2], ctx);
      if (c.error) return c;
      const name = m[3] ? unquote(m[3]) : `${titled(c.column)} ${DATE_PARTS[hit.part].suffix}`;
      return { kind: DATEPART, name, column: c.column, part: hit.part };
    },
  },
  // split X on "," into A and B
  {
    re: /^split\s+(.+?)\s+(?:on|at|by|using)\s+(.+?)\s+into\s+(.+)$/i,
    build: (m, ctx) => {
      const c = column(m[1], ctx);
      if (c.error) return c;
      const separator = separatorFrom(m[2]);
      if (separator === null) return { error: `I could not read "${m[2]}" as something to split on.` };
      const into = listOf(m[3]);
      if (into.length < 2) return { error: 'Name at least two columns to split into.' };
      return { kind: SPLIT, column: c.column, separator, into };
    },
  },
  // combine X and Y into Z [with " "]
  {
    re: /^(?:combine|merge|join|concatenate)\s+(.+?)\s+into\s+(.+?)(?:\s+(?:with|using|separated by)\s+(.+))?$/i,
    build: (m, ctx) => {
      const cols = [];
      for (const part of listOf(m[1])) {
        const c = column(part, ctx);
        if (c.error) return c;
        cols.push(c.column);
      }
      if (cols.length < 2) return { error: 'Name at least two columns to combine.' };
      const separator = m[3] ? separatorFrom(m[3]) ?? unquote(m[3]) : ' ';
      return { kind: MERGE, name: unquote(m[2]), columns: cols, separator };
    },
  },
  // replace "x" with "y" in Z
  {
    re: /^replace\s+(.+?)\s+with\s+(.+?)\s+(?:in|inside|within|across)\s+(.+)$/i,
    build: (m, ctx) => {
      const c = column(m[3], ctx);
      if (c.error) return c;
      const inside = /\b(?:inside|within)\b/i.test(m[0]);
      const replacement = /^(?:blank|empty|nothing|null)$/i.test(unquote(m[2])) ? '' : unquote(m[2]);
      return { kind: REPLACE, column: c.column, find: unquote(m[1]), replacement, mode: inside ? 'text' : 'value' };
    },
  },
  // fill blanks in X with Y
  {
    re: /^(?:fill|replace)\s+(?:the\s+)?(?:blanks?|empties|empty cells|missing values?|nulls?)\s+in\s+(.+?)\s+with\s+(.+)$/i,
    build: (m, ctx) => {
      const c = column(m[1], ctx);
      if (c.error) return c;
      return { kind: FILL, column: c.column, value: unquote(m[2]) };
    },
  },
  // trim / uppercase / lowercase / proper case X
  {
    re: /^(trim|strip|upper[\s-]?case|uppercase|lower[\s-]?case|lowercase|proper[\s-]?case|title[\s-]?case|capitali[sz]e(?: all)?|all caps)\s+(?:the\s+)?(?:spaces?\s+(?:in|from|around)\s+)?(.+)$/i,
    build: (m, ctx) => {
      const hit = TEXT_WORDS.find((t) => t.re.test(m[1]));
      const c = column(m[2], ctx);
      if (c.error) return c;
      return { kind: TEXT, column: c.column, op: hit.op };
    },
  },
  {
    re: /^(?:make|convert|change|turn)\s+(.+?)\s+(?:to\s+|into\s+)?(upper[\s-]?case|uppercase|lower[\s-]?case|lowercase|proper[\s-]?case|title[\s-]?case)$/i,
    build: (m, ctx) => {
      const hit = TEXT_WORDS.find((t) => t.re.test(m[2]));
      const c = column(m[1], ctx);
      if (c.error) return c;
      return { kind: TEXT, column: c.column, op: hit.op };
    },
  },
  // band X at 18, 30, 50 [as Y]
  {
    re: /^(?:band|bucket|bin|group)\s+(.+?)\s+(?:at|into bands at|by|with boundaries(?: at)?)\s+([\d.,\s-]+?)(?:\s+(?:as|called|named|into)\s+(.+))?$/i,
    build: (m, ctx) => {
      const c = column(m[1], ctx);
      if (c.error) return c;
      const edges = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
      if (!edges.length || edges.some((e) => !isFinite(e))) return { error: 'The boundaries have to be numbers.' };
      return { kind: BUCKET, name: m[3] ? unquote(m[3]) : `${titled(c.column)} Band`, column: c.column, edges };
    },
  },
  // read/treat/convert X as a number / date / text
  {
    re: /^(?:read|treat|convert|change|cast|parse|make)\s+(.+?)\s+(?:as|to|into)\s+(?:a\s+|an\s+)?(.+?)(?:\s+column)?$/i,
    build: (m, ctx) => {
      const hit = TYPE_WORDS.find((t) => t.re.test(m[2]));
      if (!hit) return { error: `I do not know how to read a column as "${m[2]}" — try number, whole number, date or text.` };
      const c = column(m[1], ctx);
      if (c.error) return c;
      return { kind: RETYPE, column: c.column, to: hit.to };
    },
  },
  // add X = [a] / [b]   (a formula, written as a formula)
  {
    re: /^(?:add|create|make|derive|compute|calculate|new column)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:column\s+)?(?:called\s+|named\s+)?(.+?)\s*(?:=|:=|as|equal to|equals)\s*(.+)$/i,
    build: (m, ctx) => {
      let expr = m[2].trim();
      // A formula mentions its columns in brackets. Written bare
      // ("revenue - discount"), exact column names are bracketed for it,
      // longest first so "unit_price" is not read as "unit".
      if (!/\[[^\]]+\]/.test(expr)) {
        const bare = expr;
        const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        for (const c of [...ctx.columns].sort((a, b) => b.length - a.length)) {
          expr = expr.replace(new RegExp(`(^|[^\\w\\[])${esc(c)}(?![\\w\\]])`, 'gi'), `$1[${c}]`);
        }
        // Only arithmetic may be left around the columns; prose stays prose.
        if (!/^[\d\s.+\-*/()%]*$/.test(expr.replace(/\[[^\]]+\]/g, ''))) expr = bare;
      }
      if (!/\[[^\]]+\]/.test(expr)) return { error: 'Write the formula with column names in brackets, like [revenue] / [units].' };
      return { kind: DERIVE, name: unquote(m[1]), expr };
    },
  },
  // keep only X, Y, Z
  {
    re: /^(?:keep|select|show)\s+(?:only\s+)?(?:the\s+)?(?:columns?\s+)?(.+?)(?:\s+columns?)?$/i,
    build: (m, ctx) => {
      const cols = [];
      for (const part of listOf(m[1])) {
        const c = column(part, ctx);
        if (c.error) return c;
        cols.push(c.column);
      }
      return { kind: KEEP, columns: cols };
    },
  },
  // drop / remove / delete X [, Y]
  {
    re: /^(?:drop|remove|delete|get rid of|hide)\s+(?:the\s+)?(?:columns?\s+)?(.+?)(?:\s+columns?)?$/i,
    build: (m, ctx) => {
      const parts = listOf(m[1]);
      const cols = [];
      for (const part of parts) {
        const c = column(part, ctx);
        if (c.error) return c;
        cols.push(c.column);
      }
      if (cols.length === 1) return { kind: DROP, column: cols[0] };
      return { many: cols.map((col) => ({ kind: DROP, column: col })) };
    },
  },
];

/**
 * Turn a sentence into one step (or, for "drop a, b, c", several).
 *
 * @returns {{ok: true, steps: object[]} | {ok: false, error: string}}
 */
export function parseTransformPhrase(phrase, { columns = [] } = {}) {
  const original = clean(phrase);
  if (!original) return { ok: false, error: 'Say what to do — "split city on the comma into City and State".' };
  const ctx = { columns };
  const text = original.replace(/^(?:please\s+|can you\s+|could you\s+|i want to\s+|i need to\s+|let'?s\s+)+/i, '');

  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (!m) continue;
    const built = rule.build(m, ctx);
    if (built.error) return { ok: false, error: built.error };
    const steps = built.many || [built];
    // Planned against the real columns before it is offered as understood.
    let current = [...columns];
    for (const step of steps) {
      const checked = validateTransform(step, current);
      if (!checked.ok) return { ok: false, error: checked.error };
      if (step.kind === DROP) current = current.filter((c) => c !== step.column);
    }
    return { ok: true, steps: steps.map((s) => ({ ...s, text: original })) };
  }
  return { ok: false, error: `I could not read "${original}" as a step. Try "rename X to Y", "split X on the comma into A and B", or "keep rows where X is Y".` };
}

/** Phrases worth showing beside the box, written against this dataset. */
export function exampleTransformPhrases(profile, columns = []) {
  const out = [];
  const dims = profile?.dimensions || [];
  const measures = profile?.measures || [];
  const dates = columns.filter((c) => profile?.columns?.[c]?.role === 'time' || /date|time/i.test(c));
  if (dates[0]) out.push(`extract the month from ${dates[0]}`);
  if (measures.length >= 2) out.push(`add Per unit = [${measures[0]}] / [${measures[1]}]`);
  if (dims[0]) out.push(`keep rows where ${dims[0]} is not blank`);
  if (dims[0]) out.push(`group by ${dims[0]}: total ${measures[0] || 'rows'}, number of rows`);
  if (measures[0]) out.push(`keep the top 100 rows by ${measures[0]}`);
  out.push('remove duplicate rows');
  return out.slice(0, 5);
}
