/**
 * Reshaping the data before anything is analysed.
 *
 * Cleaning decides what a value *is* — that `"1,234"` is a number and
 * `03/04/2024` is a date. This is the layer above it: the things Power Query
 * does. Renaming and dropping columns, deriving one from others, splitting a
 * column on a comma, pulling the month out of a date, banding a number,
 * replacing values, removing duplicates, keeping the top hundred, grouping a
 * ledger up to one row per customer, turning twelve month columns into rows.
 * Things the file cannot tell you and only the person reading it knows — or a
 * model reading it on their behalf, which is why every step here is data a
 * model can propose and a validator can refuse.
 *
 * ## Every transform is a query
 *
 * Not a hidden mutation, and not an opaque step in a pipeline — one `SELECT`
 * per operation, over the table as the previous operation left it. That is the
 * same promise the rest of this product makes about its numbers, applied to the
 * data itself: if a column was changed, there is a query that says how, and it
 * can be read by whoever has to defend the figure built on it.
 *
 * `alasql` executes the SQL, and `measures.js` already knows how to validate an
 * expression — so a derived column is checked by the same rules a measure is,
 * including the ones that keep a formula from becoming a query: no semicolons,
 * no comments, no SELECT or FROM or JOIN, and a tokenizer that refuses
 * characters outside the set an expression can contain. That matters more here
 * than it does for a measure, because these expressions end up concatenated
 * into SQL. Every value a step carries — a replacement, a bucket label, a
 * separator — goes through `literal()` on the way in for the same reason.
 *
 * ## Lineage
 *
 * Every step also says where each of its output columns came from. A rename
 * moves a column, a derive builds one out of several, a group-by collapses a
 * ledger into aggregates of its columns. The confidence store is keyed by
 * column, and doubt has to follow the data through all of that: the lineage
 * map is what lets it, without the store knowing what a "pivot" is.
 *
 * ## Pure
 *
 * Nothing here executes anything. A plan is a list of `{ sql, columns,
 * lineage }` — the query to run, the columns that exist once it has, and where
 * they came from. The worker runs them in order; the UI shows them; the tests
 * read them without a database.
 */
import { resolveColumn, tokenize, validateExpression } from './measures.js';
import { createConfidence } from './cellConfidence.js';

/**
 * The validator belongs to measures and says so in its errors.
 *
 * Reusing it is right — the rules are identical and a second copy would be a
 * second set of holes — but "a measure is one expression" is a confusing thing
 * to read in a panel where nothing is called a measure. The rule is borrowed;
 * the noun is not.
 */
function inOurWords(result) {
  if (result.ok || !result.error) return result;
  return { ...result, error: String(result.error).replace(/A measure is/g, 'A formula is') };
}

export const RENAME = 'rename';
export const DROP = 'drop';
export const KEEP = 'keep';
export const DERIVE = 'derive';
export const RETYPE = 'retype';
export const FILTER = 'filter';
export const CONDITIONAL = 'conditional';
export const BUCKET = 'bucket';
export const DATEPART = 'datepart';
export const SPLIT = 'split';
export const MERGE = 'merge';
export const TEXT = 'text';
export const REPLACE = 'replace';
export const FILL = 'fill';
export const BLANKS = 'blanks';
export const DEDUPE = 'dedupe';
export const SORT = 'sort';
export const LIMIT = 'limit';
export const GROUP = 'group';
export const UNPIVOT = 'unpivot';
export const PIVOT = 'pivot';
export const INDEX = 'index';

export const TRANSFORM_KINDS = [
  RENAME, DROP, KEEP, DERIVE, RETYPE, FILTER, CONDITIONAL, BUCKET, DATEPART, SPLIT, MERGE,
  TEXT, REPLACE, FILL, BLANKS, DEDUPE, SORT, LIMIT, GROUP, UNPIVOT, PIVOT, INDEX,
];

/**
 * Steps that only ADD to the table.
 *
 * A new column beside the old ones changes nothing a chart already drew. A
 * filter, a drop, a group-by or a replacement changes what the numbers mean,
 * and that is a decision a person makes. The line matters for the model: it
 * may put a step from this list into effect on its own, and may only propose
 * the rest.
 */
export const ADDITIVE_KINDS = [DERIVE, CONDITIONAL, BUCKET, DATEPART, SPLIT, MERGE, INDEX];

/**
 * The fields each kind carries, and what each is for.
 *
 * Read by two things that must agree: the guard that accepts a step a model
 * wrote (anything not listed here is dropped before validation), and the
 * briefing that tells the model what a step looks like. One table, so the
 * model is never told about a field the guard would strip.
 */
export const TRANSFORM_FIELDS = {
  [RENAME]: { column: 'existing column', to: 'new name' },
  [DROP]: { column: 'existing column' },
  [KEEP]: { columns: 'existing columns to keep, in order' },
  [DERIVE]: { name: 'new column', expr: 'row formula, e.g. [Revenue] - [Cost] — no aggregates' },
  [RETYPE]: { column: 'existing column', to: 'number | integer | text | date' },
  [FILTER]: { expr: "row condition, e.g. [Status] <> 'Test'", mode: 'keep | remove' },
  [CONDITIONAL]: {
    name: 'new column',
    rules: "[{ when: row condition, then: value or formula }], first match wins; values quoted like 'High'",
    otherwise: 'value when no rule matches (optional)',
  },
  [BUCKET]: { name: 'new column', column: 'numeric column', edges: '[ascending numbers]', labels: 'optional, one more than edges' },
  [DATEPART]: { name: 'new column', column: 'date column', part: 'year | quarter | year_quarter | month | month_name | year_month | day | weekday | date | hour' },
  [SPLIT]: { column: 'text column', separator: 'text to split on', into: '[new column names]', dropOriginal: 'true | false' },
  [MERGE]: { name: 'new column', columns: '[existing columns]', separator: 'text between them' },
  [TEXT]: { column: 'text column', op: 'trim | upper | lower | proper' },
  [REPLACE]: { column: 'existing column', find: 'value', replacement: 'value', mode: 'value (whole cell) | text (inside the cell)' },
  [FILL]: { column: 'existing column', value: 'what blanks become' },
  [BLANKS]: { columns: '[columns that must not be blank]; empty list means the whole row' },
  [DEDUPE]: { columns: '[key columns]; empty list means whole-row duplicates' },
  [SORT]: { by: '[{ column, direction: asc | desc }]' },
  [LIMIT]: { count: 'rows to keep', by: 'column to rank by (optional)', direction: 'desc | asc' },
  [GROUP]: {
    by: '[columns to group by]',
    aggregates: '[{ fn: SUM | AVG | MIN | MAX | COUNT | COUNT_DISTINCT | MEDIAN | FIRST, column, name }]',
  },
  [UNPIVOT]: { columns: '[columns that become rows]', nameColumn: 'name for the column-name column', valueColumn: 'name for the value column' },
  [PIVOT]: { column: 'category column whose values become columns', measure: 'numeric column', fn: 'SUM | AVG | MIN | MAX | COUNT', values: '[the values that become columns]' },
  [INDEX]: { name: 'new column' },
};

/** What a column can be read as. Anything else is left alone. */
export const RETYPE_TARGETS = {
  number: { label: 'Number', fn: 'TO_NUMBER' },
  integer: { label: 'Whole number', fn: 'TO_INTEGER' },
  text: { label: 'Text', fn: 'TO_TEXT' },
  date: { label: 'Date', fn: 'TO_DATE' },
};

/** The parts of a date a column can be made from. */
export const DATE_PARTS = {
  year: { label: 'Year', fn: 'YEAR', suffix: 'Year' },
  quarter: { label: 'Quarter (1–4)', fn: 'QUARTER', suffix: 'Quarter' },
  year_quarter: { label: 'Year and quarter', fn: 'YEAR_QUARTER', suffix: 'Quarter' },
  month: { label: 'Month (1–12)', fn: 'MONTH', suffix: 'Month' },
  month_name: { label: 'Month name', fn: 'MONTH_NAME', suffix: 'Month' },
  year_month: { label: 'Year and month', fn: 'YEAR_MONTH', suffix: 'Month' },
  day: { label: 'Day of month', fn: 'DAY', suffix: 'Day' },
  weekday: { label: 'Day of week', fn: 'WEEKDAY_NAME', suffix: 'Weekday' },
  date: { label: 'Date only (no time)', fn: 'DATE_ONLY', suffix: 'Date' },
  hour: { label: 'Hour of day', fn: 'HOUR', suffix: 'Hour' },
};

/** The ways text can be tidied in place. */
export const TEXT_OPS = {
  trim: { label: 'Trim spaces', fn: 'TRIM' },
  upper: { label: 'UPPER CASE', fn: 'UPPER' },
  lower: { label: 'lower case', fn: 'LOWER' },
  proper: { label: 'Proper Case', fn: 'PROPER' },
};

/** The aggregates a group-by can produce. */
export const GROUP_FUNCTIONS = {
  SUM: { label: 'Sum', needsColumn: true },
  AVG: { label: 'Average', needsColumn: true },
  MIN: { label: 'Minimum', needsColumn: true },
  MAX: { label: 'Maximum', needsColumn: true },
  COUNT: { label: 'Count of rows', needsColumn: false },
  COUNT_DISTINCT: { label: 'Distinct count', needsColumn: true },
  MEDIAN: { label: 'Median', needsColumn: true },
  FIRST: { label: 'First value', needsColumn: true },
};

const br = (name) => `[${name}]`;
const list = (cols) => cols.map(br).join(', ');
const NUMBER_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

/**
 * A value typed into a step, as SQL.
 *
 * Numbers are numbers, everything else is a quoted string with its quotes
 * doubled — which is the whole of what makes a replacement value or a bucket
 * label safe to concatenate. A string that reads as a number ("0", "12.5") is
 * emitted as one: a fill value typed into a box arrives as text whatever the
 * column holds, and `COALESCE([units], '0')` would put text into a number
 * column.
 */
export function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  const s = String(value);
  if (NUMBER_RE.test(s.trim())) return String(Number(s));
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * A name that can be written into SQL and read back out.
 *
 * The closing bracket is the only character that can escape a quoted
 * identifier, so it is the only one refused outright. The rest is about a
 * person being able to find the column again.
 */
export function columnNameProblem(name, existing = []) {
  const value = String(name ?? '').trim();
  if (!value) return 'Give the column a name.';
  if (value.length > 60) return 'That name is too long — 60 characters at most.';
  if (value.includes(']')) return 'A column name cannot contain "]".';
  if (existing.some((c) => c.toLowerCase() === value.toLowerCase())) {
    return `There is already a column called "${value}".`;
  }
  return null;
}

/** Always a quoted string, whatever it looks like — a band label of "100" is a label. */
const str = (v) => `'${String(v).replace(/'/g, "''")}'`;
const names = (arr) => (Array.isArray(arr) ? arr : []).map((c) => String(c ?? '').trim()).filter(Boolean);
const quoteish = (v) => (typeof v === 'number' ? String(v) : `"${v}"`);

/** One sentence describing what a transform does, for a list a person reads. */
export function describeTransform(op) {
  switch (op?.kind) {
    case RENAME:
      return `Rename ${op.column} to ${op.to}`;
    case DROP:
      return `Drop ${op.column}`;
    case KEEP:
      return `Keep only ${names(op.columns).join(', ')}`;
    case DERIVE:
      return `Add ${op.name} = ${op.expr}`;
    case RETYPE:
      return `Read ${op.column} as ${RETYPE_TARGETS[op.to]?.label?.toLowerCase() || op.to}`;
    case FILTER:
      return `${op.mode === 'remove' ? 'Remove' : 'Keep'} rows where ${op.expr}`;
    case CONDITIONAL: {
      const rules = (op.rules || []).map((r) => `${r.then} when ${r.when}`).join(', ');
      return `Add ${op.name}: ${rules}${op.otherwise !== undefined && op.otherwise !== '' ? `, otherwise ${op.otherwise}` : ''}`;
    }
    case BUCKET:
      return `Add ${op.name}: ${op.column} banded at ${(op.edges || []).join(', ')}`;
    case DATEPART:
      return `Add ${op.name} = ${DATE_PARTS[op.part]?.label?.toLowerCase() || op.part} of ${op.column}`;
    case SPLIT:
      return `Split ${op.column} on ${quoteish(op.separator)} into ${names(op.into).join(', ')}`;
    case MERGE:
      return `Add ${op.name} = ${names(op.columns).join(` + ${quoteish(op.separator ?? ' ')} + `)}`;
    case TEXT:
      return `${TEXT_OPS[op.op]?.label || op.op} in ${op.column}`;
    case REPLACE:
      return op.mode === 'text'
        ? `Replace ${quoteish(op.find)} with ${quoteish(op.replacement)} inside ${op.column}`
        : `Replace ${quoteish(op.find)} with ${quoteish(op.replacement)} in ${op.column}`;
    case FILL:
      return `Fill blanks in ${op.column} with ${quoteish(op.value)}`;
    case BLANKS:
      return names(op.columns).length
        ? `Remove rows where ${names(op.columns).join(' or ')} is blank`
        : 'Remove rows that are entirely blank';
    case DEDUPE:
      return names(op.columns).length
        ? `Remove duplicates by ${names(op.columns).join(', ')}`
        : 'Remove duplicate rows';
    case SORT:
      return `Sort by ${(op.by || []).map((s) => `${s.column} ${s.direction === 'desc' ? 'descending' : 'ascending'}`).join(', ')}`;
    case LIMIT:
      return op.by
        ? `Keep the ${op.count} rows with the ${op.direction === 'asc' ? 'lowest' : 'highest'} ${op.by}`
        : `Keep the first ${op.count} rows`;
    case GROUP:
      return `Group by ${names(op.by).join(', ')}: ${(op.aggregates || [])
        .map((a) => a.name)
        .join(', ')}`;
    case UNPIVOT:
      return `Unpivot ${names(op.columns).join(', ')} into ${op.nameColumn || 'Attribute'} and ${op.valueColumn || 'Value'}`;
    case PIVOT:
      return `Pivot ${op.column} into columns, ${op.fn || 'SUM'} of ${op.measure}`;
    case INDEX:
      return `Add row number ${op.name}`;
    default:
      return 'Unknown step';
  }
}

/**
 * The columns a step reads, by name. The lineage says where the outputs came
 * from; this says what the step touched, which the UI uses to warn before a
 * column is dropped and the AI uses to explain a proposal.
 */
function exprColumns(expr, columns) {
  const tokens = tokenize(expr) || [];
  const out = [];
  for (const t of tokens) {
    if (t.kind !== 'column') continue;
    const c = resolveColumn(t.value, columns);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

const rowExpr = (expr, columns) =>
  inOurWords(validateExpression(expr, { columns, measures: [], mode: 'filter' }));

/**
 * Can this run against these columns?
 *
 * Checked against the columns as the *previous* step leaves them, which is why
 * this takes a column list rather than reading a dataset: a rename in step one
 * decides what step two is allowed to mention.
 */
export function validateTransform(op, columns = []) {
  const kind = op?.kind;
  if (!TRANSFORM_KINDS.includes(kind)) return { ok: false, error: `Unknown step type: ${kind}` };

  const ok = { ok: true, error: null };
  const fail = (error) => ({ ok: false, error });
  const named = (name) => resolveColumn(name, columns);
  const missing = (name) => fail(`There is no column called "${name}".`);
  const needColumn = () => {
    if (!op.column) return fail('Choose a column.');
    return named(op.column) ? null : missing(op.column);
  };
  const newName = (name, taken = columns) => columnNameProblem(name, taken);

  switch (kind) {
    case RENAME: {
      const bad = needColumn();
      if (bad) return bad;
      const from = named(op.column);
      const problem = newName(op.to, columns.filter((c) => c !== from));
      return problem ? fail(problem) : ok;
    }

    case DROP: {
      const bad = needColumn();
      if (bad) return bad;
      if (columns.length <= 1) return fail('That is the last column — there would be nothing left.');
      return ok;
    }

    case KEEP: {
      const wanted = names(op.columns);
      if (!wanted.length) return fail('Choose at least one column to keep.');
      for (const c of wanted) if (!named(c)) return missing(c);
      return ok;
    }

    case RETYPE: {
      const bad = needColumn();
      if (bad) return bad;
      if (!RETYPE_TARGETS[op.to]) return fail(`Cannot read a column as "${op.to}".`);
      return ok;
    }

    case DERIVE: {
      const problem = newName(op.name);
      if (problem) return fail(problem);
      // `filter` mode is the row-wise one: it refuses SUM, AVG and COUNT, which
      // is exactly right — a derived column is computed from one row, and an
      // aggregate would silently collapse the table.
      const checked = rowExpr(op.expr, columns);
      return checked.ok ? ok : checked;
    }

    case FILTER: {
      const checked = rowExpr(op.expr, columns);
      return checked.ok ? ok : checked;
    }

    case CONDITIONAL: {
      const problem = newName(op.name);
      if (problem) return fail(problem);
      const rules = Array.isArray(op.rules) ? op.rules : [];
      if (!rules.length) return fail('Give the column at least one rule.');
      for (const [i, rule] of rules.entries()) {
        const when = rowExpr(rule?.when, columns);
        if (!when.ok) return fail(`Rule ${i + 1}: ${when.error}`);
        const then = rowExpr(rule?.then, columns);
        if (!then.ok) return fail(`Rule ${i + 1}, value: ${then.error}`);
      }
      if (op.otherwise !== undefined && op.otherwise !== null && String(op.otherwise).trim() !== '') {
        const otherwise = rowExpr(op.otherwise, columns);
        if (!otherwise.ok) return fail(`Otherwise: ${otherwise.error}`);
      }
      return ok;
    }

    case BUCKET: {
      const problem = newName(op.name);
      if (problem) return fail(problem);
      const bad = needColumn();
      if (bad) return bad;
      const edges = (Array.isArray(op.edges) ? op.edges : []).map(Number);
      if (!edges.length) return fail('Give at least one boundary to band the column at.');
      if (edges.some((e) => !isFinite(e))) return fail('Every boundary has to be a number.');
      for (let i = 1; i < edges.length; i++) {
        if (edges[i] <= edges[i - 1]) return fail('Boundaries have to go up.');
      }
      if (op.labels && (!Array.isArray(op.labels) || op.labels.length !== edges.length + 1)) {
        return fail(`With ${edges.length} boundaries there are ${edges.length + 1} bands to label.`);
      }
      return ok;
    }

    case DATEPART: {
      const problem = newName(op.name);
      if (problem) return fail(problem);
      const bad = needColumn();
      if (bad) return bad;
      if (!DATE_PARTS[op.part]) return fail(`"${op.part}" is not a part of a date this understands.`);
      return ok;
    }

    case SPLIT: {
      const bad = needColumn();
      if (bad) return bad;
      if (op.separator === undefined || op.separator === null || String(op.separator) === '') {
        return fail('Say what to split on — a comma, a space, a dash.');
      }
      const into = names(op.into);
      if (!into.length) return fail('Name the columns the pieces go into.');
      if (into.length > 10) return fail('Ten pieces at most.');
      const source = named(op.column);
      const taken = op.dropOriginal ? columns.filter((c) => c !== source) : columns;
      const seen = [];
      for (const name of into) {
        const problem = newName(name, [...taken, ...seen]);
        if (problem) return fail(problem);
        seen.push(name);
      }
      return ok;
    }

    case MERGE: {
      const problem = newName(op.name);
      if (problem) return fail(problem);
      const parts = names(op.columns);
      if (parts.length < 2) return fail('Choose at least two columns to combine.');
      for (const c of parts) if (!named(c)) return missing(c);
      return ok;
    }

    case TEXT: {
      const bad = needColumn();
      if (bad) return bad;
      if (!TEXT_OPS[op.op]) return fail(`"${op.op}" is not a text operation this understands.`);
      return ok;
    }

    case REPLACE: {
      const bad = needColumn();
      if (bad) return bad;
      if (op.find === undefined || op.find === null || String(op.find) === '') {
        return fail('Say what to look for.');
      }
      if (op.mode && op.mode !== 'value' && op.mode !== 'text') return fail(`"${op.mode}" is not a replace mode.`);
      return ok;
    }

    case FILL: {
      const bad = needColumn();
      if (bad) return bad;
      if (op.value === undefined || op.value === null || String(op.value) === '') {
        return fail('Say what to put in the blanks.');
      }
      return ok;
    }

    case BLANKS: {
      for (const c of names(op.columns)) if (!named(c)) return missing(c);
      return ok;
    }

    case DEDUPE: {
      for (const c of names(op.columns)) if (!named(c)) return missing(c);
      return ok;
    }

    case SORT: {
      const by = Array.isArray(op.by) ? op.by : [];
      if (!by.length) return fail('Choose a column to sort by.');
      for (const s of by) if (!named(s?.column)) return missing(s?.column);
      return ok;
    }

    case LIMIT: {
      const count = Number(op.count);
      if (!Number.isInteger(count) || count < 1) return fail('How many rows to keep has to be a whole number above zero.');
      if (op.by && !named(op.by)) return missing(op.by);
      return ok;
    }

    case GROUP: {
      const by = names(op.by);
      if (!by.length) return fail('Choose at least one column to group by.');
      for (const c of by) if (!named(c)) return missing(c);
      const aggregates = Array.isArray(op.aggregates) ? op.aggregates : [];
      if (!aggregates.length) return fail('Add at least one calculation — a sum, an average, a count.');
      const taken = by.map((c) => named(c));
      for (const [i, a] of aggregates.entries()) {
        const fn = String(a?.fn || '').toUpperCase();
        const def = GROUP_FUNCTIONS[fn];
        if (!def) return fail(`Calculation ${i + 1}: "${a?.fn}" is not one of SUM, AVG, MIN, MAX, COUNT, COUNT_DISTINCT, MEDIAN or FIRST.`);
        if (def.needsColumn && !named(a?.column)) return missing(a?.column);
        const problem = newName(a?.name, taken);
        if (problem) return fail(`Calculation ${i + 1}: ${problem}`);
        taken.push(String(a.name).trim());
      }
      return ok;
    }

    case UNPIVOT: {
      const cols = names(op.columns);
      if (cols.length < 2) return fail('Choose at least two columns to turn into rows.');
      for (const c of cols) if (!named(c)) return missing(c);
      const rest = columns.filter((c) => !cols.some((u) => resolveColumn(u, columns) === c));
      const nameColumn = String(op.nameColumn || 'Attribute').trim();
      const valueColumn = String(op.valueColumn || 'Value').trim();
      const p1 = newName(nameColumn, rest);
      if (p1) return fail(p1);
      const p2 = newName(valueColumn, [...rest, nameColumn]);
      if (p2) return fail(p2);
      return ok;
    }

    case PIVOT: {
      const bad = needColumn();
      if (bad) return bad;
      if (!op.measure || !named(op.measure)) return missing(op.measure);
      if (named(op.measure) === named(op.column)) return fail('The column to spread and the one to total have to be different.');
      const fn = String(op.fn || 'SUM').toUpperCase();
      if (!['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'].includes(fn)) return fail(`"${op.fn}" cannot be used in a pivot.`);
      const values = (Array.isArray(op.values) ? op.values : []).filter((v) => v !== null && v !== undefined && String(v) !== '');
      if (!values.length) return fail('List the values that become columns.');
      if (values.length > 50) return fail('Fifty columns at most — past that, a pivot is not readable.');
      const rest = columns.filter((c) => c !== named(op.column) && c !== named(op.measure));
      const seen = [];
      for (const v of values) {
        const problem = newName(String(v), [...rest, ...seen]);
        if (problem) return fail(problem);
        seen.push(String(v));
      }
      return ok;
    }

    case INDEX: {
      const problem = newName(op.name);
      return problem ? fail(problem) : ok;
    }

    default:
      return fail(`Unknown step type: ${kind}`);
  }
}

/** A lineage where every column is its own source. */
const identity = (columns) => Object.fromEntries(columns.map((c) => [c, [c]]));

/**
 * The query for one step, the columns that exist afterwards, and where each
 * came from.
 *
 * Columns are always listed rather than selected with `*`. It costs a few
 * characters and buys two things: the output order is the order a person sees
 * in the list, and the resulting column names are known here rather than
 * discovered by looking at whatever came back.
 */
export function planTransform(op, columns = [], table = 'Dataset') {
  const checked = validateTransform(op, columns);
  if (!checked.ok) return { ok: false, error: checked.error, sql: null, columns, lineage: identity(columns) };

  const from = `FROM ${br(table)}`;
  const named = (name) => resolveColumn(name, columns);
  const done = (sql, next, lineage) => ({ ok: true, error: null, sql, columns: next, lineage });
  /** Passthrough of the current columns, with `replaced` swapped for an expression. */
  const inPlace = (target, expression) =>
    columns.map((c) => (c === target ? `${expression} AS ${br(c)}` : br(c))).join(', ');
  /** Everything as it was, plus one new column. */
  const appended = (expression, name, sources) =>
    done(`SELECT ${list(columns)}, ${expression} AS ${br(name)} ${from}`, [...columns, name], {
      ...identity(columns),
      [name]: sources,
    });

  switch (op.kind) {
    case RENAME: {
      const target = named(op.column);
      const to = String(op.to).trim();
      const next = columns.map((c) => (c === target ? to : c));
      const select = columns.map((c) => (c === target ? `${br(c)} AS ${br(to)}` : br(c))).join(', ');
      const lineage = identity(next);
      lineage[to] = [target];
      return done(`SELECT ${select} ${from}`, next, lineage);
    }

    case DROP: {
      const target = named(op.column);
      const next = columns.filter((c) => c !== target);
      return done(`SELECT ${list(next)} ${from}`, next, identity(next));
    }

    case KEEP: {
      const next = [];
      for (const c of names(op.columns)) {
        const real = named(c);
        if (real && !next.includes(real)) next.push(real);
      }
      return done(`SELECT ${list(next)} ${from}`, next, identity(next));
    }

    case RETYPE: {
      const target = named(op.column);
      const fn = RETYPE_TARGETS[op.to].fn;
      return done(`SELECT ${inPlace(target, `${fn}(${br(target)})`)} ${from}`, columns, identity(columns));
    }

    case DERIVE: {
      const name = String(op.name).trim();
      return appended(`(${op.expr})`, name, exprColumns(op.expr, columns));
    }

    case FILTER: {
      // The one step that changes the rows rather than the shape.
      const where = op.mode === 'remove' ? `NOT (${op.expr})` : `(${op.expr})`;
      return done(`SELECT ${list(columns)} ${from} WHERE ${where}`, columns, identity(columns));
    }

    case CONDITIONAL: {
      const name = String(op.name).trim();
      const rules = op.rules.map((r) => `WHEN (${r.when}) THEN ${r.then}`).join(' ');
      const hasElse = op.otherwise !== undefined && op.otherwise !== null && String(op.otherwise).trim() !== '';
      const expression = `CASE ${rules}${hasElse ? ` ELSE ${op.otherwise}` : ''} END`;
      const sources = [
        ...op.rules.flatMap((r) => [...exprColumns(r.when, columns), ...exprColumns(r.then, columns)]),
        ...(hasElse ? exprColumns(op.otherwise, columns) : []),
      ];
      return appended(expression, name, [...new Set(sources)]);
    }

    case BUCKET: {
      const name = String(op.name).trim();
      const target = named(op.column);
      const edges = op.edges.map(Number);
      const labels = op.labels || bucketLabels(edges);
      const whens = edges.map((edge, i) => `WHEN ${br(target)} < ${edge} THEN ${str(labels[i])}`);
      const expression = `CASE WHEN ${br(target)} IS NULL THEN NULL ${whens.join(' ')} ELSE ${str(labels[edges.length])} END`;
      return appended(expression, name, [target]);
    }

    case DATEPART: {
      const name = String(op.name).trim();
      const target = named(op.column);
      return appended(`${DATE_PARTS[op.part].fn}(${br(target)})`, name, [target]);
    }

    case SPLIT: {
      const target = named(op.column);
      const into = names(op.into);
      const sep = str(op.separator);
      const base = op.dropOriginal ? columns.filter((c) => c !== target) : columns;
      const pieces = into.map((n, i) => `SPLIT_PART(${br(target)}, ${sep}, ${i + 1}) AS ${br(n)}`);
      const lineage = identity(base);
      for (const n of into) lineage[n] = [target];
      return done(`SELECT ${[...base.map(br), ...pieces].join(', ')} ${from}`, [...base, ...into], lineage);
    }

    case MERGE: {
      const name = String(op.name).trim();
      const parts = names(op.columns).map(named);
      const sep = str(op.separator ?? ' ');
      return appended(`TEXT_JOIN(${sep}, ${list(parts)})`, name, parts);
    }

    case TEXT: {
      const target = named(op.column);
      const fn = TEXT_OPS[op.op].fn;
      return done(`SELECT ${inPlace(target, `${fn}(${br(target)})`)} ${from}`, columns, identity(columns));
    }

    case REPLACE: {
      const target = named(op.column);
      const find = literal(op.find);
      const replacement = literal(op.replacement ?? '');
      const expression =
        op.mode === 'text'
          ? `REPLACE(${br(target)}, ${find}, ${replacement})`
          : `CASE WHEN ${br(target)} = ${find} THEN ${replacement} ELSE ${br(target)} END`;
      return done(`SELECT ${inPlace(target, expression)} ${from}`, columns, identity(columns));
    }

    case FILL: {
      const target = named(op.column);
      return done(`SELECT ${inPlace(target, `COALESCE(${br(target)}, ${literal(op.value)})`)} ${from}`, columns, identity(columns));
    }

    case BLANKS: {
      const cols = names(op.columns).map(named);
      const checked = cols.length ? cols : columns;
      const joiner = cols.length ? ' OR ' : ' AND ';
      const where = checked.map((c) => `IS_BLANK(${br(c)})`).join(joiner);
      return done(`SELECT ${list(columns)} ${from} WHERE NOT (${where})`, columns, identity(columns));
    }

    case DEDUPE: {
      const keys = names(op.columns).map(named);
      if (!keys.length) {
        return done(`SELECT DISTINCT ${list(columns)} ${from}`, columns, identity(columns));
      }
      // The first row for each key wins, and the rest of its columns come with
      // it. GROUP BY rather than a window: alasql's ROW_NUMBER ignores PARTITION.
      const select = columns.map((c) => (keys.includes(c) ? br(c) : `FIRST(${br(c)}) AS ${br(c)}`)).join(', ');
      return done(`SELECT ${select} ${from} GROUP BY ${list(keys)}`, columns, identity(columns));
    }

    case SORT: {
      const order = op.by
        .map((s) => `${br(named(s.column))} ${s.direction === 'desc' ? 'DESC' : 'ASC'}`)
        .join(', ');
      return done(`SELECT ${list(columns)} ${from} ORDER BY ${order}`, columns, identity(columns));
    }

    case LIMIT: {
      const count = Number(op.count);
      const order = op.by ? ` ORDER BY ${br(named(op.by))} ${op.direction === 'asc' ? 'ASC' : 'DESC'}` : '';
      return done(`SELECT ${list(columns)} ${from}${order} LIMIT ${count}`, columns, identity(columns));
    }

    case GROUP: {
      const by = names(op.by).map(named);
      const lineage = identity(by);
      const aggregates = op.aggregates.map((a) => {
        const fn = String(a.fn).toUpperCase();
        const name = String(a.name).trim();
        const column = GROUP_FUNCTIONS[fn].needsColumn ? named(a.column) : null;
        lineage[name] = column ? [column] : [];
        if (fn === 'COUNT') return `COUNT(*) AS ${br(name)}`;
        if (fn === 'COUNT_DISTINCT') return `COUNT(DISTINCT ${br(column)}) AS ${br(name)}`;
        return `${fn}(${br(column)}) AS ${br(name)}`;
      });
      const next = [...by, ...op.aggregates.map((a) => String(a.name).trim())];
      return done(`SELECT ${[...by.map(br), ...aggregates].join(', ')} ${from} GROUP BY ${list(by)}`, next, lineage);
    }

    case UNPIVOT: {
      const cols = names(op.columns).map(named);
      const rest = columns.filter((c) => !cols.includes(c));
      const nameColumn = String(op.nameColumn || 'Attribute').trim();
      const valueColumn = String(op.valueColumn || 'Value').trim();
      // One SELECT per column being turned into rows, stacked. alasql has no
      // UNPIVOT, and this is what UNPIVOT means anyway.
      const parts = cols.map(
        (c) => `SELECT ${[...rest.map(br), `${str(c)} AS ${br(nameColumn)}`, `${br(c)} AS ${br(valueColumn)}`].join(', ')} ${from}`
      );
      const next = [...rest, nameColumn, valueColumn];
      const lineage = { ...identity(rest), [nameColumn]: [], [valueColumn]: cols };
      return done(parts.join(' UNION ALL '), next, lineage);
    }

    case PIVOT: {
      const dimension = named(op.column);
      const measure = named(op.measure);
      const fn = String(op.fn || 'SUM').toUpperCase();
      const rest = columns.filter((c) => c !== dimension && c !== measure);
      const values = op.values.map(String);
      // SUM and COUNT of nothing is zero; an average or an extreme of nothing
      // is nothing.
      const empty = fn === 'SUM' || fn === 'COUNT' ? '0' : 'NULL';
      const cells = values.map(
        (v) => `${fn === 'COUNT' ? 'SUM' : fn}(CASE WHEN ${br(dimension)} = ${literal(v)} THEN ${fn === 'COUNT' ? '1' : br(measure)} ELSE ${empty} END) AS ${br(v)}`
      );
      const lineage = identity(rest);
      for (const v of values) lineage[v] = [dimension, measure];
      const group = rest.length ? ` GROUP BY ${list(rest)}` : '';
      return done(`SELECT ${[...rest.map(br), ...cells].join(', ')} ${from}${group}`, [...rest, ...values], lineage);
    }

    case INDEX: {
      const name = String(op.name).trim();
      return appended('ROWNUM()', name, []);
    }

    default:
      return { ok: false, error: `Unknown step type: ${op.kind}`, sql: null, columns, lineage: identity(columns) };
  }
}

/** `< 100`, `100–500`, `500+` — what a band is called when nobody named it. */
export function bucketLabels(edges) {
  const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));
  const out = [`< ${fmt(edges[0])}`];
  for (let i = 1; i < edges.length; i++) out.push(`${fmt(edges[i - 1])}–${fmt(edges[i])}`);
  out.push(`${fmt(edges[edges.length - 1])}+`);
  return out;
}

/**
 * Plan a whole list.
 *
 * A step that cannot run is **skipped, not fatal**. Transforms are edited by
 * hand and they refer to each other: dropping a column that a later derive
 * mentions should leave that derive reported as broken, with everything around
 * it still working, rather than blanking the dataset and making the reader undo
 * their way backwards to find out which one it was.
 */
export function planTransforms(ops = [], columns = [], table = 'Dataset') {
  const steps = [];
  const skipped = [];
  let current = [...columns];

  for (const op of ops) {
    if (op?.enabled === false) {
      skipped.push({ id: op.id, reason: 'turned off' });
      continue;
    }
    const step = planTransform(op, current, table);
    if (!step.ok) {
      skipped.push({ id: op?.id, reason: step.error });
      continue;
    }
    steps.push({
      id: op.id,
      kind: op.kind,
      sql: step.sql,
      columns: step.columns,
      lineage: step.lineage,
      describe: describeTransform(op),
    });
    current = step.columns;
  }

  return { steps, columns: current, skipped };
}

/**
 * The doubt about a column, carried across a reshape.
 *
 * The confidence store is keyed by column name and by row index, and transforms
 * move both. A rename orphans its entry, a drop leaves one pointing at nothing,
 * and a filter renumbers every row it keeps. Left alone, the store would go on
 * describing a table that no longer exists — and it would do it quietly, since
 * a count against a missing column simply never surfaces.
 *
 * Three rules, applied through each step's lineage so that a pivot and a
 * rename are handled by the same twenty lines:
 *
 *   - **Positions are dropped** the moment any step runs. A filter removes rows
 *     and everything after it shifts up; keeping the indices would put warnings
 *     on innocent cells, which is worse than keeping none. Counts stay exact,
 *     the way they already do after a join.
 *   - **A column follows its source, and a column with no output is gone.**
 *     Nothing else would be honest.
 *   - **A column built from several inherits the worst of them.** `[net] /
 *     [units]` cannot be sounder than `units` was: if a third of that column
 *     was a coin toss then a third of this one is too, and a finding built on
 *     it should be capped accordingly. This is the whole argument of the
 *     evidence tier, applied one step further along.
 *
 * Takes the PLAN, not the ops: the plan already knows which steps ran and what
 * each one did to the columns, and a second reading of the ops here would be a
 * second place for that to be decided.
 */
export function confidenceAfterTransforms(store, plan) {
  if (!store) return store;
  const steps = plan?.steps || [];
  if (!steps.length) return store;

  const next = createConfidence();
  let byColumn = JSON.parse(JSON.stringify(store.byColumn || {}));
  let rows = { ...(store.rows || {}) };
  // Row indices no longer mean anything; say so rather than keeping them.
  next.cells = {};
  next.recorded = 0;
  next.truncated = (store.total || 0) > 0;

  const countOf = (tally) => Object.values(tally || {}).reduce((a, b) => a + b, 0);

  for (const step of steps) {
    const lineage = step.lineage || {};
    const afterColumns = {};
    const afterRows = {};
    for (const [output, sources] of Object.entries(lineage)) {
      let worst = null;
      for (const source of sources || []) {
        const tally = byColumn[source];
        if (!tally) continue;
        const count = countOf(tally);
        if (count > 0 && (!worst || count > worst.count)) worst = { source, count, tally };
      }
      if (!worst) continue;
      afterColumns[output] = { ...worst.tally };
      if (rows[worst.source] !== undefined) afterRows[output] = rows[worst.source];
    }
    byColumn = afterColumns;
    rows = afterRows;
  }

  next.byColumn = byColumn;
  next.rows = rows;
  next.total = Object.values(byColumn).reduce((sum, tally) => sum + countOf(tally), 0);
  return next;
}
