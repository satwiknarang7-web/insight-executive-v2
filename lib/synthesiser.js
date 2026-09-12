/**
 * The argument, as opposed to the findings.
 *
 * The executive summary has always been a list: the four strongest readings,
 * ranked, each written as though its chart were the only one in the deck. That
 * is a stack of true sentences and it is not an analysis. A reader gets no
 * spine — what this data is about, what is in doubt before anything is claimed,
 * the biggest thing in it, what qualifies that, and what to decide.
 *
 * Read back, the deck it produced had seven findings and about four distinct
 * claims: one metric charted twice, one flat series charted twice, and two
 * slides carrying word-for-word identical recommendations. Nothing noticed,
 * because nothing was looking at the findings as a set.
 *
 * So this does three things, and the order matters.
 *
 * **It finds what the deck says twice.** Two findings over the same measure and
 * dimension are one claim. Two identical recommendations are one instruction
 * printed twice, and the second is cleared.
 *
 * **It finds what is contested.** A measure summed across rows that a status
 * column marks cancelled, returned or refunded is not the quantity its name
 * says it is. This does not fix that — filtering is the engine's job and a
 * larger change — but an argument that leads with a total while a tenth of it
 * is void is an argument built on sand, so the doubt goes first, before the
 * claim it undermines.
 *
 * **It builds a spine.** Subject, doubt, the largest claim, its qualifier, the
 * decision. Each step cites the finding it came from, which is what makes the
 * whole argument checkable sentence by sentence rather than as a mood.
 *
 * The model half writes the connective prose over that spine. Unlike every
 * other agent here it IS shown numbers — the verified ones — because an
 * argument without figures is a press release. So the check inverts: rather
 * than "any digit is invented", it is "every digit must already appear in the
 * finding this sentence cites". `acceptArgument` enforces exactly that.
 */

/** Past this the summary is a report of its own and nobody reads it. */
const MAX_STEPS = 6;

/** A decision has to rest on something. Without a citation it is an opinion. */
const MAX_SENTENCE = 320;

/** Values in a status column that mean the row did not happen. */
const VOID_STATUS = /^(cancell?ed|returned|refunded|void(ed)?|failed|charge ?back|rejected)$/i;

/** A column likely to record what became of a row. */
const STATUS_COLUMN = /(^|[^a-z])(status|state|outcome|disposition)([^a-z]|$)/i;

/** Below this share, void rows are a rounding error rather than a premise. */
const MIN_VOID_SHARE = 0.01;

const norm = (s) => String(s ?? '').trim();
const key = (s) => norm(s).toLowerCase().replace(/\s+/g, ' ');

/**
 * Findings that are the same claim wearing two titles.
 *
 * Matched on what a finding is OF — its measure and the column it broke that
 * measure down by — rather than on its wording, because the two slides that
 * duplicated each other in practice were "Total Amount Trend Over Month" and
 * "Monthly Changes in Total Amount": different titles, different chart types,
 * one series.
 *
 * The weaker of a pair is the redundant one, and weaker means what the engine
 * already decided: the lower evidence tier, then the later position.
 */
export function nearDuplicates(findings = []) {
  const tiers = { strong: 3, moderate: 2, indicative: 1, thin: 0 };
  const rank = (f) => tiers[norm(f?.metrics?.evidence).toLowerCase()] ?? 0;
  const out = [];
  const bySubject = new Map();

  (findings || []).forEach((f, index) => {
    const subject = `${key(f?.measure)}|${key(f?.dimension)}`;
    if (!key(f?.measure) && !key(f?.dimension)) return;
    if (!bySubject.has(subject)) bySubject.set(subject, []);
    bySubject.get(subject).push({ f, index });
  });

  for (const group of bySubject.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => rank(b.f) - rank(a.f) || a.index - b.index);
    const [kept, ...rest] = sorted;
    for (const dup of rest) {
      out.push({
        kind: 'duplicate-claim',
        id: String(dup.f?.id ?? ''),
        severity: 'medium',
        note: `"${norm(dup.f?.title)}" measures the same thing as "${norm(kept.f?.title)}".`,
        question:
          `"${norm(dup.f?.title)}" and "${norm(kept.f?.title)}" are the same measure over the same column. ` +
          'Is the second one saying anything the first did not?',
        repair: null,
      });
    }
  }

  out.push(...repeatedAdvice(findings));
  return out;
}

/**
 * A recommendation with its own subject removed.
 *
 * "Decide whether the reliance on Electronics is a strength to press or an
 * exposure to hedge" and the same sentence about 26-35 are one instruction
 * printed twice, and an exact-string check calls them different because a name
 * changed. Comparing exact strings missed exactly that pair on a shipped deck.
 *
 * So the finding's own nouns come out before the comparison — its leader, the
 * column it grouped by, the measure it aggregated — and what is left is the
 * shape of the advice. Two findings whose advice has the same shape are giving
 * the same instruction about different things, which is the thing worth
 * noticing.
 */
function adviceShape(finding) {
  let text = key(finding?.recommendation);
  if (!text) return '';
  const nouns = [
    finding?.metrics?.leader,
    finding?.metrics?.runnerUp,
    finding?.metrics?.laggard,
    finding?.dimension,
    finding?.measure,
  ];
  for (const noun of nouns) {
    const n = key(noun);
    if (n && n.length > 2) text = text.split(n).join(' ');
  }
  return text.replace(/[\d.,%]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The same instruction printed twice.
 *
 * Two findings reached "decide whether the reliance is a strength to press or
 * an exposure to hedge" about different columns on one deck. The second is
 * cleared outright — a reader who has read it once has read it.
 */
function repeatedAdvice(findings = []) {
  const seen = new Map();
  const out = [];
  for (const f of findings || []) {
    const advice = adviceShape(f);
    if (!advice || advice.length < 20) continue;
    if (seen.has(advice)) {
      out.push({
        kind: 'repeated-advice',
        id: String(f?.id ?? ''),
        severity: 'medium',
        note: `"${norm(f?.title)}" repeats the recommendation already given on "${seen.get(advice)}".`,
        question: null,
        repair: { op: 'clear_text', id: String(f?.id ?? ''), field: 'insight_question', why: 'the same instruction is already given on another slide' },
      });
      continue;
    }
    seen.set(advice, norm(f?.title));
  }
  return out;
}

/**
 * The shape of the case, before anybody writes it.
 *
 * Deterministic and citable. Each step names the finding it rests on, so the
 * argument can be checked one sentence at a time — and so the model writing it
 * up has somewhere to attach every figure it is allowed to use.
 *
 * The order is the argument: what this is about, what is in doubt, the largest
 * thing in it, what qualifies that, and what to decide. A doubt that changes
 * how every figure reads comes BEFORE the figures, which is the one ordering
 * rule here that is not a matter of taste.
 */
export function argumentSpine({ findings = [], connections = [], excluded = null, rowCount = 0 } = {}) {
  const steps = [];
  // Strongest first, not deck order. The deck is ordered to be read; an
  // argument leads with its best evidence. Run against the shipped report,
  // taking the first finding put a flat, indicative-only trend at the head of
  // the case while the 72.6% concentration sat fourth.
  const tiers = { strong: 3, moderate: 2, indicative: 1, thin: 0 };
  const ranked = [...(findings || [])]
    .filter(Boolean)
    .map((f, index) => ({ f, index }))
    .sort((a, b) => (tiers[key(b.f?.metrics?.evidence)] ?? 0) - (tiers[key(a.f?.metrics?.evidence)] ?? 0) || a.index - b.index)
    .map((x) => x.f);

  if (excluded) {
    // Not a doubt any more — a statement of what was done. The engine now takes
    // these rows out before anything counts, and an exclusion that changes
    // every figure in the report is the first thing a reader needs, not a
    // footnote after the figures it changed.
    steps.push({
      role: 'basis',
      cites: [],
      text:
        `${excluded.rows.toLocaleString()} of ${excluded.total.toLocaleString()} rows (${excluded.sharePct}%) are marked ` +
        `${excluded.levels.join(' or ')} in ${excluded.column} and are excluded from every figure below. ` +
        `The report describes the remaining ${excluded.kept.toLocaleString()} rows.`,
    });
  }

  const lead = ranked[0];
  if (lead) {
    steps.push({ role: 'claim', cites: [String(lead.id)], text: norm(lead.headline) });
  }

  // A connection is the only sentence in the deck that no single chart
  // contains, which makes it the natural qualifier for whatever led.
  for (const line of connections || []) {
    if (steps.length >= MAX_STEPS - 1) break;
    const text = typeof line === 'string' ? line : norm(line?.text);
    if (text) steps.push({ role: 'qualifier', cites: [], text });
  }

  const second = ranked.find((f) => String(f.id) !== String(lead?.id));
  if (second && steps.length < MAX_STEPS - 1) {
    steps.push({ role: 'qualifier', cites: [String(second.id)], text: norm(second.headline) });
  }

  const decision = decisionFrom(ranked);
  if (decision) steps.push(decision);

  return steps.slice(0, MAX_STEPS);
}

/**
 * The line a reader is supposed to act on.
 *
 * The report it was written for ended on description: seven findings and not
 * one recommendation carrying a figure, an action, or a statement of what would
 * change the answer. A decision that names no number is a mood.
 *
 * So this is only emitted when a finding supplies a figure to hang it on, and
 * the figure comes from that finding's own verified facts rather than from
 * anything written here.
 */
function decisionFrom(findings = []) {
  const actionable = (findings || []).find(
    (f) => norm(f?.recommendation) && ['strong', 'moderate'].includes(norm(f?.metrics?.evidence).toLowerCase())
  );
  if (!actionable) return null;

  const fact = (actionable.verifiedFacts || []).find((x) => /\d/.test(String(x)));
  return {
    role: 'decision',
    cites: [String(actionable.id)],
    text: fact ? `${norm(actionable.recommendation)} The figure to hold it to: ${norm(fact)}.` : norm(actionable.recommendation),
  };
}

// ---------------------------------------------------------------------------
// The half that writes it up
// ---------------------------------------------------------------------------

/**
 * What the model is shown, and why this one is different.
 *
 * Every other agent in this codebase is shown no values, which makes any digit
 * in its reply invented and rejectable. That guarantee cannot hold here: an
 * executive summary without figures is a press release, and the whole point of
 * A7 is to turn verified numbers into a case.
 *
 * So the guarantee inverts rather than disappearing. The model is shown the
 * spine and, for each step, the verified facts of the finding it cites — and
 * every figure it writes must already appear in the facts of a step it cited.
 * Not "probably drawn from them": present in them, as a string. A number it
 * invents has nowhere to have come from and is caught the same way.
 */
export function argumentBriefing({ steps = [], findings = [] } = {}) {
  const byId = new Map((findings || []).map((f) => [String(f?.id), f]));
  return {
    steps: (steps || []).map((s, i) => ({
      n: i + 1,
      role: s.role,
      says: s.text,
      cites: s.cites || [],
      facts: (s.cites || []).flatMap((id) => byId.get(String(id))?.verifiedFacts || []),
    })),
  };
}

/**
 * Take what the model wrote, and keep only the sentences it could support.
 *
 * Three rules, all mechanical. A sentence must cite a step that exists, because
 * an uncited claim is exactly the thing this project does not ship. Every
 * number in it must appear in that step's verified facts, which is the inverted
 * form of the no-digits rule the other agents run under. And nothing may be
 * longer than a sentence or two, because a summary that grows into a report is
 * not a summary.
 *
 * A sentence that fails any of them is dropped, not corrected — the
 * deterministic spine is already a complete and correct argument, so the floor
 * is always there to fall back to.
 */
export function acceptArgument(raw, { steps = [] } = {}) {
  if (!Array.isArray(raw)) return [];
  const facts = new Map(
    (steps || []).map((s, i) => [String(i + 1), (s.facts || []).concat(s.says || '').join(' ')])
  );
  const out = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const text = norm(item.text).replace(/\s+/g, ' ');
    const cites = String(item.step ?? '');
    if (!text || text.length > MAX_SENTENCE) continue;
    const supporting = facts.get(cites);
    if (supporting === undefined) continue;
    if (!numbersAreSupported(text, supporting)) continue;
    out.push({ step: Number(cites), text, source: 'model' });
    if (out.length >= MAX_STEPS) break;
  }
  return out;
}

/**
 * Every figure in the sentence appears in the evidence behind it.
 *
 * Compared as normalised strings rather than parsed as quantities, on purpose:
 * "43.3%" and "43.3" and "43.30%" should all match the fact that says 43.3, and
 * a number that matches nothing was not read anywhere.
 *
 * Small bare integers are exempt — "two of the seven categories", "the top
 * three" — because those are counts a writer produces from the list in front of
 * them rather than figures quoted out of the data. The exemption stops at
 * anything wearing a unit: `12%` and `₹12` are quotations however small, and an
 * earlier version of this let "Revenue grew 12% year on year" through a check
 * whose whole job was to catch it.
 */
function numbersAreSupported(text, evidence) {
  const haystack = String(evidence).replace(/,/g, '');
  const written = String(text).replace(/,/g, '');
  const number = /(\D|^)(\d+(?:\.\d+)?)/g;

  for (let m = number.exec(written); m; m = number.exec(written)) {
    const n = m[2];
    const before = m[1];
    const after = written.slice(m.index + m[0].length);
    const wearsAUnit = /^\s*(%|[a-zA-Z]{1,3}\b)/.test(after) || /[$£€₹]\s*$/.test(before);
    if (!n.includes('.') && Number(n) <= 20 && !wearsAUnit) continue;
    if (haystack.includes(n)) continue;
    // A rounded quote of a longer figure is still a quote of it.
    if (n.includes('.') && haystack.includes(n.split('.')[0])) continue;
    return false;
  }
  return true;
}

/** The spine as plain bullets, for when no provider answers. */
export const spineAsBullets = (steps) => (steps || []).map((s) => s.text).filter(Boolean);
