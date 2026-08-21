/**
 * The data model layer: turning several related sheets into one analysable model.
 *
 * The rest of the engine (planner, chart resolver, insight engine) reasons about
 * exactly one flat row set and is very good at it. Rather than teach all of that
 * to plan joins, this module does the joining once — up front — and hands the
 * existing engine a single wider table:
 *
 *   sheets → infer relationships → pick a fact table → build one joined view
 *
 * So `Orders` joined to `Customers` and `Products` becomes one row set that also
 * carries `region` and `category`, and every existing chart/insight rule works
 * on cross-sheet dimensions without knowing joins exist.
 *
 * Two deliberate constraints:
 *
 * 1. Only many-to-one and one-to-one joins are produced. The parent side of
 *    every relationship must be unique, which is what guarantees the view has
 *    exactly as many rows as the fact table. A fan-out would silently multiply
 *    every SUM in the app, and a confidently wrong total is worse than no total.
 *    Many-to-many links are detected but reported as unsupported, not joined.
 *
 * 2. Nothing here mutates its inputs, and nothing here talks to a worker, the
 *    DOM or IndexedDB — it is all pure so it can be tested directly.
 */
import { isIdentifier } from './chartResolver.js';

/** Rows sampled per table when profiling join keys. */
const SAMPLE_ROWS = 100000;
/** A column's distinct values below this are never worth joining on. */
const MIN_PARENT_DISTINCT = 2;
/** Fraction of a child column's values that must exist in the parent. */
const MIN_CONTAINMENT = 0.7;
/** Containment demanded when the column names give no corroborating signal. */
const BLIND_CONTAINMENT = 0.98;
/** Below this a candidate is not offered at all. */
const MIN_CONFIDENCE = 0.55;
/** How far the view builder will walk from the fact table. */
const DEFAULT_MAX_DEPTH = 2;

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

const RESERVED = new Set(['table', 'select', 'from', 'where', 'group', 'order', 'join', 'index']);

/**
 * Turn a sheet or file name into a stable SQL-safe table identifier, unique
 * within `taken`. Sheet names in the wild are things like "Q1 Orders (final)".
 */
export function normalizeTableName(raw, taken = new Set()) {
  let base = String(raw ?? '')
    .replace(/\.(csv|tsv|txt|xlsx?|xlsm)$/i, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!base) base = 'Sheet';
  if (/^[0-9]/.test(base)) base = `T_${base}`;
  if (RESERVED.has(base.toLowerCase())) base = `${base}_tbl`;

  let name = base;
  let n = 2;
  while (taken.has(name)) name = `${base}_${n++}`;
  return name;
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Naive singularisation — enough to relate `Customers` to `customer_id`. */
function singular(s) {
  if (s.endsWith('ies')) return `${s.slice(0, -3)}y`;
  if (s.endsWith('ses') || s.endsWith('xes')) return s.slice(0, -2);
  if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1);
  return s;
}

const stripKeySuffix = (s) => s.replace(/(id|key|code|no|num|number|ref)$/, '');

/**
 * How strongly do these names suggest a foreign key, from 0 (nothing) to 1?
 *
 * Value overlap alone produces a lot of nonsense — any two integer columns
 * starting at 1 "contain" each other. The name is what separates a real key
 * from a coincidence, so it carries real weight in the score below.
 */
export function nameAffinity(childColumn, parentTable, parentColumn) {
  const c = norm(childColumn);
  const p = norm(parentColumn);
  const t = singular(norm(parentTable));
  if (!c || !p) return 0;

  if (c === p) return 1; // order.region_code ↔ regions.region_code
  if (c === t + p) return 0.95; // order.customer_id ↔ Customers.id
  const cs = stripKeySuffix(c);
  const ps = stripKeySuffix(p);
  if (cs && cs === t) return 0.9; // order.customer_id ↔ Customers.<pk>
  if (cs && ps && cs === ps) return 0.8; // order.customer_ref ↔ Customers.customer_id
  if (c.endsWith(p) || p.endsWith(c)) return 0.5;
  return 0;
}

// ---------------------------------------------------------------------------
// Key profiling
// ---------------------------------------------------------------------------

/**
 * Canonical form of a value for join purposes.
 *
 * The same id routinely arrives as the number 1001 in one sheet and the string
 * "1001" in another — Excel columns are typed per cell, and CSV ingestion
 * coerces anything numeric-looking. Matching on the raw value would miss every
 * one of those, so both sides are canonicalised the same way. Case is folded
 * for the same reason ("ACME" vs "Acme").
 */
export function joinKey(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  const s = String(value).trim();
  if (s === '') return null;
  // "1001", "1001.0" and 1001 must all collapse to the same key.
  if (/^-?\d+(\.0+)?$/.test(s)) return String(Number(s));
  return s.toLowerCase();
}

/**
 * Per-column facts needed to judge join candidates. One pass over a sample of
 * the rows; float columns get no value set because a float is never a key.
 */
export function profileKeys(rows, columns) {
  const n = Math.min(rows.length, SAMPLE_ROWS);
  const sampled = rows.length > n;
  const stats = {};

  for (const col of columns) {
    if (col === 'isAnomaly') continue;
    let nonNull = 0;
    let numeric = 0;
    let strings = 0;
    let integral = true;
    const values = new Set();

    for (let i = 0; i < n; i++) {
      const v = rows[i][col];
      if (v === null || v === undefined || v === '') continue;
      nonNull++;
      if (typeof v === 'number') {
        numeric++;
        if (!Number.isInteger(v)) integral = false;
      } else if (typeof v === 'string') {
        strings++;
      }
      const k = joinKey(v);
      if (k !== null) values.add(k);
    }

    const type = numeric && strings ? 'mixed' : numeric ? 'number' : strings ? 'string' : 'unknown';
    // A non-integer numeric column cannot be an identifier; drop the value set
    // rather than carry hundreds of thousands of useless strings around.
    const isFloat = type === 'number' && !integral;
    stats[col] = {
      name: col,
      type,
      nonNull,
      distinct: values.size,
      unique: nonNull > 0 && values.size === nonNull,
      nullRatio: n > 0 ? 1 - nonNull / n : 1,
      sampled,
      keyable: !isFloat && values.size >= MIN_PARENT_DISTINCT,
      values: isFloat ? null : values,
    };
  }
  return stats;
}

/** Fraction of `child`'s distinct values that also appear in `parent`. */
function containment(child, parent) {
  if (!child || child.size === 0 || !parent || parent.size === 0) return 0;
  let hit = 0;
  for (const v of child) if (parent.has(v)) hit++;
  return hit / child.size;
}

// ---------------------------------------------------------------------------
// Relationship inference
// ---------------------------------------------------------------------------

/**
 * Find the foreign-key relationships between a set of tables.
 *
 * `tables` is `[{ name, rows, columns }]`. Returns the accepted relationships
 * (at most one per ordered table pair), the runners-up per pair so the review UI
 * can offer them, and warnings about links that exist but cannot be used.
 */
export function inferRelationships(tables, { statsByTable = null } = {}) {
  const stats = statsByTable || {};
  for (const t of tables) {
    if (!stats[t.name]) stats[t.name] = profileKeys(t.rows || [], t.columns || []);
  }

  const candidates = [];
  const manyToMany = [];

  for (const child of tables) {
    for (const parent of tables) {
      if (child.name === parent.name) continue;
      const cStats = stats[child.name];
      const pStats = stats[parent.name];

      for (const childCol of Object.keys(cStats)) {
        const cs = cStats[childCol];
        if (!cs.keyable) continue;

        for (const parentCol of Object.keys(pStats)) {
          const ps = pStats[parentCol];
          if (!ps.keyable) continue;

          const affinity = nameAffinity(childCol, parent.name, parentCol);

          // The parent side must identify a row uniquely. If it doesn't but the
          // columns clearly line up, that is a many-to-many link: real, but out
          // of scope, so record it for the user instead of silently ignoring it.
          //
          // `cs.unique` matters here: every valid many-to-one is also visited in
          // reverse (unique child, repeating parent), and that is emphatically
          // not a many-to-many — only a link with duplicates on *both* sides is.
          if (!ps.unique) {
            if (!cs.unique && affinity >= 0.8 && containment(cs.values, ps.values) >= 0.9) {
              manyToMany.push({
                from: { table: child.name, column: childCol },
                to: { table: parent.name, column: parentCol },
              });
            }
            continue;
          }

          // A plain measure must never be joined to a lookup table just because
          // its numbers happen to fall inside the other column's range.
          if (affinity === 0 && cs.type === 'number' && !isIdentifier(childCol)) continue;

          const overlap = containment(cs.values, ps.values);
          if (overlap < MIN_CONTAINMENT) continue;
          // With no name evidence at all, only a near-total match counts.
          if (affinity === 0 && overlap < BLIND_CONTAINMENT) continue;

          let confidence = 0.45 * overlap + 0.25 + 0.3 * affinity;
          if (cs.sampled || ps.sampled) confidence -= 0.05;
          if (cs.nullRatio > 0.5) confidence -= 0.1;
          if (confidence < MIN_CONFIDENCE) continue;

          candidates.push({
            id: `${child.name}.${childCol}->${parent.name}.${parentCol}`,
            from: { table: child.name, column: childCol },
            to: { table: parent.name, column: parentCol },
            cardinality: cs.unique ? 'one-to-one' : 'many-to-one',
            confidence: Math.min(1, Number(confidence.toFixed(3))),
            overlap: Number(overlap.toFixed(3)),
            nameAffinity: affinity,
            reasons: describeReasons(overlap, affinity, cs, ps),
          });
        }
      }
    }
  }

  return prune(candidates, dedupeM2M(manyToMany));
}

function describeReasons(overlap, affinity, cs, ps) {
  const out = [];
  out.push(`${Math.round(overlap * 100)}% of values found in the parent column`);
  out.push(`parent column is unique across ${ps.distinct.toLocaleString()} values`);
  if (affinity >= 0.8) out.push('column names line up');
  else if (affinity > 0) out.push('column names partly line up');
  if (cs.sampled || ps.sampled) out.push('measured on a sample of the rows');
  return out;
}

function dedupeM2M(list) {
  const seen = new Set();
  const out = [];
  for (const m of list) {
    // A ↔ B and B ↔ A describe the same unusable link.
    const key = [`${m.from.table}.${m.from.column}`, `${m.to.table}.${m.to.column}`].sort().join('~');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...m,
      kind: 'many-to-many',
      message: `${m.from.table} and ${m.to.table} look related on ${m.from.column}, but neither side is unique. Many-to-many links are not joined — joining them would multiply every total.`,
    });
  }
  return out;
}

/**
 * Keep the single best relationship per ordered table pair.
 *
 * Two sheets can legitimately be joined on more than one column (a shipping and
 * a billing country both pointing at `Countries`). Supporting both at once needs
 * aliased joins, which v1 does not do, so the extras are returned as
 * `alternatives` for the review UI to offer as a swap.
 */
function prune(candidates, manyToMany) {
  const byPair = new Map();
  for (const c of candidates) {
    const pair = `${c.from.table}->${c.to.table}`;
    const list = byPair.get(pair) || [];
    list.push(c);
    byPair.set(pair, list);
  }

  const relationships = [];
  const alternatives = [];
  for (const [, list] of byPair) {
    list.sort((a, b) => b.confidence - a.confidence || b.overlap - a.overlap);
    relationships.push(list[0]);
    alternatives.push(...list.slice(1));
  }

  // A one-to-one pair yields a relationship in both directions; keep the
  // stronger one so the same two sheets are not joined twice.
  const kept = [];
  const seenPair = new Set();
  relationships.sort((a, b) => b.confidence - a.confidence);
  for (const r of relationships) {
    const undirected = [r.from.table, r.to.table].sort().join('~');
    if (r.cardinality === 'one-to-one' && seenPair.has(undirected)) {
      alternatives.push(r);
      continue;
    }
    seenPair.add(undirected);
    kept.push(r);
  }

  // A pair that already has a usable join needs no "unsupported link" warning.
  const joined = new Set(kept.map((r) => [r.from.table, r.to.table].sort().join('~')));
  const warnings = manyToMany.filter(
    (m) => !joined.has([m.from.table, m.to.table].sort().join('~'))
  );

  return {
    relationships: kept,
    alternatives: alternatives.sort((a, b) => b.confidence - a.confidence),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Fact table
// ---------------------------------------------------------------------------

/**
 * Pick the table the analysis should be built around.
 *
 * The fact table is the one that points *at* others (it holds the foreign keys),
 * carries the measures, and usually has the most rows — an `Orders` sheet next
 * to `Customers` and `Products` lookups.
 */
export function chooseFactTable(tables, relationships) {
  if (tables.length === 0) return null;
  if (tables.length === 1) return tables[0].name;

  let best = null;
  let bestScore = -Infinity;

  for (const t of tables) {
    const outbound = relationships.filter((r) => r.from.table === t.name).length;
    const inbound = relationships.filter((r) => r.to.table === t.name).length;
    const measures = countMeasures(t);
    const rows = (t.rows || []).length;

    const score =
      outbound * 3 + Math.min(measures, 5) * 1.5 + Math.log10(Math.max(rows, 1)) - inbound * 1.5;

    if (score > bestScore || (score === bestScore && rows > (best?.rows || []).length)) {
      bestScore = score;
      best = t;
    }
  }
  return best.name;
}

function countMeasures(table) {
  const rows = table.rows || [];
  if (rows.length === 0) return 0;
  const sample = rows.slice(0, 200);
  let count = 0;
  for (const col of table.columns || []) {
    if (col === 'isAnomaly' || isIdentifier(col)) continue;
    const vals = sample.map((r) => r[col]).filter((v) => v !== null && v !== undefined && v !== '');
    if (vals.length && vals.every((v) => typeof v === 'number')) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * Build the complete model for a set of sheets: relationships, roles and the
 * chosen fact table. `factTable` may be supplied to honour a user override.
 */
export function buildDataModel(tables, { factTable = null } = {}) {
  const statsByTable = {};
  for (const t of tables) statsByTable[t.name] = profileKeys(t.rows || [], t.columns || []);

  const { relationships, alternatives, warnings } = inferRelationships(tables, { statsByTable });
  const fact = factTable && tables.some((t) => t.name === factTable)
    ? factTable
    : chooseFactTable(tables, relationships);

  const related = new Set([fact]);
  for (const r of relationships) {
    if (related.has(r.from.table)) related.add(r.to.table);
  }
  // A second pass catches chains (fact → parent → grandparent) whatever order
  // the relationships happen to be in.
  for (let i = 0; i < tables.length; i++) {
    for (const r of relationships) if (related.has(r.from.table)) related.add(r.to.table);
  }

  return {
    factTable: fact,
    tables: tables.map((t) => ({
      name: t.name,
      rowCount: (t.rows || []).length,
      columnCount: (t.columns || []).length,
      role: t.name === fact ? 'fact' : related.has(t.name) ? 'dimension' : 'unrelated',
      sourceFile: t.sourceFile ?? null,
      sheetName: t.sheetName ?? null,
    })),
    relationships,
    alternatives,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// The joined analysis view
// ---------------------------------------------------------------------------

/**
 * Flatten the model into the single wide row set the analysis engine consumes.
 *
 * Walks outward from the fact table along many-to-one edges only, so each fact
 * row matches at most one parent row and the output has exactly as many rows as
 * the fact table. Unmatched keys produce nulls, as a LEFT JOIN would.
 *
 * Joined columns keep their plain name (`region`, not `Customers.region`) unless
 * that would collide, because the plain name is what ends up as a chart axis
 * label. Provenance is returned separately for anything that needs the origin.
 */
export function buildAnalysisView(tablesByName, model, { maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  const fact = tablesByName[model?.factTable];
  if (!fact) return { rows: [], columns: [], provenance: {}, joins: [], skipped: [] };

  const factRows = fact.rows || [];
  const columns = (fact.columns || []).filter((c) => c !== 'isAnomaly');
  const provenance = {};
  for (const c of columns) provenance[c] = { table: fact.name, column: c };

  const taken = new Set(columns);
  const joins = [];
  const skipped = [];
  const visited = new Set([fact.name]);

  // Breadth-first so nearer tables claim the unprefixed column names.
  let frontier = [{ table: fact.name, depth: 0 }];
  const plan = [];

  while (frontier.length) {
    const next = [];
    for (const node of frontier) {
      if (node.depth >= maxDepth) continue;
      const edges = (model.relationships || [])
        .filter((r) => r.from.table === node.table && !visited.has(r.to.table))
        .sort((a, b) => b.confidence - a.confidence);

      for (const edge of edges) {
        if (visited.has(edge.to.table)) continue;
        const parent = tablesByName[edge.to.table];
        if (!parent) continue;
        visited.add(edge.to.table);
        plan.push({ edge, via: node.table, depth: node.depth + 1 });
        next.push({ table: edge.to.table, depth: node.depth + 1 });
      }
    }
    frontier = next;
  }

  for (const r of model.relationships || []) {
    if (!visited.has(r.to.table)) {
      skipped.push({ relationship: r, reason: 'not reachable from the fact table within the join depth' });
    }
  }

  // Each step: build a key → row lookup for the parent, then widen every row.
  // `rows` starts as the fact rows and is replaced by widened copies once.
  let rows = factRows.map((r) => ({ ...r }));

  for (const step of plan) {
    const { edge, via } = step;
    const parent = tablesByName[edge.to.table];
    const parentRows = parent.rows || [];

    const lookup = new Map();
    for (let i = 0; i < parentRows.length; i++) {
      const k = joinKey(parentRows[i][edge.to.column]);
      if (k === null || lookup.has(k)) continue; // first wins; parent is unique anyway
      lookup.set(k, parentRows[i]);
    }

    // Decide the output name for every column this parent contributes.
    const mapping = [];
    for (const col of parent.columns || []) {
      if (col === 'isAnomaly') continue;
      if (col === edge.to.column) continue; // the key is already on the child side
      let out = col;
      if (taken.has(out)) out = `${parent.name}.${col}`;
      let n = 2;
      while (taken.has(out)) out = `${parent.name}.${col}_${n++}`;
      taken.add(out);
      mapping.push({ source: col, out });
      columns.push(out);
      provenance[out] = { table: parent.name, column: col, via };
    }
    if (mapping.length === 0) continue;

    // The child column may itself be a joined column from an earlier step.
    const childCol = provenanceName(provenance, edge.from) || edge.from.column;

    let matched = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const k = joinKey(row[childCol]);
      const hit = k === null ? undefined : lookup.get(k);
      if (hit) matched++;
      for (const m of mapping) row[m.out] = hit ? (hit[m.source] ?? null) : null;
    }

    joins.push({
      from: edge.from,
      to: edge.to,
      cardinality: edge.cardinality,
      addedColumns: mapping.map((m) => m.out),
      matchRate: rows.length ? Number((matched / rows.length).toFixed(3)) : 0,
    });
  }

  return { rows, columns, provenance, joins, skipped };
}

/** Find what a source column ended up being called in the view. */
function provenanceName(provenance, ref) {
  for (const [out, p] of Object.entries(provenance)) {
    if (p.table === ref.table && p.column === ref.column) return out;
  }
  return null;
}

/**
 * A readable description of the model for the LLM and the review UI. Mirrors
 * the tone of `describeSchema` so the two can sit in one prompt.
 */
export function describeModel(model, tablesByName) {
  if (!model || !model.tables?.length) return '';
  const lines = [];
  for (const t of model.tables) {
    const cols = (tablesByName[t.name]?.columns || []).filter((c) => c !== 'isAnomaly');
    lines.push(`- ${t.name} (${t.role}, ${t.rowCount.toLocaleString()} rows): ${cols.join(', ')}`);
  }
  const rels = (model.relationships || []).map(
    (r) =>
      `- ${r.from.table}.${r.from.column} → ${r.to.table}.${r.to.column} (${r.cardinality}, ${Math.round(
        r.confidence * 100
      )}% confidence)`
  );
  return [
    `Fact table: ${model.factTable}`,
    'Tables:',
    ...lines,
    rels.length ? 'Relationships:' : 'Relationships: none detected',
    ...rels,
  ].join('\n');
}
