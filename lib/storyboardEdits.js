/**
 * Edits to a generated storyboard.
 *
 * The analysis used to be entirely disposable: re-run it and everything the user
 * had touched was gone, because nothing they did was ever stored. A chart type
 * picked on the insight page lived in `useState` and died on navigation.
 *
 * These functions turn the storyboard into something a user owns. Every edit is
 * a pure transformation producing a new storyboard, so the provider can persist
 * the result and the presentation, report and PDF all read the same edited
 * version. Kept out of the provider (and out of pipeline.js, which drags in
 * alasql) so it can be tested directly.
 *
 * An edited slide records what the user changed in `edits`, which is what lets
 * the UI show "modified" and lets a re-run keep the user's choices instead of
 * silently reverting them.
 */

/** Fields on a slide a user is allowed to change. */
const SLIDE_FIELDS = new Set(['pageTitle', 'analystNotes', 'speech', 'insight_anchor']);
/** Fields on a slide's chart a user is allowed to change. */
const CHART_FIELDS = new Set(['chart_type', 'colors', 'title', 'xAxisKey', 'yAxisKey', 'secondaryYAxisKey']);

/**
 * Apply a patch to one slide.
 *
 * `patch.chart` updates the chart spec (type, colours, axes); everything else
 * updates the slide itself. Unknown keys are ignored rather than merged, so a
 * stray field from a future UI cannot corrupt a persisted storyboard.
 */
export function updateSlide(storyboard, id, patch = {}) {
  return storyboard.map((slide) => {
    if (String(slide.id) !== String(id)) return slide;

    const next = { ...slide };
    const touched = new Set(slide.edits || []);

    for (const [key, value] of Object.entries(patch)) {
      if (key === 'chart') continue;
      if (!SLIDE_FIELDS.has(key)) continue;
      next[key] = value;
      touched.add(key);
    }

    if (patch.chart) {
      const chart = { ...(slide.chart || {}) };
      for (const [key, value] of Object.entries(patch.chart)) {
        if (!CHART_FIELDS.has(key)) continue;
        chart[key] = value;
        touched.add(`chart.${key}`);
      }
      next.chart = chart;
    }

    next.edits = [...touched];
    return next;
  });
}

/** Remove a slide. Returns the storyboard unchanged if the id is unknown. */
export function removeSlide(storyboard, id) {
  return storyboard.filter((slide) => String(slide.id) !== String(id));
}

/** A slide id that cannot collide with a generated one or an existing custom one. */
export function nextCustomId(storyboard) {
  let n = 1;
  const taken = new Set(storyboard.map((s) => String(s.id)));
  while (taken.has(`custom_${n}`)) n++;
  return `custom_${n}`;
}

/**
 * Wrap a chart the user built into a storyboard slide.
 *
 * `finding` is the verified analysis the engine computed for it — the same
 * statistics a generated slide carries — so a hand-built chart is described with
 * real numbers rather than an empty narrative.
 */
export function createSlide({ storyboard, chart, finding, title, notes = '' }) {
  const id = nextCustomId(storyboard);
  const facts = finding?.verifiedFacts || [];
  const verifiedBlock = facts.length ? `**Verified metrics**\n\n${facts.map((x) => `- ${x}`).join('\n')}` : '';
  const heading = title || chart?.title || 'Custom chart';

  return {
    id,
    pageTitle: heading,
    insight_anchor: finding?.headline || '',
    insight_implication: finding?.detail || '',
    insight_question: finding?.recommendation || '',
    markdownAnalysis: finding
      ? `### ${heading}\n\n${finding.headline}\n\n${finding.detail}\n\n${verifiedBlock}`
      : `### ${heading}\n\nBuilt manually from the loaded data.`,
    findings: finding ? { metrics: finding.metrics, verifiedFacts: facts } : null,
    analystNotes: notes,
    chart: { ...chart, id, title: heading },
    custom: true,
    edits: [],
  };
}

/** Insert a slide, at `index` when given, otherwise at the end. */
export function insertSlide(storyboard, slide, index = null) {
  if (index === null || index < 0 || index >= storyboard.length) return [...storyboard, slide];
  const next = [...storyboard];
  next.splice(index, 0, slide);
  return next;
}

/**
 * Re-apply a user's edits to a freshly generated storyboard.
 *
 * Re-running the analysis rebuilds every slide from scratch. Without this, a
 * re-run silently discards renamed titles, chosen chart types, palettes and
 * analyst notes — which makes the Save button a lie the moment anyone clicks
 * Re-run. Matching is by slide id, then by title, since ids are positional and
 * a changed dataset can shift them.
 */
export function reapplyEdits(fresh, previous) {
  if (!previous?.length) return fresh;

  const byId = new Map(previous.map((s) => [String(s.id), s]));
  const byTitle = new Map(previous.map((s) => [normalizeTitle(s.chart?.title || s.pageTitle), s]));

  const merged = fresh.map((slide) => {
    const old = byId.get(String(slide.id)) || byTitle.get(normalizeTitle(slide.chart?.title || slide.pageTitle));
    if (!old?.edits?.length) return slide;

    const patch = { chart: {} };
    for (const key of old.edits) {
      if (key.startsWith('chart.')) {
        const field = key.slice(6);
        if (CHART_FIELDS.has(field)) patch.chart[field] = old.chart?.[field];
      } else if (SLIDE_FIELDS.has(key)) {
        patch[key] = old[key];
      }
    }
    return updateSlide([slide], slide.id, patch)[0];
  });

  // Charts the user built by hand are not regenerated, so they are carried over.
  const custom = previous.filter((s) => s.custom);
  return [...merged, ...custom];
}

const normalizeTitle = (t) => String(t || '').toLowerCase().trim();
