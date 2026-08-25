'use client';

/**
 * Pull tables from a connected database into the analysis engine.
 *
 * Three steps, because each one answers a question the next one needs: is the
 * connection alive, which tables can this role see, and which of them do you
 * want. Picking several related tables is the interesting case — the engine
 * infers the joins between them exactly as it does for a workbook's sheets.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  Database,
  Loader2,
  Plug,
  Search,
  Table2,
  X,
} from 'lucide-react';
import { useActions } from '../../lib/store/DatasetProvider';

export default function ImportFromConnection({ organization, connections, initialConnectionId = null, onClose }) {
  const router = useRouter();
  const { ingestRemote } = useActions();

  const [connectionId, setConnectionId] = useState(initialConnectionId || connections[0]?.id || null);
  const [step, setStep] = useState('idle'); // idle | testing | tables | pulling
  const [status, setStatus] = useState(null);
  const [tables, setTables] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [filter, setFilter] = useState('');
  const [error, setError] = useState(null);

  const connection = connections.find((c) => c.id === connectionId) || null;

  const post = useCallback(
    async (body) => {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: organization.id, connectionId, ...body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'That did not work.');
      return json;
    },
    [organization.id, connectionId]
  );

  // Reset everything when the chosen connection changes.
  useEffect(() => {
    setStep('idle');
    setStatus(null);
    setTables([]);
    setSelected(new Set());
    setError(null);
  }, [connectionId]);

  const connect = useCallback(async () => {
    setStep('testing');
    setError(null);
    try {
      const info = await post({ action: 'test' });
      setStatus(info);
      const { tables: found } = await post({ action: 'tables' });
      setTables(found);
      setStep('tables');
    } catch (e) {
      setError(e.message);
      setStep('idle');
    }
  }, [post]);

  const toggle = useCallback((qualified) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(qualified)) next.delete(qualified);
      else next.add(qualified);
      return next;
    });
  }, []);

  const pull = useCallback(async () => {
    setStep('pulling');
    setError(null);
    try {
      const chosen = tables.filter((t) => selected.has(t.qualified));
      const pulled = [];

      for (const t of chosen) {
        const result = await post({
          action: 'fetchTable',
          schema: t.schema,
          table: t.name,
          ref: t.ref,
        });
        pulled.push({
          label: t.name,
          columns: result.columns,
          rows: result.rows,
          rowCount: result.rowCount,
          truncated: result.truncated,
        });
      }

      await ingestRemote({
        tables: pulled,
        sourceLabel: connection?.name || 'Connected database',
      });
      onClose();
      router.push('/dashboard');
    } catch (e) {
      setError(e.message);
      setStep('tables');
    }
  }, [tables, selected, post, ingestRemote, connection, onClose, router]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return tables;
    return tables.filter((t) => t.qualified.toLowerCase().includes(needle));
  }, [tables, filter]);

  if (connections.length === 0) {
    return (
      <Shell onClose={onClose}>
        <p className="text-sm leading-relaxed text-white/50">
          There are no saved connections yet. Add one first, then come back here to pull tables from it.
        </p>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose}>
      <label className="mb-4 flex flex-col gap-2">
        <span className="label">Connection</span>
        <select
          value={connectionId || ''}
          onChange={(e) => setConnectionId(e.target.value)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/85 outline-none focus:border-accent-500/50"
        >
          {connections.map((c) => (
            <option key={c.id} value={c.id} className="bg-surface">
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {status && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-2">
          <Check size={13} className="text-emerald-400" />
          <span className="text-[12px] text-emerald-200">
            Connected to {status.database} as {status.user}
          </span>
          {status.version && (
            <span className="font-mono text-[10px] text-white/30">{status.version}</span>
          )}
          {status.readOnlyReplica && (
            <span className="rounded-full border border-emerald-500/30 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-emerald-300">
              Read-only replica
            </span>
          )}
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[13px] text-rose-300">
          {error}
        </p>
      )}

      {step === 'idle' && (
        <button
          onClick={connect}
          className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400"
        >
          <Plug size={13} /> Connect and list tables
        </button>
      )}

      {step === 'testing' && (
        <div className="flex items-center gap-2 py-4 text-sm text-white/40">
          <Loader2 size={14} className="animate-spin" /> Connecting
        </div>
      )}

      {(step === 'tables' || step === 'pulling') && (
        <>
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3">
            <Search size={13} className="shrink-0 text-white/30" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filter ${tables.length} tables`}
              className="w-full bg-transparent py-2 text-sm text-white/85 outline-none placeholder:text-white/20"
            />
          </div>

          <div className="max-h-72 overflow-y-auto rounded-lg border border-white/8">
            {visible.map((t) => {
              const on = selected.has(t.qualified);
              return (
                <button
                  key={t.qualified}
                  type="button"
                  onClick={() => toggle(t.qualified)}
                  className={`flex w-full items-center gap-3 border-b border-white/5 px-3 py-2.5 text-left transition-colors last:border-b-0 ${
                    on ? 'bg-accent-500/10' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      on ? 'border-accent-500 bg-accent-500 text-on-accent' : 'border-white/20'
                    }`}
                  >
                    {on && <Check size={11} />}
                  </span>
                  <Table2 size={13} className="shrink-0 text-white/25" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-white/80">{t.qualified}</span>
                  {t.isView && (
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-white/30">
                      View
                    </span>
                  )}
                </button>
              );
            })}
            {visible.length === 0 && (
              <p className="px-3 py-6 text-center text-[13px] text-white/25">Nothing matches that filter.</p>
            )}
          </div>

          {selected.size > 1 && (
            <p className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-white/40">
              <Database size={13} className="mt-0.5 shrink-0 text-accent-400/70" />
              Several tables will be related to each other automatically — the same key detection used for a
              multi-sheet workbook.
            </p>
          )}

          <p className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-white/35">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400/70" />
            Large tables are capped, and you will be told if one was. An analysis of a capped table describes
            only the rows that were pulled.
          </p>

          <div className="mt-5 flex items-center gap-2">
            <button
              onClick={pull}
              disabled={selected.size === 0 || step === 'pulling'}
              className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:bg-white/10 disabled:text-white/30"
            >
              {step === 'pulling' ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />}
              {step === 'pulling'
                ? 'Pulling'
                : `Import ${selected.size || ''} ${selected.size === 1 ? 'table' : 'tables'}`.trim()}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-white/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 hover:bg-white/5 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({ children, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="panel slide-in my-auto w-full max-w-2xl p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Import from a connection"
      >
        <div className="mb-5 flex items-center gap-3">
          <Database size={16} className="text-accent-400" />
          <h2 className="text-base font-black">Import from a database</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-lg border border-white/10 p-1.5 text-white/40 hover:bg-white/5 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
