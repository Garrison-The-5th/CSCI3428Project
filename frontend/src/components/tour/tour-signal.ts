/**
 * File: tour-signal.ts
 * Description: Lets a page tell the walkthrough that the learner did the thing a step
 *   is waiting for.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */

/** Prefix on the window events the tour listens for. */
export const TOUR_EVENT_PREFIX = 'tour:';

/**
 * Reports that the learner did something a tour step may be waiting for.
 *
 * Most "do it to continue" steps wait for a route, which the tour can see for
 * itself. A few things worth teaching move nothing in the URL — stepping through
 * the course player is one — so the page says so instead. A window event rather
 * than a context call, so a page needs no knowledge of the tour beyond this one
 * import, and saying it while no tour is running costs nothing.
 */
export function signalTour(name: string) {
  window.dispatchEvent(new CustomEvent(`${TOUR_EVENT_PREFIX}${name}`));
}
