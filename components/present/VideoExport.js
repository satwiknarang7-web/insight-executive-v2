'use client';

/**
 * Download the slideshow as a video, with or without the presenter's voice.
 *
 * Three steps, all in the browser:
 *
 *  1. The voice. With narration on, each slide's script — the same words the
 *     live slideshow speaks — is synthesised by `/api/speech` and decoded.
 *     Only the server voice can go into a file: the browser's own speech
 *     comes out of the speakers and no page can record it. So narration is
 *     offered only where the server voice is set up, and the dialog says why
 *     when it is not.
 *  2. The pictures. Each slide is drawn off screen at a fixed 16:9 size with
 *     every animation finished, and copied to an image.
 *  3. The film. lib/videoExport.js plays the images and the voice into a
 *     recorder, in real time.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Check, Download, Film, Loader2, Mic, MicOff, X } from 'lucide-react';
import { getFontEmbedCSS, toCanvas } from 'html-to-image';
import SlideContent from './SlideContent';
import { extensionFor, pickVideoType, recordSlides, videoSupport } from '../../lib/videoExport';

const STAGE_W = 1600;
const STAGE_H = 900;
const SCALE = 1.2; // 1600×900 → 1920×1080
const LENGTHS = [4, 6, 9, 12];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const baseName = (f) => String(f || 'slideshow').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.-]+/g, '_');

/** "01 · Over time" for a chart slide, "Executive summary" for the first. */
function chapterLabel(board, page) {
  if (page === 0) return 'Executive summary';
  let n = 0;
  for (const [si, sec] of (board.sections || []).entries()) {
    for (let k = 0; k < sec.tiles.length; k += 1) {
      n += 1;
      if (n === page) return `${String(si + 1).padStart(2, '0')} · ${sec.title || 'The main picture'}`;
    }
  }
  return 'Chart';
}

export default function VideoExport({ board, tiles, measures, fields, avatar, scripts, fileName, narrateByDefault = true, onClose }) {
  const total = tiles.length + 1;
  const [voice, setVoice] = useState(null); // null checking · true · false
  const [narrate, setNarrate] = useState(narrateByDefault);
  const [seconds, setSeconds] = useState(6);
  const [phase, setPhase] = useState('setup'); // setup · voice · slides · recording · done · error
  const [step, setStep] = useState({ at: 0, of: total });
  const [time, setTime] = useState({ at: 0, of: 0 });
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [capture, setCapture] = useState(null); // page drawn on the stage
  const stageRef = useRef(null);
  const abortRef = useRef(null);
  // The dialog only ever opens from a click, so these run in the browser.
  const [support] = useState(() => videoSupport());
  const [type] = useState(() => pickVideoType());

  useEffect(() => {
    let cancelled = false;
    fetch('/api/speech')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setVoice(!!d?.available))
      .catch(() => !cancelled && setVoice(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Stop everything, and free the file, when the dialog goes away.
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );
  useEffect(() => () => result && URL.revokeObjectURL(result.url), [result]);

  const withVoice = narrate && voice === true;
  const busy = phase === 'voice' || phase === 'slides' || phase === 'recording';

  const save = useCallback((res) => {
    const a = document.createElement('a');
    a.href = res.url;
    a.download = res.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setResult(null);
    // Made inside the click, so the browser lets it play into the recorder.
    const audioCtx = withVoice ? new (window.AudioContext || window.webkitAudioContext)() : null;
    const abort = new AbortController();
    abortRef.current = abort;
    const stopped = () => abort.signal.aborted;

    try {
      // 1. The voice.
      const audio = new Array(total).fill(null);
      if (withVoice) {
        setPhase('voice');
        for (let i = 0; i < total; i += 1) {
          if (stopped()) return;
          setStep({ at: i + 1, of: total });
          if (!scripts[i]) continue;
          const res = await fetch('/api/speech', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: scripts[i] }),
            signal: abort.signal,
          });
          if (!res.ok) {
            throw new Error(
              res.status === 429
                ? 'The voice service is busy — too many requests in the last few minutes. Wait a little, or make the video without narration.'
                : 'The voice service did not answer, so the narration could not be made. Make the video without narration, or try again later.'
            );
          }
          audio[i] = await audioCtx.decodeAudioData(await res.arrayBuffer());
        }
      }

      // 2. The pictures.
      setPhase('slides');
      const images = [];
      let fontEmbedCSS;
      for (let i = 0; i < total; i += 1) {
        if (stopped()) return;
        setStep({ at: i + 1, of: total });
        flushSync(() => setCapture(i));
        // Charts measure their box after mounting; give them a moment to draw.
        await wait(450);
        const node = stageRef.current;
        if (!node) throw new Error('The slide could not be drawn.');
        const style = getComputedStyle(document.body);
        const opts = { width: STAGE_W, height: STAGE_H, pixelRatio: SCALE, skipAutoScale: true, backgroundColor: style.backgroundColor, cacheBust: false };
        if (fontEmbedCSS === undefined) fontEmbedCSS = await getFontEmbedCSS(node).catch(() => '');
        let canvas;
        try {
          canvas = await toCanvas(node, { ...opts, fontEmbedCSS });
        } catch {
          // A font that cannot be fetched is not worth losing the slide over.
          canvas = await toCanvas(node, { ...opts, skipFonts: true });
        }
        images.push(canvas);
      }
      flushSync(() => setCapture(null));

      // 3. The film.
      setPhase('recording');
      const slides = images.map((image, i) => ({
        image,
        audio: audio[i],
        ms: audio[i] ? Math.max(4000, audio[i].duration * 1000 + 1500) : seconds * 1000,
      }));
      const root = getComputedStyle(document.documentElement);
      const blob = await recordSlides({
        slides,
        audioCtx,
        width: Math.round(STAGE_W * SCALE),
        height: Math.round(STAGE_H * SCALE),
        background: getComputedStyle(document.body).backgroundColor,
        accent: root.getPropertyValue('--color-accent-400').trim() || '#34d399',
        signal: abort.signal,
        onProgress: (at, of) => setTime({ at, of }),
      });
      if (!blob) return;
      const res = { url: URL.createObjectURL(blob), name: `${baseName(fileName)}_slideshow.${extensionFor(blob.type)}`, size: blob.size };
      setResult(res);
      setPhase('done');
      save(res);
    } catch (e) {
      if (stopped()) return;
      setError(e?.message || 'The video could not be made.');
      setPhase('error');
    } finally {
      flushSync(() => setCapture(null));
      audioCtx?.close().catch(() => {});
      if (abort.signal.aborted) setPhase('setup');
    }
  }, [withVoice, total, scripts, seconds, fileName, save]);

  const cancel = () => {
    abortRef.current?.abort();
    setPhase('setup');
  };

  const estimate = withVoice ? null : total * seconds * 1000;

  return (
    <div className="anim-fade absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="panel anim-pop w-full max-w-lg p-6" role="dialog" aria-modal="true" aria-label="Download the slideshow as a video">
        <div className="mb-4 flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent-400/25 bg-accent-400/10 text-accent-300">
            <Film size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="display text-[20px] leading-tight text-white/95">Download as a video</h2>
            <p className="mt-0.5 text-[12.5px] text-white/50">
              {total} slides · 1920 × 1080 · {type ? (extensionFor(type) === 'mp4' ? 'MP4' : 'WebM') : 'unsupported here'}
            </p>
          </div>
          <button type="button" onClick={() => (busy ? cancel() : onClose())} aria-label="Close" className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white">
            <X size={15} />
          </button>
        </div>

        {!support.ok ? (
          <p className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4 text-[13px] leading-relaxed text-amber-300">{support.reason}</p>
        ) : phase === 'setup' || phase === 'error' ? (
          <>
            {/* Narration on or off. */}
            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
              <div className="flex items-center gap-3">
                {withVoice ? <Mic size={16} className="shrink-0 text-accent-400" /> : <MicOff size={16} className="shrink-0 text-white/35" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-white/90">Narration</div>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-white/50">
                    {voice === null
                      ? 'Checking whether a voice is available…'
                      : voice
                        ? `${avatar.name} reads each slide, and every slide stays up until the sentence ends.`
                        : 'Not available here: a video can only carry the server voice (ElevenLabs), which this deployment has not set up. The in-browser voice plays through your speakers and cannot be recorded into a file.'}
                  </p>
                </div>
                <div className="inline-flex shrink-0 rounded-xl border border-white/10 bg-white/[0.02] p-1" role="radiogroup" aria-label="Narration">
                  {[
                    [true, 'On'],
                    [false, 'Off'],
                  ].map(([v, label]) => {
                    const active = voice === true ? narrate === v : v === false;
                    return (
                      <button
                        key={label}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={voice !== true}
                        onClick={() => setNarrate(v)}
                        className={`rounded-lg px-3 py-1 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed ${active ? 'bg-accent-500 text-on-accent' : 'text-white/55 hover:text-white/85 disabled:opacity-40'}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Without a voice, the viewer sets the pace. */}
            {!withVoice && (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-white/90">Each slide stays up for</div>
                  <p className="mt-0.5 text-[12px] text-white/50">About {clock(estimate)} in total.</p>
                </div>
                <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.02] p-1" role="radiogroup" aria-label="Seconds per slide">
                  {LENGTHS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={seconds === s}
                      onClick={() => setSeconds(s)}
                      className={`rounded-lg px-3 py-1 text-[12px] font-semibold transition-colors ${seconds === s ? 'bg-accent-500 text-on-accent' : 'text-white/55 hover:text-white/85'}`}
                    >
                      {s}s
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="anim-pop mt-3 rounded-lg border border-rose-500/25 bg-rose-500/5 p-3 text-[12.5px] leading-relaxed text-rose-300">{error}</p>}

            <p className="mt-4 text-[11.5px] leading-relaxed text-white/40">
              The video is made in this browser and records in real time, so a two-minute deck takes about two minutes. Keep this tab open until it finishes.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-[12.5px] font-semibold text-white/65 transition-colors hover:bg-white/5 hover:text-white">
                Cancel
              </button>
              <button type="button" onClick={start} disabled={voice === null && narrate} className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-[12.5px] font-semibold text-on-accent transition-colors hover:bg-accent-400 disabled:opacity-50">
                <Film size={14} /> Make the video
              </button>
            </div>
          </>
        ) : phase === 'done' && result ? (
          <div className="anim-pop">
            <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4">
              <span className="anim-zoom flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                <Check size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold text-white/90">{result.name}</div>
                <div className="text-[12px] text-white/50">
                  {clock(time.of)} · {(result.size / 1048576).toFixed(1)} MB · {withVoice ? 'with narration' : 'no narration'}
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPhase('setup')} className="rounded-lg border border-white/10 px-4 py-2 text-[12.5px] font-semibold text-white/65 transition-colors hover:bg-white/5 hover:text-white">
                Make another
              </button>
              <button type="button" onClick={() => save(result)} className="flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-[12.5px] font-semibold text-on-accent transition-colors hover:bg-accent-400">
                <Download size={14} /> Download again
              </button>
            </div>
          </div>
        ) : (
          <div aria-live="polite">
            <ol className="space-y-2">
              {[
                ...(withVoice ? [['voice', 'Recording the narration']] : []),
                ['slides', 'Drawing the slides'],
                ['recording', 'Recording the video'],
              ].map(([id, label], k, all) => {
                const order = all.map((x) => x[0]);
                const done = order.indexOf(phase) > k;
                const now = phase === id;
                return (
                  <li key={id} className={`flex items-center gap-2.5 text-[13px] ${now ? 'font-semibold text-white/90' : done ? 'text-white/55' : 'text-white/30'}`}>
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      {done ? <Check size={13} className="anim-zoom text-accent-400" /> : now ? <Loader2 size={13} className="animate-spin text-accent-400" /> : <span className="h-1.5 w-1.5 rounded-full border border-white/25" />}
                    </span>
                    {label}
                    {now && phase !== 'recording' && <span className="ml-auto font-mono text-[11.5px] text-white/45">{step.at} / {step.of}</span>}
                    {now && phase === 'recording' && <span className="ml-auto font-mono text-[11.5px] text-white/45">{clock(time.at)} / {clock(time.of)}</span>}
                  </li>
                );
              })}
            </ol>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/6">
              {/* Keyed on the step, so each one starts from empty rather than
                  sliding back from where the last one finished. */}
              <div
                key={phase}
                className="ld-progress h-full rounded-full bg-accent-500 transition-[width] duration-300"
                style={{ width: `${phase === 'recording' ? (time.of ? (time.at / time.of) * 100 : 0) : (step.at / Math.max(1, step.of)) * 100}%` }}
              />
            </div>
            <p className="mt-3 text-[11.5px] text-white/40">Keep this tab open — a hidden tab records slowly.</p>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={cancel} className="rounded-lg border border-white/10 px-4 py-2 text-[12.5px] font-semibold text-white/65 transition-colors hover:bg-white/5 hover:text-white">
                Stop
              </button>
            </div>
          </div>
        )}
      </div>

      {/* The stage slides are drawn on: off screen, a fixed 16:9, nothing
          moving. Portalled to the body, because this overlay's blur would make
          it the stage's containing block. */}
      {capture !== null &&
        createPortal(
          <div aria-hidden="true" style={{ position: 'fixed', left: -20000, top: 0, pointerEvents: 'none' }}>
            <div ref={stageRef} className="motion-off relative flex flex-col overflow-hidden bg-canvas" style={{ width: STAGE_W, height: STAGE_H, padding: '40px 56px 36px' }}>
              <div className="mb-6 flex items-end justify-between gap-6">
                <div className="min-w-0">
                  <div className="label">{chapterLabel(board, capture)}</div>
                  <div className="mt-1 truncate text-[16px] font-semibold text-white/60">{board.subject || fileName}</div>
                </div>
                <div className="shrink-0 font-mono text-[13px] tabular-nums text-white/40">
                  {String(capture + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col justify-center">
                <SlideContent board={board} page={capture} tiles={tiles} measures={measures} fields={fields} avatar={avatar} height={560} animate={false} wide />
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
