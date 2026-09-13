'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { X, ArrowLeft, ArrowRight, Compass } from 'lucide-react';
import { useTutorial } from '../../lib/store/TutorialProvider';

/**
 * Full-screen guided-tour overlay.
 *
 * When the tutorial is active it renders:
 *   1. A dark backdrop with a transparent "spotlight" cut-out over the target.
 *   2. A teal-glowing ring around the target element.
 *   3. An animated tooltip beside the target with step info and navigation.
 *
 * Navigation between pages is handled automatically: if the next step is on a
 * different route, the overlay pushes to that route and waits for the target
 * element to appear in the DOM before positioning.
 */
export default function TutorialOverlay() {
  const { active, currentStep, stepIndex, totalSteps, next, prev, stop } = useTutorial();
  const router = useRouter();
  const pathname = usePathname();

  const [rect, setRect] = useState(null);
  const [tooltipSide, setTooltipSide] = useState('bottom');
  const [navigating, setNavigating] = useState(false);
  const overlayRef = useRef(null);
  const pollRef = useRef(null);

  // ----- Locate the target element and track its position ----- //
  const findAndTrack = useCallback(() => {
    if (!currentStep) return;
    const el = document.querySelector(`[data-tutorial="${currentStep.target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });

    // Decide tooltip side — prefer step's placement, but flip if clipped.
    const pad = 280; // tooltip approximate height
    let side = currentStep.placement || 'bottom';
    if (side === 'bottom' && r.bottom + pad > window.innerHeight) side = 'top';
    if (side === 'top' && r.top - pad < 0) side = 'bottom';
    if (side === 'left' && r.left - 340 < 0) side = 'right';
    if (side === 'right' && r.right + 340 > window.innerWidth) side = 'left';
    setTooltipSide(side);

    // Scroll the element into view if needed.
    if (r.top < 0 || r.bottom > window.innerHeight) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentStep]);

  // When the active step changes, navigate if needed, then poll for the target.
  useEffect(() => {
    if (!active || !currentStep) return;

    // If step is on a different page, navigate first.
    if (currentStep.page && currentStep.page !== pathname) {
      setNavigating(true);
      router.push(currentStep.page);
      return; // the pathname change will re-trigger this effect
    }
    setNavigating(false);

    // Poll until the target appears (it may mount after navigation / render).
    let attempts = 0;
    const maxAttempts = 40; // 40 × 100ms = 4s
    clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      const el = document.querySelector(`[data-tutorial="${currentStep.target}"]`);
      if (el || attempts >= maxAttempts) {
        clearInterval(pollRef.current);
        findAndTrack();
      }
      attempts++;
    }, 100);

    return () => clearInterval(pollRef.current);
  }, [active, currentStep, pathname, router, findAndTrack]);

  // Reposition on scroll / resize.
  useEffect(() => {
    if (!active) return;
    const handler = () => findAndTrack();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [active, findAndTrack]);

  // Close on Escape.
  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (e.key === 'Escape') stop();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, stop, next, prev]);

  if (!active || !currentStep) return null;

  // Spotlight geometry — 8px padding around the target.
  const pad = 12;
  const spotlight = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  // Tooltip position relative to the spotlight.
  const tooltipStyle = {};
  if (spotlight) {
    const gap = 16;
    switch (tooltipSide) {
      case 'bottom':
        tooltipStyle.top = spotlight.top + spotlight.height + gap;
        tooltipStyle.left = Math.max(16, Math.min(spotlight.left, window.innerWidth - 340));
        break;
      case 'top':
        tooltipStyle.bottom = window.innerHeight - spotlight.top + gap;
        tooltipStyle.left = Math.max(16, Math.min(spotlight.left, window.innerWidth - 340));
        break;
      case 'left':
        tooltipStyle.top = spotlight.top;
        tooltipStyle.right = window.innerWidth - spotlight.left + gap;
        break;
      case 'right':
        tooltipStyle.top = spotlight.top;
        tooltipStyle.left = spotlight.left + spotlight.width + gap;
        break;
    }
  } else {
    // Target not found — center the tooltip.
    tooltipStyle.top = '50%';
    tooltipStyle.left = '50%';
    tooltipStyle.transform = 'translate(-50%, -50%)';
  }

  return (
    <div
      ref={overlayRef}
      className="tutorial-overlay"
      onClick={(e) => {
        // Click on backdrop (not tooltip) dismisses the tour.
        if (e.target === overlayRef.current) stop();
      }}
      aria-modal="true"
      role="dialog"
      aria-label="Guided tour"
    >
      {/* SVG backdrop with spotlight cutout */}
      <svg className="tutorial-backdrop" aria-hidden="true">
        <defs>
          <mask id="tutorial-mask">
            <rect width="100%" height="100%" fill="white" />
            {spotlight && (
              <rect
                x={spotlight.left}
                y={spotlight.top}
                width={spotlight.width}
                height={spotlight.height}
                rx={12}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.6)"
          mask="url(#tutorial-mask)"
        />
      </svg>

      {/* Glow ring around target */}
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

      {/* Tooltip */}
      <div className="tutorial-tooltip" style={tooltipStyle}>
        <div className="flex items-center gap-2 mb-1">
          <Compass size={16} className="text-accent-400 shrink-0" />
          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-accent-400/70">
            {stepIndex + 1} of {totalSteps}
          </span>
          <button
            onClick={stop}
            className="ml-auto rounded-md p-1 text-white/30 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close tutorial"
          >
            <X size={14} />
          </button>
        </div>

        <h3 className="text-sm font-bold text-white/90 mt-1">{currentStep.title}</h3>
        <p className="text-[12px] leading-relaxed text-white/50 mt-1.5">{currentStep.body}</p>

        {navigating && (
          <p className="text-[11px] text-accent-400/60 mt-2 animate-pulse">Navigating…</p>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={prev}
            disabled={stepIndex === 0}
            className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-white/50 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowLeft size={12} /> Back
          </button>
          <button
            onClick={next}
            className="flex items-center gap-1 rounded-lg bg-accent-500 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-on-accent transition-colors hover:bg-accent-400"
          >
            {stepIndex + 1 === totalSteps ? 'Finish' : 'Next'} <ArrowRight size={12} />
          </button>
          <button
            onClick={stop}
            className="ml-auto text-[10px] font-bold uppercase tracking-[0.15em] text-white/30 transition-colors hover:text-white/60"
          >
            Skip tour
          </button>
        </div>

        {/* Step progress dots */}
        <div className="flex items-center gap-1.5 mt-3 justify-center">
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === stepIndex
                  ? 'w-4 bg-accent-400'
                  : i < stepIndex
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
