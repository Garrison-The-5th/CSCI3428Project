/**
 * File: tour-service.ts
 * Description: Where a signed-in person is in the first-login walkthrough.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */
import { boundedInteger, TOUR_STEP_COUNT } from '@/config/validation';
import { NotFoundError } from '@/controllers/http-errors';
import AuthGateway from '@/gateways/auth-gateway/auth-gateway';
import DefaultTutorialService from '@/services/default-tutorial-service/default-tutorial-service';

import { TourStatus } from '../../../generated/prisma';

/** What the browser is told, and what it sends back. */
export interface TourState {
  status: TourStatus;
  step: number;
  /**
   * The course the walkthrough hands people into. Null before the tutorial has
   * been created, in which case the tour's course steps fall back to a card.
   */
  tutorialCourseId: string | null;
}

const STATUSES = Object.values(TourStatus) as string[];

/**
 * The walkthrough's state for signed-in users, kept on their User row so it
 * follows them from one device to the next.
 *
 * Guests have no row of their own to keep it on that is theirs alone — a link
 * acts as whoever owns the address — so theirs lives in the browser instead;
 * see `tour-store.ts` on the frontend. Nothing here is reachable with a link.
 *
 * The step is checked against the script's length rather than trusted, and so
 * is the status: a PUT that stored step 400 would leave the browser resuming a
 * tour at a step that does not exist.
 */
export default class TourService {
  /** Where this person is in the tour. */
  static async get(userId: number): Promise<TourState> {
    const [row, tutorialCourseId] = await Promise.all([
      AuthGateway.getTour(userId),
      DefaultTutorialService.id(),
    ]);
    if (!row) throw new NotFoundError('No such user');
    return { status: row.tourStatus, step: row.tourStep, tutorialCourseId };
  }

  /**
   * Records where this person is.
   *
   * Finishing and skipping keep the step they stopped at, which costs nothing
   * and says how far a skipper got. Replay is a PUT of IN_PROGRESS at step 0 —
   * there is no separate route for it, because it is not a separate state.
   */
  static async save(userId: number, body: unknown): Promise<TourState> {
    const { status, step } = TourService.parse(body);
    const [row, tutorialCourseId] = await Promise.all([
      AuthGateway.setTour(userId, status, step),
      DefaultTutorialService.id(),
    ]);
    return { status: row.tourStatus, step: row.tourStep, tutorialCourseId };
  }

  /** Validates a PUT body: a known status and a step inside the script. */
  static parse(body: unknown): { status: TourStatus; step: number } {
    const { status, step } = (body ?? {}) as { status?: unknown; step?: unknown };

    if (typeof status !== 'string' || !STATUSES.includes(status)) {
      throw new Error(`status must be one of ${STATUSES.join(', ')}`);
    }

    // A missing step is not step 0: an IN_PROGRESS write without one would
    // silently send somebody back to the start.
    if (step === undefined || step === null || step === '') {
      throw new Error('step is required');
    }

    return {
      status: status as TourStatus,
      step: boundedInteger(step, { min: 0, max: TOUR_STEP_COUNT - 1, label: 'step' }),
    };
  }
}
