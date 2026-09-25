'use client';

/**
 * The dashboard as a slideshow: the summary, then one chart per slide at full
 * size with its sentence underneath, narrated by the chosen presenter.
 *
 * One chart a slide, never the whole board shrunk onto one screen — a board
 * squeezed to fit a projector is a page of unreadable tiles. The board is the
 * dashboard tab; this is for walking a room through it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Maximize2, Pause, Play, Users, Volume2, VolumeX, X } from 'lucide-react';
import { useDataset } from '../../lib/store/DatasetProvider';
import { useDashboard } from '../../lib/store/DashboardProvider';
import ThemeToggle from '../../components/shell/ThemeToggle';
import AnalystAvatar from '../../components/panels/AnalystAvatar';
import AvatarPicker, { useAvatar } from '../../components/panels/AvatarPicker';
import useNarration from '../../lib/useNarration';
import { pickVoice, slideScript, summaryScript } from '../../lib/speech';
import { dashboardToDeck } from '../../lib/engine/deck';
import { ChartPalette } from '../../components/charts/palette';
import TileChart from '../../components/dashboard/TileChart';
import KpiStrip from '../../components/dashboard/KpiStrip';

const SPEEDS = [
  { label: '1x', ms: 9000 },
  { label: '1.5x', ms: 6000 },
  { label: '2x', ms: 4500 },
  { label: '0.5x', ms: 18000 },
];

export default function PresentPage() {
  const router = useRouter();
  const { dataset } = useDataset();
  const { board, engine } = useDashboard();
  const [page, setPage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [narrating, setNarrating] = useState(true);
  const [choosing, setChoosing] = useState(false);
  const [height, setHeight] = useState(420);
  const rootRef = useRef(null);
  const { avatar, avatarId, chooseAvatar } = useAvatar();
  const { speak, stop, voices, supported } = useNarration();

  const tiles = useMemo(() => (board?.sections || []).flatMap((s) => s.tiles), [board]);
  const measures = engine?.measures || board?.measures || [];
  const fields = engine?.ds?.fields || board?.ds?.fields || [];
  const deck = useMemo(() => (board ? dashboardToDeck(board, { measures, fields, fileName: dataset?.fileName }) : null), [board, measures, fields, dataset?.fileName]);
  const total = tiles.length + 1;

  const go = useCallback((d) => setPage((p) => Math.min(total - 1, Math.max(0, p + d))), [total]);

  // The chart takes whatever height the screen leaves it.
  useEffect(() => {
    // Wide windows put the narration beside the chart, so it gets nearly
    // the whole height; narrow ones stack it underneath.
    const fit = () => setHeight(Math.max(260, Math.min(760, window.innerHeight - (window.innerWidth >= 1024 ? 250 : 390))));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
      else if (e.key === 'Escape') router.push('/dashboard');
      else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, router]);

  const script = useMemo(() => {
    if (!deck) return '';
    if (page === 0) return summaryScript(deck.slideZero, avatar, { fileName: dataset?.fileName, rowCount: dataset?.rowCount });
    const entry = deck.storyboard[page - 1];
    return entry ? slideScript({ ...entry, insight_anchor: entry.findings.headline }, avatar, { index: page - 1, total: tiles.length }) : '';
  }, [deck, page, avatar, dataset, tiles.length]);

  const advance = useCallback(() => {
    setPlaying((isPlaying) => {
      if (!isPlaying) return false;
      if (page >= total - 1) return false;
      setPage((n) => n + 1);
      return true;
    });
  }, [page, total]);

  useEffect(() => {
    if (!playing || !narrating || !supported || !script) {
      stop();
      return undefined;
    }
    speak(script, { voice: pickVoice(voices, avatar), pitch: avatar.voice.pitch, rate: avatar.voice.rate, onDone: advance });
    return () => stop();
  }, [playing, script, narrating, supported, avatar, voices, speak, stop, advance]);

  useEffect(() => {
    if (!playing || (narrating && supported && script)) return undefined;
    if (page >= total - 1) {
      setPlaying(false);
      return undefined;
    }
    const t = setTimeout(() => setPage((p) => p + 1), SPEEDS[speedIdx].ms);
    return () => clearTimeout(t);
  }, [playing, page, total, speedIdx, narrating, supported, script]);

  const goFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };

  if (!board) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas text-center">
        <p className="text-sm text-white/40">There is nothing to present yet.</p>
        <button onClick={() => router.push(dataset ? '/dashboard' : '/home')} className="rounded-xl bg-accent-500 px-5 py-2.5 text-xs font-black uppercase tracking-[0.2em] text-on-accent hover:bg-accent-400">
          {dataset ? 'Go to the dashboard' : 'Get data'}
        </button>
      </div>
    );
  }

  const tile = page > 0 ? tiles[page - 1] : null;
  const bullets = board.aiSummary?.length ? board.aiSummary : (board.findings || []).map((f) => f.text);
  // Which chapter a chart belongs to, for the header.
  const chapter = (() => {
    let n = 0;
    for (const [si, sec] of (board.sections || []).entries()) {
      for (const t of sec.tiles) {
        n += 1;
        if (n === page) return { index: si + 1, title: sec.title || 'The main picture' };
      }
    }
    return null;
  })();

  return (
    <ChartPalette>
      <div ref={rootRef} className="relative flex h-screen flex-col overflow-hidden bg-canvas" data-testid="present">
        <div className="ambient-wash" />
        <div className="grid-veil" />
        {/* Progress through the deck. */}
        <div className="absolute inset-x-0 top-0 z-30 h-[3px] bg-white/[0.06]" aria-hidden="true">
          <div className="h-full bg-gradient-to-r from-accent-400 to-[var(--accent-2)] transition-[width] duration-500 ease-out" style={{ width: `${((page + 1) / total) * 100}%` }} />
        </div>

        <header className="relative z-20 flex items-center justify-between gap-4 px-4 pb-2 pt-4 sm:px-8">
          <div className="min-w-0">
            <div className="label">
              {page === 0 ? 'Executive summary' : chapter ? `${String(chapter.index).padStart(2, '0')} · ${chapter.title}` : 'Chart'}
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold text-white/60">{board.subject || dataset?.fileName}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="mr-2 hidden font-mono text-[12px] tabular-nums text-white/45 sm:block">
              {String(page + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
            </span>
            <button onClick={() => setChoosing(true)} title={`Presented by ${avatar.name} — change presenter`} className="hidden items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] py-1.5 pl-1.5 pr-3 hover:bg-white/[0.06] sm:flex">
              <AnalystAvatar avatar={avatar} size={28} />
              <span className="text-left">
                <span className="block text-[12px] font-semibold text-white/85">{avatar.name}</span>
                <span className="block text-[10px] uppercase tracking-[0.1em] text-white/40">{avatar.role}</span>
              </span>
              <Users size={13} className="text-white/40" />
            </button>
            <IconButton label={narrating ? 'Mute the presenter' : 'Unmute the presenter'} onClick={() => setNarrating((n) => !n)}>
              {narrating ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </IconButton>
            <ThemeToggle compact />
            <IconButton label="Full screen" onClick={goFullscreen}>
              <Maximize2 size={16} />
            </IconButton>
            <IconButton label="Leave the slideshow" onClick={() => router.push('/dashboard')}>
              <X size={16} />
            </IconButton>
          </div>
        </header>

        <main className="relative z-10 min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-10">
          <FitSlide key={page}>
            {page === 0 ? (
              <div className="mx-auto max-w-6xl space-y-7">
                <div>
                  <span className="eyebrow">{bullets.length} key {bullets.length === 1 ? "finding" : "findings"} · {tiles.length} {tiles.length === 1 ? "chart" : "charts"}</span>
                  <h1 className="display mt-4 max-w-4xl text-[30px] leading-[1.12] text-white/95 sm:text-[44px]">{board.headline || board.subject || 'What the data says'}</h1>
                </div>
                {bullets.length > 0 && (
                  <ol className="grid gap-3 md:grid-cols-2">
                    {bullets.slice(0, 4).map((b, i) => (
                      <li key={i} className="card flex gap-3 p-4">
                        <span className="figure flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-accent-400/30 bg-accent-400/10 text-[13px] font-semibold text-accent-300">{i + 1}</span>
                        <span className="text-[15px] leading-relaxed text-white/85">{b}</span>
                      </li>
                    ))}
                  </ol>
                )}
                <KpiStrip kpis={board.kpis} />
              </div>
            ) : (
              tile && (
                <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-stretch">
                  <div className="card flex min-h-0 flex-col p-5 sm:p-6">
                    <div className="mb-3 flex items-baseline gap-3">
                      <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-white/40">Fig. {page}</span>
                      <h2 className="text-[20px] font-semibold leading-snug text-white/95 sm:text-[26px]">{tile.title}</h2>
                    </div>
                    <div className="min-w-0">
                      <TileChart tile={tile} measures={measures} fields={fields} height={height} />
                    </div>
                  </div>
                  {tile.insight && (
                    <div className="flex items-start gap-3 rounded-2xl border border-accent-400/25 bg-accent-400/[0.06] p-4 sm:p-5 lg:flex-col lg:self-center">
                      <AnalystAvatar avatar={avatar} size={32} />
                      <p className="text-[15px] leading-relaxed text-white/85 sm:text-[17px]">{tile.insight}</p>
                    </div>
                  )}
                </div>
              )
            )}
          </FitSlide>
        </main>

        <footer className="relative z-20 flex justify-center px-4 pb-5 pt-2">
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[color-mix(in_oklab,var(--surface)_80%,transparent)] p-1.5 shadow-2xl backdrop-blur-xl">
            <IconButton label="Previous" onClick={() => go(-1)} disabled={page === 0}>
              <ChevronLeft size={18} />
            </IconButton>
            <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'} className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-500 text-on-accent hover:bg-accent-400">
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)} className="h-10 rounded-xl px-3 font-mono text-[12px] font-semibold text-white/60 hover:bg-white/5" title="Autoplay speed">
              {SPEEDS[speedIdx].label}
            </button>
            <IconButton label="Next" onClick={() => go(1)} disabled={page >= total - 1}>
              <ChevronRight size={18} />
            </IconButton>
            <div className="ml-1 hidden items-center gap-1 pr-2 sm:flex" aria-hidden="true">
              {Array.from({ length: total }, (_, i) => (
                <button key={i} tabIndex={-1} onClick={() => setPage(i)} className={`h-1.5 rounded-full transition-all ${i === page ? 'w-6 bg-accent-400' : 'w-2.5 bg-white/15 hover:bg-white/30'}`} />
              ))}
            </div>
          </div>
        </footer>
        {choosing && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={(e) => e.target === e.currentTarget && setChoosing(false)}>
            <div className="card w-full max-w-xl p-5" role="dialog" aria-label="Choose your presenter">
              <div className="mb-3 flex items-center">
                <span className="text-[13px] font-bold text-white/85">Choose your presenter</span>
                <button type="button" aria-label="Close" onClick={() => setChoosing(false)} className="ml-auto rounded p-1 text-white/40 hover:text-white">
                  <X size={15} />
                </button>
              </div>
              <AvatarPicker
                selectedId={avatarId}
                onSelect={(id) => {
                  chooseAvatar(id);
                  setChoosing(false);
                }}
              />
            </div>
          </div>
        )}
      </div>
    </ChartPalette>
  );
}

function IconButton({ children, label, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="flex h-10 w-10 items-center justify-center rounded-xl text-white/65 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-30">
      {children}
    </button>
  );
}

/**
 * A slide shrinks to fit the window, like a slide in a presentation app, so
 * a short or narrow window never cuts off its top. Below 60% it would be
 * unreadable, so from there it scrolls instead, starting from the top.
 */
function FitSlide({ children }) {
  const outer = useRef(null);
  const inner = useRef(null);
  const [fit, setFit] = useState({ scale: 1, height: 0 });
  useEffect(() => {
    const measure = () => {
      const box = outer.current;
      const content = inner.current;
      if (!box || !content) return;
      const need = content.scrollHeight;
      const have = box.clientHeight;
      const scale = need > have ? Math.max(0.6, have / need) : 1;
      setFit((f) => (f.scale === scale && f.height === need ? f : { scale, height: need }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="ld-rise mx-auto flex h-full max-w-[1500px] flex-col">
      {/* my-auto centres when there is room and starts at the top when there is not. */}
      <div className="my-auto w-full" style={{ height: fit.scale < 1 ? fit.height * fit.scale : undefined }}>
        <div ref={inner} style={{ transform: fit.scale < 1 ? `scale(${fit.scale})` : undefined, transformOrigin: 'top center' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
