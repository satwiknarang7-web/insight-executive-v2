/**
 * Read the deck, fix what can be fixed, and hand over the rest as questions.
 *
 * The review used to happen after the customer was already looking at the
 * report: the critic listed what it found underneath the findings, and the
 * findings kept whatever was wrong with them. That is a product that shows you
 * its own defects and asks you to hold them in mind, which is the opposite of
 * the ten seconds a report gets to prove it is worth paying for.
 *
 * So the loop closes here, before first paint. Three passes over the same deck:
 *
 * 1. `auditPresentation` finds what is measurably wrong — a donut of two
 *    slices, a rainbow on one series, a heading that names the operation, a
 *    repeated card, a measure drawn at two scales.
 * 2. Everything with a mechanical fix is applied, through the same
 *    `storyboardEdits` whitelist a person edits through, so each change is
 *    recorded on the slide and can be typed over.
 * 3. What is left is either a sentence for A2 to write, or a question nobody
 *    here can answer, and those two go to different places.
 *
 * **The rule that keeps this safe: a repair that cannot be verified is a
 * removal or a disclosure, never a rewrite.** Nothing in this file invents a
 * figure, and nothing deletes a finding. The worst it can do is leave a defect
 * visible with a question attached, which is exactly where the product is
 * today.
 */

import { updateSlide, removeKpi } from './storyboardEdits.js';
import { auditPresentation, rewrites, disclosures, shortenTitle } from './presentationAudit.js';
import { checkValidity, scepticQuestions } from './validitySceptic.js';

/** Read the deck the way a reader will see it. */
export function reviewDeck({ storyboard = [], kpis = [], profile = null } = {}) {
  return auditPresentation({ storyboard, kpis, profile });
}

/**
 * Read what it SAYS against what it computed.
 *
 * Separate from the presentation audit on purpose: that one asks whether the
 * deck is legible, this asks whether it is honest, and a defect of each kind
 * calls for a different fix. Run twice — once on the engine's own wording
 * before the deck paints, and again when the narrator's lands, because prose is
 * exactly where a claim grows.
 */
export function reviewClaims({ findings = [], storyboard = [], slideZero = null, rowCount = 0 } = {}) {
  return checkValidity({ findings, storyboard, slideZero, rowCount });
}

/** What the sceptic found, as questions for the reader. */
export const scepticOpenQuestions = (items) => scepticQuestions(items);

/**
 * Apply every fix that needs no judgement.
 *
 * KPI removals are collected and applied last, by descending index, because
 * removing a card shifts every index after it and the audit recorded positions
 * in the strip it read.
 */
export function applyRepairs({ storyboard = [], kpis = [], audit = [] } = {}) {
  let board = [...(storyboard || [])];
  let cards = Array.isArray(kpis) ? [...kpis] : [];
  const applied = [];
  const drops = [];

  for (const item of audit || []) {
    const fix = item.repair;
    if (!fix) continue;
    if (fix.op === 'chart_type') {
      board = updateSlide(board, fix.id, { chart: { chart_type: fix.chart_type } });
      applied.push({ ...fix, source: 'audit' });
    } else if (fix.op === 'colorBy') {
      board = updateSlide(board, fix.id, { chart: { colorBy: fix.colorBy } });
      applied.push({ ...fix, source: 'audit' });
    } else if (fix.op === 'remove_kpi') {
      drops.push(fix);
    }
  }

  for (const fix of drops.sort((a, b) => b.index - a.index)) {
    cards = removeKpi(cards, fix.index);
    applied.push({ ...fix, source: 'audit' });
  }

  return { storyboard: board, kpis: cards, applied };
}

/**
 * The headings the model is being asked to rewrite, and why.
 *
 * Handed to A2 as targets rather than letting it roam the deck: a model asked
 * to improve a report will improve a report, including the parts that were
 * fine. Naming the defects turns "make this better" into "these four headings
 * are too long or name the operation", which is a question with a right answer.
 */
export function rewriteTargets(audit = []) {
  const byId = new Map();
  for (const item of rewrites(audit)) {
    const { id, current, why } = item.rewrite;
    if (!byId.has(id)) byId.set(id, { id, current, reasons: [] });
    byId.get(id).reasons.push(why);
  }
  return [...byId.values()].map((t) => ({ id: t.id, current: t.current, why: t.reasons.join('; ') }));
}

/**
 * Shortened headings without a model, for when no provider answers.
 *
 * `shortenTitle` only ever removes words that carry nothing, and returns null
 * rather than guess. So this is a floor, not a substitute: it fixes "Sum of
 * Total Amount by Region" and leaves anything it cannot honestly shorten for a
 * reader to rename by hand.
 */
export function fallbackRewrites(audit = [], storyboard = []) {
  const titles = new Set(
    (storyboard || []).map((s) => String(s?.chart?.title || s?.pageTitle || '').toLowerCase().trim())
  );
  const ops = [];
  for (const target of rewriteTargets(audit)) {
    const shorter = shortenTitle(target.current);
    if (!shorter || titles.has(shorter.toLowerCase())) continue;
    titles.delete(String(target.current).toLowerCase().trim());
    titles.add(shorter.toLowerCase());
    ops.push({ op: 'retitle', id: target.id, title: shorter, why: target.why, source: 'audit' });
  }
  return ops;
}

/**
 * What could not be fixed, as questions for the reader.
 *
 * These join the critic's list rather than forming one of their own: a reader
 * should not have to learn which internal pass noticed a thing. Marked with
 * their kind so the panel can tell a presentation defect from an unasked
 * question, and so a future engine fix can find them again.
 */
export function openQuestions(audit = []) {
  return disclosures(audit).map((item) => ({
    kind: item.kind,
    source: 'audit',
    question: item.question,
    evidence: item.note ? [item.note] : [],
  }));
}

// ---------------------------------------------------------------------------
// What the sceptic found
// ---------------------------------------------------------------------------

/** The heading the engine writes above a recommendation inside the long write-up. */
const ADVICE_BLOCK = /\n*\*\*What to do with it\*\*\n\n[\s\S]*?(?=\n\n\*\*|\n\n###|$)/;

/**
 * Clear a claim the sceptic found larger than its own numbers.
 *
 * Clearing, never rewriting. Writing a better sentence would mean knowing what
 * is true, and nothing in this pass does — so the honest fix is to take the
 * unsupported sentence off the page and leave the verified figures it sat over,
 * which are the part that was never in doubt.
 *
 * The recommendation lives twice: as its own field and inside the long write-up
 * under its own heading. Clearing one and not the other leaves the sentence on
 * the report page having removed it from the dashboard, so both go.
 */
export function applySceptic({ storyboard = [], items = [] } = {}) {
  let board = [...(storyboard || [])];
  const applied = [];

  for (const item of items || []) {
    const fix = item.repair;
    if (!fix || (fix.op !== 'clear_text' && fix.op !== 'set_text')) continue;
    const slide = board.find((s) => String(s?.id) === String(fix.id));
    if (!slide) continue;

    // `set_text` replaces the claim; `clear_text` removes it. The difference is
    // whether anything true can be put in its place without new evidence: a
    // pointer at another slide can, a corrected recommendation cannot.
    const patch = { insight_question: fix.op === 'set_text' ? fix.text : '' };
    const markdown = String(slide.markdownAnalysis || '');
    if (ADVICE_BLOCK.test(markdown)) patch.markdownAnalysis = markdown.replace(ADVICE_BLOCK, '').trim();

    board = updateSlide(board, fix.id, patch);
    applied.push({ op: 'clear_text', id: fix.id, field: 'insight_question', why: fix.why, source: 'sceptic' });
  }

  return { storyboard: board, applied };
}
