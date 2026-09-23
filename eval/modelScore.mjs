/**
 * How well `lib/tableModel.js` reads a table, against the truth a person wrote
 * down for it (a corpus `report` section, or the truth a fuzz table was
 * generated with).
 *
 * Each check is a list of misses rather than a score, so the ratchet in
 * tests/scorecard.test.mjs can say which reading got worse:
 *
 *   grain        the kind of row
 *   long         the value column and the column naming its quantities
 *   scope        each measure the truth scopes, scoped by the same column — or
 *                one that maps one-to-one onto it (market ↔ currency) — and no
 *                scope the truth does not have
 *   noSum        each measure the truth says is never summed; and none of the
 *                measures it lists as `additive`
 *   noSumAcross  each level the truth names, and no level it does not
 *
 * The truth lists what a person was sure of. A measure it says nothing about
 * is not scored for `noSum` either way — it would be a claim nobody checked.
 */

function oneToOne(rows, a, b) {
  const there = new Map();
  const back = new Map();
  for (const r of rows) {
    const x = String(r?.[a] ?? '');
    const y = String(r?.[b] ?? '');
    if ((there.has(x) && there.get(x) !== y) || (back.has(y) && back.get(y) !== x)) return false;
    there.set(x, y);
    back.set(y, x);
  }
  return true;
}

export function scoreModel(model, rows, truth) {
  const misses = [];
  const miss = (check, detail) => misses.push(`${check}: ${detail}`);
  const same = (a, b) => a === b || oneToOne(rows, a, b);

  if (truth.grain && model.grain.kind !== truth.grain) miss('grain', `read as ${model.grain.kind}, is ${truth.grain}`);

  const tl = truth.long || null;
  const ml = model.long || null;
  if (tl && (!ml || ml.value !== tl.value || ml.by !== tl.by)) miss('long', `expected ${tl.value} by ${tl.by}, read ${ml ? `${ml.value} by ${ml.by}` : 'none'}`);
  if (!tl && ml) miss('long', `read ${ml.value} by ${ml.by} on a table that is not long`);

  const tm = truth.measures || {};
  for (const [col, m] of Object.entries(model.measures)) {
    const want = tm[col]?.scope || [];
    // A scope with one level among the rows that have the measure is vacuous.
    const levels = (s) => new Set(rows.filter((r) => r?.[col] !== null && r?.[col] !== undefined && r?.[col] !== '').map((r) => r?.[s])).size;
    for (const s of want) if (levels(s) > 1 && !m.scope.some((x) => same(x, s))) miss('scope', `${col} not scoped by ${s}`);
    const expectLong = tl && col === tl.value ? [tl.by] : [];
    for (const s of m.scope) if (![...want, ...expectLong].some((x) => same(x, s))) miss('scope', `${col} scoped by ${s}, which the truth does not`);

    if (tm[col]?.noSum && m.sum) miss('noSum', `${col} is summable in the model`);
    if ((truth.additive || []).includes(col) && !m.sum) miss('noSum', `${col} is additive and the model forbids summing it`);

    const across = tm[col]?.noSumAcross || [];
    for (const t of across) if (!m.noSumAcross.includes(t)) miss('noSumAcross', `${col} summed across ${t} in the model`);
    for (const t of m.noSumAcross) if (!across.includes(t)) miss('noSumAcross', `${col} read as a level over ${t}; it is not`);
  }
  for (const col of Object.keys(tm)) {
    if (!model.measures[col]) miss('measure', `${col} is not a measure in the model`);
  }
  return misses;
}
