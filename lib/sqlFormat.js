/**
 * Laying a generated query out so a person can read it.
 *
 * Every query in this app is emitted as one long line, because nothing that
 * writes one cares how it looks — the planner, the measure compiler and the
 * chart builder all concatenate fragments. Shown to a reader, that single line
 * ran off the side of its panel and had to be scrolled horizontally to be read
 * at all, which is the one thing a query someone is being invited to check
 * should never do. Broken at its clause boundaries it wraps naturally and fits.
 *
 * This is a layout pass, not a parser. It never reorders, rewrites, quotes or
 * validates anything: the output is the input with newlines and spaces added,
 * so what you read is exactly what ran. The only structure it needs to
 * understand is what it must NOT break inside — a bracketed column name like
 * `[Order Date]`, a string literal like `'North America'`, and the inside of a
 * function call — and those are tracked character by character rather than
 * guessed at with a regular expression.
 *
 * Pure: no imports, no side effects.
 */

/** Clauses that begin a new line at the top level of a statement. */
const CLAUSES = [
  'SELECT',
  'FROM',
  'INNER JOIN',
  'LEFT OUTER JOIN',
  'RIGHT OUTER JOIN',
  'FULL OUTER JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'CROSS JOIN',
  'JOIN',
  'WHERE',
  'GROUP BY',
  'HAVING',
  'ORDER BY',
  'LIMIT',
  'OFFSET',
  'UNION ALL',
  'UNION',
];

/** Keywords inside a CASE expression that read better on their own line. */
const CASE_PARTS = ['WHEN', 'ELSE', 'END'];

/** How far the continuation of a SELECT list is indented. */
const SELECT_INDENT = '       '; // aligns under "SELECT "

/**
 * Split a statement into `{ keyword, body }` segments at top level.
 *
 * "Top level" means depth zero: not inside brackets, quotes or parentheses. A
 * `WHERE` inside a subquery, or the word "from" inside a string literal, is
 * therefore left exactly where it is.
 */
function segments(sql) {
  const out = [];
  let current = { keyword: null, body: '' };
  let depth = 0;
  let quote = null; // "'" while inside a string, "]" while inside an identifier

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (quote) {
      current.body += ch;
      // '' is an escaped quote inside a SQL string, not the end of one.
      if (quote === "'" && ch === "'" && sql[i + 1] === "'") {
        current.body += sql[++i];
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "'") {
      quote = "'";
      current.body += ch;
      continue;
    }
    if (ch === '[') {
      quote = ']';
      current.body += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);

    if (depth === 0) {
      const hit = clauseAt(sql, i);
      if (hit) {
        out.push(current);
        current = { keyword: hit, body: '' };
        i += hit.length - 1;
        continue;
      }
    }

    current.body += ch;
  }

  out.push(current);
  return out.filter((s) => s.keyword || s.body.trim());
}

/**
 * The clause keyword starting at `i`, if one does.
 *
 * Requires a word boundary on both sides so `GROUPS` is not read as `GROUP`,
 * and matches the longest candidate first so `LEFT OUTER JOIN` is not split
 * into `LEFT` and a stray `JOIN`.
 */
function clauseAt(sql, i) {
  if (i > 0 && /[A-Za-z0-9_]/.test(sql[i - 1])) return null;
  const rest = sql.slice(i);
  for (const clause of CLAUSES) {
    if (rest.length < clause.length) continue;
    if (rest.slice(0, clause.length).toUpperCase() !== clause) continue;
    const after = rest[clause.length];
    if (after !== undefined && /[A-Za-z0-9_]/.test(after)) continue;
    return rest.slice(0, clause.length);
  }
  return null;
}

/** Split on top-level commas, so `SUM([a]), [b]` becomes two items. */
function topLevelItems(body) {
  const out = [];
  let current = '';
  let depth = 0;
  let quote = null;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];

    if (quote) {
      current += ch;
      if (quote === "'" && ch === "'" && body[i + 1] === "'") current += body[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'") {
      quote = "'";
      current += ch;
      continue;
    }
    if (ch === '[') {
      quote = ']';
      current += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);

    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }

  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * Break a long CASE expression across lines.
 *
 * The histogram queries build one CASE with a WHEN per bucket, which is by far
 * the longest thing anyone will read here; on one line it is unreadable however
 * wide the panel is.
 */
function layoutCase(item, indent) {
  if (!/\bcase\b/i.test(item)) return item;

  let out = '';
  let depth = 0;
  let quote = null;

  for (let i = 0; i < item.length; i++) {
    const ch = item[i];

    if (quote) {
      out += ch;
      if (quote === "'" && ch === "'" && item[i + 1] === "'") out += item[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'") {
      quote = "'";
      out += ch;
      continue;
    }
    if (ch === '[') {
      quote = ']';
      out += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);

    if (depth === 0 && (i === 0 || /\s/.test(item[i - 1]))) {
      const word = CASE_PARTS.find((w) => item.slice(i, i + w.length).toUpperCase() === w && !/[A-Za-z0-9_]/.test(item[i + w.length] ?? ' '));
      if (word) {
        out = `${out.replace(/\s+$/, '')}\n${indent}  ${item.slice(i, i + word.length)}`;
        i += word.length - 1;
        continue;
      }
    }
    out += ch;
  }

  return out;
}

/**
 * Format one SQL statement for display.
 *
 * Returns the input unchanged when there is nothing recognisable to lay out, so
 * a hand-written query, a fragment, or an empty string is never mangled into
 * something that reads as though it had been rewritten.
 */
export function formatSql(sql) {
  const text = String(sql ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return '';

  const parts = segments(text);
  if (parts.length <= 1) return text;

  const lines = [];
  for (const { keyword, body } of parts) {
    const trimmed = body.trim();

    if (!keyword) {
      if (trimmed) lines.push(trimmed);
      continue;
    }

    const upper = keyword.toUpperCase();
    // The SELECT list is the one place worth putting one item per line: it is
    // the only clause that routinely holds several independent expressions.
    if (upper === 'SELECT') {
      const items = topLevelItems(trimmed).map((item) => layoutCase(item, SELECT_INDENT));
      if (items.length <= 1) {
        lines.push(`${keyword} ${items[0] ?? ''}`.trim());
      } else {
        lines.push(`${keyword} ${items[0]}${items.length > 1 ? ',' : ''}`);
        items.slice(1).forEach((item, i) => {
          const last = i === items.length - 2;
          lines.push(`${SELECT_INDENT}${item}${last ? '' : ','}`);
        });
      }
      continue;
    }

    lines.push(trimmed ? `${keyword} ${trimmed}` : keyword);
  }

  return lines.join('\n');
}
