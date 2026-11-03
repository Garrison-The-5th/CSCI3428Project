/**
 * File: use-tour-target.ts
 * Description: Finds the element a tour step points at, waiting for pages that render
 *   it late, and falling back when it never comes.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */
import { useEffect, useState } from 'react';

import type { TourStep } from '@/components/tour/tour-steps';

/**
 * How long to wait for a target before giving up on it.
 *
 * Long enough for a slow dashboard read on a poor connection, short enough that
 * somebody whose target will never come is not left staring at a dimmed screen.
 * Most waits end far sooner — see `READY_ATTRIBUTE`.
 */
export const TARGET_TIMEOUT_MS = 5000;

/**
 * Set on a page once its data has loaded, so the tour knows that a target still
 * missing at that point is not coming and can fall back at once rather than
 * after the timeout. Home and Learning set it: their tutorial card is only
 * there when the tutorial is, and the fallback is the whole point.
 */
export const READY_ATTRIBUTE = 'data-tour-ready';

/** What the step is pointing at right now. */
export interface TourTargetState {
  /**
   * `searching` — not there yet, still waiting.
   * `primary` — found one of the step's own targets.
   * `fallback` — gave up on those and is using the step's fallback.
   * `missing` — nothing to point at; the card is centred.
   */
  mode: 'searching' | 'primary' | 'fallback' | 'missing';
  /** The spotlit elements: the main target first, then any `alsoHighlight`. */
  elements: HTMLElement[];
}

/** The first visible element carrying `data-tour="<name>"`. */
export function findTarget(name: string): HTMLElement | null {
  const matches = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const element of matches) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return element;
  }
  return null;
}

/**
 * Tracks the step's target as the page renders.
 *
 * Pages load their data before the things the tour points at exist — Home says
 * "Loading your learning..." first, Profile spins for a moment — so the target
 * is looked for again on every DOM change until it turns up. A
 * MutationObserver rather than polling, so a fast page is caught on the frame
 * it renders.
 *
 * Gives up, and falls back, when the page marks itself ready without the
 * target or when TARGET_TIMEOUT_MS passes. The tour must never leave somebody
 * behind an overlay pointing at nothing.
 *
 * `routeKey` restarts the search on navigation, because a step can span two
 * pages (the tutorial card is on Home or on Learning).
 */
export function useTourTarget(step: TourStep | null, routeKey: string): TourTargetState {
  const [state, setState] = useState<TourTargetState>({ mode: 'searching', elements: [] });

  useEffect(() => {
    if (!step?.target?.length) {
      setState({ mode: 'missing', elements: [] });
      return;
    }

    let settled = false;
    let gaveUp = false;

    /*
      Only ever changes state when something actually changed.

      The overlay renders into the same document this observes, so an update
      that always produced a new object would re-render the overlay, which is a
      DOM change, which would call this again.
    */
    const update = (mode: TourTargetState['mode'], elements: HTMLElement[]) =>
      setState((current) =>
        current.mode === mode && sameElements(current.elements, elements)
          ? current
          : { mode, elements },
      );

    /** The step's own targets, then its extras. */
    const lookPrimary = () => {
      for (const name of step.target!) {
        const element = findTarget(name);
        if (element) {
          const extras = (step.alsoHighlight ?? [])
            .map(findTarget)
            .filter((found): found is HTMLElement => found !== null);
          return [element, ...extras];
        }
      }
      return null;
    };

    const giveUp = () => {
      gaveUp = true;
      const fallbackElement = step.fallback?.target ? findTarget(step.fallback.target) : null;
      if (fallbackElement) update('fallback', [fallbackElement]);
      else update(step.fallback ? 'fallback' : 'missing', []);
    };

    const check = () => {
      const primary = lookPrimary();
      if (primary) {
        // Found late, after a fallback: switch to the real thing.
        settled = true;
        update('primary', primary);
        return;
      }
      if (gaveUp) {
        // Still keep the fallback's element fresh if it re-rendered.
        giveUp();
        return;
      }
      if (document.querySelector(`[${READY_ATTRIBUTE}]`)) giveUp();
    };

    update('searching', []);
    check();

    const observer = new MutationObserver(() => {
      if (settled && !lookPrimary()) {
        // The target went away (a re-render replaced it); look again.
        settled = false;
      }
      check();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-tour', READY_ATTRIBUTE],
    });

    const timer = window.setTimeout(() => {
      if (!settled) giveUp();
    }, TARGET_TIMEOUT_MS);

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [step, routeKey]);

  return state;
}

/** Same elements, same order. */
function sameElements(a: HTMLElement[], b: HTMLElement[]) {
  return a.length === b.length && a.every((element, index) => element === b[index]);
}
