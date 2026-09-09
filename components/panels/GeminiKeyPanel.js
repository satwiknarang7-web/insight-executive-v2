'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUpRight, Check, Eye, EyeOff, KeyRound, Loader2, Sparkles, Trash2 } from 'lucide-react';

import {
  STUDIO_URL,
  clearKey,
  keyProblem,
  keySnapshot,
  maskKey,
  serverKeySnapshot,
  subscribeToKey,
  verifyKey,
  writeKey,
} from '../../lib/geminiKey';

/**
 * Connect a Gemini key, so the writing runs on the viewer's own account.
 *
 * The panel is deliberately explicit about what it does and does not change,
 * because the honest answer is unusual: connecting a key does not unlock the
 * product. Every number, chart and finding is computed from the rows by SQL and
 * is there either way — a model is asked only to phrase findings it has already
 * been handed, and with no key at all the deterministic wording stands. So this
 * says "better writing", not "AI analysis", and it says so before asking for
 * anything.
 *
 * The key is checked against Google from this browser before it is saved, so a
 * mistyped one is refused here rather than surfacing later as prose that
 * quietly never improved.
 */
export default function GeminiKeyPanel() {
  // Read through the store rather than into state on mount. `localStorage` is
  // external state, and an effect that sets it renders "no key" first and
  // corrects itself after hydration — a visible flash of the wrong answer on
  // every load for anyone who has one. Subscribing also keeps other tabs in
  // step when a key is added or removed here.
  const saved = useSyncExternalStore(subscribeToKey, keySnapshot, serverKeySnapshot);
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const abortRef = useRef(null);

  // Only to drop an in-flight verification if the panel goes away mid-check.
  useEffect(() => () => abortRef.current?.abort(), []);

  const save = useCallback(async () => {
    const key = draft.trim();
    const shape = keyProblem(key);
    if (shape) {
      setProblem(shape);
      return;
    }

    setBusy(true);
    setProblem('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const result = await verifyKey(key, { signal: controller.signal });
    if (controller.signal.aborted) return;

    if (!result.ok) {
      setBusy(false);
      setProblem(result.problem);
      return;
    }

    if (!writeKey(key)) {
      setBusy(false);
      setProblem('This browser will not let the page store anything — private mode, or site data is blocked.');
      return;
    }

    setDraft('');
    setReveal(false);
    setBusy(false);
    setJustSaved(true);
  }, [draft]);

  const remove = useCallback(() => {
    clearKey();
    setJustSaved(false);
    setProblem('');
  }, []);

  return (
    <div className="card overflow-hidden p-0">
      <div className="flex items-start gap-3 border-b border-white/6 bg-gradient-to-r from-accent-500/10 to-transparent p-5">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent-500/25 bg-accent-500/10 text-accent-400">
          <Sparkles size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-black text-white/90">Gemini — your own key</h2>
            {saved ? (
              <span className="flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/8 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-emerald-400">
                <Check size={9} strokeWidth={3.5} /> Connected
              </span>
            ) : (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-white/35">
                Optional
              </span>
            )}
          </div>
          {/*
            * What it changes, said before anything is asked for.
            *
            * A key here buys better *writing*, not better numbers, and saying
            * so is the difference between an honest optional extra and a
            * paywall dressed as a feature.
            */}
          <p className="mt-1.5 text-[12px] leading-relaxed text-white/45">
            Every number, chart and finding is computed from your rows by SQL and is there either way.
            A key lets a model phrase those findings in better prose — on your account, billed to you,
            never to this deployment.
          </p>
        </div>
      </div>

      <div className="p-5">
        {saved ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 font-mono text-[12px] text-white/55">
              <KeyRound size={13} className="shrink-0 text-white/25" />
              <span className="truncate">{maskKey(saved)}</span>
            </span>
            <button
              type="button"
              onClick={remove}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[12px] font-bold text-white/55 transition-colors hover:border-rose-500/40 hover:text-rose-300"
            >
              <Trash2 size={13} /> Remove
            </button>
          </div>
        ) : (
          <>
            <label className="flex flex-col gap-2">
              <span className="label">Google AI Studio API key</span>
              <span className="flex items-center gap-2">
                <span className="relative flex min-w-0 flex-1 items-center">
                  <input
                    // `password` by default so a key is not left on screen in a
                    // shared window or a screen share, with a deliberate reveal
                    // for checking a paste.
                    type={reveal ? 'text' : 'password'}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setProblem('');
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && save()}
                    placeholder="AIza…"
                    spellCheck={false}
                    autoComplete="off"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 pr-10 font-mono text-[13px] text-white/85 outline-none placeholder:text-white/20 focus:border-accent-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setReveal((v) => !v)}
                    aria-label={reveal ? 'Hide the key' : 'Show the key'}
                    className="absolute right-2 flex h-7 w-7 items-center justify-center rounded-md text-white/30 transition-colors hover:text-white/70"
                  >
                    {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </span>
                <button
                  type="button"
                  onClick={save}
                  disabled={busy || !draft.trim()}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent-500 px-4 py-2.5 text-[12px] font-black uppercase tracking-[0.12em] text-on-accent transition-opacity disabled:opacity-35"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  {busy ? 'Checking' : 'Connect'}
                </button>
              </span>
            </label>

            <a
              href={STUDIO_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex items-center gap-1 text-[12px] font-bold text-accent-400 transition-opacity hover:opacity-80"
            >
              Get a free key from Google AI Studio <ArrowUpRight size={13} />
            </a>
          </>
        )}

        {problem && (
          <p className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
            {problem}
          </p>
        )}
        {justSaved && !problem && (
          <p className="mt-3 text-[12px] text-emerald-400/80">
            Checked against Google and saved. Analyses from now on are written with this key.
          </p>
        )}

        {/*
          * Where the key goes, in the place someone decides whether to paste one.
          *
          * Both halves are load-bearing and the second is the caveat: it is kept
          * on this device only, and it is sent to this app's server on each
          * model call, because the prompts are assembled there.
          */}
        <p className="mt-4 border-t border-white/6 pt-3 text-[11px] leading-relaxed text-white/30">
          Kept in this browser only — never in your account, never in a saved analysis, and gone from
          this device when you remove it. It is sent with each model request to this app, which passes
          it to Google and stores nothing.
        </p>
      </div>
    </div>
  );
}
