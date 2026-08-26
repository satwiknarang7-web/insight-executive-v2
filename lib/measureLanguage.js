/**
 * The English side of a measure.
 *
 * "Profit as a percentage of revenue" has to become
 * `(SUM([Profit]) / SUM([Revenue])) * 100` before anything can run it. A model
 * does that well, but this app is built to work with no API key at all — every
 * other feature has a deterministic path behind it, and a formula language that
 * only works when a provider is configured would be the first one that doesn't.
 *
 * So this is a small, honest parser rather than a general one. It knows the
 * handful of shapes people actually type:
 *
 *   total revenue
 *   average order value                         → AVG of the closest column
 *   number of orders                            → COUNT(*)
 *   count of distinct customers                 → COUNT(DISTINCT [Customer])
 *   revenue minus cost                          → SUM(...) - SUM(...)
 *   profit as a percentage of revenue           → ratio, formatted as a percent
 *   revenue per order                           → ratio
 *   total revenue where region is West          → the same, with a row filter
 *
 * Anything it does not recognise returns `{ ok: false }`, and the caller falls
 * through to the model. It never guesses: a phrase naming a column that is not
 * in the data is an error, not a silent substitution of a column that is.
 */
import { isCurrencyKey } from './format.js';
import { resolveMeasure } from './measures.js';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Aggregate words, longest phrases first so "average of" wins over "of". */
const AGGREGATE_WORDS = [
  { re: /\b(?:count of distinct|distinct count of|number of distinct|number of unique|unique count of|distinct|unique)\b/i, agg: 'COUNT', distinct: true },
  { re: /\b(?:average|avg|mean|typical|per average)\b/i, agg: 'AVG' },
  { re: /\b(?:maximum|max|highest|largest|biggest|peak|greatest)\b/i, agg: 'MAX' },
  { re: /\b(?:minimum|min|lowest|smallest|least)\b/i, agg: 'MIN' },
  { re: /\b(?:count of|count|number of|how many|tally of)\b/i, agg: 'COUNT' },
  { re: /\b(?:total|sum of|sum|combined|overall|gross|aggregate)\b/i, agg: 'SUM' },
];

/** Words that mean "every row", when no column is named alongside them. */
const ROW_WORDS = /\b(rows?|records?|entries|orders?|transactions?|line items?|observations?)\b/i;

/**
 * Binary operators, in the order English tends to read them.
 *
 * Note "per" and "over" mean division here. "Revenue per order" is a ratio in
 * every dashboard ever built, and reading it any other way would be pedantry.
 */
const OPERATORS = [
  { re: /\s+(?:divided by|per|over)\s+/i, op: '/' },
  { re: /\s+(?:minus|less|subtract(?:ed by)?|net of|except)\s+/i, op: '-' },
  { re: /\s+(?:plus|added to|and then add)\s+/i, op: '+' },
  { re: /\s+(?:times|multiplied by)\s+/i, op: '*' },
  { re: /\s*([-+*/])\s*/, op: null }, // a literal symbol; the op is what matched
];

/** "as a percentage of", and the ways people write it. */
const PERCENT_OF = /\s+(?:as\s+(?:a\s+)?)?(?:%|percent(?:age)?)\s+of\s+/i;
/** "the ratio of X to Y". */
const RATIO_OF = /^\s*(?:the\s+)?ratio\s+of\s+(.+?)\s+to\s+(.+)$/i;
/** "the share of X out of Y". */
const SHARE_OF = /\s+(?:out\s+of|of\s+total)\s+/i;

/** Where a row filter starts. */
const FILTER_SPLIT = /\s+(?:where|only for|only when|filtered to|restricted to|just for|limited to|for only)\s+/i;

/** Chatter people put in front of the thing they actually want. */
const PREAMBLE =
  /^\s*(?:please\s+)?(?:can you\s+|could you\s+)?(?:create|add|make|define|build|give me|show me|i want|i need|calculate|compute|work out)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:measure|metric|calculation|kpi|formula)?\s*(?:for|of|that|which|to be|:)?\s*/i;

/** A name written up front ("Profit Margin = ..." / "Profit Margin: ..."). */
const NAMED_PREFIX = /^\s*([A-Za-z][A-Za-z0-9 _%().'-]{0,48}?)\s*(?::=|=|:)\s*(.+)$/;
/** A name written at the end ("..., call it Profit Margin"). */
const NAMED_SUFFIX = /[,;]?\s*(?:and\s+)?(?:call|name)\s+(?:it|this|that)\s+(?:"([^"]+)"|'([^']+)'|(.+))$/i;

const normalize = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const words = (s) => normalize(s).split(' ').filter(Boolean);

// ---------------------------------------------------------------------------
// Column matching
// ---------------------------------------------------------------------------

/**
 * Find the column a fragment of English is talking about.
 *
 * Two passes. First an exact-ish containment check — "total revenue" contains
 * "Revenue", "avg unit price" contains "Unit_Price" once both are normalised —
 * preferring the longest column that matches, so a dataset with both `Price`
 * and `Unit Price` resolves "unit price" to the specific one rather than the
 * short one that happens to be a substring of it.
 *
 * Then a word-overlap fallback for the reversed phrasing ("revenue total" for
 * `Total_Revenue`), which requires most of the column's own words to be present
 * so that `Order Date` cannot be matched by the single word "order".
 */
export function matchColumn(text, columns = [], { exclude = [] } = {}) {
  const hay = normalize(text);
  if (!hay) return null;
  const pool = columns.filter((c) => !exclude.includes(c));

  let best = null;
  let bestScore = 0;

  for (const column of pool) {
    const name = normalize(column);
    if (!name) continue;
    if (hay === name) return column; // an exact phrase always wins outright
    if (hay.includes(name)) {
      const score = 100 + name.length;
      if (score > bestScore) [best, bestScore] = [column, score];
    }
  }
  if (best) return best;

  for (const column of pool) {
    const parts = words(column);
    if (!parts.length) continue;
    const hits = parts.filter((p) => p.length > 2 && hay.includes(p));
    if (!hits.length) continue;
    const coverage = hits.length / parts.length;
    if (coverage < 0.5) continue;
    const score = coverage * 10 + hits.join('').length / 100;
    if (score > bestScore) [best, bestScore] = [column, score];
  }
  if (best) return best;

  // Last pass: singular/plural and glued suffixes. People write "customers"
  // and "orders"; the column is `CustomerID` or `Order_Date`. Requiring a stem
  // of four characters keeps this from matching on "id" or "no".
  for (const column of pool) {
    const name = normalize(column).replace(/ /g, '');
    for (const word of words(text)) {
      const stem = word.replace(/(?:ies|es|s)$/, '');
      if (stem.length < 4) continue;
      if (name.startsWith(stem) || name.includes(stem)) {
        const score = stem.length;
        if (score > bestScore) [best, bestScore] = [column, score];
      }
    }
  }
  return best;
}

/** Numeric columns, as the profile knows them (it calls them "measures"). */
const numericColumns = (profile) => profile?.measures || [];

// ---------------------------------------------------------------------------
// Operand parsing
// ---------------------------------------------------------------------------

/**
 * Parse one side of an operator: an aggregate, a column, a number, or a
 * reference to a measure that already exists.
 */
function parseOperand(text, ctx) {
  const raw = String(text || '').trim();
  if (!raw) return { error: 'There is nothing to measure here.' };

  // A bare number, so "revenue divided by 1000" works.
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return { expr: raw, literal: true };

  // A measure that already exists, either masked out of the text before the
  // operator scan (see `maskMeasures`) or written plainly.
  const masked = raw.match(/^«(\d+)»$/);
  if (masked) {
    const existing = ctx.masked?.[Number(masked[1])];
    if (existing) return { expr: `[${existing.name}]`, measure: existing };
  }
  const existing = resolveMeasure(raw.replace(/^\[|\]$/g, ''), ctx.measures);
  if (existing) return { expr: `[${existing.name}]`, measure: existing };

  // Which aggregate did they ask for?
  let agg = null;
  let distinct = false;
  let aggMatch = '';
  for (const entry of AGGREGATE_WORDS) {
    const hit = raw.match(entry.re);
    if (hit) {
      agg = entry.agg;
      distinct = !!entry.distinct;
      aggMatch = hit[0];
      break;
    }
  }

  const column = matchColumn(raw, ctx.columns);

  // "number of orders", "count of rows" — a count with no column to count.
  // A column is only allowed to win here when the phrase names it outright: a
  // dataset with an `Orders` column should count that column, but one with an
  // `Order_ID` column should not turn "number of orders" into a count of IDs
  // that quietly skips the rows where the ID is blank.
  const namesColumn = column && normalize(raw).includes(normalize(column));
  if (agg === 'COUNT' && !distinct && ROW_WORDS.test(raw) && !namesColumn) {
    return { expr: 'COUNT(*)', agg: 'COUNT' };
  }
  if (!column) {
    // "count of customers" where `Customer` does not exist as a column is a
    // real miss; saying which words were not understood beats a generic no.
    return { error: `I could not find a column matching "${unmask(raw, ctx).trim()}".` };
  }

  const numeric = numericColumns(ctx.profile).includes(column);
  if (!agg) agg = numeric ? 'SUM' : 'COUNT'; // an unqualified measure means its total
  if (agg !== 'COUNT' && !numeric && ctx.profile?.measures?.length) {
    return { error: `[${column}] is not a numeric column, so it can only be counted.` };
  }

  // Everything in this fragment has to be accounted for. "What share of revenue
  // comes from Electronics" mentions `revenue`, and without this check the
  // parser would answer it with a plain total — confidently, and wrongly, since
  // neither "share" nor "Electronics" survived into the formula. Declining hands
  // the phrase to the model, which can write the CASE expression it needs.
  const leftover = unaccountedWords(raw, { column, matched: aggMatch, distinct });
  if (leftover.length) {
    return { error: `I could not tell what "${leftover.join(' ')}" means here.` };
  }

  const inner = distinct ? `DISTINCT [${column}]` : `[${column}]`;
  return { expr: `${agg}(${inner})`, agg, column, distinct };
}

/**
 * Words in a fragment that ended up in neither the aggregate nor the column.
 *
 * Filler and question words are expected and ignored; anything else means the
 * phrase said something the parser did not hear.
 */
function unaccountedWords(raw, { column, matched, distinct }) {
  const used = new Set();
  for (const w of words(column)) used.add(stem(w));
  for (const w of words(matched || '')) used.add(stem(w));
  if (distinct) used.add(stem('distinct'));

  return words(raw).filter((w) => {
    const root = stem(w);
    if (used.has(root)) return false;
    if (FILLER.has(w) || FILLER.has(root)) return false;
    if (/^\d+$/.test(w)) return false;
    if (ROW_WORDS.test(w)) return false;
    // A stem the column name merely contains ("customers" for `CustomerID`).
    return ![...used].some((u) => u.includes(root) || root.includes(u));
  });
}

const stem = (w) => String(w).replace(/(?:ies|es|s)$/, '');

/** Words that carry no instruction: articles, question words, politeness. */
const FILLER = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'for', 'from', 'to', 'by', 'with',
  'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this',
  'that', 'these', 'those', 'my', 'our', 'their', 'we', 'you', 'i', 'me',
  'all', 'any', 'each', 'every', 'what', 'which', 'how', 'much', 'many',
  'see', 'show', 'display', 'get', 'know', 'find', 'tell', 'want', 'need',
  'please', 'just', 'value', 'amount', 'across', 'over', 'up',
]);

/**
 * Hide the names of existing measures from the operator scan.
 *
 * A measure called "Revenue Per Units Sold" contains the word "per", which the
 * arithmetic parser reads as division — so a phrase built on that measure was
 * torn in half at its own name. Each name is replaced by an opaque marker
 * before any splitting happens, and `parseOperand` turns the marker back into
 * the reference. Longest names first, so one measure whose name contains
 * another's cannot be shadowed by it.
 */
function maskMeasures(text, measures = []) {
  const found = [];
  let out = String(text);

  const sorted = [...measures].sort((a, b) => String(b.name).length - String(a.name).length);
  for (const measure of sorted) {
    const parts = words(measure.name);
    if (!parts.length) continue;
    const pattern = new RegExp(`(?<![A-Za-z0-9])${parts.map(escapeRe).join('[\\s_.-]+')}(?![A-Za-z0-9])`, 'i');
    if (!pattern.test(out)) continue;
    out = out.replace(pattern, `«${found.length}»`);
    found.push(measure);
  }
  return { text: out, masked: found };
}

/** Put measure names back into text before showing it to the user. */
function unmask(text, ctx) {
  return String(text).replace(/«(\d+)»/g, (m, i) => ctx.masked?.[Number(i)]?.name || m);
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Parse an arithmetic phrase into an expression.
 *
 * Left-associative and fully parenthesised, deliberately: "revenue minus cost
 * divided by revenue" is a margin to every person who types it, and SQL's own
 * precedence would quietly make it `revenue - (cost / revenue)`. Reading order
 * is the better guess about intent than operator precedence is.
 */
function parseArithmetic(text, ctx) {
  const raw = String(text || '').trim();

  // "the ratio of X to Y"
  const ratio = raw.match(RATIO_OF);
  if (ratio) {
    const left = parseArithmetic(ratio[1], ctx);
    if (left.error) return left;
    const right = parseArithmetic(ratio[2], ctx);
    if (right.error) return right;
    return {
      expr: `${group(left)} / ${group(right)}`,
      parts: [...left.parts, ...right.parts],
      ratio: true,
    };
  }

  for (const { re, op } of OPERATORS) {
    const m = raw.match(re);
    if (!m || m.index === undefined) continue;
    const operator = op || m[1];
    const leftText = raw.slice(0, m.index);
    const rightText = raw.slice(m.index + m[0].length);
    if (!leftText.trim() || !rightText.trim()) continue;

    const left = parseArithmetic(leftText, ctx);
    if (left.error) return left;
    const right = parseArithmetic(rightText, ctx);
    if (right.error) return right;
    return {
      expr: `${group(left)} ${operator} ${group(right)}`,
      parts: [...left.parts, ...right.parts],
      ratio: operator === '/' || left.ratio || right.ratio,
    };
  }

  const operand = parseOperand(raw, ctx);
  if (operand.error) return operand;
  return { expr: operand.expr, parts: [operand], ratio: false, atomic: true };
}

/**
 * Bracket a sub-expression, but only when it is one.
 *
 * The grouping is what makes reading order beat operator precedence, so it
 * cannot be dropped — but wrapping a single `SUM([Revenue])` in brackets too
 * makes the formula the user is shown look generated rather than written, and
 * they are meant to be able to edit it.
 */
function group(part) {
  return part.atomic ? part.expr : `(${part.expr})`;
}

// ---------------------------------------------------------------------------
// Filter parsing
// ---------------------------------------------------------------------------

const COMPARATORS = [
  { re: /\s+(?:is not|isn't|does not equal|is not equal to|!=|<>)\s+/i, sql: '<>' },
  { re: /\s+(?:is at least|at least|greater than or equal to|>=)\s+/i, sql: '>=' },
  { re: /\s+(?:is at most|at most|less than or equal to|<=)\s+/i, sql: '<=' },
  { re: /\s+(?:is greater than|greater than|is more than|more than|is above|above|exceeds|>)\s+/i, sql: '>' },
  { re: /\s+(?:is less than|less than|is below|below|under|<)\s+/i, sql: '<' },
  { re: /\s+(?:contains|includes)\s+/i, sql: 'LIKE' },
  { re: /\s+(?:starts with|begins with)\s+/i, sql: 'STARTS' },
  { re: /\s+(?:is equal to|equals|equal to|is|=|in|are)\s+/i, sql: '=' },
];

const quote = (v) => `'${String(v).replace(/'/g, "''")}'`;

/** One condition: a column, a comparison, and a value. */
function parseCondition(text, ctx) {
  const raw = String(text || '').trim().replace(/[.?!]+$/, '');
  if (!raw) return { error: 'The filter is empty.' };

  for (const { re, sql } of COMPARATORS) {
    const m = raw.match(re);
    if (!m || m.index === undefined) continue;

    const columnText = raw.slice(0, m.index);
    const valueText = raw.slice(m.index + m[0].length).trim().replace(/^["']|["']$/g, '');
    const column = matchColumn(columnText, ctx.columns);
    if (!column) return { error: `I could not find a column matching "${columnText.trim()}".` };
    if (!valueText) return { error: `The filter on [${column}] has no value to compare against.` };

    const numeric = /^-?\d+(?:\.\d+)?$/.test(valueText);
    if (sql === 'LIKE') return { expr: `[${column}] LIKE ${quote(`%${valueText}%`)}` };
    if (sql === 'STARTS') return { expr: `[${column}] LIKE ${quote(`${valueText}%`)}` };
    return { expr: `[${column}] ${sql} ${numeric ? valueText : quote(valueText)}` };
  }
  return { error: `I could not read "${raw}" as a filter. Try "region is West".` };
}

/** A filter clause: conditions joined by and / or. */
function parseFilter(text, ctx) {
  const pieces = String(text).split(/\s+(and|or)\s+/i);
  let out = '';
  for (let i = 0; i < pieces.length; i += 2) {
    const condition = parseCondition(pieces[i], ctx);
    if (condition.error) return condition;
    const joiner = i === 0 ? '' : ` ${pieces[i - 1].toUpperCase()} `;
    out += joiner + condition.expr;
  }
  return { expr: out };
}

// ---------------------------------------------------------------------------
// The whole phrase
// ---------------------------------------------------------------------------

/**
 * Turn a sentence into a measure definition.
 *
 * @returns {{ok: true, measure: object} | {ok: false, error: string}}
 */
export function parseMeasurePhrase(phrase, { columns = [], profile = null, measures = [] } = {}) {
  const original = String(phrase || '').trim();
  if (!original) return { ok: false, error: 'Say what you want to measure.' };
  if (!columns.length) return { ok: false, error: 'No data is loaded.' };

  const ctx = { columns, profile, measures };
  let text = original;
  let name = null;

  // A name, given either up front or at the end.
  const suffix = text.match(NAMED_SUFFIX);
  if (suffix) {
    name = (suffix[1] || suffix[2] || suffix[3] || '').trim();
    text = text.slice(0, suffix.index).trim();
  }
  const prefix = text.match(NAMED_PREFIX);
  if (prefix && !/\b(?:is|are|where)\b/i.test(prefix[1])) {
    name = name || prefix[1].trim();
    text = prefix[2].trim();
  }
  text = text.replace(PREAMBLE, '').trim();
  if (!text) return { ok: false, error: 'Say what you want to measure.' };

  // The row filter, if there is one.
  let filter = null;
  const split = text.split(FILTER_SPLIT);
  if (split.length > 1) {
    const parsed = parseFilter(split.slice(1).join(' '), ctx);
    if (parsed.error) return { ok: false, error: parsed.error };
    filter = parsed.expr;
    text = split[0].trim();
  }

  // "A as a percentage of B" / "A out of B" — a ratio that wants a % sign.
  let percent = false;
  let body = text;
  const asPercent = text.split(PERCENT_OF);
  const asShare = text.split(SHARE_OF);
  if (asPercent.length === 2) {
    percent = true;
    body = `the ratio of ${asPercent[0]} to ${asPercent[1]}`;
  } else if (asShare.length === 2) {
    percent = true;
    body = `the ratio of ${asShare[0]} to ${asShare[1]}`;
  }

  const hidden = maskMeasures(body, measures);
  const parsed = parseArithmetic(hidden.text, { ...ctx, masked: hidden.masked });
  if (parsed.error) return { ok: false, error: parsed.error };

  const expr = percent ? `${group(parsed)} * 100` : parsed.expr;
  const columnsUsed = parsed.parts.filter((p) => p.column).map((p) => p.column);
  const counting = parsed.parts.every((p) => p.agg === 'COUNT');

  let format = 'number';
  if (percent) format = 'percent';
  else if (!parsed.ratio && !counting && columnsUsed.some((c) => isCurrencyKey(c))) format = 'currency';

  return {
    ok: true,
    measure: {
      name: uniqueMeasureName(name || defaultMeasureName(text, percent), measures),
      text: original,
      expr,
      filter,
      format,
      source: 'phrase',
      explanation: explain({ expr, filter, percent }),
    },
  };
}

/** A title made out of what they typed, when they did not name it themselves. */
export function defaultMeasureName(text, percent = false) {
  const cleaned = String(text || '')
    .replace(PREAMBLE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?!]+$/, '');
  if (!cleaned) return 'New measure';
  const title = cleaned
    .split(' ')
    .slice(0, 6)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
  const named = title.charAt(0).toUpperCase() + title.slice(1);
  return percent && !/%|percent/i.test(named) ? `${named} %` : named;
}

/** Append a number rather than overwrite a measure that already has the name. */
export function uniqueMeasureName(name, measures = []) {
  const taken = new Set((measures || []).map((m) => normalize(m.name)));
  const base = String(name || 'New measure').trim() || 'New measure';
  if (!taken.has(normalize(base))) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(normalize(candidate))) return candidate;
  }
  return `${base} ${Date.now()}`;
}

/** One sentence saying what the measure does, in the terms it was built from. */
function explain({ expr, filter, percent }) {
  const base = `Computed as ${expr}`;
  const scope = filter ? `, over rows where ${filter}` : ', over every row in scope';
  return `${base}${scope}.${percent ? ' Shown as a percentage.' : ''}`;
}

/**
 * Example phrases built from the columns actually loaded.
 *
 * A blank box that accepts "anything" is the hardest kind to start using, and
 * examples naming this dataset's own columns teach the shape of the thing far
 * faster than a syntax note would.
 *
 * Two rules make the difference between a suggestion and a distraction:
 *
 *   - **Every candidate is parsed before it is offered.** A suggestion that
 *     fails when you click it is worse than no suggestion, and the parser is
 *     narrow enough that a plausible-looking sentence quite often does. Running
 *     each one through `parseMeasurePhrase` against this dataset's own columns
 *     means what is shown is what will work. It costs a few parses on a page
 *     that renders once.
 *   - **Columns are ranked, not taken in file order.** `total order_id`,
 *     `total year` and `unit price per unit price` are all things a naive pick
 *     produces, and each of them teaches the syntax by way of a calculation
 *     nobody would ever want.
 */
export function exampleMeasurePhrases(profile, { measures = [], sample = [] } = {}) {
  const columns = Object.keys(profile?.columns || {});
  if (!columns.length) return [];

  const ranked = [...numericColumns(profile)]
    .filter((c) => !TEMPORAL_NAME.test(c))
    .sort((a, b) => additivity(b) - additivity(a));
  const primary = ranked[0];
  const secondary = ranked.find((c) => c !== primary);

  // What you divide BY is a population, not more money: customers, orders,
  // stores. A dimension with many distinct values is exactly that; a numeric
  // column is the fallback when there is no such dimension.
  const dimensions = (profile?.dimensions || []).filter((d) => !TEMPORAL_NAME.test(d));
  const distinctOf = (c) => profile?.columns?.[c]?.distinctCount || 0;
  const population = [...dimensions].sort((a, b) => distinctOf(b) - distinctOf(a))[0];
  // What you group or filter BY is a small set of names, not a near-unique one.
  const category = [...dimensions]
    .filter((d) => distinctOf(d) > 1 && distinctOf(d) <= 50)
    .sort((a, b) => distinctOf(a) - distinctOf(b))[0];

  // Ordered so that the shapes furthest apart come first: someone reading four
  // of these should come away knowing four different things they can say, not
  // four variations on adding a column up.
  const value = sampleValue(sample, category);
  const candidates = [];
  if (primary) candidates.push(`total ${pretty(primary)}`);
  if (primary) candidates.push(`average ${pretty(primary)}`);
  if (primary && population) candidates.push(`${pretty(primary)} per ${pretty(population)}`);
  if (population) candidates.push(`number of distinct ${pretty(population)}`);
  // A filter reads as an instruction only when it names a value that is really
  // in the column. "where region is …" is a template; "where region is West" is
  // an example, and it is the one that can be clicked.
  if (primary && category && value) {
    candidates.push(`total ${pretty(primary)} where ${pretty(category)} is ${value}`);
  }
  if (primary && secondary) {
    candidates.push(`${pretty(secondary)} as a percentage of ${pretty(primary)}`);
    candidates.push(`${pretty(primary)} minus ${pretty(secondary)}`);
  }
  if (primary) candidates.push(`maximum ${pretty(primary)}`);
  candidates.push('number of rows');

  // Enough for one worked example of every shape the reference panel lists.
  // Callers that only have room for a few take the first few, which is why the
  // ordering above matters.
  const ctx = { columns, profile, measures };
  const out = [];
  for (const phrase of candidates) {
    if (out.includes(phrase)) continue;
    if (!parseMeasurePhrase(phrase, ctx).ok) continue;
    out.push(phrase);
    if (out.length === 9) break;
  }
  return out;
}

/**
 * A real value from a column, to put in a filter example.
 *
 * Taken from the preview rows the worker already sends with the dataset, so it
 * costs nothing. Long, blank and redacted values are skipped: an example is
 * meant to be read at a glance and typed over.
 */
function sampleValue(sample, column) {
  if (!column || !Array.isArray(sample)) return null;
  for (const row of sample) {
    const value = row?.[column];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (!text || text.length > 24 || text.startsWith('[REDACTED')) continue;
    // A value containing the words the parser splits on would be read as more
    // of the sentence rather than as the value.
    if (FILTER_SPLIT.test(` ${text} `) || /\b(is|and|or|not)\b/i.test(text)) continue;
    return text;
  }
  return null;
}

const TEMPORAL_NAME = /(date|time|year|month|day|quarter|qtr|week|created|updated|timestamp)/i;

/**
 * How much sense a column makes to add up.
 *
 * `revenue` totals to something meaningful; `unit_price` totals to a number
 * with no interpretation at all, and an `age` or a `rating` totals to nonsense.
 * The scoring applies to every numeric column rather than only the ones that
 * look like money, because plenty of datasets have no currency column at all
 * and the first numeric one in file order is nobody's idea of a headline metric.
 */
function additivity(column) {
  const name = normalize(column);
  let score = 0;
  if (/revenue|sales|amount|profit|margin|spend|cost|value|total|income/.test(name)) score += 3;
  if (isCurrencyKey(column)) score += 2;
  if (/quantity|qty|units|count|volume/.test(name)) score += 1;
  // Averages of averages, and per-unit figures, do not add up.
  if (/price|rate|per |unit|avg|average|ratio|percent|pct|score|rating/.test(name)) score -= 2;
  // Something measured on a scale rather than accumulated.
  if (/age|latitude|longitude|lat$|lon$|lng$|temperature|weight|height/.test(name)) score -= 3;
  return score;
}

const pretty = (s) => String(s || '').replace(/_/g, ' ').replace(/\./g, ' ').trim().toLowerCase();
