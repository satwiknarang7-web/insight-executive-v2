'use client';

/**
 * The library: analyses this user kept, and analyses other people shared.
 *
 * Two lists rather than one, because provenance changes what you can do. Your
 * own can be deleted and shared onward; a shared one you can open and present
 * but not manage.
 *
 * It lives on the profile page, outside the app shell, and that is deliberate:
 * the shell exists to hold a loaded dataset, and the whole point of a shared
 * analysis is that you were sent findings without the file behind them. When
 * the library was inside the shell you could not reach your own library without
 * first opening a spreadsheet you did not have.
 *
 * Opening one restores the storyboard into the session. There is deliberately
 * no dataset behind it — see `restoreAnalysis` — so it opens as a presentation
 * rather than as a dashboard when there is nothing loaded to re-query.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, FolderOpen, Loader2, Presentation, Share2, Trash2, Users, X } from 'lucide-react';
import { useActions, useDataset } from '../../lib/store/DatasetProvider';
import ShareControls from './ShareControls';

export default function AnalysisLibrary() {
  const router = useRouter();
  const { restoreAnalysis } = useActions();
  const { dataset } = useDataset();

  const [mine, setMine] = useState([]);
  const [shared, setShared] = useState([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/analyses');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not load your library.');
      setMine(body.mine || []);
      setShared(body.shared || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = useCallback(
    async (id) => {
      setOpening(id);
      setError(null);
      try {
        const res = await fetch(`/api/analyses/${id}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Could not open that analysis.');
        await restoreAnalysis(body.analysis.payload);
        // The dashboard reads the loaded rows for its header and its "re-run".
        // With no dataset in the session there are none, so a restored analysis
        // opens as the deck it is.
        router.push(dataset ? '/dashboard' : '/present');
      } catch (e) {
        setError(e.message);
        setOpening(null);
      }
    },
    [restoreAnalysis, router, dataset]
  );

  const remove = useCallback(async (id) => {
    const res = await fetch(`/api/analyses/${id}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setMine((list) => list.filter((a) => a.id !== id));
    else setError(body.error || 'Could not delete that analysis.');
  }, []);

  const shareTarget = mine.find((a) => a.id === sharing) || null;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[13px] text-rose-300">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-white/40">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <Section
            title="Saved by you"
            icon={FolderOpen}
            empty="Nothing saved yet. Press Save on a dashboard to keep it here."
            items={mine}
            opening={opening}
            onOpen={open}
            onRemove={remove}
            onShare={setSharing}
          />
          <Section
            title="Shared with you"
            icon={Users}
            empty="Nobody has shared an analysis with you yet."
            items={shared}
            opening={opening}
            onOpen={open}
          />
        </div>
      )}

      <p className="max-w-2xl text-[12px] leading-relaxed text-white/30">
        A saved analysis holds the findings — charts, summary, KPIs and measures — not the rows behind
        them. Opening one restores the dashboard, report and presentation. Exploring or asking new
        questions needs the original file loaded again.
      </p>

      {shareTarget && (
        <ShareDialog analysis={shareTarget} onClose={() => setSharing(null)} />
      )}
    </div>
  );
}

function Section({ title, icon: Icon, empty, items, opening, onOpen, onRemove, onShare }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Icon size={14} className="text-accent-400" />
        <h2 className="text-xs font-black uppercase tracking-[0.28em] text-white/45">{title}</h2>
        <span className="text-[11px] text-white/25">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <p className="text-[13px] text-white/30">{empty}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((a) => (
            <div key={a.id} className="card flex flex-col gap-2 p-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-white/90" title={a.title}>
                  {a.title}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/35">
                  {a.dataset_name && <span className="truncate">{a.dataset_name}</span>}
                  {a.row_count ? <span>{a.row_count.toLocaleString()} rows</span> : null}
                  <span className="flex items-center gap-1">
                    <Clock size={10} /> {new Date(a.updated_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(a.id)}
                  disabled={!!opening}
                  className="flex items-center gap-1.5 rounded-lg bg-accent-500 px-3 py-2 text-[10px] font-black uppercase tracking-[0.15em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-50"
                >
                  {opening === a.id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Presentation size={12} />
                  )}
                  Open
                </button>
                {onShare && (
                  <button
                    type="button"
                    onClick={() => onShare(a.id)}
                    aria-label={`Share ${a.title}`}
                    title="Share this analysis"
                    className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.15em] text-white/45 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    <Share2 size={12} /> Share
                  </button>
                )}
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(a.id)}
                    aria-label={`Delete ${a.title}`}
                    title="Delete this analysis"
                    className="ml-auto rounded-lg p-1.5 text-white/20 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ShareDialog({ analysis, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="panel slide-in my-auto w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${analysis.title}`}
      >
        <div className="mb-4 flex items-center gap-3">
          <Share2 size={16} className="text-accent-400" />
          <div className="min-w-0">
            <h2 className="truncate text-base font-black text-white">{analysis.title}</h2>
            <p className="text-[11px] text-white/35">Anyone here can open it, present it, and read the query behind every number.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto shrink-0 rounded-lg border border-white/10 p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
        <ShareControls analysisId={analysis.id} compact />
      </div>
    </div>
  );
}
