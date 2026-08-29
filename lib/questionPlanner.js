/**
 * Build a chart from a question, without a language model.
 *
 * The offline path used to work by picking: it generated the storyboard's own
 * candidate charts and returned whichever one shared the most words with the
 * question. That has two failures and this page had both. It can only ever
 * answer with a chart the planner already happened to build — overwhelmingly
 * bar charts — so asking for a matrix got a bar chart. And a single incidental
 * word is enough to call it a match, so "make a matrix of average monthly
 * tenure, with row: category and column: Gender" was answered with average
 * spend by category, on the strength of the word "category" appearing in that
 * chart's title. The page promises it will say when nothing matches rather than
 * showing an unrelated chart, and it was not keeping the promise.
 *
 * So this reads the question instead: what shape was asked for, what is being
 * measured, and what it should be broken down by. It composes a specification
 * the same way the New Chart dialog does — same requirements, same validation,
 * same SQL — and when it cannot find a column for something the question names,
 * it says which part it could not place rather than answering a question that
 * was not asked.
 *
 * It is deliberately literal. This is not an attempt at understanding English;
 * it is an attempt at reading the handful of shapes people actually type into a
 * chart box, and declining the rest honestly.
 */
import { buildChartSpec, chartRequirement } from './chartSpecs.js';
import { matchColumn } from './measureLanguage.js';

/**
 * Words that name a chart shape, longest phrase first so "stacked area" is
 * read before "area" and "bubble map" before "map".
 */
const TYPE_WORDS = [
  ['cross tab', 'matrix'],
  ['crosstab', 'matrix'],
  ['cross-tab', 'matrix'],
  ['pivot table', 'matrix'],
  ['matrix', 'matrix'],
  ['heat map', 'matrix'],
  ['heatmap', 'matrix'],

  ['bubble map', 'bubblemap'],
  ['filled map', 'filledmap'],
  ['shape map', 'shapemap'],
  ['choropleth', 'filledmap'],
  ['map', 'filledmap'],

  ['horizontal bar', 'hbar'],
  ['bar chart', 'bar'],
  ['column chart', 'bar'],
  ['columns', 'bar'],
  ['waterfall', 'waterfall'],
  ['funnel', 'funnel'],
  ['ribbon', 'ribbon'],
  ['treemap', 'treemap'],
  ['tree map', 'treemap'],
  ['scatter', 'scatter'],
  ['bubble', 'bubble'],
  ['radar', 'radar'],
  ['spider', 'radar'],
  ['gauge', 'gauge'],
  ['donut', 'donut'],
  ['doughnut', 'donut'],
  ['pie', 'pie'],
  ['area', 'area'],
  ['line', 'line'],
  ['table', 'table'],
  ['kpi', 'kpi'],
  ['card', 'card'],
]
  // Longest phrase first, always. Scanned in written order, "treemap" is read
  // as a map and "bubble map" as a bubble, because the shorter word is a
  // substring of the longer one.
  .sort((a, b) => b[0].length - a[0].length);

/** Phrasings that imply a shape without naming one. */
const IMPLIED_TYPES = [
  [/\bover time\b|\btrend\b|\btrending\b|\bgrowth\b|\bby month\b|\bby year\b|\bmonthly\b|\bover the (?:year|month|period)/i, 'line'],
  [/\bshare\b|\bproportion\b|\bcomposition\b|\bbreakdown of\b|\bpercent(?:age)? of\b|\bmake ?up\b/i, 'donut'],
  [/\brelationship between\b|\bcorrelat/i, 'scatter'],
  [/\bby (?:country|countries|region|state|nation)\b/i, null], // a place is not automatically a map
];

/**
 * Aggregate words. `COUNT` is last on purpose: "how many orders per region" is
 * a count, but "average order value" is an average of a column that happens to
 * have "order" in its name.
 */
const AGGREGATE_WORDS = [
  [/\baverage\b|\bavg\b|\bmean\b|\bper (?:order|customer|unit|item|transaction)\b/i, 'AVG'],
  [/\bmedian\b/i, 'MEDIAN'],
  [/\bmaximum\b|\bmax\b/i, 'MAX'],
  [/\bminimum\b|\bmin\b/i, 'MIN'],
  [/\btotal\b|\bsum\b|\boverall\b|\bcombined\b/i, 'SUM'],
  [/\bhow many\b|\bnumber of\b|\bcount of\b|\bcount\b|\bhow much\b/i, 'COUNT'],
];

/**
 * Ranking words are not aggregates.
 *
 * "highest", "lowest", "best", "worst" say which end of the list to look at,
 * not what to compute. "The lowest total revenue by category" wants the totals
 * sorted upward, not the smallest single sale within each category — reading
 * those words as MIN and MAX answers a different question and labels it with
 * the word "total" anyway.
 */
const RANK_LOW = /\blowest\b|\bsmallest\b|\bworst\b|\bbottom\b|\bleast\b|\bfewest\b/i;

/**
 * Phrases that introduce a grouping column, in the order they are looked for.
 * Each captures the column phrase; an explicit `row:`/`column:` wins over a
 * loose "by X" because someone who writes it that way means it.
 */
// A role phrase runs until "and", "with", "as", or punctuation. Without that
// bound the capture in "row: Category and column: Gender" swallows the rest of
// the sentence, the column half is never seen, and a matrix that was fully
// specified gets refused for missing a column.
const UNTIL = '([^,;.]+?)(?=\\s+and\\b|\\s+with\\b|\\s+as\\b|[,;.]|$)';
const role = (name, lead) => ({ role: name, re: new RegExp(lead + UNTIL, 'i') });

const ROLE_PATTERNS = [
  role('row', '\\brows?\\s*[:=]\\s*'),
  role('column', '\\bcolumns?\\s*[:=]\\s*'),
  role('legend', '\\b(?:legend|series|split by|coloured by|colored by)\\s*[:=]?\\s*'),
  role('group', '\\b(?:broken down by|grouped by|by each|for each|per each)\\s+'),
  // "which region has the most revenue" names its grouping without a "by", and
  // the noun stops at the verb — running it to the end of the sentence would
  // eat the measure along with it.
  {
    role: 'group',
    re: /\bwhich\s+([a-z0-9_ ]{2,32}?)\s+(?:has|have|had|is|are|was|were|brings|makes|does|do|sells|gets|leads)\b/i,
  },
  role('group', '\\bby\\s+'),
  role('group', '\\bper\\s+'),
];

const clean = (s) => String(s || '').trim().replace(/\s+/g, ' ');

/**
 * Is this column really named in the text, or did it match on a fragment?
 *
 * `matchColumn` matches on substrings, which is right for measure formulas
 * where the phrase has already been narrowed down, and wrong here: a question
 * asking for "average monthly tenure" was answered with a column called `Age`,
 * because "age" sits inside "aver**age**". Nothing about that is a match, and
 * the chart it produced looked entirely reasonable.
 *
 * So one of the column's own words has to appear in the question on word
 * boundaries — allowing a plural, and allowing the underscores in a column name
 * to be spaces or nothing in the question.
 */
function namedIn(text, column) {
  if (!column) return false;
  const hay = String(text).toLowerCase();
  const parts = String(column)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  if (!parts.length) return true; // a one- or two-letter column has no fragments to confuse

  const glued = parts.join('');
  const spaced = parts.join(' ');
  for (const candidate of [glued, spaced, ...parts]) {
    const re = new RegExp(`\\b${candidate.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(?:e?s)?\\b`, 'i');
    if (re.test(hay)) return true;
  }
  return false;
}

/**
 * Which shape did they ask for, if any.
 * @returns {string|null} a chart type, or null when the question names none.
 */
export function readChartType(question) {
  const hay = String(question || '').toLowerCase();
  for (const [phrase, type] of TYPE_WORDS) {
    if (hay.includes(phrase)) return type;
  }
  for (const [re, type] of IMPLIED_TYPES) {
    if (re.test(question) && type) return type;
  }
  return null;
}

/** Which aggregate did they ask for, and does the engine have it. */
export function readAggregate(question) {
  for (const [re, aggregate] of AGGREGATE_WORDS) {
    if (re.test(question)) return aggregate;
  }
  return null;
}

/**
 * Pull out the grouping columns the question names, and hand back the question
 * with those phrases removed — so the search for the measure that follows
 * cannot land on a column that has already been spoken for.
 */
function readGroupings(question, dimensions) {
  const found = [];
  let rest = String(question || '');

  for (const { role, re } of ROLE_PATTERNS) {
    const match = rest.match(re);
    if (!match) continue;
    const column = matchColumn(match[1], dimensions, { exclude: found.map((f) => f.column) });
    if (!column || !namedIn(match[1], column)) continue;
    found.push({ role, column, phrase: clean(match[1]) });
    rest = rest.replace(match[0], ' ');
  }

  return { groupings: found, rest };
}

/**
 * Read a question into a chart specification.
 *
 * @param {string} question
 * @param {{columns: string[], profile: object, sample: object[], measures: object[]}} context
 * @returns {{ spec: object|null, error: string|null }} `error` names the part
 *   of the question that could not be placed, so the page can say so instead of
 *   answering something else.
 */
export function planQuestion(question, context = {}) {
  const text = clean(question);
  if (!text) return { spec: null, error: 'Ask a question first.' };

  const profile = context.profile || {};
  const dimensions = profile.dimensions || [];
  const numeric = profile.measures || [];
  const temporal = profile.temporal || [];
  const saved = context.measures || [];

  const askedType = readChartType(text);
  const aggregate = readAggregate(text);

  if (aggregate === 'MEDIAN') {
    return {
      spec: null,
      error:
        'Medians are not available offline — the query engine here has no median function. ' +
        'Ask for an average, or build the chart on the dashboard.',
    };
  }

  const { groupings, rest } = readGroupings(text, dimensions);

  // The measure: a saved measure by name first, since someone who has defined
  // "Profit Margin" and then asks for it means that one and not a column that
  // happens to share a word with it.
  const savedMatch = saved.find((m) => rest.toLowerCase().includes(String(m.name).toLowerCase()));
  const loose = savedMatch
    ? null
    : matchColumn(rest, numeric, { exclude: groupings.map((g) => g.column) });
  const measureColumn = namedIn(rest, loose) ? loose : null;

  // A count needs no column at all — "how many orders per region" counts rows.
  const counting = aggregate === 'COUNT' && !measureColumn && !savedMatch;
  if (!savedMatch && !measureColumn && !counting) {
    return {
      spec: null,
      error:
        `No column here matches what you asked to measure. ` +
        `The numeric columns are: ${numeric.slice(0, 8).join(', ')}${numeric.length > 8 ? '…' : ''}.`,
    };
  }

  const value = savedMatch
    ? { aggregate: 'SUM', column: '', measureId: savedMatch.id }
    : { aggregate: counting ? 'COUNT' : aggregate || 'SUM', column: measureColumn || '', measureId: null };

  // The shape: what was asked for, or what the groupings imply.
  const type = askedType || impliedType(groupings, temporal);
  const requirement = chartRequirement(type);

  // Fill the slots the chosen type declares from the groupings that were found,
  // honouring an explicit row/column/legend before falling back to order.
  const dims = {};
  const pool = [...groupings];
  const take = (predicate) => {
    const i = pool.findIndex(predicate);
    return i === -1 ? null : pool.splice(i, 1)[0];
  };

  for (const slot of requirement.dimensions) {
    let picked = null;
    if (slot.optional) picked = take((g) => g.role === 'legend');
    else if (slot.key === 'dimension2') picked = take((g) => g.role === 'column');
    else if (slot.prefer === 'time') picked = take((g) => temporal.includes(g.column));
    if (!picked) picked = take((g) => g.role === 'row') || take((g) => g.role === 'group');
    if (picked) dims[slot.key] = picked.column;
  }

  const missing = requirement.dimensions.filter((slot) => !slot.optional && !dims[slot.key]);
  if (missing.length) {
    // A trend with no date named can still use the one date column there is;
    // anything else genuinely was not said.
    const slot = missing[0];
    if (slot.prefer === 'time' && temporal.length === 1) {
      dims[slot.key] = temporal[0];
    } else {
      return {
        spec: null,
        error:
          `A ${requirement.label} needs a column for ${missing
            .map((m) => m.label.toLowerCase())
            .join(' and ')}, and I could not find one in that question. ` +
          `The columns you can group by are: ${dimensions.slice(0, 8).join(', ')}${
            dimensions.length > 8 ? '…' : ''
          }.`,
      };
    }
  }

  // Every measure slot takes the one measure that was read. A type wanting two
  // different measures cannot be built from a question naming one, and saying
  // so is better than plotting the same number against itself.
  const vals = {};
  for (const slot of requirement.measures) vals[slot.key] = value;
  if (requirement.measures.length > 1) {
    return {
      spec: null,
      error: `A ${requirement.label} needs ${requirement.measures.length} different measures. Build it on the dashboard, where each one can be chosen separately.`,
    };
  }

  const built = buildChartSpec(
    { type, dims, vals, sort: readSort(text), bucket: readBucket(text) },
    { columns: context.columns || [], profile, sample: context.sample || [], measures: saved }
  );
  if (built.error) return { spec: null, error: built.error };

  return { spec: { ...built.spec, title: built.spec.title }, error: null };
}

/** Smallest first when they asked for the bottom of the list. */
function readSort(question) {
  return RANK_LOW.test(question) ? 'value-asc' : 'value-desc';
}

/** "by month", "yearly", "day by day" — the period a date axis groups into. */
function readBucket(question) {
  if (/\bby day\b|\bdaily\b|\bday by day\b|\bper day\b/i.test(question)) return 'day';
  if (/\bby month\b|\bmonthly\b|\bper month\b|\bby the month\b/i.test(question)) return 'month';
  if (/\bby year\b|\byearly\b|\bannual(?:ly)?\b|\bper year\b/i.test(question)) return 'year';
  return 'auto';
}

/** With no shape named, the groupings decide it. */
function impliedType(groupings, temporal) {
  // A legend splits one axis into series; it is not a second axis, so it does
  // not turn a bar chart into a cross-tab.
  const axes = groupings.filter((g) => g.role !== 'legend');
  if (axes.length === 0) return groupings.length ? 'bar' : 'card';
  if (axes.length >= 2) return 'matrix';
  return temporal.includes(axes[0].column) ? 'line' : 'bar';
}
