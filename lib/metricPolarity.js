/**
 * Which direction is good.
 *
 * Nothing in this engine knew. Every ranking recommendation was written as
 * though more of the measure were better, because on revenue it is — and a
 * shipped report reached "lifting the 5 below average is worth more here than
 * pushing Books further ahead" about a SHIPPING COST RATE. Read plainly, that
 * advises a company to raise its shipping costs in five categories.
 *
 * The arithmetic was right, the evidence tier was right, the sentence was
 * grammatical, and the advice was backwards. No amount of checking the numbers
 * catches that, because the numbers were never wrong.
 *
 * So a measure now carries a direction, and it changes three things:
 *
 * - the **verb**. "Books leads categories on shipping cost rate" reads as
 *   praise. A cost leader is not leading, it is worst.
 * - the **advice**. On a minimise-metric the work is bringing the leader DOWN
 *   toward the field, not lifting the field toward the leader.
 * - and **what counts as good news**. A concentration of cost is not a strength
 *   to press.
 *
 * Only clear cases get a direction. Most measures are neither — a count, a
 * quantity, an age, a price — and for those the neutral wording is correct and
 * stays. Being unsure here is cheap; being confidently backwards is what this
 * file exists to stop.
 */

/**
 * Measures where less is better.
 *
 * Every entry is a word whose presence settles the question on its own. `cost`,
 * `refund`, `churn`, `defect`: there is no reading of any of them where more is
 * the good outcome.
 */
const LOWER_IS_BETTER = [
  /\bcosts?\b/i,
  /\bexpenses?\b/i,
  /\boverheads?\b/i,
  /\brefunds?\b/i,
  /\bchurn/i,
  /\battrition\b/i,
  /\bcancell?ations?\b/i,
  /\bcancell?ed\b/i,
  /\breturns? rate\b/i,
  /\breturned\b/i,
  /\bdefects?\b/i,
  /\berrors?\b/i,
  /\bfailures?\b/i,
  /\bfaults?\b/i,
  /\bcomplaints?\b/i,
  /\bdelays?\b/i,
  /\blatency\b/i,
  /\bdowntime\b/i,
  /\bwaste\b/i,
  /\blosses\b/i,
  /\bbreach(es)?\b/i,
  /\boverdue\b/i,
  /\bbacklog\b/i,
  /\bshrinkage\b/i,
  /\bbounce rate\b/i,
  /\babandon(ment|ed)?\b/i,
  /\bdamaged?\b/i,
  /\brejected?\b/i,
];

/**
 * Measures where more is better.
 *
 * Thinner than the list above on purpose. The neutral wording already reads as
 * "more is the thing being ranked", so a wrong entry here changes nothing and a
 * wrong entry above turns advice backwards — the two lists do not carry equal
 * risk and are not written to the same standard of certainty.
 */
const HIGHER_IS_BETTER = [
  /\brevenues?\b/i,
  /\bprofits?\b/i,
  /\bmargins?\b/i,
  /\bsales\b/i,
  /\bincome\b/i,
  /\bretention\b/i,
  /\bsatisfaction\b/i,
  /\bconversions?\b/i,
  /\buptime\b/i,
  /\byield\b/i,
  /\breturn on\b/i,
  /\blifetime value\b/i,
];

/**
 * Phrases that look like one of the lists above and are not.
 *
 * `Return on investment` contains `return`, and reversing its polarity would
 * reintroduce the bug in the other direction. Checked first, so a match here
 * settles the question before anything else is tried.
 */
const EXCEPTIONS = [
  { re: /\breturn on\b/i, direction: 'higher' },
  // A cost saving is a saving.
  { re: /\b(cost|expense) (saving|reduction|avoidance)/i, direction: 'higher' },
];

/**
 * Which way is good for this measure, or null when it is neither.
 *
 * @param {string} name the measure's name, as a reader sees it
 * @returns {'higher'|'lower'|null}
 */
export function metricPolarity(name) {
  const text = String(name ?? '').trim();
  if (!text) return null;

  for (const { re, direction } of EXCEPTIONS) {
    if (re.test(text)) return direction;
  }
  if (LOWER_IS_BETTER.some((re) => re.test(text))) return 'lower';
  if (HIGHER_IS_BETTER.some((re) => re.test(text))) return 'higher';
  return null;
}

/** True when being at the top of this ranking is the bad place to be. */
export const leadingIsBad = (name) => metricPolarity(name) === 'lower';

/**
 * The verb for topping a ranking.
 *
 * "Leads" is a compliment. A category at the top of a shipping cost rate is not
 * leading anything, and a reader skimming headlines takes the verb at face
 * value long before they read the number under it.
 */
export function rankingVerb(name) {
  return leadingIsBad(name) ? 'has the highest' : 'leads';
}
