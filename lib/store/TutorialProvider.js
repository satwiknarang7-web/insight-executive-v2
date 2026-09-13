'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { TUTORIAL_STEPS, TOUR_COMPLETED_KEY } from '../tutorialSteps';

const TutorialContext = createContext(null);

/**
 * Context provider for the guided tour.
 *
 * Manages the current step, active/inactive state, and navigation. Consumed by
 * `TutorialOverlay` (which renders the spotlight and tooltip) and by any
 * component that wants a "start the tour" trigger.
 */
export function TutorialProvider({ children }) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const start = useCallback((fromStep = 0) => {
    setStepIndex(fromStep);
    setActive(true);
  }, []);

  const stop = useCallback(() => {
    setActive(false);
    setStepIndex(0);
    try {
      localStorage.setItem(TOUR_COMPLETED_KEY, '1');
    } catch {
      /* private mode */
    }
  }, []);

  const next = useCallback(() => {
    setStepIndex((i) => {
      if (i + 1 >= TUTORIAL_STEPS.length) {
        // Tour finished
        setActive(false);
        try {
          localStorage.setItem(TOUR_COMPLETED_KEY, '1');
        } catch {
          /* */
        }
        return 0;
      }
      return i + 1;
    });
  }, []);

  const prev = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const value = useMemo(
    () => ({
      active,
      stepIndex,
      steps: TUTORIAL_STEPS,
      currentStep: TUTORIAL_STEPS[stepIndex] ?? null,
      totalSteps: TUTORIAL_STEPS.length,
      start,
      stop,
      next,
      prev,
    }),
    [active, stepIndex, start, stop, next, prev]
  );

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
}

/** Hook to access the tutorial state and actions. */
export function useTutorial() {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error('useTutorial must be inside TutorialProvider');
  return ctx;
}
