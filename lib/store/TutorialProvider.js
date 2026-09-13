'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { TUTORIAL_STEPS, PAGE_ADVANCE, TOUR_COMPLETED_KEY } from '../tutorialSteps';

const TutorialContext = createContext(null);

/**
 * State for the guided tour.
 *
 * The tour is *armed*, not *running*: it knows which page the reader is on and
 * offers the steps that belong to that page, one at a time. It never routes.
 * When a page's steps run out it says how to carry on and then waits, staying
 * armed across navigation until the reader arrives somewhere it can speak
 * again — or dismisses it.
 *
 * Consumed by `TutorialOverlay`, which draws the ring and the tooltip, and by
 * anything that wants a "start the tour" trigger.
 */
export function TutorialProvider({ children }) {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [cursor, setCursor] = useState(0);
  // True once this page's steps are spent and the hand-back note is showing.
  const [handedBack, setHandedBack] = useState(false);

  const pageSteps = useMemo(
    () => TUTORIAL_STEPS.filter((step) => step.page === pathname),
    [pathname]
  );

  // Arriving somewhere new restarts that page's steps. The tour survives the
  // journey; a position within one page does not. Adjusted during render rather
  // than in an effect, so the reader never sees one frame of the old page's
  // step against the new page's DOM.
  const [anchor, setAnchor] = useState(pathname);
  if (anchor !== pathname) {
    setAnchor(pathname);
    setCursor(0);
    setHandedBack(false);
  }

  const finish = useCallback(() => {
    setActive(false);
    setCursor(0);
    setHandedBack(false);
    try {
      localStorage.setItem(TOUR_COMPLETED_KEY, '1');
    } catch {
      /* private mode */
    }
  }, []);

  const start = useCallback(() => {
    setCursor(0);
    setHandedBack(false);
    setActive(true);
  }, []);

  const next = useCallback(() => {
    if (cursor + 1 < pageSteps.length) {
      setCursor(cursor + 1);
      return;
    }
    // Out of steps here. Either there is somewhere left to send them — in which
    // case the tour says so and waits — or this was the last page of the tour.
    if (PAGE_ADVANCE[pathname]) setHandedBack(true);
    else finish();
  }, [cursor, pageSteps.length, pathname, finish]);

  const prev = useCallback(() => {
    if (handedBack) {
      setHandedBack(false);
      return;
    }
    setCursor((i) => Math.max(0, i - 1));
  }, [handedBack]);

  const currentStep = active && !handedBack ? (pageSteps[cursor] ?? null) : null;
  const continueHint = active && handedBack ? (PAGE_ADVANCE[pathname] ?? null) : null;

  const value = useMemo(
    () => ({
      active,
      currentStep,
      continueHint,
      // Numbered against the whole tour, so "4 of 8" still means something
      // after the reader has crossed a page boundary.
      stepNumber: currentStep ? TUTORIAL_STEPS.indexOf(currentStep) + 1 : 0,
      totalSteps: TUTORIAL_STEPS.length,
      atStart: cursor === 0 && !handedBack,
      isLastStep:
        currentStep != null &&
        cursor + 1 >= pageSteps.length &&
        !PAGE_ADVANCE[pathname],
      start,
      stop: finish,
      next,
      prev,
    }),
    [active, currentStep, continueHint, cursor, handedBack, pageSteps.length, pathname, start, finish, next, prev]
  );

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
}

/** Hook to access the tutorial state and actions. */
export function useTutorial() {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error('useTutorial must be inside TutorialProvider');
  return ctx;
}
