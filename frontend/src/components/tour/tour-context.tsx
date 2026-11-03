/**
 * File: tour-context.tsx
 * Description: Runs the first-login walkthrough — which step is showing, where it is
 *   saved, and moving the learner between pages as the script says.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */
import {
  cloneElement,
  createContext,
  ReactElement,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';

import TourOverlay, { TourOverlayProps } from '@/components/tour/tour-overlay';
import { TOUR_EVENT_PREFIX } from '@/components/tour/tour-signal';
import { TOUR_STEPS, TourAdvance, TourStep } from '@/components/tour/tour-steps';
import { useTourTarget } from '@/components/tour/use-tour-target';
import { useGuest } from '@/contexts/guest-context';
import { makeLearnerApi } from '@/services/learner-api';
import { TourState } from '@/services/tour-store';
import { logger } from '@/utils/logger';

/** How long the overlay takes to fade away when the tour ends. */
const EXIT_MS = 200;

/** Below this width the sidebar slides over the page rather than beside it. */
const SIDEBAR_OVERLAYS_BELOW = 835;

/**
 * Pages the tour never starts on: nobody is signed in there yet, or a link has
 * just failed and the page is explaining why.
 */
const NO_TOUR_PATHS = ['/login', '/about', '/public', '/unauthorized', '/a/'];

export interface TourContextValue {
  /** A step is on screen. */
  active: boolean;
  stepIndex: number;
  /** Starts from the top, for somebody who has never seen it. */
  start: () => void;
  /** Starts again from the top, whatever happened last time — the Profile page's button. */
  replay: () => void;
  skip: () => void;
  next: () => void;
  back: () => void;
}

const TourContext = createContext<TourContextValue | undefined>(undefined);

/** The walkthrough's controls. Outside a TourProvider every action does nothing. */
export function useTour(): TourContextValue {
  return useContext(TourContext) ?? INACTIVE;
}

const noop = () => undefined;
const INACTIVE: TourContextValue = {
  active: false,
  stepIndex: 0,
  start: noop,
  replay: noop,
  skip: noop,
  next: noop,
  back: noop,
};

/** Fills `:tutorial` in a route with the tutorial's id. */
export function resolveRoute(route: string, tutorialId: string | null): string | null {
  if (!route.includes(':tutorial')) return route;
  return tutorialId ? route.replace(':tutorial', tutorialId) : null;
}

/**
 * Whether a path is one of a step's routes. `:tutorial` matches the tutorial's
 * id, or any id while that is not known yet.
 */
export function routeMatches(route: string, pathname: string, tutorialId: string | null) {
  const match = matchPath({ path: route, end: true }, pathname);
  if (!match) return false;
  return !tutorialId || !match.params.tutorial || match.params.tutorial === tutorialId;
}

interface TourProviderProps {
  children: ReactNode;
  /**
   * The app shell is on screen for somebody who may take the tour — signed in,
   * or holding a working link. False on the sign-in page and while Keycloak is
   * still deciding.
   */
  enabled: boolean;
  /** The sidebar's state lives in `App`; the tour needs to open it for the menu steps. */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

/**
 * Plays `TOUR_STEPS`.
 *
 * Mounted inside the router, because it moves people between pages and has to
 * see where they went: `App` renders the `<Router>` itself, so this sits just
 * inside it, around the shell, rather than up with the other providers in
 * `index.tsx`. The sidebar's open state is passed in from `App`, which owns it.
 *
 * Starts itself once per page load when the visitor has never seen the tour
 * (NOT_STARTED), and resumes when they were part way through — on the right
 * page, at the right step, which is what makes a reload mid-tour harmless.
 * Where that state is kept is `LearnerApi`'s business, not this file's.
 *
 * The tour writes to its own state and nothing else. Opening items in the
 * player records progress, but that is the player doing what it always does
 * for a real course; the tour never presses Export, Erase or anything like it.
 */
export function TourProvider({
  children,
  enabled,
  sidebarOpen,
  setSidebarOpen,
}: TourProviderProps) {
  const { isGuest, token } = useGuest();
  // One instance per session rather than per render, so the callbacks below
  // that save the tour keep their identity between steps.
  const api = useMemo(() => makeLearnerApi(token), [token]);
  const navigate = useNavigate();
  const location = useLocation();

  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [tutorialId, setTutorialId] = useState<string | null>(null);
  /**
   * A route the tour itself is on its way to. While set, being somewhere else
   * is expected rather than a learner wandering off, so no "continue" card.
   */
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);
  const loaded = useRef(false);

  const step: TourStep | null = active ? TOUR_STEPS[stepIndex] : null;
  const pathname = location.pathname.replace(/\/+$/, '') || '/';

  const persist = useCallback(
    (state: TourState) => {
      api.saveTour(state).catch((err) => logger.error('could not save the tour', err));
    },
    [api],
  );

  /**
   * Shows a step, saving it and taking the learner to its page if they are not
   * there. `knownTutorialId` is for the first step after loading, when the id
   * has only just been read and is not in state yet.
   */
  const goTo = useCallback(
    (index: number, knownTutorialId: string | null = tutorialId) => {
      const target = TOUR_STEPS[index];
      setStepIndex(index);
      setActive(true);
      persist({ status: 'IN_PROGRESS', step: index });

      const here = target.routes.some((route) => routeMatches(route, pathname, knownTutorialId));
      if (!here) {
        const destination = resolveRoute(target.routes[0], knownTutorialId);
        if (destination) {
          setNavigatingTo(destination);
          navigate(destination);
        }
      }
    },
    [navigate, pathname, persist, tutorialId],
  );

  const start = useCallback(() => goTo(0), [goTo]);
  const replay = useCallback(() => goTo(0), [goTo]);

  const next = useCallback(() => {
    if (stepIndex >= TOUR_STEPS.length - 1) {
      setActive(false);
      persist({ status: 'COMPLETED', step: stepIndex });
      return;
    }
    goTo(stepIndex + 1);
  }, [goTo, persist, stepIndex]);

  const back = useCallback(() => {
    if (stepIndex > 0) goTo(stepIndex - 1);
  }, [goTo, stepIndex]);

  const skip = useCallback(() => {
    setActive(false);
    persist({ status: 'SKIPPED', step: stepIndex });
  }, [persist, stepIndex]);

  // Once per page load, as soon as the shell is up: start, resume, or stay away.
  const onTourPath = !NO_TOUR_PATHS.some((path) =>
    path.endsWith('/') ? pathname.startsWith(path) : pathname === path,
  );
  useEffect(() => {
    if (!enabled || !onTourPath || loaded.current) return;
    loaded.current = true;

    (async () => {
      try {
        const saved = await api.getTour();
        setTutorialId(saved.tutorialCourseId);
        // First visit: from the top. Part way through: the same step, on the
        // page it belongs on — which is what makes a reload mid-tour harmless.
        if (saved.status === 'NOT_STARTED') {
          goTo(0, saved.tutorialCourseId);
        } else if (saved.status === 'IN_PROGRESS') {
          const index = Math.min(Math.max(saved.step, 0), TOUR_STEPS.length - 1);
          goTo(index, saved.tutorialCourseId);
        }
      } catch (err) {
        // No tour is better than a broken one; the app works without it.
        logger.error('could not load the tour', err);
      }
    })();
    // Once per page load; `goTo` and the path are read as they are at that moment.
  }, [api, enabled, onTourPath]);

  // Arrived where the tour was taking them.
  useEffect(() => {
    if (navigatingTo && pathname === navigatingTo) setNavigatingTo(null);
  }, [navigatingTo, pathname]);

  const target = useTourTarget(step, pathname);
  const usingFallback = target.mode === 'fallback';
  const advance: TourAdvance | null = step
    ? usingFallback && step.fallback?.advance
      ? step.fallback.advance
      : step.advance
    : null;

  // "Do it to continue": the route they were asked to reach.
  useEffect(() => {
    if (!step || advance?.kind !== 'route') return;
    if (routeMatches(advance.to, pathname, tutorialId)) {
      setNavigatingTo(null);
      next();
    }
    // Only on navigation; `next` changes with the step and would re-fire this.
  }, [pathname]);

  // "Do it to continue": something a page reports with signalTour.
  useEffect(() => {
    if (!step || advance?.kind !== 'signal') return;
    const event = `${TOUR_EVENT_PREFIX}${advance.name}`;
    const onSignal = () => next();
    window.addEventListener(event, onSignal);
    return () => window.removeEventListener(event, onSignal);
  }, [advance, next, step]);

  /*
    The sidebar: open for the steps about it, and out of the way on a phone for
    the rest. On a wide screen it sits beside the page and is left as it is;
    on a narrow one it covers the page, so leaving it open would hide exactly
    what the step is pointing at.
  */
  useEffect(() => {
    if (!step) return;
    if (step.sidebar || target.elements.some((element) => element.closest('.app-sidebar'))) {
      if (!sidebarOpen) setSidebarOpen(true);
    } else if (sidebarOpen && window.innerWidth < SIDEBAR_OVERLAYS_BELOW) {
      setSidebarOpen(false);
    }
    // Driven by the step and what it found, not by every toggle of the sidebar.
  }, [step, target.elements]);

  const value = useMemo(
    () => ({ active, stepIndex, start, replay, skip, next, back }),
    [active, stepIndex, start, replay, skip, next, back],
  );

  // Somewhere the step is not, and not because the tour sent them or because
  // they just did what the step asked: offer the way back.
  const offPath =
    step !== null &&
    navigatingTo === null &&
    !step.routes.some((route) => routeMatches(route, pathname, tutorialId)) &&
    !(advance?.kind === 'route' && routeMatches(advance.to, pathname, tutorialId));

  let overlay: ReactElement<TourOverlayProps> | null = null;
  if (step && enabled && onTourPath) {
    if (offPath) {
      const destination = resolveRoute(step.routes[0], tutorialId);
      overlay = (
        <TourOverlay
          targets={[]}
          title="Continue the tour?"
          body="You have left the page the tour was on. Pick up where you left off, or skip the rest."
          stepNumber={stepIndex + 1}
          stepCount={TOUR_STEPS.length}
          actionLabel={destination ? 'Continue tour' : null}
          onAction={() => {
            if (!destination) return;
            setNavigatingTo(destination);
            navigate(destination);
          }}
          onSkip={skip}
          interactive={false}
        />
      );
    } else {
      const body =
        usingFallback && step.fallback
          ? step.fallback.body
          : (isGuest && step.guestBody) || step.body;
      const waits = advance?.kind === 'route' || advance?.kind === 'signal';
      overlay = (
        <TourOverlay
          targets={target.elements}
          title={step.title}
          body={body}
          stepNumber={stepIndex + 1}
          stepCount={TOUR_STEPS.length}
          actionLabel={
            waits ? null : (step.actionLabel ?? (advance?.kind === 'finish' ? 'Finish' : 'Next'))
          }
          onAction={next}
          onBack={stepIndex > 0 ? back : undefined}
          onSkip={skip}
          interactive={waits}
          searching={target.mode === 'searching'}
        />
      );
    }
  }

  /*
    When the tour ends — Finish, Skip, or a page it does not run on — the last
    overlay stays up a moment, marked as leaving, so it fades out rather than
    vanishing. Same element in the same place, so it keeps its state.
  */
  const lastOverlay = useRef<ReactElement<TourOverlayProps> | null>(null);
  const [, setExitDone] = useState(0);
  const showing = overlay !== null;
  if (overlay) lastOverlay.current = overlay;
  useEffect(() => {
    if (showing || !lastOverlay.current) return;
    const timer = window.setTimeout(() => {
      lastOverlay.current = null;
      setExitDone((count) => count + 1);
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [showing]);
  const rendered =
    overlay ?? (lastOverlay.current ? cloneElement(lastOverlay.current, { leaving: true }) : null);

  return (
    <TourContext.Provider value={value}>
      {children}
      {rendered}
    </TourContext.Provider>
  );
}
