/**
 * File: enrolment-service.ts
 * Description: What a signed-in learner is entitled to see.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */
import { endOfDueDay } from '@/config/validation';
import AssignmentGateway from '@/gateways/assignment-gateway/assignment-gateway';
import DefaultTutorialService from '@/services/default-tutorial-service/default-tutorial-service';

/**
 * What a signed-in learner is entitled to see.
 *
 * Learning is assigned, not browsed: a published course is visible to someone
 * only once it has been given to their address as a PLATFORM assignment. LINK
 * assignments are excluded on purpose — that kind is delivered as a URL and is
 * meant to stay outside the platform, so being sent one never adds the course to
 * the sender's Learning page.
 *
 * Plus one course nobody assigns: the default tutorial, which every account
 * holds. See `forEmail`.
 *
 * Deliberately reads nothing but the assignment table and the tutorial's id, so
 * every caller can import it without dragging the curriculum and quiz services
 * into a cycle.
 */
export interface Enrolment {
  courseIds: Set<string>;
  /** Quizzes handed over on their own, not the ones inside an enrolled course. */
  quizIds: Set<string>;
  /**
   * When this person's copy of each course is due, by course id.
   *
   * A deadline belongs to the assignment, not to the course: the same course
   * handed to one person on Monday and another on Friday falls due on two
   * different dates, and only the assignment knows which is whose. Every reader
   * of a learner's deadline goes through this map for that reason, and the
   * course's own `dueDate` is the fallback for anything that never went through
   * an assignment.
   *
   * A course assigned with no deadline appears here mapped to null, so callers
   * can tell "no deadline" apart from "not assigned".
   */
  dueByCourseId: Map<string, Date | null>;
  /** The same, for quizzes handed over on their own. */
  dueByQuizId: Map<string, Date | null>;
}

/**
 * The deadline that applies to one course or quiz for this person.
 *
 * An assignment always wins, including when it carries no deadline at all —
 * which is why this cannot be written as `map.get(id) ?? fallback`. "They were
 * given this with no deadline" and "they were never given this" are different
 * answers, and only the second should fall back to the date printed on the
 * course or quiz itself. That date is what remains for content reached without
 * an assignment behind it; letting it leak back in would hold somebody to a
 * course-wide deadline their own assignment had deliberately left open.
 */
export function dueFor(
  map: Map<string, Date | null>,
  id: string,
  fallback: Date | null,
): Date | null {
  return map.has(id) ? map.get(id)! : endOfDueDay(fallback);
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
  /**
   * Everything assigned on-platform to this address, with the deadline that applies to each course
   * and quiz (the newest assignment's, where one was assigned twice).
   */
  static async forEmail(email: string): Promise<Enrolment> {
    const [assignments, tutorialId] = await Promise.all([
      AssignmentGateway.listPlatformForEmail(email.trim().toLowerCase()),
      DefaultTutorialService.id(),
    ]);

    // Newest assignment first, so where the same item was handed over twice the
    // most recent deadline is the one that stands — that is what re-assigning
    // something is for. `listPlatformForEmail` orders by assignedAt desc, and a
    // Map keeps the first write per key.
    const dueByCourseId = new Map<string, Date | null>();
    const dueByQuizId = new Map<string, Date | null>();
    for (const assignment of assignments) {
      const due = endOfDueDay(assignment.dueDate);
      if (assignment.courseId && !dueByCourseId.has(assignment.courseId)) {
        dueByCourseId.set(assignment.courseId, due);
      }
      if (assignment.quizId && !dueByQuizId.has(assignment.quizId)) {
        dueByQuizId.set(assignment.quizId, due);
      }
    }

    /*
      The default tutorial, for everybody.

      Added here rather than as an assignment row per account: rows would have
      to be written for every account, and again for every account created
      afterwards, and the admin dashboard would then report the tutorial as
      learning somebody had handed out. Every reader of "what is this person
      on" — the Learning tab, one course, the dashboard, the quiz list, quiz
      access — goes through this method, so this one line is what makes the
      tutorial open everywhere rather than listing on Learning and refusing to
      open.

      Mapped to null — no deadline — so it is never overdue, never locked and
      never counted among required learning. Nothing can assign it (the
      assignment service refuses), so there is no assignment deadline here to
      overrule.
    */
    if (tutorialId && !dueByCourseId.has(tutorialId)) dueByCourseId.set(tutorialId, null);

    return {
      courseIds: new Set(dueByCourseId.keys()),
      quizIds: new Set(dueByQuizId.keys()),
      dueByCourseId,
      dueByQuizId,
    };
  }
}
