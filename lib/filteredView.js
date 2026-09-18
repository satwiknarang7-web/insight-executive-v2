/**
 * The deck, showing a slice.
 *
 * A filtered dashboard is the same deck with different numbers in it, so this
 * changes only the parts that are numbers: each chart's result rows, the
 * statistics under it, and the card strip. Titles, order, the charts a person
 * dropped or added, every edit they made — untouched, because none of those are
 * facts about the rows and a click must not quietly undo somebody's work.
 *
 * What it does move is the sentence. `insight_anchor` is usually a reading of
 * the result set — "Month-to-month has the highest churn rate at 51.7%, 2.2×
 * the 23.2% average" — and under a filter that sentence is not stale, it is
 * false. Where a model wrote the line instead, the model's line is set aside
 * for as long as the filter is on and the recomputed one is shown, because a
 * written sentence cannot be recomputed and this one carries figures. The prose
 * that carries no figure — the executive summary, the narration — stays where
 * it is, dimmed and labelled by the page as written for the whole table.
 *
 * The unfiltered values ride along on the objects they came from, so clearing a
 * filter is a restore rather than another pass over the rows.
 *
 * Pure: takes an analysis and a worker result, returns a new analysis.
 */

/** The fields a filter replaces, and therefore the fields worth keeping. */
const SLIDE_FIELDS = ['insight_anchor', 'insight_implication', 'findings'];

/**
 * The deck as the filter leaves it.
 *
 * @param {object} analysis   the analysis on screen
 * @param {object} result     `{charts, perChart, kpis, rowCount, empty}` from the worker
 * @param {object} meta       `{filters, where, sql}` — what is being shown
 */
export function applyFiltered(analysis, result, meta = {}) {
  if (!analysis) return analysis;

  const chartsById = byId(result?.charts);
  const findingsById = byId(result?.perChart);

  const storyboard = (analysis.storyboard || []).map((slide) => {
    const chart = chartsById[String(slide.id)];
    const finding = findingsById[String(slide.id)];
    if (!chart && !finding) return slide;

    const next = { ...slide, ...keep(slide) };
    if (chart) next.chart = { ...slide.chart, ...chart, unfiltered: slide.chart?.unfiltered || slide.chart };
    if (finding) {
      next.insight_anchor = finding.headline || '';
      next.insight_implication = finding.detail || '';
      next.findings = { metrics: finding.metrics, verifiedFacts: finding.verifiedFacts };
    }
    return next;
  });

  return {
    ...analysis,
    storyboard,
    kpis: filteredKpis(analysis, result?.kpis),
    kpisUnfiltered: analysis.kpisUnfiltered || analysis.kpis || [],
    filter: {
      filters: meta.filters || [],
      where: meta.where || '',
      sql: meta.sql || '',
      description: meta.description || '',
      rowCount: result?.rowCount ?? 0,
      empty: !!result?.empty,
    },
  };
}

/**
 * The cards, recomputed — but only the ones the analysis wrote.
 *
 * A card a person pinned, or one the analyst wrote from a measure, carries its
 * own definition and is recomputed elsewhere or not at all; replacing the whole
 * strip would drop them. So the planner's cards are replaced in place and
 * everything else is left where it is.
 */
function filteredKpis(analysis, fresh) {
  const planned = Array.isArray(fresh) ? [...fresh] : [];
  const current = analysis.kpis || [];
  const base = analysis.kpisUnfiltered || current;

  return base.map((card, i) => {
    if (card?.custom || card?.prepared) return current.find((c) => c.label === card.label) || card;
    const match = planned.find((c) => c.label === card.label) || planned.shift();
    const values = match ? { value: match.value, trend: match.trend ?? card.trend } : {};
    return { ...card, ...readerOwned(current, card, i), ...values };
  });
}

/**
 * What a filter is not entitled to change.
 *
 * `kpisUnfiltered` is a snapshot taken when the first filter went on, and it
 * exists to hold the figures the whole table produced so clearing a filter is
 * a restore rather than another pass over the rows. It is a snapshot of the
 * *values*, and it was being used as a snapshot of the cards.
 *
 * So a tile dragged while a filter was on went back where it came from the
 * moment the filter changed, and again when it was cleared — a reader
 * arranging a board while looking at one slice had the arrangement taken off
 * them for no stated reason. The findings escaped this because a slide carries
 * its own `unfiltered` bag of exactly the fields a filter replaces; the cards
 * had no such line drawn.
 *
 * The fields below are the ones `reapplyKpiEdits` already carries across a
 * re-run, which is the same question asked of a bigger hammer: where the
 * reader put a card, and what they chose to call it, belong to the reader.
 */
const READER_OWNED = ['layout', 'label', 'id', 'edited', 'origLabel'];

function readerOwned(current, card, index) {
  const live = (card?.id && current.find((c) => c.id === card.id)) || current[index];
  if (!live) return {};
  const held = {};
  for (const field of READER_OWNED) if (live[field] !== undefined) held[field] = live[field];
  return held;
}

/** Put the whole table back, without asking the engine for it again. */
export function clearFiltered(analysis) {
  if (!analysis?.filter) return analysis;

  const storyboard = (analysis.storyboard || []).map((slide) => {
    const chart = slide.chart?.unfiltered ? { ...slide.chart.unfiltered } : slide.chart;
    const restored = { ...slide, chart };
    for (const field of SLIDE_FIELDS) {
      if (slide.unfiltered && field in slide.unfiltered) restored[field] = slide.unfiltered[field];
    }
    delete restored.unfiltered;
    return restored;
  });

  const { kpisUnfiltered, ...rest } = analysis;
  // The values come back from the snapshot; the arrangement does not go back
  // with them. Clearing a filter restores the figures the whole table produced,
  // which is not an instruction to undo whatever the reader moved while it was
  // on. Same line as `filteredKpis` draws, for the same reason.
  const live = analysis.kpis || [];
  const restoredKpis = (kpisUnfiltered || live).map((card, i) => ({
    ...card,
    ...readerOwned(live, card, i),
  }));
  return { ...rest, storyboard, kpis: restoredKpis, filter: null };
}

/** The fields this slide had before any filter, remembered once. */
function keep(slide) {
  if (slide.unfiltered) return {};
  const held = {};
  for (const field of SLIDE_FIELDS) held[field] = slide[field];
  return { unfiltered: held };
}

function byId(list) {
  return Object.fromEntries((Array.isArray(list) ? list : []).map((item) => [String(item.id), item]));
}

/**
 * The specs to run again: what each slide's chart actually is.
 *
 * Taken from the board rather than from the last plan, because the board is
 * what has been edited. `unfiltered` is stripped on the way out — it is the
 * chart's own history and the engine has no use for it.
 */
export function specsFor(analysis) {
  return (analysis?.storyboard || [])
    .map((slide) => slide.chart)
    .filter((chart) => chart && chart.sql)
    .map(({ unfiltered, resultData, ...spec }) => {
      void unfiltered;
      void resultData;
      return spec;
    });
}

/**
 * Is the written narrative describing rows that are no longer on screen?
 *
 * Used by the page to dim it and say so. True whenever a filter is on, because
 * every one of those sentences was written about the whole table.
 */
export function narrativeIsStale(analysis) {
  return !!analysis?.filter && !!analysis.filter.where;
}
