/**
 * Turning a slide into something an avatar can say out loud.
 *
 * Written text and spoken text are not the same thing. "$1.2M" read literally
 * becomes "dollar one point two em"; "Q1 2026" becomes "cue one two thousand
 * and twenty six"; a bulleted markdown block becomes a stream of asterisks.
 * This module produces a script meant for a speech synthesiser, not a reader.
 *
 * It is deliberately deterministic and offline — no API key, no network. The
 * narrative the LLM already wrote (or the verified fallback text) is the source;
 * the avatar's register only decides how it is introduced and joined together.
 */

/** Expand a number-heavy display string into words a synthesiser reads correctly. */
export function speakable(text) {
  if (!text) return '';
  let s = String(text);

  // Markdown artefacts that would be read aloud as punctuation.
  s = s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/[*_`#>]/g, ' ');
  s = s.replace(/\[(.+?)\]\(.*?\)/g, '$1');

  // Currency and magnitude suffixes, before the bare-suffix rule below.
  s = s.replace(/([$€£])\s?([\d.,]+)\s?M\b/gi, (_, c, n) => `${n} million ${currency(c)}`);
  s = s.replace(/([$€£])\s?([\d.,]+)\s?K\b/gi, (_, c, n) => `${n} thousand ${currency(c)}`);
  s = s.replace(/([$€£])\s?([\d.,]+)/g, (_, c, n) => `${n} ${currency(c)}`);
  s = s.replace(/\b([\d.,]+)\s?M\b/g, '$1 million');
  s = s.replace(/\b([\d.,]+)\s?K\b/g, '$1 thousand');
  s = s.replace(/\b([\d.,]+)\s?B\b/g, '$1 billion');

  // Quarters and percentages.
  s = s.replace(/\bQ([1-4])\b/g, 'quarter $1');
  s = s.replace(/([\d.]+)\s?%/g, '$1 percent');

  // Snake_case and dotted joined-column names read as words. The dot rule
  // requires a letter on one side: without that it also splits "1.2" into
  // "1 2", which turns every decimal in the deck into two separate numbers.
  s = s.replace(/([a-zA-Z0-9])_([a-zA-Z0-9])/g, '$1 $2');
  s = s.replace(/([a-zA-Z])\.([a-zA-Z0-9])/g, '$1 $2');
  s = s.replace(/([a-zA-Z0-9])\.([a-zA-Z])/g, '$1 $2');

  // Ranges and comparisons.
  s = s.replace(/(\d)\s?-\s?(\d)/g, '$1 to $2');
  // The trailing  would not consume the full stop in "vs.", leaving
  // "versus. Cost" — a spurious sentence break mid-phrase.
  s = s.replace(/\bvs\.?(?=\s|$)/gi, 'versus');

  return s.replace(/\s{2,}/g, ' ').trim();
}

const currency = (symbol) => ({ $: 'dollars', '€': 'euros', '£': 'pounds' })[symbol] || '';

/** Join sentences with a real pause between them. */
function joinSentences(parts) {
  return parts
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .map((p) => (/[.!?]$/.test(p) ? p : `${p}.`))
    .join(' ');
}

/**
 * The script for one slide, in one avatar's voice.
 *
 * Analyst notes are spoken last and introduced as the analyst's own comment, so
 * an audience can tell the difference between what the data says and what a
 * person added.
 */
export function slideScript(slide, avatar, { index = 0, total = 0 } = {}) {
  if (!slide) return '';
  const r = avatar.register;
  const title = slide.pageTitle || slide.chart?.title || 'this finding';

  const parts = [
    r.open(title),
    slide.insight_anchor ? `${r.lead} ${slide.insight_anchor}` : '',
    slide.insight_implication ? `${r.bridge} ${slide.insight_implication}` : '',
    slide.insight_question ? `${r.close} ${slide.insight_question}` : '',
    slide.analystNotes ? `A note from the analyst: ${slide.analystNotes}` : '',
    index >= 0 && total > 0 && index === total - 1 ? 'That is the last of the findings.' : '',
  ];

  return speakable(joinSentences(parts));
}

/** The script for the opening summary slide. */
export function summaryScript(slideZero, avatar, { fileName, rowCount } = {}) {
  if (!slideZero) return '';
  const r = avatar.register;
  const source = fileName ? ` from ${fileName.replace(/\.(csv|tsv|txt|xlsx?|xlsm)$/i, '')}` : '';
  const scale = rowCount ? ` across ${rowCount.toLocaleString()} rows` : '';

  const insights = (slideZero.macroInsights || []).slice(0, 3);
  const card = slideZero.strategicScorecard || {};

  const parts = [
    `I'm ${avatar.name}, and I'll walk you through this analysis${source}${scale}`,
    slideZero.title && slideZero.title !== 'Executive Summary' ? slideZero.title : '',
    // The opening line carries the whole analysis, so it is said before the
    // bullets rather than left out of the spoken version entirely.
    slideZero.headline || '',
    insights.length ? `${r.lead} ${joinSentences(insights)}` : '',
    card.focus ? `Our focus: ${card.focus}` : '',
    card.risk ? `The risk to watch: ${card.risk}` : '',
    card.opportunity ? `And the opportunity: ${card.opportunity}` : '',
    "Let's go through the findings.",
  ];

  return speakable(joinSentences(parts));
}

/**
 * The script for the closing board — every chart at once.
 *
 * A recap, not a re-read. The findings have just been walked through one at a
 * time; saying them again in the same words is how a deck outstays its welcome.
 * So this names how much was covered, restates only the single line the whole
 * analysis rests on, and hands back the decision the scorecard already carries.
 */
export function dashboardScript(analysis, avatar, { fileName } = {}) {
  if (!analysis) return '';
  const r = avatar.register;
  const count = analysis.storyboard?.length || 0;
  const card = analysis.slideZero?.strategicScorecard || {};
  const source = fileName ? fileName.replace(/\.(csv|tsv|txt|xlsx?|xlsm)$/i, '') : 'this data';

  const parts = [
    `That is all ${count} ${count === 1 ? 'finding' : 'findings'} from ${source}, on one board`,
    analysis.slideZero?.headline || '',
    card.focus ? `${r.close} ${card.focus}` : '',
    card.risk ? `The one thing to keep an eye on: ${card.risk}` : '',
    'Every number here came from a query you can read.',
  ];

  return speakable(joinSentences(parts));
}

/** The whole deck as an ordered list of scripts, for a continuous read-through. */
export function deckScript(analysis, avatar, { fileName, rowCount } = {}) {
  if (!analysis) return [];
  const board = analysis.storyboard || [];
  return [
    { id: 'summary', title: analysis.slideZero?.title || 'Executive Summary', text: summaryScript(analysis.slideZero, avatar, { fileName, rowCount }) },
    ...board.map((slide, i) => ({
      id: slide.id,
      title: slide.pageTitle,
      text: slideScript(slide, avatar, { index: i, total: board.length }),
    })),
    { id: 'dashboard', title: 'Everything together', text: dashboardScript(analysis, avatar, { fileName }) },
  ];
}

/**
 * Pick the system voice that best fits an avatar.
 *
 * Available voices vary wildly by browser and OS, so this is a preference
 * ordering, not a guarantee: a named match first, then any voice in the page's
 * language, then whatever the browser offers. Returning `null` is fine — the
 * synthesiser then uses its default and the pitch/rate shaping still applies.
 */
export function pickVoice(voices, avatar, lang = 'en') {
  if (!voices?.length) return null;
  const wanted = avatar?.voice?.match || [];
  const sameLang = voices.filter((v) => String(v.lang || '').toLowerCase().startsWith(lang));
  const pool = sameLang.length ? sameLang : voices;

  for (const needle of wanted) {
    const hit = pool.find((v) => String(v.name || '').toLowerCase().includes(needle));
    if (hit) return hit;
  }
  return pool.find((v) => v.default) || pool[0] || null;
}
