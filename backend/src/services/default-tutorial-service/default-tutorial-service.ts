/**
 * File: default-tutorial-service.ts
 * Description: The one course everybody has, and the rules that keep it there.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */
import { ForbiddenError } from '@/controllers/http-errors';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';

/**
 * The default tutorial: a real course, edited like any other, that every
 * account and every link holder has without anyone assigning it.
 *
 * It reaches people through enrolment rather than through assignment rows. One
 * row per account would not scale and would miss every account created after
 * it was written, so `EnrolmentService` and the guest catalogue add it to what
 * each person holds instead. No assignment row ever names it, which is also
 * what keeps it out of the admin dashboard's figures: those count assignments.
 *
 * Deliberately imports nothing but a gateway. Enrolment, the curriculum
 * service and the assignment service all ask it questions, and any service
 * import here would put it in a cycle with one of them. Creating the course,
 * which does need the services, lives apart in `default-tutorial-bootstrap.ts`.
 */

/**
 * The id, once known.
 *
 * Read on every enrolment lookup, which is every learner request, so it is
 * remembered for the life of the process after the first hit. Safe because the
 * id cannot change: the course cannot be deleted, and the partial unique index
 * forbids a second one. A miss is not remembered, so a process that started
 * before the bootstrap finished picks the course up on its next request.
 */
let cachedId: string | null = null;

export default class DefaultTutorialService {
  /** The default tutorial's course id, or null if it does not exist yet. */
  static async id(): Promise<string | null> {
    if (cachedId) return cachedId;
    cachedId = await CurriculumGateway.getDefaultTutorialId();
    return cachedId;
  }

  /** Whether this course is the default tutorial. */
  static async is(courseId: string): Promise<boolean> {
    return (await DefaultTutorialService.id()) === courseId;
  }

  /** Forgets the remembered id. For tests, which create and drop courses freely. */
  static clearCache() {
    cachedId = null;
  }

  /**
   * Refuses something nobody may do to the tutorial.
   *
   * Every account is enrolled on it and the walkthrough walks people into it,
   * so deleting, unpublishing or re-kinding it would break the first thing a
   * new user is shown. Refused here, in the service, rather than only hidden in
   * the editor: the API is reachable without the editor, and a rule that lives
   * in a button is a rule a script can step around.
   *
   * A 403 rather than a 400 because nothing about the request can be fixed —
   * it is refused for everyone, admins included.
   */
  static async assertNotTutorial(courseId: string, action: TutorialProtectedAction) {
    if (await DefaultTutorialService.is(courseId)) {
      throw new ForbiddenError(PROTECTED_MESSAGES[action]);
    }
  }
}

/** The things nobody may do to the default tutorial. */
export type TutorialProtectedAction = 'delete' | 'unpublish' | 'kind' | 'assign';

const PROTECTED_MESSAGES: Record<TutorialProtectedAction, string> = {
  delete: 'The default tutorial cannot be deleted — every account depends on it.',
  unpublish: 'The default tutorial cannot be unpublished — every account depends on it.',
  kind: 'The default tutorial must stay a lesson.',
  assign: 'The default tutorial cannot be assigned — everybody already has it, with no deadline.',
};
