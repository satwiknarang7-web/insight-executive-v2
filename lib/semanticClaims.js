/**
 * What a column means, when its name does not say so in English.
 *
 * `lib/measureUnits.js` refuses to combine rows whose unit varies, and it finds
 * them with a lexicon: `LCU`, `local currency`, `national currency`, or a
 * `currency` column sitting in the table. That lexicon is right about the file
 * it was written for and will be wrong about somebody's. A column called
 * `importe`, `Betrag`, `montant`, `金额` — or `revenue_local`, or `amount_ccy` —
 * is the same hazard wearing a word the list does not have, and the failure is
 * silent: the app sums Brazilian reais onto US dollars and prints the result as
 * one figure.
 *
 * That is the gap a model closes and a regex cannot. So this is the first of
 * the agents: it is shown the SHAPE of the table — column names, what kind each
 * is, how many distinct values it has — and asked which of the numeric columns
 * are counted in a unit that changes from row to row.
 *
 * Three things make it safe to act on, and they are the whole design.
 *
 * **It is shown no values.** The same discipline the critic runs under. A model
 * with no figures in front of it cannot quote one back, and cannot be steered
 * by the data it is judging.
 *
 * **Measurement wins.** A claim about a column the lexicon already caught is
 * dropped, not merged — the deterministic answer is not up for discussion. The
 * model only ever fills a gap.
 *
 * **The failure is one-directional.** A claim that is wrong causes the engine to
 * REFUSE an aggregate it could have computed. That costs a chart and an honest
 * notice explaining the refusal; it cannot produce a wrong number, because the
 * only thing a claim can do is take a column out of the sums. A missed column,
 * conversely, is exactly today's behaviour. Both ends of being wrong land
 * somewhere the product already survives.
 */

/** More than this many claims on one table is a model pattern-matching, not reading. */
const MAX_CLAIMS = 6;

/** A unit is a word or two. Anything longer is prose, and prose is not a unit. */
const MAX_UNIT_LENGTH = 40;

/** A unit label is letters and spaces. A digit in one means it was invented. */
const UNIT_SHAPE = /^[\p{L} ./-]{2,}$/u;

/**
 * What the model is shown: the shape of the table and nothing in it.
 *
 * Measures are marked, because they are the only columns a unit claim can
 * apply to — a claim about a category is not wrong so much as meaningless, and
 * saying which is which up front is cheaper than rejecting it afterwards.
 */
export function claimsBriefing({ profile = null } = {}) {
  const cardinality = profile?.cardinality || {};
  return {
    columns: [
      ...(profile?.measures || []).map((name) => ({
        name,
        kind: 'number',
        levels: cardinality[name] || null,
      })),
      ...(profile?.dimensions || []).map((name) => ({
        name,
        kind: 'category',
        levels: cardinality[name] || null,
      })),
    ],
  };
}

/**
 * Keep the claims that are about a real measure, in a plausible unit, on a
 * column nothing has already decided.
 *
 * @param {unknown} raw        whatever the route parsed out of the reply
 * @param {object}  context
 * @param {object}  context.profile   measures and dimensions of the table
 * @param {object}  context.detected  what `detectDenomination` already found
 * @returns {Object<string, {unit: string, why: string, source: string}>}
 */
export function acceptUnitClaims(raw, { profile = null, detected = {} } = {}) {
  if (!Array.isArray(raw)) return {};
  const measures = new Set(profile?.measures || []);
  const out = {};

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const column = String(item.column ?? '').trim();
    const unit = String(item.unit ?? '').trim();

    // A claim about a column that is not a measure has nothing to act on, and
    // a claim about one the lexicon already caught is not needed: the
    // deterministic answer stands and is not improved by agreement.
    if (!measures.has(column) || detected[column] || out[column]) continue;
    if (!unit || unit.length > MAX_UNIT_LENGTH || !UNIT_SHAPE.test(unit)) continue;

    out[column] = {
      unit,
      why:
        `read as counted in ${unit}, which is not the same unit on every row — ` +
        'so adding or averaging across rows would combine unlike quantities',
      source: 'model',
    };
    if (Object.keys(out).length >= MAX_CLAIMS) break;
  }
  return out;
}
