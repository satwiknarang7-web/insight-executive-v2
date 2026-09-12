/**
 * The agent that edits the deck.
 *
 * Everything else a model does in this codebase produces TEXT — a narrative
 * over verified numbers, a question about what is missing, a claim about what a
 * column means. This one changes the artefact: it renames a chart, picks a
 * different chart type, and reorders the deck, which is what a person does when
 * they are handed a generated report and asked to make it good.
 *
 * That is a larger power than any of the others, so it is fenced in a way none
 * of them needed.
 *
 * **The model chooses among legal moves; it does not describe a move.** For each
 * slide, `editBriefing` computes the alternatives that are structurally valid
 * for that chart — same arity, and a shape the data actually has: no line over
 * a category, no pie of forty things, no pie at all over time. The model picks
 * from that list or it picks nothing. A type it invents is not rejected so much
 * as unreachable, because it was never on the menu.
 *
 * **It is shown no values.** Column names, chart titles, chart types, how many
 * rows each chart drew. The same discipline as the critic and for the same
 * structural reason: a model with no figures in front of it has none to quote,
 * so a digit in a title it writes is invented and is dropped mechanically.
 *
 * **It cannot remove anything, and it cannot touch a number.** The ops are a
 * closed set of three. Removal is deliberately not among them: `dropFlatCharts`
 * and the signal floor already delete charts that say nothing, deterministically
 * and for stated reasons, and an agent that can delete a slide can delete the
 * finding a reader needed. Nor can any op reach a figure — every number on the
 * page comes from the SQL that was already run, and the whitelist in
 * `storyboardEdits` has no key that would let it near one.
 *
 * Everything it does lands through `updateSlide`, so each change is recorded in
 * `slide.edits` exactly like a change a user made by hand — which is what makes
 * it visible in the UI, survivable across a re-run, and undoable.
 */

import { chartArity } from './chartSpecs.js';
import { inventedNumber } from './critic.js';
import { updateSlide } from './storyboardEdits.js';

/** More edits than this on one deck is a model rewriting, not editing. */
const MAX_EDITS = 8;

/** A chart title is a phrase. Past this it is a sentence, and a sentence is prose. */
const MAX_TITLE_LENGTH = 80;

/**
 * Types that draw one category against one number, and can therefore stand in
 * for one another without the query changing.
 *
 * Anything not here keeps the type it was given. A waterfall, a funnel, a map,
 * a matrix, a scatter: the type IS the finding in those cases, and swapping it
 * does not restyle the chart, it changes what the chart claims.
 */
const INTERCHANGEABLE = ['bar', 'hbar', 'line', 'area', 'pie', 'donut', 'treemap', 'radial', 'table'];

/** Of those, the ones that read a series as parts of one whole. */
const PART_OF_WHOLE = new Set(['pie', 'donut', 'treemap', 'radial']);

/** And the ones that draw a value as a continuous path between its neighbours. */
const CONTINUOUS = new Set(['line', 'area']);

/** Fewer slices than this is a bar chart; more is a colour wheel. */
const MIN_SLICES = 3;
const MAX_SLICES = 8;

const norm = (s) => String(s ?? '').trim();

/**
 * The types this chart could be drawn as instead, given what it is drawn from.
 *
 * This is the whole safety argument for the chart_type op, so it is computed
 * here from the chart and never asked of the model. Three rules, each of which
 * exists because the opposite produces a chart that lies:
 *
 * - a path between points asserts that the gap between them means something,
 *   which is true of months and false of regions;
 * - a slice asserts that the parts sum to a whole, which is false the moment
 *   the query took a top ten, and false across periods;
 * - and a wheel of forty slices is not a reading of anything.
 */
export function alternativeTypes(chart, { temporal = [] } = {}) {
  const current = norm(chart?.chart_type).toLowerCase();
  if (!INTERCHANGEABLE.includes(current)) return [];

  const { dimensions, measures } = chartArity(current);
  if (dimensions !== 1 || measures !== 1) return [];

  const isTime = temporal.includes(chart?.xAxisKey) || temporal.includes(chart?.dimension);
  const drawn = Array.isArray(chart?.resultData) ? chart.resultData.length : null;
  // A ranking is the top of a distribution, not the distribution — so its
  // slices do not add up to anything a reader should be shown as a whole.
  const truncated = /\bLIMIT\b/i.test(norm(chart?.sql));
  const wholeIsReal = !isTime && !truncated && drawn !== null && drawn >= MIN_SLICES && drawn <= MAX_SLICES;

  return INTERCHANGEABLE.filter((type) => {
    if (type === current) return false;
    if (CONTINUOUS.has(type) && !isTime) return false;
    if (PART_OF_WHOLE.has(type) && !wholeIsReal) return false;
    return true;
  });
}

/**
 * What the model is shown: the deck's structure, and none of its numbers.
 *
 * `drawn` is a count of rows, not a row — the same thing the critic is told
 * about a column's levels, and for the same reason: it is what separates a
 * sensible pie from an unreadable one, and it is not a figure out of anyone's
 * data.
 */
export function editBriefing({ storyboard = [], profile = null, targets = [] } = {}) {
  const temporal = profile?.temporal || [];
  // What the deterministic audit already found wrong with a heading. Handed
  // over so the model rewrites the defects instead of roaming: a model asked to
  // improve a report will improve all of it, including the parts that were
  // fine, and every needless rename is a change the reader has to check.
  const flagged = new Map((targets || []).map((t) => [String(t.id), t.why]));
  return {
    slides: (storyboard || []).map((slide, position) => ({
      id: String(slide?.id ?? position),
      position,
      title: norm(slide?.chart?.title || slide?.pageTitle),
      chart_type: norm(slide?.chart?.chart_type),
      dimension: norm(slide?.chart?.dimension || slide?.chart?.xAxisKey) || null,
      measure: norm(slide?.chart?.yAxisKey) || null,
      drawn: Array.isArray(slide?.chart?.resultData) ? slide.chart.resultData.length : null,
      evidence: norm(slide?.findings?.metrics?.evidence) || null,
      alternatives: alternativeTypes(slide?.chart, { temporal }),
      needs_rewrite: flagged.get(String(slide?.id ?? position)) || null,
    })),
  };
}

/**
 * Keep the operations that are legal, and drop the rest without comment.
 *
 * Checked against the BRIEFING — the same object the model was handed — rather
 * than against the storyboard. That is deliberate: the briefing is where each
 * slide's legal chart types were computed from the rows, so validating against
 * it means the rule the model was given and the rule it is held to are the same
 * object, and the route can run this check without the data ever leaving the
 * browser.
 *
 * What survives is a list the caller can apply blindly, which is the point: the
 * decision about what is allowed is made here, once, where it can be tested.
 *
 * @param {unknown}  raw     whatever the route parsed out of the reply
 * @param {object}   context
 * @param {object[]} context.slides   the briefing's slides, as `editBriefing` built them
 * @param {object}   [context.profile] column names, for the invented-digit test
 * @returns {{op: string, id?: string, title?: string, chart_type?: string, order?: string[], why: string}[]}
 */
export function acceptEdits(raw, { slides = [], profile = null } = {}) {
  if (!Array.isArray(raw)) return [];

  const names = [
    ...(profile?.dimensions || []),
    ...(profile?.measures || []),
    ...(slides || []).map((s) => norm(s?.title)),
  ];
  const byId = new Map((slides || []).map((s) => [String(s?.id), s]));
  const titles = new Set((slides || []).map((s) => norm(s?.title).toLowerCase()));

  const out = [];
  const retitled = new Set();
  const retyped = new Set();
  let reordered = false;

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const op = norm(item.op).toLowerCase();
    const why = norm(item.why).slice(0, 200);

    if (op === 'retitle') {
      const id = norm(item.id);
      const slide = byId.get(id);
      const title = norm(item.title).replace(/\s+/g, ' ');
      if (!slide || retitled.has(id)) continue;
      if (!title || title.length > MAX_TITLE_LENGTH) continue;
      // It was shown no values, so a figure in a title it wrote came from
      // nowhere — and a chart headed with a number nobody computed is the one
      // failure this project will not ship.
      if (inventedNumber(title, names)) continue;
      const existing = norm(slide.title);
      if (title.toLowerCase() === existing.toLowerCase()) continue;
      // Two slides under one heading is a deck a reader cannot navigate.
      if (titles.has(title.toLowerCase())) continue;
      titles.delete(existing.toLowerCase());
      titles.add(title.toLowerCase());
      retitled.add(id);
      out.push({ op: 'retitle', id, title, why });
    } else if (op === 'chart_type') {
      const id = norm(item.id);
      const slide = byId.get(id);
      const type = norm(item.chart_type).toLowerCase();
      if (!slide || retyped.has(id)) continue;
      // Not "is this a real chart type" — is it one of the types THIS chart
      // could be drawn as. A type off the menu was never a legal move.
      if (!(slide.alternatives || []).includes(type)) continue;
      retyped.add(id);
      out.push({ op: 'chart_type', id, chart_type: type, why });
    } else if (op === 'reorder') {
      if (reordered || !Array.isArray(item.order)) continue;
      const seen = new Set();
      const order = [];
      for (const candidate of item.order) {
        const id = norm(candidate);
        if (!byId.has(id) || seen.has(id)) continue;
        seen.add(id);
        order.push(id);
      }
      // A partial list is honoured rather than refused: the named slides move
      // to the front in the order given and everything else keeps its relative
      // place. No slide can be lost by reordering, which is why this op does
      // not have to be a permutation to be safe.
      if (order.length < 2) continue;
      reordered = true;
      out.push({ op: 'reorder', order, why });
    }

    if (out.length >= MAX_EDITS) break;
  }

  return out;
}

/**
 * Apply accepted operations to the deck.
 *
 * Deliberately a thin pass over `updateSlide`: the agent gets no privileged
 * route into a storyboard, so every field it touches is one the whitelist there
 * already allows a person to touch, and every change it makes is recorded in
 * `slide.edits` the same way. That record is not bookkeeping — it is what makes
 * the edit show as modified in the UI, survive a re-run through `reapplyEdits`,
 * and be undoable by hand.
 *
 * A rename sets both the slide heading and the chart title, because on the page
 * they are one thing: renaming a chart and leaving the heading above it saying
 * something else is not an edit a person would recognise.
 */
export function applyEdits(storyboard, ops = []) {
  let board = [...(storyboard || [])];
  for (const op of ops || []) {
    if (op.op === 'retitle') {
      board = updateSlide(board, op.id, { pageTitle: op.title, chart: { title: op.title } });
    } else if (op.op === 'chart_type') {
      board = updateSlide(board, op.id, { chart: { chart_type: op.chart_type } });
    } else if (op.op === 'reorder') {
      board = reorderStoryboard(board, op.order);
    }
  }
  return board;
}

/** Put the named ids first, in that order; everything else keeps its place. */
export function reorderStoryboard(storyboard, order) {
  const rank = new Map((order || []).map((id, i) => [String(id), i]));
  const at = (slide) => (rank.has(String(slide?.id)) ? rank.get(String(slide?.id)) : Infinity);
  return [...(storyboard || [])]
    .map((slide, i) => ({ slide, i }))
    .sort((a, b) => at(a.slide) - at(b.slide) || a.i - b.i)
    .map((x) => x.slide);
}
