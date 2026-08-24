/**
 * File: assignment-gateway.ts
 * Description: All database access for assignments.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { AssignmentType, CourseKind } from '../../../generated/prisma';
import { prisma } from '../../../prisma/prisma-client';

/** The assigner, joined onto every author-facing read so mail can come from them. */
const withAssigner = {
  assignedBy: { select: { id: true, email: true, name: true } },
} as const;

/**
 * Every read and write of the `Assignment` table — who was given what, and how.
 *
 * An assignment is one course or one quiz handed to one address, so somebody
 * given three courses has three rows and three separate links. Author-facing
 * reads join `withAssigner` above, because mail about an assignment goes out as
 * the person who set it rather than from a system mailbox.
 */
export default class AssignmentGateway {
  static create(data: {
    type: AssignmentType;
    token: string;
    email: string;
    courseId?: string | null;
    quizId?: string | null;
    assignedById?: number | null;
    dueDate?: Date | null;
    expiresAt?: Date | null;
  }) {
    return prisma.assignment.create({ data });
  }

  /**
   * Stamps a successful send and advances the rate-limit counters.
   *
   * The window is rolling and opened by the first mail in it: `windowStart` is
   * passed in by the caller, which has already decided whether the previous
   * window had expired. Counting here rather than in the service keeps the write
   * atomic with the stamp, so two resends racing cannot both read a count of 0.
   */
  static markNotified(id: string, windowStart: Date, count: number) {
    return prisma.assignment.update({
      where: { id },
      data: { notifiedAt: new Date(), notifyWindowStart: windowStart, notifyCount: count },
    });
  }

  /**
   * What a signed-in learner is enrolled on. Only PLATFORM assignments count —
   * a link handed to this address is deliberately invisible here, so a one-off
   * URL never turns into a permanent enrolment.
   */
  static listPlatformForEmail(email: string) {
    const now = new Date();
    return prisma.assignment.findMany({
      where: {
        email,
        type: 'PLATFORM',
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { assignedAt: 'desc' },
    });
  }

  /** Looks a link up by its token. Returns the record even when revoked or expired
   *  so the caller can explain which it is. */
  static findByToken(token: string) {
    return prisma.assignment.findUnique({
      where: { token },
      include: {
        course: { select: { id: true, title: true, published: true, deletedAt: true } },
        quiz: { select: { id: true, title: true, published: true, deletedAt: true } },
      },
    });
  }

  static listForCourse(courseId: string) {
    return prisma.assignment.findMany({
      where: { courseId },
      orderBy: { assignedAt: 'desc' },
      include: withAssigner,
    });
  }

  static listForQuiz(quizId: string) {
    return prisma.assignment.findMany({
      where: { quizId },
      orderBy: { assignedAt: 'desc' },
      include: withAssigner,
    });
  }

  /**
   * Every assignment, optionally only those one person handed out.
   *
   * `assignedById` null means no scoping, which is what an admin gets — and has
   * to, because assignments created before that column existed have no assigner
   * and would otherwise be invisible to everyone.
   */
  static listAll(assignedById: number | null) {
    return prisma.assignment.findMany({
      where: assignedById === null ? {} : { assignedById },
      orderBy: { assignedAt: 'desc' },
      include: withAssigner,
    });
  }

  /** Every course that has been handed to at least one person, for the admin view. */
  static async listAssignedCourseIds() {
    const rows = await prisma.assignment.groupBy({
      by: ['courseId'],
      where: { courseId: { not: null } },
      _count: { _all: true },
    });
    return rows.map((row) => ({ courseId: row.courseId!, count: row._count._all }));
  }

  static findById(id: string) {
    return prisma.assignment.findUnique({ where: { id }, include: withAssigner });
  }

  static revoke(id: string) {
    return prisma.assignment.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  /**
   * Turns a link back on, and gives a completed one its result view back — see
   * `AssignmentService.restore` for why that comes with it rather than being a
   * separate switch.
   */
  static restore(id: string) {
    return prisma.assignment.update({
      where: { id },
      data: { revokedAt: null, resultsSeenAt: null },
    });
  }

  /** Records that the one visit a completed link still had has been used. */
  static markResultsSeen(id: string) {
    return prisma.assignment.update({ where: { id }, data: { resultsSeenAt: new Date() } });
  }

  /** Only the due date is editable after the fact; the rest defines the grant. */
  static setDueDate(id: string, dueDate: Date | null) {
    return prisma.assignment.update({ where: { id }, data: { dueDate } });
  }

  static delete(id: string) {
    return prisma.assignment.delete({ where: { id } });
  }

  /**
   * Wipes everything this person has done inside one course.
   *
   * Taking a course away takes the record of working through it too, so
   * re-assigning starts them from nothing rather than dropping them back at the
   * end of a course they can no longer remember. The completion row goes with it,
   * or a re-assignment would immediately look finished.
   */
  static clearCourseProgress(userId: number, courseId: string) {
    return prisma.$transaction([
      prisma.elementProgress.deleteMany({
        where: { userId, element: { section: { courseId } } },
      }),
      prisma.sectionProgress.deleteMany({ where: { userId, section: { courseId } } }),
      prisma.quizAttempt.deleteMany({ where: { userId, quiz: { section: { courseId } } } }),
      prisma.quizSession.deleteMany({ where: { userId, quiz: { section: { courseId } } } }),
      prisma.courseCompletion.deleteMany({ where: { userId, courseId } }),
    ]);
  }

  /** The same, for a quiz handed over on its own. */
  static clearQuizProgress(userId: number, quizId: string) {
    return prisma.$transaction([
      prisma.quizAttempt.deleteMany({ where: { userId, quizId } }),
      prisma.quizSession.deleteMany({ where: { userId, quizId } }),
    ]);
  }

  static touch(id: string) {
    return prisma.assignment.update({ where: { id }, data: { lastAccessedAt: new Date() } });
  }

  /**
   * Closes whatever links handed this quiz to this person, once they have handed
   * it in. Only one-time quizzes call this.
   *
   * Keyed on the address rather than on a single assignment id because the
   * submission arrives from either the link or a signed-in session, and both are
   * the same person as far as the User row is concerned. `updateMany` so a quiz
   * completed without any assignment behind it — an author trying their own — is
   * a no-op rather than a failure.
   */
  static async markQuizCompleted(userId: number, quizId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return { count: 0 };

    // A one-time link may now be the whole of a quiz set, and a set is handed
    // over as a link to the *course* — so the assignment carrying it names the
    // course and leaves `quizId` null. Matching on the quiz alone would leave
    // that link recorded as outstanding for ever, however long ago the paper
    // went in.
    //
    // Safe to close the course row because a one-time link is the only quiz in
    // its set, which QuizService and CurriculumService both enforce; the kind is
    // still checked here rather than assumed, so a lesson that somehow held one
    // could not close itself off the back of a single quiz.
    const owner = await prisma.quiz.findUnique({
      where: { id: quizId },
      select: { section: { select: { course: { select: { id: true, kind: true } } } } },
    });
    const course = owner?.section?.course;
    const courseId = course?.kind === CourseKind.QUIZ_SET ? course.id : null;

    return prisma.assignment.updateMany({
      where: {
        email: user.email,
        completedAt: null,
        OR: courseId ? [{ quizId }, { courseId }] : [{ quizId }],
      },
      data: { completedAt: new Date() },
    });
  }

  /** Existing assignment for the same person and the same item, if there is one. */
  static findDuplicate(email: string, courseId: string | null, quizId: string | null) {
    return prisma.assignment.findFirst({
      where: { email, courseId, quizId, revokedAt: null },
    });
  }
}
