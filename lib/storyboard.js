/**
 * Storyboard assembly.
 *
 * Kept separate from pipeline.js (which pulls in alasql) so the main thread can
 * merge narrative onto verified findings without bundling a SQL engine.
 */
/**
 * Merge LLM narrative (optional) onto the verified findings to produce the final
 * storyboard. If the LLM is unavailable every field falls back to the
 * deterministic, already-correct text.
 */
export function buildStoryboard({ charts, perChart, synthesis, narrative }) {
  const findingsById = Object.fromEntries(perChart.map((f) => [String(f.id), f]));
  const narratives = Array.isArray(narrative?.storyboard) ? narrative.storyboard : [];

  const slideZero = {
    title: narrative?.slideZero?.title || synthesis?.title || 'Executive Summary',
    // The opening line an analyst would say before the bullets. Deterministic
    // when there is no narrative pass, absent only when there is neither.
    headline: narrative?.slideZero?.headline || synthesis?.headline || '',
    macroInsights:
      (Array.isArray(narrative?.slideZero?.macroInsights) && narrative.slideZero.macroInsights.length
        ? narrative.slideZero.macroInsights
        : synthesis?.macroInsights) || [],
    strategicScorecard: {
      focus: narrative?.slideZero?.strategicScorecard?.focus || synthesis?.strategicScorecard?.focus || '',
      risk: narrative?.slideZero?.strategicScorecard?.risk || synthesis?.strategicScorecard?.risk || '',
      opportunity:
        narrative?.slideZero?.strategicScorecard?.opportunity || synthesis?.strategicScorecard?.opportunity || '',
    },
    rowsAnalyzed: synthesis?.rowsAnalyzed ?? 0,
    chartsAnalyzed: synthesis?.chartsAnalyzed ?? charts.length,
    narrated: narratives.length > 0,
  };

  const storyboard = charts.map((chart, index) => {
    const finding = findingsById[String(chart.id)] || null;
    const match =
      narratives.find((n) => String(n.id).toLowerCase().trim() === String(chart.id).toLowerCase().trim()) ||
      narratives.find(
        (n) =>
          n.pageTitle?.toLowerCase().trim() === chart.title?.toLowerCase().trim() ||
          n.title?.toLowerCase().trim() === chart.title?.toLowerCase().trim()
      ) ||
      narratives[index] ||
      null;

    const verifiedBlock = finding
      ? `**Verified metrics**\n\n${finding.verifiedFacts.map((x) => `- ${x}`).join('\n')}`
      : '';

    return {
      id: chart.id,
      pageTitle: match?.pageTitle || match?.title || chart.title,
      insight_anchor: match?.insight_anchor || finding?.headline || '',
      insight_implication: match?.insight_implication || finding?.detail || '',
      insight_question: match?.insight_question || finding?.recommendation || '',
      markdownAnalysis:
        match?.markdownAnalysis ||
        (finding ? writeUp({ heading: finding.title || chart.title, finding, verifiedBlock }) : NO_ROWS),
      findings: finding ? { metrics: finding.metrics, verifiedFacts: finding.verifiedFacts } : null,
      chart,
    };
  });

  return { slideZero, storyboard };
}

/** Shown when a chart's query came back empty — there is nothing to write up. */
const NO_ROWS =
  '### Analysis unavailable\nThis query returned no rows. Check the SQL in Data Quality.';

/**
 * The long-form write-up for one finding, in the order an analyst presents it:
 * the conclusion, the evidence behind it, what to do next, then the raw numbers
 * for anyone who wants to check the work. The recommendation used to be dropped
 * here and shown only as a "next question", which left the written analysis
 * ending on description rather than on a decision.
 */
function writeUp({ heading, finding, verifiedBlock }) {
  const parts = [`### ${heading}`, finding.headline, finding.detail];
  if (finding.recommendation) parts.push(`**What to do with it**\n\n${finding.recommendation}`);
  if (verifiedBlock) parts.push(verifiedBlock);
  return parts.filter(Boolean).join('\n\n');
}
