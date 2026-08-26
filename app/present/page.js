'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  X,
  Sparkles,
  Target,
  AlertTriangle,
  TrendingUp,
  Maximize2,
  Volume2,
  VolumeX,
  Users,
} from 'lucide-react';
import { useAnalysis, useDataset } from '../../lib/store/DatasetProvider';
import LazyChart from '../../components/charts/LazyChart';
import ChartBoundary from '../../components/charts/ChartBoundary';
import { cleanFloatingPoints } from '../../lib/dataCleaner';
import ThemeToggle from '../../components/shell/ThemeToggle';
import AnalystAvatar from '../../components/panels/AnalystAvatar';
import AvatarPicker, { useAvatar } from '../../components/panels/AvatarPicker';
import useNarration from '../../lib/useNarration';
import { dashboardScript, slideScript, summaryScript, pickVoice } from '../../lib/speech';

/**
 * Slides that are not one of the findings: the summary in front, and the board
 * behind. Both exist because a deck that is only findings has no beginning and
 * no end — you open on chart one and stop on chart nine.
 */
const EXTRA_SLIDES = 2;

const SPEEDS = [
  { label: '1x', ms: 9000 },
  { label: '1.5x', ms: 6000 },
  { label: '2x', ms: 4500 },
  { label: '0.5x', ms: 18000 },
];

export default function PresentPage() {
  const router = useRouter();
  const { dataset, status } = useDataset();
  const { analysis } = useAnalysis();

  const [page, setPage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [narrating, setNarrating] = useState(true);
  const [choosing, setChoosing] = useState(false);
  const rootRef = useRef(null);

  // Where "exit" goes. A restored analysis has no dataset, and the dashboard
  // would only bounce back to the upload page — the profile page it was opened
  // from is the honest way back.
  const exitTo = dataset ? '/dashboard' : '/profile';

  const { avatar, avatarId, chooseAvatar } = useAvatar();
  // Prefers the configured ElevenLabs voice; falls back to the browser voice.
  const { speak, stop, speaking, voices, supported } = useNarration();

  const board = analysis?.storyboard || [];
  const total = board.length + EXTRA_SLIDES;
  // The closing board: every chart at once, after they have been walked
  // through one at a time.
  const onDashboard = total > EXTRA_SLIDES && page === total - 1;

  const go = useCallback(
    (delta) => {
      setPage((p) => Math.min(total - 1, Math.max(0, p + delta)));
    },
    [total]
  );

  useEffect(() => {
    // A restored analysis has a storyboard and no rows behind it — that is what
    // a shared analysis IS, and this is the screen for it. Requiring a dataset
    // here meant an analysis someone sent you could be opened and then
    // immediately bounced back to the upload page.
    if (status !== 'booting' && !dataset && !analysis?.storyboard?.length) router.replace('/');
  }, [status, dataset, analysis, router]);

  // Keyboard control: arrows, space to play/pause, escape to leave.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
      else if (e.key === 'Escape') router.push(exitTo);
      else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, router, exitTo]);

  // The script for whatever slide is on screen, in the chosen avatar's voice.
  const script = useMemo(() => {
    if (!analysis) return '';
    if (page === 0) {
      return summaryScript(analysis.slideZero, avatar, {
        fileName: dataset?.fileName,
        rowCount: dataset?.rowCount,
      });
    }
    if (page === total - 1) return dashboardScript(analysis, avatar, { fileName: dataset?.fileName });
    const current = analysis.storyboard[page - 1];
    return slideScript(current, avatar, { index: page - 1, total: analysis.storyboard.length });
  }, [analysis, avatar, page, dataset, total]);

  const advance = useCallback(() => {
    setPlaying((isPlaying) => {
      if (!isPlaying) return false;
      if (page >= total - 1) return false;
      setPage((n) => n + 1);
      return true;
    });
  }, [page, total]);

  // Narration is driven by the play button, not by arriving at a slide.
  //
  // Speaking the moment the deck opened meant a presenter connecting to a
  // projector had the summary read to the room before they were ready, with no
  // way to rewind it. It also fought the browser: audio started without a user
  // gesture is blocked by autoplay policy, so the ElevenLabs voice would fail
  // its first utterance and quietly fall back. Pressing play is that gesture.
  //
  // While playing, changing slide or presenter still re-speaks immediately.
  useEffect(() => {
    if (!playing || !narrating || !supported || !script) {
      stop();
      return undefined;
    }
    speak(script, {
      voice: pickVoice(voices, avatar),
      pitch: avatar.voice.pitch,
      rate: avatar.voice.rate,
      // Autoplay waits for the narration to finish rather than cutting the
      // presenter off mid-sentence on a fixed timer.
      onDone: advance,
    });
    return () => stop();
  }, [playing, script, narrating, supported, avatar, voices, speak, stop, advance]);

  // The timer only drives autoplay when the presenter is silent; otherwise the
  // voice paces the deck and a timer would fight it.
  useEffect(() => {
    if (!playing) return undefined;
    if (narrating && supported && script) return undefined;
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

  if (!analysis?.storyboard?.length) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas text-center">
        <p className="text-sm text-white/40">There is nothing to present yet.</p>
        <button
          onClick={() => router.push(exitTo)}
          className="rounded-xl bg-accent-500 px-5 py-2.5 text-xs font-black uppercase tracking-[0.2em] text-on-accent hover:bg-accent-400"
        >
          Go to the dashboard
        </button>
      </div>
    );
  }

  const slide = page === 0 || onDashboard ? null : analysis.storyboard[page - 1];

  return (
    <div ref={rootRef} className="relative flex h-screen flex-col overflow-hidden bg-canvas">
      <div className="ambient-wash" />

      {/* Autoplay progress rail */}
      {playing && (
        <div
          key={`${page}-${speedIdx}`}
          className="absolute left-0 top-0 z-30 h-0.5 bg-accent-500"
          style={{ animation: `present-progress ${SPEEDS[speedIdx].ms}ms linear forwards` }}
        />
      )}

      {/* Top bar */}
      <header className="relative z-20 flex items-center justify-between gap-4 px-6 py-4">
        <div className="min-w-0">
          <div className="label">
            {page === 0
              ? 'Executive summary'
              : onDashboard
                ? 'Everything together'
                : `Finding ${page} of ${total - EXTRA_SLIDES}`}
          </div>
          <div className="mt-0.5 truncate text-sm font-bold text-white/60">{dataset?.fileName}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setChoosing(true)}
            title={`Presented by ${avatar.name} - change presenter`}
            className="flex items-center gap-2 rounded-lg border border-white/10 py-1.5 pl-1.5 pr-3 text-left transition-colors hover:bg-white/5"
          >
            <AnalystAvatar avatar={avatar} size={26} speaking={speaking} muted={!narrating} />
            <span className="hidden sm:block">
              <span className="block text-[11px] font-black leading-tight text-white/75">{avatar.name}</span>
              <span
                className="block text-[9px] font-black uppercase tracking-[0.15em]"
                style={{ color: avatar.accent }}
              >
                {avatar.role}
              </span>
            </span>
            <Users size={13} className="text-white/25" />
          </button>

          <button
            onClick={() => setNarrating((n) => !n)}
            aria-label={narrating ? 'Mute the presenter' : 'Unmute the presenter'}
            title={supported ? undefined : 'This browser has no speech synthesis'}
            disabled={!supported}
            className={`rounded-lg border p-2 transition-colors disabled:opacity-25 ${
              narrating && supported
                ? 'border-accent-500/40 bg-accent-500/10 text-accent-300'
                : 'border-white/10 text-white/45 hover:bg-white/5 hover:text-white'
            }`}
          >
            {narrating && supported ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>

          <ThemeToggle compact />

          <button onClick={goFullscreen} aria-label="Toggle fullscreen" className="rounded-lg border border-white/10 p-2 text-white/45 hover:bg-white/5 hover:text-white">
            <Maximize2 size={15} />
          </button>
          <button onClick={() => router.push(exitTo)} aria-label="Exit presentation" className="rounded-lg border border-white/10 p-2 text-white/45 hover:bg-white/5 hover:text-white">
            <X size={15} />
          </button>
        </div>
      </header>

      {choosing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setChoosing(false)}
          role="presentation"
        >
          <div
            className="panel w-full max-w-2xl p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Choose your presenter"
          >
            <div className="mb-1 flex items-center gap-2">
              <Users size={15} className="text-accent-400" />
              <h2 className="text-base font-black text-white">Who presents this deck?</h2>
            </div>
            <p className="mb-5 text-[12px] leading-relaxed text-white/40">
              Each analyst frames the same verified findings differently and reads them in their own voice. The
              numbers never change.
            </p>
            <AvatarPicker selectedId={avatarId} onSelect={chooseAvatar} />
            {!supported && (
              <p className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[12px] text-amber-300">
                This browser has no speech synthesis, so the deck will be presented silently.
              </p>
            )}
            <button
              onClick={() => setChoosing(false)}
              className="mt-5 rounded-lg bg-accent-500 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-on-accent hover:bg-accent-400"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Slide */}
      <div key={page} className="slide-in relative z-10 flex min-h-0 flex-1 flex-col px-6 pb-2 md:px-12">
        {page === 0 ? (
          <SummarySlide slideZero={analysis.slideZero} kpis={analysis.kpis} />
        ) : onDashboard ? (
          <DashboardSlide analysis={analysis} fileName={dataset?.fileName} />
        ) : (
          <ChartSlide slide={slide} />
        )}
      </div>

      {/* Controls */}
      <footer className="relative z-20 flex items-center justify-center gap-3 px-6 py-4">
        <button
          onClick={() => go(-1)}
          disabled={page === 0}
          aria-label="Previous slide"
          className="rounded-xl border border-white/10 p-3 text-white/55 transition-colors enabled:hover:bg-white/6 enabled:hover:text-white disabled:opacity-20"
        >
          <ChevronLeft size={18} />
        </button>

        <button
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Pause' : 'Play'}
          title={
            narrating && supported
              ? playing
                ? 'Pause the presenter'
                : 'Play — the presenter starts speaking'
              : playing
              ? 'Pause'
              : 'Play'
          }
          className={`rounded-xl border p-3 transition-colors ${
            playing ? 'border-accent-500/40 bg-accent-500/15 text-accent-300' : 'border-white/10 text-white/55 hover:bg-white/6 hover:text-white'
          }`}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>

        <button
          onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
          className="rounded-xl border border-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/6 hover:text-white"
        >
          {SPEEDS[speedIdx].label}
        </button>

        <button
          onClick={() => go(1)}
          disabled={page === total - 1}
          aria-label="Next slide"
          className="rounded-xl border border-white/10 p-3 text-white/55 transition-colors enabled:hover:bg-white/6 enabled:hover:text-white disabled:opacity-20"
        >
          <ChevronRight size={18} />
        </button>

        <div className="ml-4 hidden items-center gap-1.5 sm:flex">
          {Array.from({ length: total }).map((_, i) => (
            <button
              key={i}
              onClick={() => {
                setPlaying(false);
                setPage(i);
              }}
              aria-label={`Go to slide ${i + 1}`}
              className={`h-1 rounded-full transition-all ${
                i === page
                  ? 'w-7 bg-accent-500'
                  : i === 0 || i === total - 1
                    ? 'w-3 bg-white/25'
                    : 'w-3 bg-white/10 hover:bg-white/25'
              }`}
            />
          ))}
        </div>
      </footer>
    </div>
  );
}

function SummarySlide({ slideZero, kpis }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col justify-center overflow-y-auto py-4">
      <div className="mb-6 flex items-center gap-3">
        <Sparkles size={18} className="text-accent-400" />
        <h1 className="text-3xl font-black tracking-tight md:text-5xl">{slideZero.title}</h1>
      </div>

      {slideZero.headline && (
        <p className="mb-6 text-xl font-medium leading-relaxed text-white/85 md:text-2xl">
          {cleanFloatingPoints(slideZero.headline)}
        </p>
      )}

      {kpis?.length > 0 && (
        <div className="mb-7 grid grid-cols-2 gap-3 md:grid-cols-4">
          {kpis.map((k, i) => (
            <div key={`${k.label}-${i}`} className="card p-4">
              <div className="text-2xl font-black text-white">{k.value}</div>
              <div className="label mt-1 truncate">{k.label}</div>
            </div>
          ))}
        </div>
      )}

      <ul className="mb-7 flex flex-col gap-4">
        {slideZero.macroInsights.map((line, i) => (
          <li key={i} className="flex gap-4">
            <span className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-accent-500" />
            <p className="text-lg leading-relaxed text-white/80 md:text-xl">{cleanFloatingPoints(line)}</p>
          </li>
        ))}
      </ul>

      <div className="grid gap-3 md:grid-cols-3">
        <Pill icon={Target} tone="accent" label="Focus" text={slideZero.strategicScorecard.focus} />
        <Pill icon={AlertTriangle} tone="rose" label="Risk" text={slideZero.strategicScorecard.risk} />
        <Pill icon={TrendingUp} tone="emerald" label="Opportunity" text={slideZero.strategicScorecard.opportunity} />
      </div>
    </div>
  );
}

/**
 * The closing board: every finding at once.
 *
 * A deck read one chart at a time leaves the audience holding nine separate
 * facts and no picture. This is the picture — the same charts, the same
 * verified numbers, laid out together so the relationships between them are
 * visible in one glance and so there is something to leave on screen while the
 * room asks questions.
 *
 * Titles only, no narrative: every word has already been said, and repeating it
 * in six-point type beside a thumbnail helps nobody.
 */
function DashboardSlide({ analysis, fileName }) {
  const board = analysis.storyboard || [];
  const kpis = analysis.kpis || [];
  const card = analysis.slideZero?.strategicScorecard || {};

  // Two columns up to four charts, three beyond that. Past nine, the grid stops
  // being a dashboard and becomes a contact sheet, so it scrolls instead.
  const columns = board.length <= 4 ? 'lg:grid-cols-2' : 'lg:grid-cols-3';

  return (
    <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col overflow-y-auto py-2">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-black tracking-tight md:text-3xl">
          {analysis.slideZero?.title || 'Everything together'}
        </h1>
        <span className="text-[13px] text-white/40">
          {board.length} {board.length === 1 ? 'finding' : 'findings'}
          {fileName ? ` · ${fileName}` : ''}
        </span>
      </div>

      {kpis.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {kpis.map((k, i) => (
            <div key={`${k.label}-${i}`} className="card p-3">
              <div className="text-xl font-black text-white md:text-2xl">{k.value}</div>
              <div className="label mt-0.5 truncate">{k.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className={`grid gap-3 ${columns}`}>
        {board.map((item) => (
          <div key={item.id} className="card flex flex-col p-3">
            <div className="mb-2 truncate text-[13px] font-black text-white/85" title={item.pageTitle}>
              {item.pageTitle}
            </div>
            <div className="h-[190px] w-full">
              <ChartBoundary resetKey={`board-${item.id}-${item.chart?.chart_type}`}>
                <LazyChart
                  data={item.chart?.resultData}
                  type={item.chart?.chart_type}
                  xKey={item.chart?.xAxisKey}
                  yKey={item.chart?.yAxisKey}
                  secondaryYKey={item.chart?.secondaryYAxisKey}
                  colors={item.chart?.colors}
                  labels={item.chart?.labels}
                  colorBy={item.chart?.colorBy}
                  xLabel={item.chart?.xAxisLabel}
                  yLabel={item.chart?.yAxisLabel}
                  compact
                  eager
                />
              </ChartBoundary>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Pill icon={Target} tone="accent" label="Focus" text={card.focus} />
        <Pill icon={AlertTriangle} tone="rose" label="Risk" text={card.risk} />
        <Pill icon={TrendingUp} tone="emerald" label="Opportunity" text={card.opportunity} />
      </div>
    </div>
  );
}

function ChartSlide({ slide }) {
  const chart = slide.chart || {};
  return (
    <div className="grid h-full min-h-0 gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col overflow-y-auto">
        <h2 className="text-2xl font-black leading-tight tracking-tight md:text-3xl">{slide.pageTitle}</h2>

        {slide.insight_anchor && (
          <div className="mt-5 rounded-2xl border border-accent-500/20 bg-accent-500/[0.06] p-4">
            <div className="label !text-accent-400/80 mb-2 flex items-center gap-2">
              <Sparkles size={11} /> Key finding
            </div>
            <p className="text-[15px] leading-relaxed text-white/85">{cleanFloatingPoints(slide.insight_anchor)}</p>
          </div>
        )}

        {slide.insight_implication && (
          <div className="mt-3 rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <div className="label mb-2">What it means</div>
            <p className="text-[14px] leading-relaxed text-white/65">{cleanFloatingPoints(slide.insight_implication)}</p>
          </div>
        )}

        {slide.findings?.verifiedFacts?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {slide.findings.verifiedFacts.slice(0, 5).map((f, i) => (
              <span key={i} className="rounded-lg bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] text-white/45">
                {f}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="card min-h-0 p-4">
        <ChartBoundary resetKey={`${slide.id}-${chart.chart_type}`}>
          <LazyChart
            data={chart.resultData}
            type={chart.chart_type}
            xKey={chart.xAxisKey}
            yKey={chart.yAxisKey}
            secondaryYKey={chart.secondaryYAxisKey}
            colors={chart.colors}
            labels={chart.labels}
            colorBy={chart.colorBy}
            xLabel={chart.xAxisLabel}
            yLabel={chart.yAxisLabel}
            eager
          />
        </ChartBoundary>
      </div>
    </div>
  );
}

function Pill({ icon: Icon, tone, label, text }) {
  // A card the engine left empty had nothing to report; it is dropped rather
  // than presented as a dash on a slide.
  if (!String(text || '').trim()) return null;

  const tones = {
    accent: 'border-accent-500/20 bg-accent-500/6 text-accent-400',
    rose: 'border-rose-500/20 bg-rose-500/6 text-rose-400',
    emerald: 'border-emerald-500/20 bg-emerald-500/6 text-emerald-400',
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-2">
        <Icon size={13} />
        <span className="text-[9px] font-black uppercase tracking-[0.25em]">{label}</span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-white/80">{cleanFloatingPoints(text) || '—'}</p>
    </div>
  );
}
