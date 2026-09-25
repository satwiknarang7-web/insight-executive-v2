'use client';

/**
 * The assistant, on every page: a chat that answers from the app's help and
 * the reader's own table and dashboard (retrieved in the browser, see
 * lib/assistant/retrieve.js), and proposes changes. A proposal is shown as a
 * card with what it will do; nothing changes until the reader clicks Apply,
 * and every applied change can be undone.
 *
 * With a model key (or Pro) a model writes the answer from the retrieved
 * passages; without one, commands are read by lib/assistant/local.js and
 * questions are answered from the passages or by the engine's question reader.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { Check, Loader2, MessageCircle, RotateCcw, Send, Sparkles, X } from 'lucide-react';
import { useActions, useDataset } from '../../lib/store/DatasetProvider';
import { useDashboard } from '../../lib/store/DashboardProvider';
import { usePlan } from '../../lib/store/PlanProvider';
import { call } from '../../lib/store/engineClient';
import { keySnapshot, modelHeaders, serverKeySnapshot, subscribeToKey } from '../../lib/geminiKey';
import { retrieve } from '../../lib/assistant/retrieve';
import { checkAction } from '../../lib/assistant/actions';
import { answerFromPassages, readCommand } from '../../lib/assistant/local';
import { describeTransform } from '../../lib/transforms';
import { SAMPLES } from '../../lib/samples';

const HIDDEN = [/^\/present/, /^\/report\/print/, /^\/share\//];
const STORE = 'insight.assistant.messages';

let seq = 0;
const nid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A chart already on the dashboard that shows the same thing. */
function sameTile(board, t) {
  const key = (x) => [x.kind, x.dim || '', x.series || '', x.field || '', x.x || '', x.y || '', (x.measures || []).join(','), JSON.stringify(x.filters || [])].join('|');
  const k = key(t);
  return (board?.sections || []).flatMap((s) => s.tiles || []).find((x) => key(x) === k) || null;
}

function starters(board, dataset) {
  if (!dataset) return ['Load a demo dataset', 'How do I load my data?', 'What can this app do?', 'Do I need an AI key?'];
  const tile = board?.sections?.[0]?.tiles?.[0];
  return [
    'What does this dashboard say?',
    tile ? `Show "${tile.title}" as a table` : 'Add a chart of the main measure over time',
    'Clear all filters',
    'How do I export this?',
  ];
}

export default function Assistant() {
  const pathname = usePathname() || '';
  const router = useRouter();
  const { dataset } = useDataset();
  const { setTransforms, draftTransform, ingestText } = useActions();
  const dash = useDashboard();
  const { serverModel } = usePlan();
  const ownKey = !!useSyncExternalStore(subscribeToKey, keySnapshot, serverKeySnapshot);
  const useModel = ownKey || !!serverModel;

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]); // undo stack
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const loaded = useRef(false);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE) || '[]');
      if (Array.isArray(saved)) setMessages(saved.map((m) => ({ ...m, proposals: (m.proposals || []).map((p) => (p.state === 'pending' ? { ...p, state: 'expired' } : p)) })));
    } catch {
      /* no storage: start empty */
    }
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-40)));
    } catch {
      /* storage full or blocked: the chat still works */
    }
  }, [messages]);
  // Braces matter: newer browsers return a Promise from scrollIntoView, and an
  // effect that returns one hands React a "cleanup" it then tries to call.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, busy]);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const state = useCallback(() => ({ dataset, engine: dash.engine, board: dash.board, filters: dash.filters, pathname }), [dataset, dash.engine, dash.board, dash.filters, pathname]);

  /** Check raw actions, and resolve the ones the engine must draw first. */
  const prepare = useCallback(
    async (raw) => {
      const out = [];
      for (const a of raw) {
        const c = checkAction(a, state());
        if (!c.ok) {
          out.push({ id: nid(), state: 'refused', text: c.reason });
          continue;
        }
        let p = { id: nid(), state: 'pending', text: c.text, action: c.action };
        try {
          if (c.action.type === 'add_chart') {
            let res = await call('askTile', { text: c.action.question, ...dash.settings });
            if (res.error && useModel) {
              const model = await fetch('/api/ask', {
                method: 'POST',
                headers: modelHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ question: c.action.question, fields: dash.engine?.ds?.fields || [], measures: (dash.engine?.measures || []).map((m) => ({ id: m.id, label: m.label })) }),
              })
                .then((r) => (r.ok ? r.json() : null))
                .catch(() => null);
              if (model?.spec) {
                const checked = await call('askTile', { spec: model.spec, ...dash.settings });
                if (!checked.error) res = checked;
              }
            }
            const same = res.error ? null : sameTile(dash.board, res.tile);
            if (res.error) p = { id: p.id, state: 'refused', text: res.error };
            else if (same) p = { id: p.id, state: 'refused', text: `"${same.title}" is already on the dashboard.` };
            else {
              const { computed, error, id, ...spec } = res.tile;
              p = { ...p, text: `Add the chart "${res.tile.title}"`, detail: res.tile.insight || '', action: { type: 'add_chart', spec, adhoc: res.adhoc || null } };
            }
          } else if (c.action.type === 'transform') {
            const steps = await draftTransform(c.action.phrase);
            p = { ...p, text: `Data prep: ${steps.map((s) => describeTransform(s) || s.text || s.kind).join('; ')}`, detail: 'The dashboard is rebuilt on the changed data.', action: { type: 'transform', steps } };
          } else if (c.checkValues && c.action.filter?.values) {
            const vals = await call('fieldValues', { field: c.action.filter.field, limit: 5000 }).catch(() => null);
            const known = (vals?.values || vals || []).map((v) => String(v?.value ?? v));
            if (known.length) {
              const fixed = c.action.filter.values.map((v) => known.find((k) => k.toLowerCase() === v.toLowerCase()));
              if (fixed.some((v) => !v)) p = { id: p.id, state: 'refused', text: `No rows have ${c.action.filter.values.filter((_, i) => !fixed[i]).join(', ')} in that column.` };
              else p.action = { ...c.action, filter: { ...c.action.filter, values: fixed } };
            }
          }
        } catch (e) {
          p = { id: p.id, state: 'refused', text: e.message };
        }
        out.push(p);
      }
      return out;
    },
    [state, dash.settings, dash.engine, useModel, draftTransform]
  );

  const send = useCallback(
    async (input) => {
      const q = String(input ?? text).trim();
      if (!q || busy) return;
      setText('');
      const userMsg = { id: nid(), role: 'user', text: q };
      const convo = [...messages, userMsg];
      setMessages(convo);
      setBusy(true);
      try {
        const passages = retrieve(q, state());
        const local = readCommand(q, state());
        let reply = '';
        let raw = local.actions;
        let via = 'built-in';
        let fromPassages = false;

        if (local.undo) {
          reply = history.length ? 'Use the Undo button below to undo the last change.' : 'There is nothing to undo yet.';
        } else if (!raw.length && useModel) {
          const res = await fetch('/api/assistant', {
            method: 'POST',
            headers: modelHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ messages: convo.slice(-10).map((m) => ({ role: m.role, text: m.text })), passages: passages.map(({ title, text: t }) => ({ title, text: t })) }),
          })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
          if (res && !res.unavailable && (res.reply || res.actions?.length)) {
            reply = res.reply || '';
            raw = res.actions || [];
            via = 'model';
          }
        }
        if (!reply && !raw.length && !local.undo) {
          if (local.reply) reply = local.reply;
          else if (local.engineQuestion && dataset && dash.board && !dash.board.readOnly) {
            const res = await call('askTile', { text: q, ...dash.settings }).catch(() => ({ error: true }));
            if (!res.error) {
              const { computed, error, id, ...spec } = res.tile;
              const same = sameTile(dash.board, res.tile);
              reply = `${res.tile.insight || `Here is ${res.tile.title}.`}${same ? `\n\nThis is the "${same.title}" chart on your dashboard.` : ''}`;
              raw = [];
              const proposals = same ? [] : [{ id: nid(), state: 'pending', text: `Add the chart "${res.tile.title}"`, action: { type: 'add_chart', spec, adhoc: res.adhoc || null } }];
              setMessages((m) => [...m, { id: nid(), role: 'assistant', text: reply, proposals, via }]);
              return;
            }
          }
          if (!reply) {
            reply = answerFromPassages(q, passages);
            fromPassages = true;
          }
        }
        const proposals = raw.length ? await prepare(raw) : [];
        if (!reply && proposals.length) reply = proposals.some((p) => p.state === 'pending') ? 'Here is what I would change. Nothing happens until you click Apply.' : "I can't make that change:";
        setMessages((m) => [...m, { id: nid(), role: 'assistant', text: reply, proposals, via, sources: fromPassages || (via === 'model' && !proposals.length) ? passages.slice(0, 3).map((p) => p.title) : [] }]);
      } catch (e) {
        setMessages((m) => [...m, { id: nid(), role: 'assistant', text: `Something went wrong: ${e.message}` }]);
      } finally {
        setBusy(false);
      }
    },
    [text, busy, messages, state, useModel, history.length, dataset, dash.board, dash.settings, prepare]
  );

  const setProposal = (msgId, pid, patch) =>
    setMessages((ms) => ms.map((m) => (m.id === msgId ? { ...m, proposals: m.proposals.map((p) => (p.id === pid ? { ...p, ...patch } : p)) } : m)));

  /** Apply one proposal, keeping what it replaced for Undo. */
  const apply = useCallback(
    async (msgId, p) => {
      setProposal(msgId, p.id, { state: 'applying' });
      const before = { board: dash.snapshot(), transforms: dataset?.transforms || [], path: pathname, text: p.text };
      try {
        const a = p.action;
        switch (a.type) {
          case 'navigate':
            router.push(a.path);
            break;
          case 'load_sample': {
            const sample = SAMPLES.find((x) => x.key === a.key);
            await ingestText(sample.csv, `${sample.key}_sample.csv`);
            router.push('/dashboard');
            break;
          }
          case 'add_chart':
            if (a.adhoc) await dash.saveMeasure({ ...a.adhoc, adhoc: undefined });
            await dash.addTile({ ...a.spec, w: 6, h: 4 });
            break;
          case 'edit_chart':
            await dash.updateTile(a.id, a.patch);
            break;
          case 'remove_chart':
            dash.removeTile(a.id);
            break;
          case 'move_chart':
            dash.moveTile(a.id, a.dir);
            break;
          case 'set_filter':
            await dash.setFilters([...dash.filters.filter((f) => f.field !== a.filter.field), a.filter]);
            break;
          case 'remove_filter':
            await dash.setFilters(dash.filters.filter((f) => f.field !== a.field));
            break;
          case 'clear_filters':
            await dash.setFilters([]);
            break;
          case 'add_kpi':
            await dash.addKpi(a.measure);
            break;
          case 'remove_kpi':
            dash.removeKpi(a.id);
            break;
          case 'set_field':
            await dash.setFieldOverride(a.field, a.patch);
            break;
          case 'add_measure':
            await dash.saveMeasure(a.measure);
            break;
          case 'transform':
            await setTransforms([...(dataset?.transforms || []), ...a.steps]);
            if (!pathname.startsWith('/dashboard')) router.push('/dashboard');
            break;
          case 'rebuild':
            await dash.build({ useModel });
            break;
          default:
            throw new Error('Unknown change.');
        }
        if (a.type !== 'navigate' && a.type !== 'load_sample') setHistory((h) => [...h.slice(-19), before]);
        setProposal(msgId, p.id, { state: 'applied' });
      } catch (e) {
        setProposal(msgId, p.id, { state: 'failed', error: e.message });
      }
    },
    [dash, dataset, pathname, router, setTransforms, ingestText, useModel]
  );

  const undo = useCallback(async () => {
    const last = history.at(-1);
    if (!last) return;
    setBusy(true);
    try {
      const same = JSON.stringify(last.transforms) === JSON.stringify(dataset?.transforms || []);
      if (!same) await setTransforms(last.transforms);
      else if (last.board) await dash.restore(last.board);
      setHistory((h) => h.slice(0, -1));
      setMessages((m) => [...m, { id: nid(), role: 'assistant', text: `Undone: ${last.text}.` }]);
    } catch (e) {
      setMessages((m) => [...m, { id: nid(), role: 'assistant', text: `Couldn't undo: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  }, [history, dataset, setTransforms, dash]);

  if (HIDDEN.some((re) => re.test(pathname))) return null;
  if (!mounted) return null;

  return createPortal(
    <div className="print:hidden">
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open assistant"
          title="Assistant (Ctrl+J)"
          className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-full bg-accent-500 px-4 py-3 text-[13px] font-bold text-on-accent shadow-lg shadow-black/30 hover:bg-accent-400"
        >
          <MessageCircle size={16} /> <span className="hidden sm:inline">Assistant</span>
        </button>
      )}
      {open && (
        <div role="dialog" aria-label="Assistant" className="fixed inset-x-2 bottom-2 top-16 z-[60] flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-canvas-raised shadow-2xl shadow-black/40 sm:inset-x-auto sm:right-4 sm:top-auto sm:h-[min(640px,calc(100vh-2rem))] sm:w-[400px]">
          <div className="flex items-center gap-2 border-b border-white/7 px-4 py-3">
            <Sparkles size={15} className="text-accent-400" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-white/90">Assistant</div>
              <div className="truncate text-[11px] text-white/40">{useModel ? 'AI answers from your data and the app help' : 'Built-in mode — add an AI key for free-form answers'}</div>
            </div>
            {history.length > 0 && (
              <button type="button" onClick={undo} disabled={busy} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-white/60 hover:bg-white/5 hover:text-white disabled:opacity-40" title={`Undo: ${history.at(-1).text}`}>
                <RotateCcw size={12} /> Undo
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant" className="rounded-md p-1 text-white/40 hover:bg-white/5 hover:text-white">
              <X size={16} />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" data-testid="assistant-log">
            {!messages.length && (
              <div className="space-y-3">
                <p className="text-[13px] leading-relaxed text-white/60">
                  Ask about the app or your data, or tell me what to change — charts, filters, KPIs, columns or the data itself. I&apos;ll show each change before it happens.
                </p>
                <div className="flex flex-wrap gap-2">
                  {starters(dash.board, dataset).map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-white/10 px-3 py-1.5 text-left text-[12px] text-white/65 hover:bg-white/5 hover:text-white">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
                <div className={m.role === 'user' ? 'max-w-[85%] rounded-2xl rounded-br-md bg-accent-500/15 px-3 py-2 text-[13px] text-white/90' : 'max-w-full text-[13px] leading-relaxed text-white/80'}>
                  {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                  {!!m.proposals?.length && (
                    <div className="mt-2 space-y-2">
                      {m.proposals.map((p) => (
                        <div key={p.id} className={`rounded-xl border p-3 ${p.state === 'refused' || p.state === 'failed' ? 'border-rose-500/25 bg-rose-500/5' : 'border-white/10 bg-white/[0.03]'}`}>
                          <p className="break-words text-[12.5px] font-semibold text-white/85">{p.text}</p>
                          {p.detail && <p className="mt-1 break-words text-[12px] text-white/50">{p.detail}</p>}
                          {p.error && <p className="mt-1 text-[12px] text-rose-300">{p.error}</p>}
                          {p.state === 'pending' && (
                            <div className="mt-2 flex gap-2">
                              <button type="button" onClick={() => apply(m.id, p)} className="flex items-center gap-1 rounded-lg bg-accent-500 px-3 py-1.5 text-[12px] font-bold text-on-accent hover:bg-accent-400">
                                <Check size={13} /> Apply
                              </button>
                              <button type="button" onClick={() => setProposal(m.id, p.id, { state: 'discarded' })} className="rounded-lg border border-white/10 px-3 py-1.5 text-[12px] font-semibold text-white/60 hover:bg-white/5">
                                Discard
                              </button>
                            </div>
                          )}
                          {p.state === 'applying' && <p className="mt-2 flex items-center gap-1 text-[12px] text-white/50"><Loader2 size={12} className="animate-spin" /> Applying…</p>}
                          {p.state === 'applied' && <p className="mt-2 text-[12px] font-semibold text-emerald-400">Applied</p>}
                          {p.state === 'discarded' && <p className="mt-2 text-[12px] text-white/40">Discarded</p>}
                          {p.state === 'expired' && <p className="mt-2 text-[12px] text-white/40">Not applied</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {m.sources?.length > 0 && m.role === 'assistant' && <p className="mt-1 text-[10.5px] text-white/30">From: {m.sources.join(' · ')}</p>}
                </div>
              </div>
            ))}
            {busy && (
              <p className="flex items-center gap-2 text-[12px] text-white/45">
                <Loader2 size={13} className="animate-spin" /> Thinking…
              </p>
            )}
            <div ref={endRef} />
          </div>

          <form
            className="flex items-end gap-2 border-t border-white/7 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask, or say what to change…"
              aria-label="Message the assistant"
              className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-white/90 placeholder:text-white/30 focus:border-accent-500/50 focus:outline-none"
            />
            <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="rounded-xl bg-accent-500 p-2.5 text-on-accent hover:bg-accent-400 disabled:opacity-40">
              <Send size={15} />
            </button>
          </form>
        </div>
      )}
    </div>,
    document.body
  );
}
