'use client';

import { useCallback, useState } from 'react';
import { Send, Loader2, Sparkles, Code2, ChevronRight, Terminal, Info, ShieldCheck } from 'lucide-react';
import { useActions, useDataset, useMeasures } from '../../../lib/store/DatasetProvider';
import PageFrame from '../../../components/shell/PageFrame';
import LazyChart from '../../../components/charts/LazyChart';
import ChartBoundary from '../../../components/charts/ChartBoundary';
import { formatNumber } from '../../../lib/format';
import { formatSql } from '../../../lib/sqlFormat';
import { questionRelevance } from '../../../lib/askIntent';
import { planQuestion } from '../../../lib/questionPlanner';

const EXAMPLES = [
  'Which category brings in the most revenue?',
  'How has volume changed over time?',
  'What is the share of each region?',
  'Is there a relationship between price and units sold?',
];

export default function AskPage() {
  const { dataset } = useDataset();
  const { askEngine } = useActions();
  const measures = useMeasures();

  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState([]);
  const [error, setError] = useState(null);

  const ask = useCallback(
    async (text) => {
      const q = (text ?? question).trim();
      if (!q || busy) return;

      // A question that is not about the data has no honest answer here. The
      // deterministic planner will always return *something* — its own best
      // candidate — and presenting that as the answer to "hello how are you"
      // is a chart with a confident sentence under it about a question nobody
      // asked. Refusing is the only truthful option.
      const relevance = questionRelevance(q, { columns: dataset?.columns || [] });
      if (!relevance.answerable) {
        setError(relevance.reason);
        return;
      }

      setBusy(true);
      setError(null);

      try {
        // 1. Ask the model for a chart specification. Only the schema goes over
        //    the wire — never any rows.
        let spec = null;
        let source = 'model';
        try {
          const res = await fetch('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: q, schema: dataset.schema }),
          });
          const json = await res.json();
          if (!json.unavailable && json.sql) spec = json;
        } catch {
          /* fall through to the offline path */
        }

        // 2. No model (or it failed): read the question ourselves and compose
        //    the chart it describes. This is the path that can actually build
        //    the shape that was asked for — a matrix, a map, a funnel — rather
        //    than returning the nearest pre-built candidate, which was always a
        //    bar chart because that is most of what the storyboard contains.
        let declined = null;
        if (!spec) {
          const read = planQuestion(q, {
            columns: dataset.columns || [],
            profile: dataset.profile,
            sample: dataset.preview || [],
            measures,
          });
          if (read.spec) {
            spec = read.spec;
            source = 'planner';
          } else {
            declined = read.error;
          }
        }

        // 3. The reader could not place some part of the question. Its reason
        //    names that part, which is worth more than a chart: the page used
        //    to fall back to whichever storyboard candidate shared the most
        //    words with the question, and a single incidental word was enough
        //    to qualify. That is how "a matrix of average monthly tenure, with
        //    row: category and column: Gender" came back as average spend by
        //    category — the word "category" and nothing else.
        if (!spec) throw new Error(declined || 'Could not build a chart for that question.');

        // 4. Execute locally and compute verified statistics.
        const { chart, finding } = await askEngine(spec);
        if (!chart || !chart.resultData?.length) {
          throw new Error('That query returned no rows. Try rephrasing, or check the column names in Explore.');
        }

        setAnswers((prev) => [{ id: Date.now(), question: q, chart, finding, source, interpretation: spec.interpretation }, ...prev]);
        setQuestion('');
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [question, busy, dataset, measures, askEngine]
  );

  if (!dataset) return null;

  return (
    <PageFrame title="Ask" subtitle="Question your data in plain English">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-5">
          {/* Prompt */}
          <div className="card p-4">
            <div className="flex items-center gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ask()}
                placeholder="e.g. which region has the highest average order value?"
                disabled={busy}
                className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-white/25 disabled:opacity-50"
              />
              <button
                onClick={() => ask()}
                disabled={busy || !question.trim()}
                className="flex shrink-0 items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors enabled:hover:bg-accent-400 disabled:opacity-30"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                Ask
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/8 px-4 py-3 text-[13px] text-rose-200/80">
              {error}
            </div>
          )}

          {answers.length === 0 && !busy && (
            <div className="card p-6">
              <div className="label mb-3">Try one of these</div>
              <div className="flex flex-col gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => ask(ex)}
                    className="group flex items-center justify-between gap-3 rounded-xl border border-white/7 bg-white/[0.02] px-4 py-3 text-left text-sm text-white/60 transition-colors hover:border-accent-500/30 hover:bg-white/[0.05] hover:text-white"
                  >
                    {ex}
                    <ChevronRight size={14} className="shrink-0 text-white/20 group-hover:text-accent-400" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {answers.map((a) => (
            <Answer key={a.id} answer={a} />
          ))}
        </div>

        <aside className="flex flex-col gap-4">
          <div className="card p-5">
            <div className="mb-2 flex items-center gap-2">
              <ShieldCheck size={13} className="text-emerald-400" />
              <span className="label !text-emerald-400/70">How this works</span>
            </div>
            <p className="text-[12px] leading-relaxed text-white/45">
              Your question and the column <em>names</em> are sent to a language model, which writes a SQL
              query. The query runs in your browser against the rows, and the statistics under each chart are
              computed from the real results — not written by the model.
            </p>
            <p className="mt-3 text-[12px] leading-relaxed text-white/35">
              With no model configured, your question is read here instead — the shape you asked for, what is
              being measured, and what to break it down by — and the same query is composed from your
              columns, so the page still works offline. When part of the question names nothing in this data,
              it says which part rather than showing you a chart that answers something else.
            </p>
          </div>

          <SqlConsole />
        </aside>
      </div>
    </PageFrame>
  );
}

function Answer({ answer }) {
  const { question, chart, finding, source, interpretation } = answer;
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-white/7 px-5 py-4">
        <div className="flex items-start gap-3">
          <Sparkles size={15} className="mt-0.5 shrink-0 text-accent-400" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-white/85">{question}</p>
            {source !== 'model' && (
              <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.15em] text-amber-400/70">
                <Info size={10} />
                Matched offline
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="p-5">
        {finding?.headline && <p className="mb-4 text-[15px] leading-relaxed text-white/80">{finding.headline}</p>}
        {!finding?.headline && interpretation && (
          <p className="mb-4 text-[15px] leading-relaxed text-white/70">{interpretation}</p>
        )}

        <div className="h-80 w-full">
          <ChartBoundary resetKey={answer.id}>
            <LazyChart
              data={chart.resultData}
              type={chart.chart_type}
              xKey={chart.xAxisKey}
              yKey={chart.yAxisKey}
              secondaryYKey={chart.secondaryYAxisKey}
              seriesKey={chart?.seriesKey}
              seriesSort={chart?.seriesSort}
              xLabel={chart.xAxisLabel}
              yLabel={chart.yAxisLabel}
              eager
            />
          </ChartBoundary>
        </div>

        {finding?.detail && <p className="mt-4 text-[13px] leading-relaxed text-white/45">{finding.detail}</p>}

        {finding?.verifiedFacts?.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {finding.verifiedFacts.map((f, i) => (
              <span key={i} className="rounded-lg bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] text-white/50">
                {f}
              </span>
            ))}
          </div>
        )}

        {chart.sql && (
          <details className="group mt-4">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-white/35 hover:text-white/60">
              <Code2 size={12} />
              <span className="label">Query</span>
              <ChevronRight size={13} className="transition-transform group-open:rotate-90" />
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg code-surface border border-white/10 p-3 font-mono text-[11px] leading-relaxed">
              {formatSql(chart.sql)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

/** Escape hatch for people who would rather just write the SQL themselves. */
function SqlConsole() {
  const { runSql } = useActions();
  const [query, setQuery] = useState('SELECT * FROM SalesData LIMIT 10');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setResult(await runSql(query));
    } catch (e) {
      setErr(e.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="card group p-5">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <Terminal size={13} className="text-white/40" />
        <span className="label">SQL console</span>
        <ChevronRight size={13} className="ml-auto text-white/25 transition-transform group-open:rotate-90" />
      </summary>

      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        rows={4}
        spellCheck={false}
        className="mt-3 w-full resize-y rounded-lg border border-white/10 code-surface p-3 font-mono text-[11px] leading-relaxed outline-none focus:border-accent-500/50"
      />
      <button
        onClick={run}
        disabled={busy}
        className="mt-2 w-full rounded-lg bg-white/8 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/70 transition-colors enabled:hover:bg-white/12 disabled:opacity-40"
      >
        {busy ? 'Running…' : 'Run'}
      </button>

      {err && <p className="mt-2 break-words text-[11px] text-rose-300/80">{err}</p>}

      {result && (
        <div className="mt-3">
          <div className="mb-1.5 text-[10px] text-white/30">
            {result.total.toLocaleString()} rows{result.truncated && ' (showing first 500)'}
          </div>
          <div className="max-h-64 overflow-auto rounded-lg border border-white/7">
            <table className="w-full text-left text-[10px]">
              <thead className="sticky top-0 bg-canvas-raised">
                <tr>
                  {Object.keys(result.rows[0] || {}).map((k) => (
                    <th key={k} className="whitespace-nowrap border-b border-white/7 px-2 py-1.5 font-black uppercase tracking-wider text-white/40">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.slice(0, 100).map((row, i) => (
                  <tr key={i} className="border-b border-white/4">
                    {Object.values(row).map((v, j) => (
                      <td key={j} className="max-w-[140px] truncate px-2 py-1 text-white/60">
                        {typeof v === 'number' ? formatNumber(v) : String(v ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </details>
  );
}
