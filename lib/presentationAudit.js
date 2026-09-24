/**
 * How the deck reads, as opposed to whether it is true.
 *
 * `lib/critic.js` asks what the analysis did not reach and `lib/insightEngine.js`
 * decides what may be claimed. Neither of them looks at the thing the customer
 * actually sees: a heading that names the operation instead of the subject, a
 * donut of two slices, forty colours on a chart with one series, a title that
 * arrives on screen as "Shipping Cost Rate by Customer Age Gro…".
 *
 * None of that makes a number wrong. All of it makes the report look like
 * something a machine emitted rather than something a person would send, and
 * that is what a customer judges in the first ten seconds.
 *
 * **This is deliberately not an agent.** "Is this label too long at this tile
 * width" is measurable and "does this donut have too few slices to be a donut"
 * is arithmetic. A rule answers both better than a model, costs no latency and
 * works with no API key. What a model is genuinely better at is the sentence —
 * *given* that this heading is too long, what is a shorter one that means the
 * same thing — so the audit finds the defect and names the slide, and A2
 * (`lib/analystEdits.js`) writes the words. With no provider, the deterministic
 * repair below is the floor.
 *
 * Every finding is one of two kinds, and the difference is the whole design:
 *
 * - **repairable** — carries an operation that fixes it, applied through the
 *   same `storyboardEdits` whitelist a person edits through.
 * - **disclosed** — the audit can see it and cannot safely fix it, so it
 *   becomes a question rather than a silent pass. A repair nobody can verify is
 *   worse than a defect somebody can read about.
 */

import { alternativeTypes } from './analystEdits.js';
import { extent } from './extent.js';

/** Past this a heading is clipped on the presentation tile, which is the tightest surface. */
const MAX_TITLE_CHARS = 44;

/** A wheel needs enough slices to be a wheel, and few enough to be read. */
const MIN_SLICES = 3;
const MAX_SLICES = 8;

/** More colours than this on one chart is decoration, not encoding. */
const MAX_COLOURED_CATEGORIES = 12;

/**
 * Headings that name the operation the query ran instead of the thing it found.
 *
 * `distribution of` and `share of` are deliberately NOT here, though they read
 * like the others. They name what the chart SHOWS — a spread, a part of a whole
 * — and stripping them leaves a heading that describes less than it did:
 * "Distribution of Units Sold" shortened to "Units Sold" is a chart that no
 * longer says what it is. Measured on a real deck, which is how this list lost
 * two of its entries.
 */
const OPERATION_TITLE = /^(sum|count|total|average|avg|number)\s+of\s+/i;

const PART_OF_WHOLE = new Set(['pie', 'donut', 'treemap', 'radial']);

const norm = (s) => String(s ?? '').trim();
const key = (s) => norm(s).toLowerCase().replace(/\s+/g, ' ');

/**
 * A shorter heading, without a model.
 *
 * Only ever removes words, and only words that carry no information: the
 * operation prefix the engine put there, and a trailing parenthetical. It will
 * not paraphrase, because paraphrasing without understanding is how a heading
 * stops describing its chart. When it cannot shorten honestly it returns null
 * and the defect stays open rather than being papered over.
 */
export function shortenTitle(title) {
  let out = norm(title).replace(OPERATION_TITLE, '');
  out = out.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (!out || out.length >= norm(title).length) return null;
  // A heading has to survive the cut as a phrase, not a fragment.
  if (out.split(/\s+/).length < 2) return null;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/**
 * Read the finished deck the way a reader will see it.
 *
 * @param {object}   input
 * @param {object[]} input.storyboard the slides, in order
 * @param {object[]} [input.kpis]     the card strip above them
 * @param {object}   [input.profile]  columns, for the legal-move computation
 * @returns {{kind, id?, severity, note, repair: object|null, question: string|null}[]}
 */
export function auditPresentation({ storyboard = [], kpis = [], profile = null } = {}) {
  const slides = Array.isArray(storyboard) ? storyboard : [];
  const temporal = profile?.temporal || [];
  const out = [];
  const seenTitle = new Map();

  for (const slide of slides) {
    const chart = slide?.chart || {};
    const id = String(slide?.id ?? '');
    const title = norm(chart.title || slide?.pageTitle);
    const type = norm(chart.chart_type).toLowerCase();
    const drawn = Array.isArray(chart.resultData) ? chart.resultData.length : null;
    const legal = alternativeTypes(chart, { temporal });

    // A donut of two slices is a sentence drawn as a circle; a donut of forty
    // is a colour wheel. Both are better as bars, and bars are on the menu
    // whenever this chart is one of the interchangeable kinds.
    if (PART_OF_WHOLE.has(type) && drawn !== null && (drawn < MIN_SLICES || drawn > MAX_SLICES)) {
      const to = legal.includes('bar') ? 'bar' : legal.includes('hbar') ? 'hbar' : null;
      out.push({
        kind: 'degenerate-share',
        id,
        severity: 'high',
        note:
          drawn < MIN_SLICES
            ? `"${title}" is a ${type} of ${drawn} — too few parts to read as a whole.`
            : `"${title}" is a ${type} of ${drawn} — too many slices to tell apart.`,
        repair: to ? { op: 'chart_type', id, chart_type: to, why: 'too few or too many parts to read as a share' } : null,
        question: to ? null : `"${title}" is drawn as a ${type} with ${drawn} parts. Is that readable?`,
      });
    }

    // One colour per category on a chart with one series is decoration that
    // reads as encoding — a viewer looks for what the colours mean.
    if (chart.colorBy === 'category' && drawn !== null && drawn > MAX_COLOURED_CATEGORIES) {
      out.push({
        kind: 'rainbow',
        id,
        severity: 'medium',
        note: `"${title}" gives ${drawn} categories ${drawn} colours, which encodes nothing.`,
        repair: { op: 'colorBy', id, colorBy: 'series', why: 'one series does not need one colour per bar' },
        question: null,
      });
    }

    // A heading that names the operation is the engine talking to itself.
    if (OPERATION_TITLE.test(title)) {
      out.push({
        kind: 'operation-title',
        id,
        severity: 'medium',
        note: `"${title}" names the operation rather than the subject.`,
        repair: null,
        rewrite: { id, current: title, why: 'the heading names the operation, not the subject' },
        question: null,
      });
    }

    // And one that does not fit is read with its end missing.
    if (title.length > MAX_TITLE_CHARS) {
      out.push({
        kind: 'long-title',
        id,
        severity: 'medium',
        note: `"${title}" is ${title.length} characters and is clipped on the presentation tile.`,
        repair: null,
        rewrite: { id, current: title, why: `the heading is ${title.length} characters and gets clipped` },
        question: null,
      });
    }

    // Two slides under one heading is a deck a reader cannot navigate.
    const k = key(title);
    if (k && seenTitle.has(k)) {
      out.push({
        kind: 'duplicate-title',
        id,
        severity: 'high',
        note: `"${title}" appears on two slides.`,
        repair: null,
        rewrite: { id, current: title, why: 'another slide already carries this heading' },
        question: null,
      });
    } else if (k) {
      seenTitle.set(k, id);
    }
  }

  out.push(...auditUnits(slides));
  out.push(...auditKpis(kpis));
  return out;
}

/**
 * The same quantity, formatted two ways.
 *
 * A rate drawn as `0.12%` on one chart and `2.4` on another is one measure with
 * two units on one page, and a reader has no way to tell which is meant. The
 * audit can see it. It cannot fix it, because the formatting follows the
 * column's name through the query rather than anything the edit whitelist
 * reaches — the fix belongs in the planner, where the two charts stopped
 * agreeing.
 *
 * So this discloses. A defect a reader is told about is recoverable; one that
 * is silently "repaired" into a number nobody computed is not.
 */
function auditUnits(slides) {
  const byMeasure = new Map();
  for (const slide of slides) {
    const chart = slide?.chart || {};
    const measure = key(chart.yAxisKey);
    if (!measure) continue;
    const percent = /%|\brate\b|\bshare\b|\bpercent/i.test(norm(chart.yAxisKey));
    if (!byMeasure.has(measure)) byMeasure.set(measure, new Set());
    byMeasure.get(measure).add(percentScale(chart, percent));
  }

  const out = [];
  for (const [measure, scales] of byMeasure) {
    scales.delete(null);
    if (scales.size < 2) continue;
    out.push({
      kind: 'unit-disagreement',
      severity: 'high',
      note: `${measure} is drawn on two different scales in one deck.`,
      repair: null,
      question:
        `The same measure appears at two scales on different charts — one reads as a percentage and ` +
        'one does not. Which is the figure to quote?',
    });
  }
  return out;
}

/**
 * Whether this chart's values look like fractions or like percentages.
 *
 * A rate whose rows sit under 1 was computed as a fraction; the same rate over
 * 1 was multiplied by a hundred somewhere. Returns null when there is nothing
 * to judge, so a chart with no rows cannot manufacture a disagreement.
 */
function percentScale(chart, isRate) {
  if (!isRate) return null;
  const rows = Array.isArray(chart.resultData) ? chart.resultData : [];
  const values = rows
    .map((r) => Number(r?.[chart.yAxisKey]))
    .filter((n) => Number.isFinite(n) && n !== 0);
  if (values.length < 2) return null;
  return extent(values.map(Math.abs)).max > 1 ? 'hundreds' : 'fraction';
}

/**
 * Two cards saying the same thing with the same number.
 *
 * The strip is four figures a reader takes in at a glance, so a repeat costs a
 * quarter of it. Matched on the value rather than the label, because the two
 * that collide are usually the generated card and a measure written for the
 * same dataset under a different name.
 */
function auditKpis(kpis) {
  const cards = Array.isArray(kpis) ? kpis : [];
  const seen = new Map();
  const out = [];
  cards.forEach((card, index) => {
    const value = key(card?.value);
    if (!value) return;
    if (seen.has(value)) {
      out.push({
        kind: 'duplicate-kpi',
        severity: 'medium',
        note: `"${norm(card.label)}" repeats the value already shown as "${seen.get(value)}".`,
        repair: { op: 'remove_kpi', index, why: 'the same figure is already on the strip' },
        question: null,
      });
      return;
    }
    seen.set(value, norm(card.label));
  });
  return out;
}

/** The findings that carry a fix, in the order they should be applied. */
export const repairs = (audit) => (audit || []).filter((a) => a.repair);

/** The findings that need a sentence written, which is the model's half. */
export const rewrites = (audit) => (audit || []).filter((a) => a.rewrite);

/** The findings nothing can fix, which become questions for the reader. */
export const disclosures = (audit) => (audit || []).filter((a) => a.question);
