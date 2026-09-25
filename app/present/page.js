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
    const fit = () => setHeight(Math.max(260, Math.min(640, window.innerHeight - 330)));
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

  return (
    <ChartPalette>
      <div ref={rootRef} className="relative flex h-screen flex-col overflow-hidden bg-canvas" data-testid="present">
        <header className="relative z-20 flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <div className="label">{page === 0 ? 'Summary' : `Chart ${page} of ${tiles.length}`}</div>
            <div className="mt-0.5 truncate text-sm font-bold text-white/60">{board.subject || dataset?.fileName}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button onClick={() => setChoosing(true)} title={`Presented by ${avatar.name} — change presenter`} className="hidden items-center gap-2 rounded-lg border border-white/10 py-1.5 pl-1.5 pr-3 hover:bg-white/5 sm:flex">
              <AnalystAvatar avatar={avatar} size={28} />
              <span className="text-left">
                <span className="block text-[12px] font-bold text-white/80">{avatar.name}</span>
                <span className="block text-[10px] uppercase tracking-[0.12em] text-white/40">{avatar.role}</span>
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
          <div className="mx-auto flex h-full max-w-6xl flex-col justify-center">
            {page === 0 ? (
              <div className="space-y-6">
                <h1 className="display text-[30px] leading-tight text-white/95 sm:text-[40px]">{board.headline || board.subject || 'What the data says'}</h1>
                {bullets.length > 0 && (
                  <ul className="space-y-2.5">
                    {bullets.slice(0, 5).map((b, i) => (
                      <li key={i} className="flex gap-3 text-[16px] leading-relaxed text-white/80 sm:text-[18px]">
                        <span className="mt-[11px] h-2 w-2 shrink-0 rounded-full bg-accent-400" aria-hidden="true" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <KpiStrip kpis={board.kpis} />
              </div>
            ) : (
              tile && (
                <div className="card flex min-h-0 flex-col p-5 sm:p-7">
                  <h2 className="mb-4 text-[20px] font-semibold leading-snug text-white/95 sm:text-[24px]">{tile.title}</h2>
                  <div className="min-w-0">
                    <TileChart tile={tile} measures={measures} fields={fields} height={height} />
                  </div>
                  {tile.insight && <p className="mt-4 border-t border-white/8 pt-4 text-[15px] leading-relaxed text-white/80 sm:text-[17px]">{tile.insight}</p>}
                </div>
              )
            )}
          </div>
        </main>

        <footer className="relative z-20 flex items-center justify-center gap-3 px-4 py-3">
          <IconButton label="Previous" onClick={() => go(-1)} disabled={page === 0}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)}>
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </IconButton>
          <button onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)} className="h-10 rounded-lg border border-white/10 px-3 text-[12px] font-bold text-white/60 hover:bg-white/5" title="Autoplay speed">
            {SPEEDS[speedIdx].label}
          </button>
          <IconButton label="Next" onClick={() => go(1)} disabled={page >= total - 1}>
            <ChevronRight size={18} />
          </IconButton>
          <div className="ml-2 hidden items-center gap-1 sm:flex" aria-hidden="true">
            {Array.from({ length: total }, (_, i) => (
              <button key={i} tabIndex={-1} onClick={() => setPage(i)} className={`h-1.5 rounded-full transition-all ${i === page ? 'w-6 bg-accent-400' : 'w-2.5 bg-white/15 hover:bg-white/30'}`} />
            ))}
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
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-white/60 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-30">
      {children}
    </button>
  );
}
