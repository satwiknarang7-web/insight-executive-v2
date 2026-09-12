/**
 * What this deck does not say.
 *
 * Every other check in this codebase reads the data and asks whether a claim is
 * true. This one reads the finished analysis and asks what is missing from it —
 * which is a different job, and the one nothing was doing.
 *
 * The reason it needs doing is that the expensive mistakes in this project have
 * all been ABSENCES. A 202,616-row athlete export came back as six charts of
 * record counts while the column recording who won sat unread, and nothing on
 * the page could have told you: a chart that is not there leaves no mark. The
 * same file's strongest predictor went unused for the same reason. Reading
 * output catches wrong sentences; it cannot catch a missing one.
 *
 * The second kind is contradiction. One report told a reader on page 3 that a
 * 43.2% share of revenue was "who the data covers, not a position to rebalance"
 * and on page 8 to "decide whether the reliance is a strength to press or an
 * exposure to hedge" — the same dimension, the same number, opposite
 * instructions. Each sentence was defensible alone. Only holding them together
 * shows the problem, and nothing held them together.
 *
 * **Everything here is a question, and that is the design.** A critic that
 * asserted findings would be a second analyst with no evidence behind it, and
 * this app has exactly one rule it will not break: a number on screen came from
 * a query you can read. So this returns things to check, marked as unanswered,
 * for a reader or for the engine to resolve. Nothing it says is presented as a
 * finding, none of it carries an evidence tier, and it computes no statistic of
 * its own.
 *
 * It is deterministic and needs no API key, like every other feature here. A
 * language model would widen the second question — "what else would an analyst
 * ask of this dataset" is exactly what a model is good at and a rule list is
 * not — and it would slot in behind the same interface, adding questions to the
 * same list. What it must never do is answer one.
 */

/** Questions below this rank are noise on a deck that is otherwise fine. */
const MAX_QUESTIONS = 6;

/** A column with fewer levels than this is not worth asking about on its own. */
const MIN_INTERESTING_LEVELS = 2;

/**
 * Recommendations that tell a reader to manage a position, and ones that tell
 * them the opposite. Two findings about the same column should not do both.
 */
const PORTFOLIO_STANCE = /(exposure to hedge|strength to press|rebalance|concentration to decide|independent bets|bad quarter for)/i;
const COVERAGE_STANCE = /(who the data covers|not a position to rebalance|describe .* more than anyone|different populations|shape of the)/i;

/** A recommendation that asks for action, as opposed to one that asks for care. */
const ACTIONABLE = /^(Decide|Start with|Work out|Identify what|Find what|Design for|Split the)/;

const norm = (s) => String(s ?? '').trim();

/**
 * Columns any finding in the deck actually looked at.
 *
 * A finding names the dimension it grouped by and the measure it aggregated;
 * an outcome chart also names the column the rate was computed from. Anything
 * else in the table was profiled and then never asked a question.
 */
function columnsUsed(findings) {
  const used = new Set();
  for (const f of findings || []) {
    for (const key of [f?.dimensionKey, f?.measureKey, f?.outcomeRate?.column]) {
      if (norm(key)) used.add(norm(key));
    }
  }
  return used;
}

/**
 * Two findings about one column that point opposite ways.
 *
 * Compared on the dimension rather than the title, because the same column is
 * charted under several titles — "Total Amount by Customer Age Group" and the
 * summary bullet drawn from it are one subject and two sentences.
 */
function contradictions(findings) {
  const out = [];
  const byDimension = new Map();
  for (const f of findings || []) {
    const dim = norm(f?.dimension);
    if (!dim) continue;
    if (!byDimension.has(dim)) byDimension.set(dim, []);
    byDimension.get(dim).push(f);
  }

  for (const [dim, group] of byDimension) {
    if (group.length < 2) continue;
    const portfolio = group.filter((f) => PORTFOLIO_STANCE.test(norm(f.recommendation)));
    const coverage = group.filter((f) => COVERAGE_STANCE.test(norm(f.recommendation)));
    if (portfolio.length && coverage.length) {
      out.push({
        kind: 'contradiction',
        question: `Two findings about ${dim} give opposite instructions — one treats its concentration as a position to manage, the other as a fact about who the data covers. Which is it?`,
        evidence: [portfolio[0].title, coverage[0].title],
      });
    }
  }
  return out;
}

/**
 * The outcome the dataset exists to explain, if nothing charted it.
 *
 * A file whose columns include a result is a file about that result. When one
 * is detected and no finding is built on it, the deck is about everything
 * except the question.
 */
function unusedOutcome(findings, outcome) {
  if (!outcome?.column) return [];
  const used = (findings || []).some((f) => norm(f?.outcomeRate?.column) === norm(outcome.column));
  if (used) return [];
  return [
    {
      kind: 'unused-outcome',
      question: `${outcome.column} records what happened, and nothing in this deck is about it. Should the analysis lead with what moves it?`,
      evidence: [outcome.column],
    },
  ];
}

/**
 * Columns the analysis never asked a question about.
 *
 * Ranked so the ones most likely to matter come first: a dimension with a
 * handful of levels is a breakdown waiting to happen, while a column with one
 * value or a value per row is not. Columns the engine deliberately withheld —
 * repeated attributes, mixed currencies — are excluded, because those absences
 * are already explained on their own notice and repeating them here would bury
 * the ones that are not.
 */
function unusedColumns(findings, profile, withheld) {
  const used = columnsUsed(findings);
  const cardinality = profile?.cardinality || {};
  const rowCount = profile?.rowCount || 0;
  const skip = new Set(withheld || []);

  const candidates = [];
  for (const col of [...(profile?.dimensions || []), ...(profile?.measures || [])]) {
    if (used.has(col) || skip.has(col)) continue;
    const levels = cardinality[col] || 0;
    if (levels < MIN_INTERESTING_LEVELS) continue;
    // A column with a distinct value on nearly every row identifies rows rather
    // than grouping them, and asking to break anything down by it is noise.
    if (rowCount > 8 && levels >= 0.9 * rowCount) continue;
    const isDimension = (profile?.dimensions || []).includes(col);
    // A readable breakdown first, then a measure, then the long tail.
    const rank = isDimension && levels <= 25 ? 0 : isDimension ? 2 : 1;
    candidates.push({ col, levels, rank });
  }
  if (candidates.length === 0) return [];

  candidates.sort((a, b) => a.rank - b.rank || a.levels - b.levels);
  const named = candidates.slice(0, 3).map((c) => c.col);
  const more = candidates.length - named.length;
  return [
    {
      kind: 'unused-columns',
      question:
        `${candidates.length} ${candidates.length === 1 ? 'column was' : 'columns were'} profiled and never asked about` +
        `${named.length ? ` — ${named.join(', ')}${more > 0 ? ` and ${more} more` : ''}` : ''}. ` +
        'Is there a question here the deck did not reach?',
      evidence: candidates.map((c) => c.col),
    },
  ];
}

/**
 * A recommendation asking for action on evidence that cannot carry it.
 *
 * The engine already caps the verb by the evidence tier, so this should never
 * fire. It is kept because "should never fire" is exactly the claim worth
 * watching: if it ever does, the cap has been bypassed somewhere.
 */
function overreach(findings) {
  const out = [];
  for (const f of findings || []) {
    const tier = f?.metrics?.evidence;
    if (tier !== 'thin' && tier !== 'indicative') continue;
    if (!ACTIONABLE.test(norm(f.recommendation))) continue;
    out.push({
      kind: 'overreach',
      question: `"${norm(f.title)}" rests on ${tier} evidence but reads as an instruction. Should it be softened, or is the tier wrong?`,
      evidence: [norm(f.title)],
    });
  }
  return out;
}

/**
 * Read a finished analysis and return what is worth checking about it.
 *
 * @param {object}   input
 * @param {object[]} input.findings  per-chart findings, as `analyzeStoryboard` returns them
 * @param {object}   input.profile   columns, cardinality and row count
 * @param {object}   [input.outcome] the outcome column, when one was detected
 * @param {string[]} [input.withheld] columns the engine deliberately refused to aggregate
 * @returns {{kind: string, question: string, evidence: string[]}[]}
 */
export function critique({ findings = [], profile = null, outcome = null, withheld = [] } = {}) {
  if (!Array.isArray(findings) || findings.length === 0) return [];

  const questions = [
    // Ordered by how much a reader loses by not knowing: a deck arguing with
    // itself first, then a deck that never reached the question, then the
    // columns it walked past.
    ...contradictions(findings),
    ...overreach(findings),
    ...unusedOutcome(findings, outcome),
    ...unusedColumns(findings, profile, withheld),
  ];

  return questions.slice(0, MAX_QUESTIONS);
}
