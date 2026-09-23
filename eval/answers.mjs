/**
 * Did a report answer the question its file exists for?
 *
 * A question in a corpus expectation names what an answer has to be BUILT
 * from, not how it is worded — so an engine that reaches the same answer by a
 * different chart still gets the credit, and one that writes a plausible title
 * over the wrong columns does not:
 *
 *   {
 *     id: 'value-per-dollar',
 *     text: 'Which plan gives the most capability per dollar?',
 *     intent: 'tradeoff',
 *     answeredBy: [['Intelligence Index', 'Monthly Price USD'], ['USD per Intelligence Point']],
 *     by: ['Plan Name', 'Product'],   // split or labelled by one of these
 *     over: ['order_date'],           // along one of these (a trend)
 *     scope: ['Buyer Unit'],          // like-for-like within all of these
 *     kpi: 'churn rate',              // a KPI label that answers it, when no split is asked
 *     suggest: true,                  // the no-model catalogue must offer it
 *   }
 *
 * A chart that breaks a rule does not answer anything. "Average price by
 * provider" across per-seat and per-instance prices has the right columns and
 * the wrong answer.
 */
import { findingCharts, partitioning, referenced, selected } from './audit.mjs';

const REPORT_LEVEL = new Set(['I8', 'I10']);

const norm = (s) => String(s ?? '').toLowerCase().replace(/[_\s]+/g, ' ').trim();

/** `{ answered, chart, why }` for one question against one report. */
export function answer(result, rows, question, violations = []) {
  // Only a rule about the chart itself disqualifies it. A wrong average in its
  // sentence (I8) or its place in the deck (I10) is the report's fault, and the
  // chart still shows the right thing.
  const broken = new Set(violations.filter((v) => !REPORT_LEVEL.has(v.rule)).map((v) => v.chart));
  const columns = Object.keys(rows[0] || {});
  const single = (col) => new Set(rows.map((r) => r?.[col]).filter((v) => v !== null && v !== undefined && v !== '')).size <= 1;
  let closest = null;

  // A question that names its KPI ("what share churned") is a headline figure;
  // a chart that happens to read the outcome column is not that figure.
  for (const chart of question.kpi ? [] : findingCharts(result)) {
    const reads = referenced(chart.sql);
    const parts = partitioning(chart.sql);
    // `COUNT(*)` in an answer set means "how many rows": volume questions. The
    // count has to be what is plotted — a share's denominator is not volume.
    const reads_ = (c) => (c === 'COUNT(*)' ? selected(chart.sql, chart.yAxisKey || '')?.fn === 'COUNT' : reads.has(c));
    const set = (question.answeredBy || []).find((cols) => cols.every(reads_));
    if (!set) continue;
    const missing = [];
    if (question.by?.length && !question.by.some((c) => parts.has(c))) missing.push(`not split by ${question.by.join(' / ')}`);
    if (question.over?.length && !question.over.some((c) => parts.has(c))) missing.push(`not along ${question.over.join(' / ')}`);
    for (const scope of question.scope || []) if (!parts.has(scope) && !single(scope)) missing.push(`not within ${scope}`);
    if (broken.has(chart.id)) missing.push('breaks a rule');
    if (!missing.length) return { answered: true, chart: chart.id, why: chart.title };
    if (!closest) closest = `${chart.title}: ${missing.join(', ')}`;
  }

  // A headline figure answers a question that asks for no breakdown.
  if (!question.by?.length && !question.over?.length && !question.scope?.length) {
    for (const kpi of result.kpis || []) {
      const label = norm(kpi.label);
      // A derived figure ("Churn Rate" from `churned`) does not carry its
      // column's name, so a question may say what its KPI would be called.
      const hit =
        (question.kpi && new RegExp(question.kpi, 'i').test(label)) ||
        (question.answeredBy || []).some((cols) => cols.length === 1 && label.includes(norm(cols[0])));
      if (hit && !broken.has(`kpi:${kpi.label}`)) return { answered: true, chart: `kpi:${kpi.label}`, why: kpi.label };
    }
  }

  const named = [...(question.answeredBy || []).flat(), ...(question.by || []), ...(question.over || []), ...(question.scope || [])];
  const unknown = named.filter((c) => c !== 'COUNT(*)' && !columns.includes(c));
  return {
    answered: false,
    chart: null,
    why: unknown.length ? `expectation names missing columns: ${unknown.join(', ')}` : closest || 'no chart reads these columns',
  };
}
