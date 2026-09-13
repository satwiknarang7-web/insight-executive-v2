/**
 * Reshaping the data before anything is analysed.
 *
 * Cleaning decides what a value *is* — that `"1,234"` is a number and
 * `03/04/2024` is a date. This is the layer above it: renaming a column,
 * deriving one from others, dropping one, changing its type, keeping only some
 * rows. Things the file cannot tell you and only the person reading it knows.
 *
 * ## Every transform is a query
 *
 * Not a hidden mutation, and not an opaque step in a pipeline — one `SELECT`
 * per operation, over the table as the previous operation left it. That is the
 * same promise the rest of this product makes about its numbers, applied to the
 * data itself: if a column was changed, there is a query that says how, and it
 * can be read by whoever has to defend the figure built on it.
 *
 * It also means the work is already done. `alasql` executes the SQL, and
 * `measures.js` already knows how to validate an expression — so a derived
 * column is checked by the same rules a measure is, including the ones that
 * keep a formula from becoming a query: no semicolons, no comments, no SELECT
 * or FROM or JOIN, and a tokenizer that refuses characters outside the set an
 * expression can contain. That matters more here than it does for a measure,
 * because these expressions end up concatenated into SQL.
 *
 * ## Pure
 *
 * Nothing here executes anything. A plan is a list of `{ sql, columns }` — the
 * query to run and the columns that exist once it has. The worker runs them in
 * order; the UI shows them; the tests read them without a database.
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
export const DERIVE = 'derive';
export const RETYPE = 'retype';
export const FILTER = 'filter';

export const TRANSFORM_KINDS = [RENAME, DROP, DERIVE, RETYPE, FILTER];

/** The types a column can be forced to. Anything else is left alone. */
export const RETYPE_TARGETS = {
  number: { label: 'Number', cast: 'FLOAT' },
  text: { label: 'Text', cast: 'STRING' },
};

const br = (name) => `[${name}]`;

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

/** One sentence describing what a transform does, for a list a person reads. */
export function describeTransform(op) {
  switch (op?.kind) {
    case RENAME:
      return `Rename ${op.column} to ${op.to}`;
    case DROP:
      return `Drop ${op.column}`;
    case DERIVE:
      return `Add ${op.name} = ${op.expr}`;
    case RETYPE:
      return `Read ${op.column} as ${RETYPE_TARGETS[op.to]?.label?.toLowerCase() || op.to}`;
    case FILTER:
      return `Keep rows where ${op.expr}`;
    default:
      return 'Unknown step';
  }
}

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

  const named = (name) => resolveColumn(name, columns);

  if (kind === RENAME) {
    const from = named(op.column);
    if (!from) return { ok: false, error: `There is no column called "${op.column}".` };
    const problem = columnNameProblem(op.to, columns.filter((c) => c !== from));
    if (problem) return { ok: false, error: problem };
    return { ok: true, error: null };
  }

  if (kind === DROP) {
    const from = named(op.column);
    if (!from) return { ok: false, error: `There is no column called "${op.column}".` };
    if (columns.length <= 1) return { ok: false, error: 'That is the last column — there would be nothing left.' };
    return { ok: true, error: null };
  }

  if (kind === RETYPE) {
    const from = named(op.column);
    if (!from) return { ok: false, error: `There is no column called "${op.column}".` };
    if (!RETYPE_TARGETS[op.to]) return { ok: false, error: `Cannot read a column as "${op.to}".` };
    return { ok: true, error: null };
  }

  if (kind === DERIVE) {
    const problem = columnNameProblem(op.name, columns);
    if (problem) return { ok: false, error: problem };
    // `filter` mode is the row-wise one: it refuses SUM, AVG and COUNT, which
    // is exactly right — a derived column is computed from one row, and an
    // aggregate would silently collapse the table.
    const checked = validateExpression(op.expr, { columns, measures: [], mode: 'filter' });
    if (!checked.ok) return inOurWords(checked);
    return { ok: true, error: null };
  }

  // FILTER
  const checked = validateExpression(op.expr, { columns, measures: [], mode: 'filter' });
  if (!checked.ok) return inOurWords(checked);
  return { ok: true, error: null };
}

/**
 * The query for one step, and the columns that exist afterwards.
 *
 * Columns are always listed rather than selected with `*`. It costs a few
 * characters and buys two things: the output order is the order a person sees
 * in the list, and the resulting column names are known here rather than
 * discovered by looking at whatever came back.
 */
export function planTransform(op, columns = [], table = 'Dataset') {
  const checked = validateTransform(op, columns);
  if (!checked.ok) return { ok: false, error: checked.error, sql: null, columns };

  const from = `FROM ${br(table)}`;
  const list = (cols) => cols.map(br).join(', ');

  if (op.kind === RENAME) {
    const target = resolveColumn(op.column, columns);
    const to = String(op.to).trim();
    const next = columns.map((c) => (c === target ? to : c));
    const select = columns.map((c) => (c === target ? `${br(c)} AS ${br(to)}` : br(c))).join(', ');
    return { ok: true, error: null, sql: `SELECT ${select} ${from}`, columns: next };
  }

  if (op.kind === DROP) {
    const target = resolveColumn(op.column, columns);
    const next = columns.filter((c) => c !== target);
    return { ok: true, error: null, sql: `SELECT ${list(next)} ${from}`, columns: next };
  }

  if (op.kind === RETYPE) {
    const target = resolveColumn(op.column, columns);
    const cast = RETYPE_TARGETS[op.to].cast;
    const select = columns
      .map((c) => (c === target ? `CAST(${br(c)} AS ${cast}) AS ${br(c)}` : br(c)))
      .join(', ');
    return { ok: true, error: null, sql: `SELECT ${select} ${from}`, columns };
  }

  if (op.kind === DERIVE) {
    const name = String(op.name).trim();
    const next = [...columns, name];
    return {
      ok: true,
      error: null,
      sql: `SELECT ${list(columns)}, (${op.expr}) AS ${br(name)} ${from}`,
      columns: next,
    };
  }

  // FILTER — the only step that changes the rows rather than the shape.
  return {
    ok: true,
    error: null,
    sql: `SELECT ${list(columns)} ${from} WHERE (${op.expr})`,
    columns,
  };
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
    steps.push({ id: op.id, kind: op.kind, sql: step.sql, columns: step.columns, describe: describeTransform(op) });
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
 * Three rules:
 *
 *   - **Positions are dropped** the moment any step runs. A filter removes rows
 *     and everything after it shifts up; keeping the indices would put warnings
 *     on innocent cells, which is worse than keeping none. Counts stay exact,
 *     the way they already do after a join.
 *   - **Renames follow, drops delete.** Nothing else would be honest.
 *   - **A derived column inherits the worst of its inputs.** `[net] / [units]`
 *     cannot be sounder than `units` was: if a third of that column was a coin
 *     toss then a third of this one is too, and a finding built on it should be
 *     capped accordingly. This is the whole argument of the evidence tier,
 *     applied one step further along.
 */
export function confidenceAfterTransforms(store, ops = []) {
  if (!store) return store;
  const active = (ops || []).filter((op) => op?.enabled !== false);
  if (!active.length) return store;

  const next = createConfidence();
  next.byColumn = JSON.parse(JSON.stringify(store.byColumn || {}));
  next.rows = { ...(store.rows || {}) };
  next.total = store.total || 0;
  // Row indices no longer mean anything; say so rather than keeping them.
  next.cells = {};
  next.recorded = 0;
  next.truncated = next.total > 0;

  const countOf = (column) =>
    Object.values(next.byColumn[column] || {}).reduce((a, b) => a + b, 0);

  for (const op of active) {
    if (op.kind === RENAME) {
      const from = op.column;
      const to = String(op.to || '').trim();
      if (next.byColumn[from]) {
        next.byColumn[to] = next.byColumn[from];
        delete next.byColumn[from];
      }
      if (next.rows[from] !== undefined) {
        next.rows[to] = next.rows[from];
        delete next.rows[from];
      }
      continue;
    }

    if (op.kind === DROP) {
      const gone = countOf(op.column);
      next.total = Math.max(0, next.total - gone);
      delete next.byColumn[op.column];
      delete next.rows[op.column];
      continue;
    }

    if (op.kind === DERIVE) {
      // Whichever input was least trustworthy sets the floor for the result.
      const tokens = tokenize(op.expr) || [];
      let worst = null;
      for (const t of tokens) {
        if (t.kind !== 'column') continue;
        const count = countOf(t.value);
        if (count > 0 && (!worst || count > worst.count)) {
          worst = { column: t.value, count };
        }
      }
      if (worst) {
        const name = String(op.name || '').trim();
        next.byColumn[name] = { ...(next.byColumn[worst.column] || {}) };
        if (next.rows[worst.column] !== undefined) next.rows[name] = next.rows[worst.column];
        next.total += worst.count;
      }
    }
    // RETYPE changes how a value reads, not how sure anyone is of it.
    // FILTER removes rows, which can only make the counts an overstatement --
    // the safe direction, and correcting it would need the positions this has
    // just thrown away.
  }

  return next;
}
