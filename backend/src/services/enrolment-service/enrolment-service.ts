/**
 * File: enrolment-service.ts
 * Description: What a signed-in learner is entitled to see.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import AssignmentGateway from '@/gateways/assignment-gateway/assignment-gateway';

/**
 * What a signed-in learner is entitled to see.
 *
 * Learning is assigned, not browsed: a published course is visible to someone
 * only once it has been given to their address as a PLATFORM assignment. LINK
 * assignments are excluded on purpose — that kind is delivered as a URL and is
 * meant to stay outside the platform, so being sent one never adds the course to
 * the sender's Learning page.
 *
 * Deliberately reads nothing but the assignment table, so every caller can
 * import it without dragging the curriculum and quiz services into a cycle.
 */
export interface Enrolment {
  courseIds: Set<string>;
  /** Quizzes handed over on their own, not the ones inside an enrolled course. */
  quizIds: Set<string>;
}

/**
 * What a signed-in person is enrolled on, by email address.
 *
 * Reads PLATFORM assignments only, and that is the whole point of the class.
 * A LINK assignment is deliberately invisible here: its token is the credential
 * and it is reached through its URL alone, so a one-off link must never turn
 * into a permanent enrolment just because the same person later signs in with
 * the address it was sent to.
 */
export default class EnrolmentService {
  static async forEmail(email: string): Promise<Enrolment> {
    const assignments = await AssignmentGateway.listPlatformForEmail(email.trim().toLowerCase());

    return {
      courseIds: new Set(
        assignments.map((a) => a.courseId).filter((id): id is string => Boolean(id)),
      ),
      quizIds: new Set(assignments.map((a) => a.quizId).filter((id): id is string => Boolean(id))),
    };
  }
}
