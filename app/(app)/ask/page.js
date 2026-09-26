'use client';

/**
 * Ask a question of the data in plain words and get a chart that answers it,
 * with a sentence on what it shows. Read by the built-in engine
 * (lib/engine/ask.js) against the table's own fields and measures; with a
 * model key, a question the engine cannot read is passed to the model, whose
 * proposed chart is checked against the table before it is drawn. Any answer
 * can be added to the dashboard.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { BarChart3, ChevronRight, Cpu, LayoutGrid, ListOrdered, Loader2, Map as MapIcon, PenLine, Plus, ScatterChart as ScatterIcon, Search, Send, Terminal, TrendingUp, X } from 'lucide-react';
import PageFrame from '../../../components/shell/PageFrame';
import { useActions, useDataset } from '../../../lib/store/DatasetProvider';
import { useDashboard } from '../../../lib/store/DashboardProvider';
import { usePlan } from '../../../lib/store/PlanProvider';
import { call } from '../../../lib/store/engineClient';
import { keySnapshot, modelHeaders, serverKeySnapshot, subscribeToKey } from '../../../lib/geminiKey';
import { ChartPalette } from '../../../components/charts/palette';
import Tile from '../../../components/dashboard/Tile';
import { formatNumber } from '../../../lib/format';

export default function AskPage() {
  const { dataset } = useDataset();
  const { engine, settings, addTile, saveMeasure, board } = useDashboard();
  const { serverModel } = usePlan();
  const ownKey = !!useSyncExternalStore(subscribeToKey, keySnapshot, serverKeySnapshot);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState([]);
  const [examples, setExamples] = useState([]);
  const [added, setAdded] = useState(new Set());

  useEffect(() => {
    if (!dataset) return;
    call('askExamples', settings)
      .then((r) => setExamples(r.examples || []))
      .catch(() => setExamples([]));
  }, [dataset, settings]);

  const ask = useCallback(
    async (question) => {
      const q = String(question || '').trim();
      if (!q) return;
      setBusy(true);
      try {
        let res = await call('askTile', { text: q, ...settings });
        let via = 'engine';
        if (res.error && (ownKey || serverModel)) {
          const model = await fetch('/api/ask', {
            method: 'POST',
            headers: modelHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ question: q, fields: engine?.ds?.fields || [], measures: (engine?.measures || []).map((m) => ({ id: m.id, label: m.label })) }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
          if (model?.spec) {
            const checked = await call('askTile', { spec: model.spec, ...settings });
            if (!checked.error) {
              res = checked;
              via = 'model';
            }
          }
        }
        setAnswers((a) => [{ id: `${Date.now()}`, question: q, via, ...res }, ...a]);
        setText('');
      } finally {
        setBusy(false);
      }
    },
    [settings, ownKey, serverModel, engine]
  );

  const addToDashboard = async (answer) => {
    if (answer.adhoc) await saveMeasure({ ...answer.adhoc, adhoc: undefined });
    const { computed, error, id, ...spec } = answer.tile;
    await addTile({ ...spec, w: 6, h: 4 });
    setAdded((s) => new Set([...s, answer.id]));
  };

  if (!dataset) {
    return (
      <PageFrame title="Ask a question">
        <p className="text-sm text-white/40">Load a dataset first.</p>
      </PageFrame>
    );
  }

  const measures = engine?.measures || [];
  const fields = engine?.ds?.fields || [];
  // One example per kind of question, from this table's own questions.
  const KINDS = [
    [/over time|monthly|weekly|trend/i, TrendingUp, 'See a trend'],
    [/ vs /i, ScatterIcon, 'Find a relationship'],
    [/distribution|spread/i, BarChart3, 'See a spread'],
    [/^top /i, ListOrdered, 'Rank the leaders'],
    [/ by /i, LayoutGrid, 'Compare groups'],
  ];
  const geo = fields.find((f) => f.map);
  const kinds = [];
  for (const [re, icon, label] of KINDS) {
    const q = examples.find((e) => re.test(e) && !kinds.some((k) => k.q === e));
    if (q) kinds.push({ q, icon, label });
  }
  if (geo && measures[0]) kinds.push({ q: `${measures[0].label} by ${geo.label.toLowerCase()}`, icon: MapIcon, label: 'Put it on a map' });
  return (
    <ChartPalette>
      <PageFrame title="Ask a question" subtitle="In plain words. Every answer is a chart computed from your rows.">
        <div className="mx-auto max-w-4xl space-y-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(text);
            }}
            className="card card-glow relative flex items-center gap-3 overflow-hidden p-2.5 pl-4"
          >
            <Search size={18} className="shrink-0 text-accent-400" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={examples[0] ? `Try "${examples[0]}"` : 'Try "revenue by region"'}
              aria-label="Your question"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-[16px] text-white/90 placeholder:text-white/35 focus:outline-none"
            />
            <button type="submit" disabled={busy || !text.trim()} className="flex items-center gap-1.5 rounded-xl bg-accent-500 px-5 py-2.5 text-[13px] font-semibold text-on-accent hover:bg-accent-400 disabled:opacity-40">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Ask
            </button>
          </form>
          {examples.length > 0 && (
            <div className="stagger-fast flex flex-wrap gap-2">
              {examples.map((e) => (
                <button key={e} type="button" onClick={() => ask(e)} className="rounded-full border border-white/10 bg-white/[0.02] px-3.5 py-1.5 text-[12.5px] text-white/65 transition-colors hover:border-accent-400/40 hover:text-white">
                  {e}
                </button>
              ))}
            </div>
          )}

          {answers.length === 0 && kinds.length > 0 && (
            <section>
              <h2 className="label mb-3">What you can ask</h2>
              <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {kinds.map(({ q, icon: Icon, label }) => (
                  <button key={label} type="button" onClick={() => ask(q)} className="card lift group p-4 text-left">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent-400/25 bg-accent-400/10 text-accent-300 transition group-hover:scale-110 group-hover:shadow-[var(--glow)]">
                      <Icon size={15} className="wiggle" />
                    </span>
                    <span className="mt-3 block text-[13.5px] font-semibold text-white/90">{label}</span>
                    <span className="mt-1 block text-[12.5px] text-white/50">&ldquo;{q}&rdquo;</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {answers.map((a) => (
            <section key={a.id} className="ld-rise space-y-3" data-testid="answer">
              <div className="flex items-center gap-2">
                <span className="anim-pop max-w-[85%] origin-bottom-left rounded-2xl rounded-bl-md bg-accent-400/12 px-4 py-2 text-[14px] text-white/90">{a.question}</span>
                <button type="button" aria-label="Remove answer" onClick={() => setAnswers((x) => x.filter((y) => y.id !== a.id))} className="ml-auto rounded p-1 text-white/30 hover:text-white">
                  <X size={14} />
                </button>
              </div>
              {a.error ? (
                <p className="card card-warn anim-pop p-4 text-[13px] text-amber-300/90">{a.error}</p>
              ) : (
                <>
                  <div className="grid grid-cols-12">
                    <Tile tile={{ ...a.tile, w: 12 }} measures={a.adhoc ? [...measures, a.adhoc] : measures} fields={fields} editing={false} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/50">
                      {a.via === 'model' ? <PenLine size={11} className="text-accent-400" /> : <Cpu size={11} className="text-accent-400" />}
                      {a.via === 'model' ? 'Read by the model, checked against the table' : 'Read by the built-in engine'}
                    </span>
                    {board && (
                      <button type="button" disabled={added.has(a.id)} onClick={() => addToDashboard(a)} className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-white/70 hover:bg-white/5 hover:text-white disabled:opacity-50">
                        <Plus size={13} /> {added.has(a.id) ? 'Added to the dashboard' : 'Add to the dashboard'}
                      </button>
                    )}
                  </div>
                </>
              )}
            </section>
          ))}

          <SqlConsole />
        </div>
      </PageFrame>
    </ChartPalette>
  );
}

/** Escape hatch for people who would rather just write the SQL themselves. */
function SqlConsole() {
  const { runSql } = useActions();
  const [query, setQuery] = useState('SELECT * FROM SalesData LIMIT 10');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  // Counts the runs that returned, so the result rows replay their entrance
  // for each new answer rather than on every keystroke in the query.
  const [runs, setRuns] = useState(0);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setResult(await runSql(query));
      setRuns((n) => n + 1);
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

      {/* Replayed each time the console opens: a closed <details> does not
          render its body, so the entrance restarts with it. */}
      <div className="anim-drop">
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
                <tbody key={runs} className="stagger-fast">
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
      </div>
    </details>
  );
}
