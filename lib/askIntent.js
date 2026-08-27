/**
 * Is this a question about the data, or is it something else?
 *
 * The Ask box answered "hello how are you" with a bar chart of billed artist
 * count, labelled "closest available chart". Every part of that is working as
 * built — the deterministic planner scores its own candidates against the words
 * in the question, and when nothing scores it returns its best one anyway — and
 * the result is nonsense presented with a straight face. A tool whose entire
 * claim is that its numbers can be trusted cannot answer a greeting with a
 * chart and a confident sentence about what it shows.
 *
 * "Closest available" is the wrong fallback for a question that was never about
 * the data. It is the *right* fallback for a real question phrased in words the
 * planner does not know — "how are we doing in the north" is answerable and
 * worth a best effort. So the two cases have to be told apart, and that is all
 * this module does.
 *
 * The test is deliberately generous in one direction: anything naming a column,
 * or using the vocabulary of analysis, is answerable. Only a question with
 * neither — no column, no analytic word, no number — is turned away, and it is
 * turned away with a sentence saying what this box is for rather than a chart.
 *
 * Pure: no imports, no network, no side effects.
 */

/**
 * Words that mean "I want a number out of this data".
 *
 * Every entry has to carry analytic weight on its own. An earlier draft
 * included "what is", which appears in "what is the capital of France" and made
 * that answerable — a question word is not a request for a statistic, and
 * including one turns this test into no test at all.
 */
const ANALYTIC = new RegExp(
  [
    'total', 'sum of', 'average', 'avg', 'mean', 'median', 'count', 'how many', 'how much',
    'most', 'least', 'highest', 'lowest', 'biggest', 'smallest', 'largest', 'top \\d', 'top ten',
    'best', 'worst', 'rank', 'compare', 'comparison', 'versus', ' vs ',
    'trend', 'over time', 'growth', 'decline', 'increase', 'decrease',
    'share of', 'proportion', 'percent', 'percentage', 'breakdown', 'distribution',
    'correlat', 'relationship between', 'outlier', 'anomaly', 'segment',
    'group by', 'grouped by', 'broken down', 'chart', 'graph', 'plot',
    'revenue', 'sales', 'profit', 'margin', 'number of',
  ].join('|'),
  'i'
);

/** Openings that are conversation rather than a question about anything. */
const SMALL_TALK =
  /^\s*(hi|hey|hello|yo|sup|howdy|greetings|good\s+(morning|afternoon|evening|day)|how\s+are\s+you|how'?s\s+it\s+going|what'?s\s+up|thanks?|thank\s+you|ok(ay)?|cool|nice|lol|test|testing|ping)\b/i;

/** Questions about the assistant, not about the data. */
const ABOUT_THE_TOOL =
  /\b(who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|are\s+you\s+(an?\s+)?(ai|bot|human|chatgpt)|your\s+name|tell\s+me\s+a\s+joke|sing|write\s+(me\s+)?a\s+(poem|song|story))\b/i;

const normalise = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Words too common to count as naming a column. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'is', 'are', 'was', 'were', 'and', 'or', 'in', 'on', 'at', 'to',
  'for', 'with', 'my', 'our', 'this', 'that', 'it', 'we', 'you', 'me', 'i', 'do', 'does',
  'id', 'name', 'date', 'time', 'type', 'data',
]);

/** Is `word` in the question, allowing for a plural on either side? */
function present(words, word) {
  return words.has(word) || words.has(`${word}s`) || (word.endsWith('s') && words.has(word.slice(0, -1)));
}

/**
 * Does the question name one of this dataset's columns?
 *
 * Whole words, not substrings: `rank` must not be found inside "frank". And a
 * column whose name is nothing but a generic word — `name`, `date`, `id` — can
 * never identify a question on its own, because every dataset has one and
 * almost every English sentence contains the word.
 */
export function namesColumn(question, columns = []) {
  const asked = normalise(question);
  if (!asked) return false;
  const words = new Set(asked.split(' ').filter(Boolean));

  for (const column of columns) {
    const name = normalise(column);
    if (!name) continue;

    const parts = name.split(' ').filter(Boolean);
    const significant = parts.filter((w) => w.length > 2 && !STOPWORDS.has(w));
    if (!significant.length) continue;

    // The whole name, written out.
    if (parts.length > 1 && asked.includes(name)) return true;

    // Or most of what makes it distinctive: "billed artists" is plainly asking
    // about `billed_artist_count` even though it drops the last word.
    const needed = Math.max(1, Math.ceil((significant.length * 2) / 3));
    const found = significant.filter((w) => present(words, w)).length;
    if (found >= needed) return true;
  }
  return false;
}

/**
 * Can this question be answered from the loaded data?
 *
 * Returns `{ answerable, reason }`. `reason` is written for the user and says
 * what to do instead — a refusal that only says no is a dead end on a page
 * whose whole purpose is to get somewhere.
 */
export function questionRelevance(question, { columns = [] } = {}) {
  const raw = String(question ?? '').trim();
  if (!raw) {
    return { answerable: false, reason: 'Type a question about your data.' };
  }

  const mentionsColumn = namesColumn(raw, columns);

  if (ABOUT_THE_TOOL.test(raw) && !mentionsColumn) {
    return {
      answerable: false,
      reason:
        'This box answers questions about the data you loaded, not about itself. ' +
        'Try naming a column — for example "which category has the highest total?".',
    };
  }

  // Small talk is only small talk when it is the whole message: "hi, which
  // region sells most?" is a question with a greeting attached to it.
  if (SMALL_TALK.test(raw) && !mentionsColumn && !ANALYTIC.test(raw)) {
    return {
      answerable: false,
      reason:
        'That is not a question about this dataset, so there is nothing to compute. ' +
        'Ask about a column instead — for example "which category has the highest total?".',
    };
  }

  if (mentionsColumn || ANALYTIC.test(raw)) {
    return { answerable: true, reason: null };
  }

  // Neither a column nor the vocabulary of analysis, and long enough that it is
  // not a one-word probe: nothing here connects to the data.
  return {
    answerable: false,
    reason:
      'Nothing in that question matches a column in this dataset, so any chart would be a guess. ' +
      'Check the column names in Explore, or name one directly.',
  };
}
