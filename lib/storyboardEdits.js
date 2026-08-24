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
const SLIDE_FIELDS = new Set([
  'pageTitle',
  'analystNotes',
  'speech',
  'insight_anchor',
  'insight_implication',
  'insight_question',
  'markdownAnalysis',
]);
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
      ? [
          `### ${heading}`,
          finding.headline,
          finding.detail,
          finding.recommendation ? `**What to do with it**\n\n${finding.recommendation}` : '',
          verifiedBlock,
        ]
          .filter(Boolean)
          .join('\n\n')
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

// ---------------------------------------------------------------------------
// The executive summary and the KPI strip
// ---------------------------------------------------------------------------

/** Fields of the summary slide a user is allowed to change. */
const SUMMARY_FIELDS = new Set(['title', 'headline', 'macroInsights']);
/** Cards of the strategic scorecard a user is allowed to change. */
const SCORECARD_FIELDS = new Set(['focus', 'risk', 'opportunity']);

/**
 * Apply a patch to the summary slide.
 *
 * Same contract as `updateSlide`: unknown keys are dropped rather than merged,
 * and every field the user touches is recorded in `edits` so a re-run or a
 * late-arriving LLM narrative does not overwrite their wording. Without that
 * record, the narrative pass — which lands seconds after the dashboard first
 * paints — would silently revert anything typed in the meantime.
 */
export function updateSummary(slideZero, patch = {}) {
  if (!slideZero) return slideZero;
  const next = { ...slideZero };
  const touched = new Set(slideZero.edits || []);

  for (const [key, value] of Object.entries(patch)) {
    if (key === 'strategicScorecard') continue;
    if (!SUMMARY_FIELDS.has(key)) continue;
    next[key] = value;
    touched.add(key);
  }

  if (patch.strategicScorecard) {
    const card = { ...(slideZero.strategicScorecard || {}) };
    for (const [key, value] of Object.entries(patch.strategicScorecard)) {
      if (!SCORECARD_FIELDS.has(key)) continue;
      card[key] = value;
      touched.add(`strategicScorecard.${key}`);
    }
    next.strategicScorecard = card;
  }

  next.edits = [...touched];
  return next;
}

/** Re-apply a user's summary edits onto a freshly generated summary. */
export function reapplySummaryEdits(fresh, previous) {
  if (!previous?.edits?.length || !fresh) return fresh;
  const patch = { strategicScorecard: {} };
  for (const key of previous.edits) {
    if (key.startsWith('strategicScorecard.')) {
      const field = key.slice('strategicScorecard.'.length);
      if (SCORECARD_FIELDS.has(field)) patch.strategicScorecard[field] = previous.strategicScorecard?.[field];
    } else if (SUMMARY_FIELDS.has(key)) {
      patch[key] = previous[key];
    }
  }
  return updateSummary(fresh, patch);
}

/**
 * Edit one KPI card.
 *
 * `origLabel` remembers what the card was called when it was generated, which is
 * how a re-run finds it again: matching on the current label would lose every
 * card whose label is the thing the user renamed.
 */
export function updateKpi(kpis, index, patch = {}) {
  const list = Array.isArray(kpis) ? kpis : [];
  if (index < 0 || index >= list.length) return list;
  return list.map((kpi, i) => {
    if (i !== index) return kpi;
    const next = { ...kpi, origLabel: kpi.origLabel || kpi.label, edited: true };
    if (typeof patch.label === 'string') next.label = patch.label;
    if (patch.value !== undefined) next.value = patch.value;
    return next;
  });
}

/** Remove one KPI card. */
export function removeKpi(kpis, index) {
  const list = Array.isArray(kpis) ? kpis : [];
  return list.filter((_, i) => i !== index);
}

/**
 * Re-apply KPI edits after a re-run, and honour deletions.
 *
 * A card the user deleted stays deleted: regenerating it would make the delete
 * button look broken on every re-run.
 */
export function reapplyKpiEdits(fresh, previous) {
  if (!Array.isArray(previous) || !previous.length) return fresh || [];
  const list = Array.isArray(fresh) ? fresh : [];
  const edited = new Map(previous.filter((k) => k.edited).map((k) => [String(k.origLabel || k.label), k]));
  const kept = new Set(previous.map((k) => String(k.origLabel || k.label)));
  const everyoneNew = list.every((k) => !kept.has(String(k.label)));

  return list
    // A completely different dataset produces completely different labels;
    // treating that as "the user deleted all of them" would empty the strip.
    .filter((k) => everyoneNew || kept.has(String(k.label)))
    .map((k) => {
      const old = edited.get(String(k.label));
      return old ? { ...k, label: old.label, value: old.value, origLabel: String(k.label), edited: true } : k;
    });
}
