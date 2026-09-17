'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  Info,
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
import { CANVAS_HEIGHT, CANVAS_WIDTH, canvasScale, layoutMap, readingOrder } from '../../lib/canvasLayout';
import { slideLayout } from '../../lib/slideSize';

/*
 * The deck is the summary, then a slide per finding, then the board — which is
 * as many slides as the arrangement needs. Both ends exist because a deck that
 * is only findings has no beginning and no end: you open on chart one and stop
 * on chart nine. The count lives in `total`, which is computed rather than
 * fixed now that the board can run to more than one page.
 */

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

  /**
   * A filter tile is not a finding.
   *
   * It belongs on the board — it is how the board is looked at — but it has
   * nothing to say on a slide of its own, and it was getting one: "Finding 8 of
   * 9", a heading, and three empty checkboxes filling a screen. Walked slides
   * are the findings; the board at the end is everything.
   */
  const findings = useMemo(() => board.filter((slide) => slide?.chart?.chart_type !== 'slicer'), [board]);

  /**
   * Everything the board holds: its cards and its findings.
   *
   * The card strip used to be drawn above the board here, which put the same
   * four numbers in a different place in the deck than they are on the
   * dashboard. They are tiles on the board now, so they arrive with it.
   */
  const tiles = useMemo(
    () => [
      ...(analysis?.kpis || []).map((kpi, i) => ({ ...kpi, id: kpi.id || `kpi_${i + 1}`, kpiCard: true })),
      ...board,
    ],
    [analysis?.kpis, board]
  );

  /*
   * And the board is one slide, because the board is one page.
   *
   * It was cut into pages for a while, which is what a board that grew
   * downwards needed. A dashboard nobody can see at once is not a dashboard,
   * so the canvas is a page of fixed size now — and this slide shows it whole,
   * exactly as it was arranged on the dashboard tab.
   */
  const total = findings.length + 2;
  const firstBoardPage = findings.length + 1;
  const onDashboard = page >= firstBoardPage;

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
    if (status !== 'booting' && !dataset && !analysis?.storyboard?.length) router.replace('/home');
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
    if (page >= firstBoardPage) return dashboardScript(analysis, avatar, { fileName: dataset?.fileName });
    const current = findings[page - 1];
    return slideScript(current, avatar, { index: page - 1, total: findings.length });
  }, [analysis, avatar, page, dataset, findings, firstBoardPage]);

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

  const slide = page === 0 || onDashboard ? null : findings[page - 1];

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
                : `Finding ${page} of ${findings.length}`}
          </div>
          <div className="mt-0.5 truncate text-sm font-bold text-white/60">
            {dataset?.fileName}
            {/* A deck presented on a slice names the slice. Without it the room
                is shown a chart of some of the rows and told it is the
                business. */}
            {analysis?.filter?.description && (
              <span className="ml-2 font-semibold text-amber-300/80">
                · {analysis.filter.description} ({analysis.filter.rowCount.toLocaleString()} rows)
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setChoosing(true)}
            title={`Presented by ${avatar.name} - change presenter`}
            className="flex h-11 items-center justify-center gap-2 rounded-lg border border-white/10 px-2 text-left transition-colors hover:bg-white/5 sm:h-auto sm:justify-start sm:py-1.5 sm:pl-1.5 sm:pr-3"
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
            className={`flex h-11 w-11 items-center justify-center sm:h-auto sm:w-auto rounded-lg border transition-colors disabled:opacity-25 sm:p-2 ${
              narrating && supported
                ? 'border-accent-500/40 bg-accent-500/10 text-accent-300'
                : 'border-white/10 text-white/45 hover:bg-white/5 hover:text-white'
            }`}
          >
            {narrating && supported ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>

          <ThemeToggle compact />

          <button onClick={goFullscreen} aria-label="Toggle fullscreen" className="flex h-11 w-11 items-center justify-center sm:h-auto sm:w-auto rounded-lg border border-white/10 text-white/45 hover:bg-white/5 hover:text-white sm:p-2">
            <Maximize2 size={15} />
          </button>
          <button onClick={() => router.push(exitTo)} aria-label="Exit presentation" className="flex h-11 w-11 items-center justify-center sm:h-auto sm:w-auto rounded-lg border border-white/10 text-white/45 hover:bg-white/5 hover:text-white sm:p-2">
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
          <SummarySlide slideZero={analysis.slideZero} />
        ) : onDashboard ? (
          <DashboardSlide analysis={analysis} tiles={tiles} fileName={dataset?.fileName} />
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
          className="flex h-11 w-11 items-center justify-center sm:h-auto sm:w-auto rounded-xl border border-white/10 text-white/55 transition-colors enabled:hover:bg-white/6 enabled:hover:text-white disabled:opacity-20 sm:p-3"
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
          className={`flex h-11 w-11 items-center justify-center sm:h-auto sm:w-auto rounded-xl border transition-colors sm:p-3 ${
            playing ? 'border-accent-500/40 bg-accent-500/15 text-accent-300' : 'border-white/10 text-white/55 hover:bg-white/6 hover:text-white'
          }`}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>

        <button
          onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
          className="flex h-11 items-center justify-center rounded-xl border border-white/10 px-4 text-[10px] font-black uppercase tracking-[0.2em] text-white/45 transition-colors hover:bg-white/6 hover:text-white sm:h-auto sm:py-3"
        >
          {SPEEDS[speedIdx].label}
        </button>

        <button
          onClick={() => go(1)}
          disabled={page === total - 1}
          aria-label="Next slide"
          className="flex h-11 w-11 items-center justify-center sm:h-auto sm:w-auto rounded-xl border border-white/10 text-white/55 transition-colors enabled:hover:bg-white/6 enabled:hover:text-white disabled:opacity-20 sm:p-3"
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

/**
 * The words, and only the words.
 *
 * The card strip moved to the board, where the app puts it: /summary carries
 * what the analysis SAYS and /dashboard carries its numbers and its charts, and
 * a deck that split them differently would be a third arrangement of the same
 * two things. What is left here is the headline, the takeaways and the
 * scorecard — the three that are written rather than computed.
 */
function SummarySlide({ slideZero }) {
  /**
   * A summary slide that fits on the screen it is presented from.
   *
   * It scrolled: six long takeaways under a headline and a card strip, in a
   * centred column, so the title and the opening line were pushed off the top
   * and the reader arrived halfway down a list. Nobody scrolls a slide in front
   * of a room.
   *
   * Four takeaways, and the type steps down as they get longer — which is what
   * a person does when they are given a fixed slide and too much to say, and is
   * a better answer than a scrollbar. What is cut was the least of six, not the
   * most of four.
   */
  const bullets = (slideZero.macroInsights || []).slice(0, 4);
  const long = bullets.reduce((n, b) => n + String(b).length, 0) > 520;
  const bulletText = long ? 'text-[15px] md:text-base' : 'text-lg md:text-xl';

  // A slide is a fixed box, and on a phone the summary does not fit in one: at
  // 375x812 the content ran 806px inside a 648px box and the scorecards were
  // simply cut off. A deck read from a phone is read, not projected, so below
  // the tablet breakpoint it scrolls instead.
  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col justify-start overflow-y-auto py-4 md:justify-center md:overflow-hidden">
      <div className={`flex items-center gap-3 ${long ? 'mb-3' : 'mb-6'}`}>
        <Sparkles size={18} className="text-accent-400" />
        <h1 className={`font-black tracking-tight ${long ? 'text-2xl md:text-4xl' : 'text-3xl md:text-5xl'}`}>
          {slideZero.title}
        </h1>
      </div>

      {slideZero.headline && (
        <p
          className={`font-medium leading-relaxed text-white/85 ${
            long ? 'mb-4 text-lg md:text-xl' : 'mb-6 text-xl md:text-2xl'
          }`}
        >
          {cleanFloatingPoints(slideZero.headline)}
        </p>
      )}

      <ul className={`flex flex-col ${long ? 'mb-4 gap-2.5' : 'mb-7 gap-4'}`}>
        {bullets.map((line, i) => (
          <li key={i} className="flex gap-4">
            <span className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-accent-500" />
            <p className={`leading-relaxed text-white/80 ${bulletText}`}>{cleanFloatingPoints(line)}</p>
          </li>
        ))}
      </ul>

      <div className="grid gap-3 md:grid-cols-3">
        <Pill icon={Target} tone="accent" label="Focus" text={slideZero.strategicScorecard.focus} />
        <Pill icon={AlertTriangle} tone="rose" label="Risk" text={slideZero.strategicScorecard.risk} />
        <Pill icon={TrendingUp} tone="emerald" label="Opportunity" text={slideZero.strategicScorecard.opportunity} />
      </div>

      {/* How to read the numbers above. A deck is what gets forwarded, so the
          caveat has to travel with it — two at most, because the slide has to
          stay a slide. */}
      {slideZero.caveats?.length > 0 && (
        <ul className={`flex flex-col gap-1 ${long ? 'mt-3' : 'mt-5'}`}>
          {slideZero.caveats.slice(0, 2).map((line, i) => (
            <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-white/45 md:text-[13px]">
              <Info size={12} className="mt-1 shrink-0 text-amber-400/70" />
              {line}
            </li>
          ))}
        </ul>
      )}
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

/**
 * Whether the deck is being read on a phone rather than projected.
 *
 * Read after mount, not during render: matchMedia does not exist on the server,
 * and a value guessed during render is a hydration mismatch waiting to happen.
 */
function useNarrowViewport(query = '(max-width: 767px)') {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return narrow;
}

function DashboardSlide({ analysis, tiles = [], fileName }) {
  const board = tiles;

  /**
   * The board, at the size the slide can give it.
   *
   * The cards carry coordinates on a canvas of fixed logical width, so the only
   * question here is what that canvas scales to — and it is a different question
   * from the dashboard's, because a slide is bounded in BOTH directions. The
   * scale is whichever of the two fits, so the arrangement never runs off the
   * bottom of the one surface in this product nobody can scroll.
   */
  const boardRef = useRef(null);
  const [room, setRoom] = useState({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT });

  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setRoom({ width: el.clientWidth || CANVAS_WIDTH, height: el.clientHeight || CANVAS_HEIGHT });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const sizeOf = useCallback((item) => slideLayout(item.size), []);
  const boardBoxes = useMemo(() => layoutMap(board, sizeOf), [board, sizeOf]);

  // The page is sixteen by nine and so, near enough, is the room it is given,
  // so this is usually the width. The height is what stops a slide area that is
  // taller than that from pushing the bottom row off the screen.
  const boardScale = canvasScale(room.width, room.height);

  /**
   * A phone is not a projector.
   *
   * The shape above divides one wide slide between every finding, which on a
   * 375px screen made five charts 75px across and 57px tall — the axis labels
   * and nothing else. Nobody is projecting from a phone, so the one rule the
   * board slide holds to on a big screen — never scroll — is the one to give up
   * here: a single column of readable tiles that scrolls beats five that don't
   * draw.
   */
  const narrow = useNarrowViewport();

  /**
   * The chrome is one line, and the board gets the rest.
   *
   * This slide used to open with the summary's own title, the summary's own
   * card strip and the summary's own scorecard, and then give the board what
   * was left — which was about a third of the slide, so the charts came out
   * small and hugging one corner with half the screen empty beside them. Every
   * one of those three is on the opening slide already; repeating them here
   * cost the board the room it exists to use.
   *
   * What a reader needs on this slide is which board they are looking at and
   * how far through it they are, and that is a line of text.
   */
  return (
    <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col overflow-hidden py-2">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-black tracking-tight md:text-2xl">
          {analysis.slideZero?.title || 'Everything together'}
        </h1>
        <span className="text-[13px] text-white/40">
          {board.length} {board.length === 1 ? 'finding' : 'findings'}
          {fileName ? ` · ${fileName}` : ''}
        </span>
      </div>


      {/*
        * The arrangement the dashboard was left in, not a grid of its charts.
        *
        * This slide IS the dashboard, and it used to redraw it as evenly sized
        * tiles in however many columns fitted — which threw away the one thing
        * the reader had said about their findings, that this one is the story
        * and those two are its drivers. The board's own coordinates are scaled
        * into whatever the slide has room for, so the deck shows the dashboard
        * that was built rather than a second opinion about it.
        *
        * On a phone it stacks, in the order the arrangement reads. See
        * lib/canvasLayout.js.
        */}
      <div className="relative min-h-0 flex-1 overflow-hidden" ref={boardRef}>
        {narrow ? (
          <div className="flex h-full flex-col gap-3 overflow-y-auto">
            {readingOrder(board, sizeOf).map((item) => (
              <div key={item.id} className="card flex min-h-[210px] flex-col p-3">
                <BoardTile item={item} />
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              width: CANVAS_WIDTH,
              height: CANVAS_HEIGHT,
              transform: `scale(${boardScale})`,
              transformOrigin: 'top left',
            }}
            className="relative"
          >
            {board.map((item) => {
              // Only the cards this page holds: the rest are on another slide.
              const box = boardBoxes.get(String(item.id));
              if (!box) return null;
              return (
                <div
                  key={item.id}
                  style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }}
                  className="card flex flex-col p-3"
                >
                  <BoardTile item={item} />
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}

function ChartSlide({ slide }) {
  const chart = slide.chart || {};
  return (
    // Stacked, the two rows both size to their content, and the prose wins:
    // the chart card was left with about 20px of a phone-sized slide. Naming
    // the rows gives the chart a floor and hands the remainder — which the
    // column below already knows how to scroll — to the text.
    //
    // On a phone the slide scrolls as one page instead, the way the opening
    // slide already does. Dividing 812px between a finding, what it means, the
    // verified facts and a chart left every one of them in a box too small for
    // it, and the text in a scroller of its own inside a slide that did not
    // scroll — two scrolling regions on a screen held in one hand, with the
    // sentence cut mid-line in the smaller of them. A deck read from a phone is
    // read, not projected, and the rule about never scrolling a slide is a rule
    // about the room.
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto md:grid md:grid-rows-[minmax(0,1fr)_minmax(190px,45%)] md:overflow-hidden lg:grid-cols-[380px_minmax(0,1fr)] lg:grid-rows-1">
      <div className="flex flex-col md:min-h-0 md:overflow-y-auto">
        <h2 className="display text-[28px] leading-tight md:text-[36px]">{slide.pageTitle}</h2>

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

      {/* A height rather than a share of the slide, because in a scrolling
          column there is no share to take: `flex-1` of an auto-height parent
          is nothing, and the chart collapsed to its axis labels. */}
      <div className="card h-[320px] shrink-0 p-4 md:h-auto md:min-h-0">
        <ChartBoundary resetKey={`${slide.id}-${chart.chart_type}`}>
          <LazyChart
            data={chart.resultData}
            type={chart.chart_type}
            xKey={chart.xAxisKey}
            yKey={chart.yAxisKey}
            secondaryYKey={chart.secondaryYAxisKey}
            seriesKey={chart?.seriesKey}
            seriesSort={chart?.seriesSort}
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

/** One finding on the board: its name, and its chart under it. */
function BoardTile({ item }) {
  // A card is a number and its name, and it is on the board like anything else.
  if (item.kpiCard) {
    return (
      <div className="flex h-full flex-col justify-center">
        <div className="text-2xl font-black text-white md:text-3xl">{item.value}</div>
        <div className="label mt-1 truncate">{item.label}</div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-2 truncate text-[13px] font-black text-white/85" title={item.pageTitle}>
        {item.pageTitle}
      </div>
      {/* `min-h-0`: without it the tile refuses to shrink under the chart's own
          size and grows past the box it was given. */}
      <div className="min-h-0 w-full flex-1">
        <ChartBoundary resetKey={`board-${item.id}-${item.chart?.chart_type}`}>
          <LazyChart
            data={item.chart?.resultData}
            type={item.chart?.chart_type}
            xKey={item.chart?.xAxisKey}
            yKey={item.chart?.yAxisKey}
            secondaryYKey={item.chart?.secondaryYAxisKey}
            seriesKey={item.chart?.seriesKey}
            seriesSort={item.chart?.seriesSort}
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
    </>
  );
}

function Pill({ icon: Icon, tone, label, text, compact = false }) {
  // A card the engine left empty had nothing to report; it is dropped rather
  // than presented as a dash on a slide.
  if (!String(text || '').trim()) return null;

  const tones = {
    accent: 'border-accent-500/20 bg-accent-500/6 text-accent-400',
    rose: 'border-rose-500/20 bg-rose-500/6 text-rose-400',
    emerald: 'border-emerald-500/20 bg-emerald-500/6 text-emerald-400',
  };
  return (
    <div className={`rounded-2xl border ${compact ? 'px-4 py-2.5' : 'p-4'} ${tones[tone]}`}>
      <div className="flex items-center gap-2">
        <Icon size={13} />
        <span className="text-[9px] font-black uppercase tracking-[0.25em]">{label}</span>
      </div>
      <p className={`leading-relaxed text-white/80 ${compact ? 'mt-1 line-clamp-3 text-[12px]' : 'mt-2 text-[13px]'}`}>
        {cleanFloatingPoints(text) || '—'}
      </p>
    </div>
  );
}
