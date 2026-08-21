'use client';

/**
 * Confirm or correct how the sheets were joined, before any analysis runs on
 * them.
 *
 * This is the screen the multi-sheet work needed and did not have. Relationship
 * inference is a good guess and nothing more: it reads column names and value
 * overlap. When it is wrong, nothing errors — the analysis simply produces
 * precise, confident, false numbers, which is exactly what this product exists
 * to avoid. So the guess is shown, the evidence behind it is shown, and it can
 * be overruled.
 *
 * The most important number here is the **match rate**, not the confidence.
 * Confidence is what the inference believed before it ran; the match rate is
 * what actually happened when the join was performed. A relationship the
 * engine was 95% sure of that matched 4% of rows is wrong, and the second
 * number is the one that says so.
 */
import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Database,
  GitBranch,
  Info,
  Loader2,
  RotateCcw,
  Table2,
  Unlink,
} from 'lucide-react';
import { useActions, useDataset } from '../../lib/store/DatasetProvider';
import { modelConcerns, POOR_MATCH, LOW_CONFIDENCE } from '../../lib/dataModel';

export default function DataModelReview() {
  const { dataset } = useDataset();
  const { setModel, analyze } = useActions();
  const router = useRouter();

  const model = dataset?.model;
  const tables = dataset?.tables || [];
  const joins = dataset?.view?.joins || [];

  const [factTable, setFactTable] = useState(model?.factTable || null);
  const [disabled, setDisabled] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /** Measured match rate for a relationship, when the join actually ran. */
  const matchRateFor = useCallback(
    (rel) => {
      const join = joins.find(
        (j) => j.from.table === rel.from.table && j.to.table === rel.to.table
      );
      return join ? join.matchRate : null;
    },
    [joins]
  );

  const relationships = model?.relationships || [];

  const dirty =
    factTable !== model?.factTable || disabled.size > 0;

  // Shared with the dashboard prompt so the two can never disagree about what
  // counts as a problem.
  const concerns = useMemo(
    () => modelConcerns({ model, tables, joins }),
    [model, tables, joins]
  );

  const toggle = useCallback((id) => {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const apply = useCallback(
    async ({ thenAnalyse = false } = {}) => {
      setBusy(true);
      setError(null);
      try {
        await setModel({
          factTable,
          relationships: relationships.filter((r) => !disabled.has(r.id)),
        });
        setDisabled(new Set());
        if (thenAnalyse) {
          await analyze();
          router.push('/dashboard');
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [setModel, analyze, factTable, relationships, disabled, router]
  );

  if (!model) return null;

  if (tables.length < 2) {
    return (
      <div className="card flex max-w-lg flex-col items-start gap-3 p-8">
        <Table2 size={24} className="text-accent-400" />
        <h2 className="text-base font-black">One table, nothing to relate</h2>
        <p className="text-sm leading-relaxed text-white/45">
          This dataset is a single table, so there are no joins to review. Relationship inference applies
          when you upload a workbook with several sheets, drop several files at once, or import more than one
          table from a database.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* What the engine concluded, and how sure it should make you */}
      {concerns.length > 0 ? (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-400" />
            <span className="label !text-amber-400/80">Worth checking before you analyse</span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {concerns.map((c, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-white/70">
                {c}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
          <div className="flex items-center gap-2">
            <Check size={14} className="text-emerald-400" />
            <span className="text-[13px] text-white/70">
              Every relationship matched cleanly. Still worth a glance — a join can be well-formed and still
              be the wrong one.
            </span>
          </div>
        </div>
      )}

      {/* Fact table */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Database size={14} className="text-accent-400" />
          <h2 className="label">Analysis is built around</h2>
        </div>
        <p className="max-w-2xl text-[13px] leading-relaxed text-white/45">
          Every row of this table appears once in the analysis; the others contribute columns to it. It
          should be the table holding the measures you care about — orders, transactions, events.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {tables.map((t) => {
            const active = t.name === factTable;
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => setFactTable(t.name)}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                  active
                    ? 'border-accent-500/50 bg-accent-500/10'
                    : 'border-white/8 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
                }`}
              >
                <Table2 size={15} className={active ? 'text-accent-400' : 'text-white/25'} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black text-white/90">{t.name}</span>
                  <span className="block truncate font-mono text-[11px] text-white/35">
                    {t.rowCount.toLocaleString()} rows · {t.columns.length} columns
                    {t.sheetName ? ` · ${t.sheetName}` : ''}
                  </span>
                </span>
                {t.role === 'unrelated' && (
                  <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-white/30">
                    Unrelated
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Relationships */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="text-accent-400" />
          <h2 className="label">Detected relationships</h2>
        </div>

        {relationships.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-white/45">
            No relationships were found, so each table stands alone and only the one above is analysed. That
            usually means the key columns are named very differently, or their values do not overlap.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {relationships.map((rel) => (
              <Relationship
                key={rel.id}
                rel={rel}
                matchRate={matchRateFor(rel)}
                off={disabled.has(rel.id)}
                onToggle={() => toggle(rel.id)}
              />
            ))}
          </div>
        )}

        {model.alternatives?.length > 0 && (
          <details className="card p-4">
            <summary className="cursor-pointer list-none">
              <span className="label">Runners-up ({model.alternatives.length})</span>
            </summary>
            <p className="mt-2 text-[12px] leading-relaxed text-white/35">
              Other column pairs that could have been joined. Only the strongest per pair of tables is used;
              these are shown so you can see what was ruled out.
            </p>
            <div className="mt-3 flex flex-col gap-1.5">
              {model.alternatives.map((alt) => (
                <div key={alt.id} className="font-mono text-[11px] text-white/40">
                  {alt.from.table}.{alt.from.column} → {alt.to.table}.{alt.to.column} (
                  {Math.round(alt.confidence * 100)}%)
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {error && (
        <p className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[13px] text-rose-300">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/8 pt-5">
        <button
          onClick={() => apply({ thenAnalyse: true })}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:bg-white/10 disabled:text-white/30"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}
          {dirty ? 'Apply and analyse' : 'Looks right — analyse'}
        </button>

        {dirty && (
          <>
            <button
              onClick={() => apply()}
              disabled={busy}
              className="rounded-lg border border-white/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
            >
              Apply without analysing
            </button>
            <button
              onClick={() => {
                setFactTable(model.factTable);
                setDisabled(new Set());
              }}
              className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
            >
              <RotateCcw size={13} /> Reset
            </button>
          </>
        )}

        {dirty && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-amber-300/70">
            <Info size={12} /> Changing the model discards the current analysis
          </span>
        )}
      </div>
    </div>
  );
}

function Relationship({ rel, matchRate, off, onToggle }) {
  const poor = matchRate !== null && matchRate < POOR_MATCH;
  const lowConfidence = rel.confidence < LOW_CONFIDENCE;

  return (
    <div
      className={`card flex flex-col gap-2 p-4 transition-opacity ${off ? 'opacity-40' : ''} ${
        poor && !off ? 'border-amber-500/30' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] text-white/80">
          {rel.from.table}.<span className="text-accent-300">{rel.from.column}</span>
        </span>
        <ArrowRight size={13} className="text-white/25" />
        <span className="font-mono text-[12px] text-white/80">
          {rel.to.table}.<span className="text-accent-300">{rel.to.column}</span>
        </span>

        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-white/35">
          {rel.cardinality}
        </span>

        <button
          type="button"
          onClick={onToggle}
          title={off ? 'Use this relationship' : 'Ignore this relationship'}
          className={`ml-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.15em] transition-colors ${
            off
              ? 'border-accent-500/40 text-accent-300 hover:bg-accent-500/10'
              : 'border-white/10 text-white/40 hover:border-rose-500/30 hover:text-rose-300'
          }`}
        >
          {off ? <Check size={12} /> : <Unlink size={12} />}
          {off ? 'Use' : 'Ignore'}
        </button>
      </div>

      {/* Measured first, inferred second — the measured number is the honest one. */}
      <div className="flex flex-wrap items-center gap-4">
        {matchRate !== null && (
          <Stat
            label="Rows matched"
            value={`${Math.round(matchRate * 100)}%`}
            tone={poor ? 'warn' : 'good'}
            hint="Measured when the join actually ran"
          />
        )}
        <Stat
          label="Confidence"
          value={`${Math.round(rel.confidence * 100)}%`}
          tone={lowConfidence ? 'warn' : 'plain'}
          hint="How sure the inference was before running"
        />
        {typeof rel.overlap === 'number' && (
          <Stat label="Value overlap" value={`${Math.round(rel.overlap * 100)}%`} tone="plain" />
        )}
      </div>

      {rel.reasons?.length > 0 && (
        <p className="text-[11px] leading-relaxed text-white/30">{rel.reasons.join(' · ')}</p>
      )}

      {poor && !off && (
        <p className="text-[12px] leading-relaxed text-amber-300/80">
          Most rows found no match. If these columns are not really the same thing, every total sliced by{' '}
          {rel.to.table} will be wrong — ignore the relationship instead.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'plain', hint }) {
  const tones = {
    good: 'text-emerald-400',
    warn: 'text-amber-400',
    plain: 'text-white/70',
  };
  return (
    <span className="flex flex-col" title={hint}>
      <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/25">{label}</span>
      <span className={`font-mono text-[13px] font-bold ${tones[tone]}`}>{value}</span>
    </span>
  );
}
