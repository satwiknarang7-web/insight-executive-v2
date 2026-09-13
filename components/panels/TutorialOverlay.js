'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ArrowLeft, ArrowRight, Compass } from 'lucide-react';
import { useTutorial } from '../../lib/store/TutorialProvider';

/**
 * The guided tour's one piece of chrome.
 *
 * Non-modal by construction. There is no backdrop and nothing is trapped: the
 * layer itself does not take pointer events, so every click, drag and keystroke
 * lands on the page underneath. A reader can drop a file on the dropzone the
 * tour is currently pointing at, which is the whole point of pointing at it.
 *
 * What it draws:
 *   1. A glowing ring around the step's target — the pointing, nothing more.
 *   2. A tooltip beside it, positioned from the target's real geometry and the
 *      tooltip's own measured size, clamped inside the viewport.
 *   3. A hand-back note in the corner when a page's steps are spent.
 *
 * It never navigates. See `lib/tutorialSteps.js` for why that matters.
 */

/** Used until the tooltip has been measured once. */
const FALLBACK_TIP = { width: 320, height: 220 };
/** Space between the target's ring and the tooltip. */
const GAP = 16;
/** Space between the target and its ring. */
const PAD = 12;
/** Closest the tooltip may sit to a viewport edge. */
const MARGIN = 16;
/** How long to wait for a target that has not mounted yet. */
const TARGET_TIMEOUT = 4000;

export default function TutorialOverlay() {
  const {
    active,
    currentStep,
    continueHint,
    stepNumber,
    totalSteps,
    atStart,
    isLastStep,
    next,
    prev,
    stop,
  } = useTutorial();

  const [rect, setRect] = useState(null);
  const [side, setSide] = useState('bottom');
  // The tooltip's own box is needed to decide which side it fits on, so it is
  // state rather than a ref — it is read during render.
  const [tipSize, setTipSize] = useState(FALLBACK_TIP);
  const tipRef = useRef(null);
  const frame = useRef(0);
  // `measure` changes identity whenever the step or the tooltip's size does.
  // The effects below want to run when the *step* changes and not before, so
  // they reach the latest one through here instead of depending on it.
  const measureRef = useRef(null);

  // ----- Where the target is, and which side the tooltip fits on ----- //
  const measure = useCallback((sizeOverride) => {
    if (!currentStep) return;
    const el = document.querySelector(`[data-tutorial="${currentStep.target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    // A mounted-but-collapsed target is no better than a missing one.
    if (r.width === 0 && r.height === 0) {
      setRect(null);
      return;
    }
    setRect({ target: currentStep.target, top: r.top, left: r.left, width: r.width, height: r.height });

    const { width: tw, height: th } = sizeOverride || tipSize;
    let s = currentStep.placement || 'bottom';
    if (s === 'bottom' && r.bottom + GAP + th > window.innerHeight) s = 'top';
    else if (s === 'top' && r.top - GAP - th < 0) s = 'bottom';
    else if (s === 'left' && r.left - GAP - tw < 0) s = 'right';
    else if (s === 'right' && r.right + GAP + tw > window.innerWidth) s = 'left';
    setSide(s);
  }, [currentStep, tipSize]);

  useEffect(() => {
    measureRef.current = measure;
  }, [measure]);

  // ----- Find the target when the step changes ----- //
  // The element may not have mounted yet, so watch the DOM rather than polling
  // it on a timer. Scrolling happens here and only here: doing it inside
  // `measure` would let the scroll listener chase its own tail.
  useEffect(() => {
    if (!active || !currentStep) return;
    let cancelled = false;
    let observer = null;
    let timer = 0;

    const attempt = () => {
      if (cancelled) return true;
      const el = document.querySelector(`[data-tutorial="${currentStep.target}"]`);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      measureRef.current?.();
      return true;
    };

    if (!attempt()) {
      observer = new MutationObserver(() => {
        if (attempt()) {
          observer.disconnect();
          clearTimeout(timer);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      timer = setTimeout(() => observer?.disconnect(), TARGET_TIMEOUT);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      clearTimeout(timer);
    };
  }, [active, currentStep]);

  // ----- Follow the target as the page moves under it ----- //
  useEffect(() => {
    if (!active || !currentStep) return;
    const onMove = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => measureRef.current?.());
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [active, currentStep]);

  // ----- Measure the tooltip itself ----- //
  // Its height depends on how long the step's prose is, so the flip decision
  // above has to be made against the real box rather than a guessed one.
  useEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      setTipSize((before) => {
        if (Math.abs(before.height - size.height) <= 8 && Math.abs(before.width - size.width) <= 8) {
          return before;
        }
        // Reposition against the size just measured rather than waiting a
        // render for it to arrive as state.
        measureRef.current?.(size);
        return size;
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [currentStep, continueHint]);

  // Escape closes it. Arrow keys are deliberately left alone — the page owns
  // the keyboard while the tour is only talking.
  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (e.key === 'Escape') stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, stop]);

  if (!active) return null;

  // The hand-back note: this page is done, and moving on is the reader's move.
  if (continueHint) {
    return (
      <div className="tutorial-layer">
        <div ref={tipRef} className="tutorial-tooltip tutorial-tooltip--corner" role="note" aria-live="polite">
          <div className="mb-1 flex items-center gap-2">
            <Compass size={16} className="shrink-0 text-accent-400" />
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-accent-400/70">
              Tour paused
            </span>
            <button
              onClick={stop}
              className="ml-auto rounded-md p-1 text-white/30 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="End tutorial"
            >
              <X size={14} />
            </button>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-white/55">{continueHint}</p>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={prev}
              className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-white/50 transition-colors hover:bg-white/5 hover:text-white"
            >
              <ArrowLeft size={12} /> Back
            </button>
            <button
              onClick={stop}
              className="ml-auto text-[10px] font-bold uppercase tracking-[0.15em] text-white/30 transition-colors hover:text-white/60"
            >
              End tour
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!currentStep) return null;

  // Geometry from the previous step is not geometry for this one: the rect is
  // tagged with the target it was measured from, and a stale one reads as none.
  const fresh = rect && rect.target === currentStep.target ? rect : null;
  const spotlight = fresh
    ? {
        top: fresh.top - PAD,
        left: fresh.left - PAD,
        width: fresh.width + PAD * 2,
        height: fresh.height + PAD * 2,
      }
    : null;

  // Position from the measured tooltip, clamped so no edge can push it off
  // screen. Only `top`/`left` are set, so there is one way for it to be wrong.
  const style = {};
  if (spotlight) {
    const { width: tw, height: th } = tipSize;
    const clampX = (x) => Math.max(MARGIN, Math.min(x, window.innerWidth - tw - MARGIN));
    const clampY = (y) => Math.max(MARGIN, Math.min(y, window.innerHeight - th - MARGIN));
    switch (side) {
      case 'top':
        style.top = clampY(spotlight.top - GAP - th);
        style.left = clampX(spotlight.left);
        break;
      case 'left':
        style.top = clampY(spotlight.top);
        style.left = clampX(spotlight.left - GAP - tw);
        break;
      case 'right':
        style.top = clampY(spotlight.top);
        style.left = clampX(spotlight.left + spotlight.width + GAP);
        break;
      default:
        style.top = clampY(spotlight.top + spotlight.height + GAP);
        style.left = clampX(spotlight.left);
    }
  }

  return (
    <div className="tutorial-layer">
      {/* The pointing. No backdrop — clicks go straight through to the target. */}
      {spotlight && (
        <div
          className="tutorial-ring"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
          }}
        />
      )}

      {/* If the target never appeared, the tooltip parks in the corner rather
          than floating over the middle of the page with nothing to point at. */}
      <div
        ref={tipRef}
        className={`tutorial-tooltip${spotlight ? '' : ' tutorial-tooltip--corner'}`}
        style={spotlight ? style : undefined}
        role="note"
        aria-live="polite"
      >
        <div className="mb-1 flex items-center gap-2">
          <Compass size={16} className="shrink-0 text-accent-400" />
          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-accent-400/70">
            {stepNumber} of {totalSteps}
          </span>
          <button
            onClick={stop}
            className="ml-auto rounded-md p-1 text-white/30 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close tutorial"
          >
            <X size={14} />
          </button>
        </div>

        <h3 className="mt-1 text-sm font-bold text-white/90">{currentStep.title}</h3>
        <p className="mt-1.5 text-[12px] leading-relaxed text-white/50">{currentStep.body}</p>

        {!spotlight && (
          <p className="mt-2 text-[11px] text-white/30">
            This part of the screen isn&rsquo;t on the page yet.
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={prev}
            disabled={atStart}
            className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-white/50 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowLeft size={12} /> Back
          </button>
          <button
            onClick={next}
            className="flex items-center gap-1 rounded-lg bg-accent-500 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-on-accent transition-colors hover:bg-accent-400"
          >
            {isLastStep ? 'Finish' : 'Next'} <ArrowRight size={12} />
          </button>
          <button
            onClick={stop}
            className="ml-auto text-[10px] font-bold uppercase tracking-[0.15em] text-white/30 transition-colors hover:text-white/60"
          >
            Skip tour
          </button>
        </div>

        {/* Step progress dots */}
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === stepNumber - 1
                  ? 'w-4 bg-accent-400'
                  : i < stepNumber - 1
                    ? 'w-1.5 bg-accent-400/40'
                    : 'w-1.5 bg-white/15'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
