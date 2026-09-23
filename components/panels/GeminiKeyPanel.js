'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUpRight, Check, ChevronDown, Eye, EyeOff, KeyRound, Loader2, Sparkles, Trash2 } from 'lucide-react';

import {
  clearKey,
  keyProblem,
  keySnapshot,
  maskKey,
  readProvider,
  serverKeySnapshot,
  subscribeToKey,
  verifyKey,
  writeKey,
} from '../../lib/geminiKey';
import { PROVIDERS, PROVIDER_IDS } from '../../lib/llmProviders';

/**
 * Connect a model key, so the writing runs on the viewer's own account.
 *
 * The panel is deliberately explicit about what it does and does not change,
 * because the honest answer is unusual: connecting a key does not unlock the
 * product. Every number, chart and finding is computed from the rows by SQL and
 * is there either way — a model is asked only to phrase findings it has already
 * been handed, and with no key at all the deterministic wording stands. So this
 * says "better writing", not "AI analysis", and it says so before asking for
 * anything.
 *
 * **Any provider, not only Google.** Requiring a Gemini key was a strange thing
 * to ask of people who are, by and large, already paying somebody: a person
 * with a Claude subscription and an OpenAI account had to open a fourth
 * account to use a single model feature here. The provider is picked first and
 * the key is stored beside it.
 *
 * A Google key is checked from this browser before it is saved, so a mistyped
 * one is refused here rather than surfacing later as prose that quietly never
 * improved. The other three cannot be: they do not serve their APIs to a
 * browser origin, so the check would fail on CORS for a good key and a bad one
 * alike. Sending it through this app's server instead would give up the one
 * property that check exists to hold, so those are saved unchecked and the
 * panel says so.
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
  // Which provider the key being typed belongs to. Seeded from what is already
  // stored, so reopening the panel shows the provider the saved key is for.
  const [provider, setProvider] = useState(() => readProvider());
  // A key saved without being asked about — see `verifyKey`.
  const [unchecked, setUnchecked] = useState(false);
  // Collapsed by default. This is an optional extra on the screen whose job is
  // to get a file loaded, and expanded it was the tallest thing on that screen.
  const [open, setOpen] = useState(false);
  const abortRef = useRef(null);

  // Only to drop an in-flight verification if the panel goes away mid-check.
  useEffect(() => () => abortRef.current?.abort(), []);

  const save = useCallback(async () => {
    const key = draft.trim();
    const shape = keyProblem(key, provider);
    if (shape) {
      setProblem(shape);
      return;
    }

    setBusy(true);
    setProblem('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const result = await verifyKey(key, { provider, signal: controller.signal });
    if (controller.signal.aborted) return;

    if (!result.ok) {
      setBusy(false);
      setProblem(result.problem);
      return;
    }

    if (!writeKey(key, provider)) {
      setBusy(false);
      setProblem('This browser will not let the page store anything — private mode, or site data is blocked.');
      return;
    }

    setDraft('');
    setReveal(false);
    setBusy(false);
    setJustSaved(true);
    setUnchecked(!!result.unchecked);
  }, [draft, provider]);

  const remove = useCallback(() => {
    clearKey();
    setJustSaved(false);
    setProblem('');
  }, []);

  return (
    <div className="card overflow-hidden p-0">
      {/* The summary row is the whole panel until someone wants it. It still
          says what a key is for, because that is what decides whether to open
          it — it just says it in one line instead of a paragraph. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent-500/25 bg-accent-500/10 text-accent-400">
          <Sparkles size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-black text-white/90">
              {saved ? `${PROVIDERS[provider].label} — your own key` : 'Your own model key'}
            </span>
            {saved ? (
              <span className="flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/8 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-emerald-400">
                <Check size={9} strokeWidth={3.5} /> Connected
              </span>
            ) : (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-white/35">
                Optional
              </span>
            )}
          </span>
          <span className={`mt-0.5 block text-[11px] leading-relaxed text-white/35 ${saved ? 'truncate' : ''}`}>
            {saved ? maskKey(saved) : 'Numbers are computed here either way. A key sends your provider column summaries and twenty sample rows.'}
          </span>
        </span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-white/25 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-white/6 p-4">

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
            <div className="mb-3">
              <span className="label mb-2 block">Provider</span>
              <div className="flex flex-wrap gap-1.5">
                {PROVIDER_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    disabled={busy}
                    aria-pressed={provider === id}
                    onClick={() => {
                      setProvider(id);
                      setProblem('');
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-40 ${
                      provider === id
                        ? 'border-accent-500/40 bg-accent-500/10 text-accent-300'
                        : 'border-white/10 text-white/45 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    {PROVIDERS[id].label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-2">
              <span className="label">{PROVIDERS[provider].label} API key</span>
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
                    placeholder="AIza… or AQ.…"
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
              href={PROVIDERS[provider].keysUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex items-center gap-1 text-[12px] font-bold text-accent-400 transition-opacity hover:opacity-80"
            >
              Get a key from {PROVIDERS[provider].keysLabel} <ArrowUpRight size={13} />
            </a>

            {/* Said before the key is pasted rather than after it is saved:
                somebody choosing a provider should know which of them this
                browser is able to check for them. */}
            {provider !== 'google' && (
              <p className="mt-2 text-[11px] leading-relaxed text-white/30">
                {PROVIDERS[provider].label} does not accept requests from a browser, so this key is saved
                without being checked here. The first thing that uses it will say whether it works.
              </p>
            )}
          </>
        )}

        {problem && (
          <p className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[12px] leading-relaxed text-rose-200">
            {problem}
          </p>
        )}
        {justSaved && !problem && (
          <p className="mt-3 text-[12px] text-emerald-400/80">
            {unchecked
              ? 'Saved, unchecked. Analyses from now on are written with this key — the first one will say if it does not work.'
              : 'Checked against Google and saved. Analyses from now on are written with this key.'}
          </p>
        )}

        {/* The caveat, kept to the two facts that change someone's decision:
            where the key lives, and what travels with it. */}
        <p className="mt-3 border-t border-white/6 pt-3 text-[11px] leading-relaxed text-white/30">
          Kept in this browser only. Sent with each request to Google on your key, along with your
          column names, their values and a few sample rows.
        </p>
        </div>
      )}
    </div>
  );
}
