/**
 * What one row of this table actually is.
 *
 * `lib/measureSemantics.js` already knows the rule that matters: a number
 * arriving from a dimension table repeats once per fact row, so summing it
 * counts the same value many times. It learns that from provenance — which
 * source table each column came from — which `lib/dataModel.js` records when
 * *this app* performs the join.
 *
 * A CSV that was joined somewhere else arrives with that evidence erased. The
 * dimension table existed; it was flattened into the file before upload, and
 * every column now looks like it belongs to the fact table. The guard cannot
 * fire, and the planner sums a country-level figure once per athlete.
 *
 * Measured on a 202,616-row athlete export carrying World Bank indicators per
 * country-year, that is a 71.7x overstatement of tax revenue and 115.7x of
 * government debt — reported as a headline KPI, with an evidence tier of
 * "strong" attached to a trend fitted through it.
 *
 * This module recovers the missing evidence from the data instead of from the
 * join. The question it answers is narrow and checkable:
 *
 *   is this measure constant within some group that is coarser than a row?
 *
 * `Tax_revenue_current_LCU_Value` holds exactly one distinct value per
 * (Team, Year) across all 2,664 of them. That is not a coincidence a fact
 * measure produces — it is the signature of a value that belongs to the
 * country-year and was copied down. `Age`, `Height` and `Weight` vary inside
 * the same groups, which is what a genuine row-level measure looks like, and
 * they are left alone.
 *
 * What this deliberately does NOT do is decide the number is meaningful once
 * de-duplicated. Summing that column at its own grain still adds BRL to CNY to
 * USD. Knowing the grain is what makes refusing defensible; units are a
 * separate property and a separate module.
 */

/**
 * A key with a group for every couple of rows is not a coarser grain — at the
 * limit every column is trivially "constant" within a key unique to each row.
 * Requiring each group to cover at least this many rows on average is what
 * separates a real repeated attribute from that degenerate case.
 */
const MIN_REPETITION = 2;

/** Below this many groups the pattern is arithmetic coincidence, not structure. */
const MIN_GROUPS = 4;

/**
 * How much the measure must vary ACROSS the groups it is constant within.
 *
 * Constancy alone does not mean "belongs to the entity". A measure with two
 * values is constant inside any group whose key happens to determine it:
 * `billed_artist_count` is 1 for every solo track and 2 for every duet, so it
 * holds still within (is_collaboration, artist) across 143 groups — and it is
 * nonetheless a genuine row-level measure whose SUM is the reported figure.
 *
 * A real attribute of a coarser entity is *drawn from* that entity, so its
 * distinct values scale with the number of entities: 883 tax revenues across
 * 2,664 country-years. A flag repeated everywhere does not. Requiring the
 * measure to take a reasonable fraction of a value per group separates them,
 * and errs toward silence — a genuine attribute with too few distinct values is
 * missed, which leaves the planner where it already was.
 */
const MIN_DISTINCT_SHARE = 0.1;
const MIN_DISTINCT_VALUES = 8;

/** Key columns are entity identifiers, so a near-unique column cannot be one. */
const MAX_KEY_SHARE = 0.25;

/** Screening pass size. The winning key is always re-checked on every row. */
const SCREEN_ROWS = 20_000;

/**
 * How many columns may take part in a key.
 *
 * Every one of them is paired with every other. An earlier version ranked
 * columns by cardinality and paired only the coarsest few, which is precisely
 * backwards: the entity column is the high-cardinality half of the key. On the
 * athlete export that ordering put Sex and Season in the pair list and left
 * Team out of it, so (Team, Year) — the actual grain — was never tried.
 */
const MAX_KEY_COLUMNS = 10;

const present = (v) => v !== null && v !== undefined && v !== '';

/** Stable, collision-free group identifier for a tuple of dimension values. */
const groupId = (row, key) => key.map((c) => String(row[c] ?? '\u0000')).join('\u001f');

/** Evenly strided sample — the same shape `chartSignals.sampleRows` uses. */
function screen(rows, limit = SCREEN_ROWS) {
  if (rows.length <= limit) return rows;
  const stride = Math.ceil(rows.length / limit);
  const out = [];
  for (let i = 0; i < rows.length; i += stride) out.push(rows[i]);
  return out;
}

/**
 * Is this numeric column a calendar year? Years are entity identifiers that
 * happen to be numbers, so they belong in keys — (Team, Year) is the grain of
 * the example dataset and Team alone is not. Mirrors the `year` branch of
 * `numericRole` in the planner, which cannot be imported here: the planner
 * imports this module.
 */
function isYearColumn(rows, col, distinct) {
  if (distinct < 2 || distinct > 150) return false;
  let seen = 0;
  for (const r of rows) {
    const v = r[col];
    if (!present(v)) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1800 || v > 2100) return false;
    if (++seen >= 200) break;
  }
  return seen > 0;
}

/**
 * Columns that could name an entity: dimensions, plus years.
 *
 * Ordered by cardinality so the coarsest keys are tried first, and capped
 * because the pair expansion below is quadratic in this list. The cap is the
 * only limit: within it every column pairs with every other, because the
 * entity half of a grain key is the high-cardinality one.
 */
function keyColumns(rows, profile) {
  const cardinality = profile?.cardinality || {};
  const ceiling = Math.max(2, Math.floor(rows.length * MAX_KEY_SHARE));
  const eligible = (col) => {
    const c = cardinality[col] || 0;
    return c >= 2 && c <= ceiling;
  };

  const dims = (profile?.dimensions || []).filter(eligible);
  const years = (profile?.measures || []).filter(
    (m) => eligible(m) && isYearColumn(rows, m, cardinality[m] || 0)
  );

  return [...dims, ...years]
    .sort((a, b) => (cardinality[a] || 0) - (cardinality[b] || 0))
    .slice(0, MAX_KEY_COLUMNS);
}

/**
 * Candidate keys: every single column, then every pair of them.
 *
 * Triples are not generated. A key only ever gets finer by adding a column, and
 * the coarsest key is the one we want, so the bias is correct — a grain that
 * genuinely needs three columns is missed, which leaves the planner exactly
 * where it is today rather than moving it somewhere worse.
 */
function candidateKeys(cols) {
  const keys = cols.map((c) => [c]);
  for (let i = 0; i < cols.length; i++) {
    for (let j = i + 1; j < cols.length; j++) keys.push([cols[i], cols[j]]);
  }
  return keys;
}

/**
 * Which of `measures` hold exactly one value within every group of `key`.
 *
 * One pass, early-dropping a measure the moment it contradicts itself, so a
 * flat fact table costs little more than a scan.
 */
function constantWithin(rows, key, measures) {
  const first = new Map();
  const live = new Set(measures);
  let groups = 0;

  for (const row of rows) {
    if (live.size === 0) break;
    const id = groupId(row, key);
    let seen = first.get(id);
    if (!seen) {
      seen = new Map();
      first.set(id, seen);
      groups++;
    }
    for (const m of live) {
      const v = row[m];
      if (!present(v)) continue;
      if (!seen.has(m)) seen.set(m, v);
      else if (seen.get(m) !== v) live.delete(m);
    }
  }

  return { constant: live, groups };
}

/**
 * Measures that repeat across rows because they describe something coarser.
 *
 * @param {object[]} rows    every row; the winning key is verified against all of them
 * @param {object}   profile from `profileColumns` — measures, dimensions, cardinality
 * @returns {Object<string, {key: string[], groups: number, factor: number}>}
 *          keyed by column; `factor` is how many times each value is repeated
 */
export function detectRepeatedMeasures(rows, profile) {
  if (!Array.isArray(rows) || rows.length < MIN_GROUPS * MIN_REPETITION) return {};
  const measures = profile?.measures || [];
  if (measures.length === 0) return {};

  const cols = keyColumns(rows, profile);
  if (cols.length === 0) return {};

  const sample = screen(rows);
  const maxGroups = Math.floor(sample.length / MIN_REPETITION);
  const best = {};

  for (const key of candidateKeys(cols)) {
    // A measure cannot be an attribute of a group its own column helps define.
    const testable = measures.filter((m) => !key.includes(m));
    if (testable.length === 0) continue;

    const { constant, groups } = constantWithin(sample, key, testable);
    if (groups < MIN_GROUPS || groups > maxGroups) continue;

    for (const m of constant) {
      if (!best[m] || groups < best[m].groups) best[m] = { key, groups };
    }
  }

  // Confirm on the full table. A stride sample can miss the one row that breaks
  // constancy, and the cost of being wrong here is refusing a SUM that was
  // legitimate — so the claim is never made on a sample alone.
  const confirmed = {};
  const byKey = new Map();
  for (const [m, hit] of Object.entries(best)) {
    const id = hit.key.join('\u001f');
    if (!byKey.has(id)) byKey.set(id, { key: hit.key, measures: [] });
    byKey.get(id).measures.push(m);
  }

  const cardinality = profile?.cardinality || {};
  for (const { key, measures: candidates } of byKey.values()) {
    const { constant, groups } = constantWithin(rows, key, candidates);
    if (groups < MIN_GROUPS) continue;
    const factor = rows.length / groups;
    if (factor < MIN_REPETITION) continue;
    const needed = Math.max(MIN_DISTINCT_VALUES, groups * MIN_DISTINCT_SHARE);
    for (const m of constant) {
      if ((cardinality[m] || 0) < needed) continue;
      if (!confirmed[m] || groups < confirmed[m].groups) {
        confirmed[m] = { key, groups, factor };
      }
    }
  }

  return confirmed;
}

/** Plain-English reason, in the shape `classifyColumns` already puts in `why`. */
export function repetitionReason(hit) {
  if (!hit) return null;
  const key = hit.key.map((c) => c.replace(/_/g, ' ')).join(' and ');
  const times = hit.factor >= 10 ? Math.round(hit.factor) : hit.factor.toFixed(1);
  return (
    `holds one value per ${key} and repeats about ${times}x across rows — ` +
    `summing it would count the same figure once per row`
  );
}
