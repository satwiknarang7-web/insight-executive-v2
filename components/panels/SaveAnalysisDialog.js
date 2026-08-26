'use client';

/**
 * Keep this analysis, and decide who else may open it.
 *
 * Saving is deliberately an action rather than a side effect. The product's
 * whole posture is that a file you open stays in your browser; an archive that
 * filled itself would quietly undo that. So nothing reaches the server until
 * someone presses the button here.
 *
 * Everything about *who* can open it afterwards lives in `ShareControls`, which
 * the library renders too — sharing is offered at the moment you save and again
 * whenever you remember you meant to, and those two must not drift apart.
 */
import { useCallback, useState } from 'react';
import { Check, Loader2, Lock, X } from 'lucide-react';
import ShareControls from './ShareControls';

export default function SaveAnalysisDialog({ snapshot, datasetName, rowCount, existing = null, onClose, onSaved }) {
  const [title, setTitle] = useState(existing?.title || defaultTitle(datasetName));
  const [savedId, setSavedId] = useState(existing?.id || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: savedId, title, datasetName, rowCount, payload: snapshot }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not save.');
      setSavedId(body.analysis.id);
      setNotice('Saved to your library.');
      onSaved?.(body.analysis);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [savedId, title, datasetName, rowCount, snapshot, onSaved]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="panel slide-in my-auto w-full max-w-xl p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Save this analysis"
      >
        <div className="mb-5 flex items-center gap-3">
          <Lock size={16} className="text-accent-400" />
          <h2 className="text-base font-black text-white">Save this analysis</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-lg border border-white/10 p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>

        <label className="flex flex-col gap-2">
          <span className="label">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white/85 outline-none focus:border-accent-500/50"
          />
        </label>

        <p className="mt-3 text-[12px] leading-relaxed text-white/40">
          The findings are saved — charts, summary, KPIs and measures. The underlying rows are not
          uploaded, so a saved analysis can be presented and shared but not re-queried.
        </p>

        <button
          type="button"
          onClick={save}
          disabled={!title.trim() || busy}
          className="mt-4 flex items-center gap-2 rounded-xl bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {savedId ? 'Update' : 'Save to my library'}
        </button>

        {(error || notice) && (
          <p
            className={`mt-4 rounded-lg border px-3 py-2 text-[13px] ${
              error
                ? 'border-rose-500/25 bg-rose-500/8 text-rose-300'
                : 'border-accent-500/25 bg-accent-500/8 text-accent-200'
            }`}
          >
            {error || notice}
          </p>
        )}

        {/* Sharing only makes sense once there is something to share. */}
        {savedId && (
          <div className="mt-6 border-t border-white/8 pt-5">
            <ShareControls analysisId={savedId} />
          </div>
        )}
      </div>
    </div>
  );
}

function defaultTitle(datasetName) {
  const base = String(datasetName || 'Analysis').replace(/\.(csv|tsv|txt|xlsx?|xlsm)$/i, '');
  const when = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${base} — ${when}`;
}
