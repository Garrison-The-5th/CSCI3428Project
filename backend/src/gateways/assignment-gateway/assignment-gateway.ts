/**
 * File: assignment-gateway.ts
 * Description: All database access for assignments.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { AssignmentType, CourseKind, QuizType } from '../../../generated/prisma';
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
  /** Replaces a link's token, which turns the old URL off. */
  static setTokenHash(id: string, tokenHash: string) {
    return prisma.assignment.update({ where: { id }, data: { tokenHash } });
  }

  static create(data: {
    type: AssignmentType;
    tokenHash: string;
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
      // The hash is only ever compared against; nothing outside needs it.
      omit: { tokenHash: true },
      where: {
        email,
        type: 'PLATFORM',
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { assignedAt: 'desc' },
    });
  }

  /**
   * Moves an address's private links onto its account, now that it has one.
   *
   * A link is how work reaches somebody who cannot sign in. Once they can, the
   * rule everywhere else is that the work belongs on their Learning and Quizzes
   * tabs — a link to an account holder is a second, forwardable key to it — and
   * the Learning tab lists PLATFORM assignments only, so a course they were
   * sent before signing up simply vanished from view the moment they did.
   *
   * Left alone:
   *   - revoked links: the author turned them off, and moving them would turn
   *     them back on;
   *   - a ONE_TIME quiz, and a quiz set holding one: those are only ever reached
   *     through the link, for account holders too (see AssignmentService.create).
   *
   * The token hash is kept. A PLATFORM token is refused with "sign in to reach
   * it", which is exactly what the old URL should now say. Safe to run more
   * than once: a second run finds nothing left to move.
   */
  static moveLinksToPlatform(email: string) {
    const oneTime = { type: QuizType.ONE_TIME, deletedAt: null };
    return prisma.assignment.updateMany({
      where: {
        email,
        type: 'LINK',
        revokedAt: null,
        NOT: [
          { quiz: { is: oneTime } },
          {
            course: {
              is: { sections: { some: { deletedAt: null, quizzes: { some: oneTime } } } },
            },
          },
        ],
      },
      data: { type: 'PLATFORM' },
    });
  }

  /** Looks a link up by its token. Returns the record even when revoked or expired
   *  so the caller can explain which it is. */
  static findByTokenHash(tokenHash: string) {
    return prisma.assignment.findUnique({
      where: { tokenHash },
      include: {
        course: { select: { id: true, title: true, published: true, deletedAt: true } },
        quiz: { select: { id: true, title: true, published: true, deletedAt: true } },
      },
    });
  }

  /** Everyone a course has been assigned to, most recent first, with who assigned it. */
  static listForCourse(courseId: string) {
    return prisma.assignment.findMany({
      // The hash is only ever compared against; nothing outside needs it.
      omit: { tokenHash: true },
      where: { courseId },
      orderBy: { assignedAt: 'desc' },
      include: withAssigner,
    });
  }

  /** Everyone a quiz has been assigned to on its own, most recent first. */
  static listForQuiz(quizId: string) {
    return prisma.assignment.findMany({
      // The hash is only ever compared against; nothing outside needs it.
      omit: { tokenHash: true },
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
      // The hash is only ever compared against; nothing outside needs it.
      omit: { tokenHash: true },
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

  /** One assignment with its assigner, or null. */
  static findById(id: string) {
    return prisma.assignment.findUnique({ where: { id }, include: withAssigner });
  }

  /** Stamps the link as revoked; it stops opening but the row is kept. */
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

  /** Permanently removes the assignment row. */
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

  /** Records that the link was just opened, for the "last accessed" column. */
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

  /**
   * When this person's copy of a quiz falls due, or null if it never does.
   *
   * A quiz reaches somebody one of two ways, and both are deadlines: handed over
   * on its own, or sitting inside a course that was handed over. The course
   * counts because a quiz inside one is due with it — so an exam in a lesson
   * closes when the lesson does, without anybody having assigned the exam.
   *
   * The latest of whatever applies wins. Where the same work arrived twice, the
   * later grant is the one that means anything; taking the earlier one would
   * close somebody out of a course that had just been re-assigned to them.
   *
   * A null due date on a live assignment is no deadline at all and beats every
   * date, which is why this cannot be written as an `orderBy` and a `take: 1`.
   */
  static async quizDeadlineFor(userId: number, quizId: string): Promise<Date | null> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return null;

    const owner = await prisma.quiz.findUnique({
      where: { id: quizId },
      select: { section: { select: { courseId: true } } },
    });
    const courseId = owner?.section?.courseId ?? null;

    const now = new Date();
    const assignments = await prisma.assignment.findMany({
      where: {
        email: user.email,
        revokedAt: null,
        // Two independent OR groups — still live, and reaches this quiz — so
        // they are spelled out under AND rather than as two `OR` keys, one of
        // which would silently overwrite the other.
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          { OR: courseId ? [{ quizId }, { courseId }] : [{ quizId }] },
        ],
      },
      select: { dueDate: true },
    });

    if (assignments.length === 0) return null;
    if (assignments.some((assignment) => assignment.dueDate === null)) return null;

    return assignments.reduce<Date | null>(
      (latest, assignment) =>
        latest === null || assignment.dueDate!.getTime() > latest.getTime()
          ? assignment.dueDate!
          : latest,
      null,
    );
  }

  /** Existing assignment for the same person and the same item, if there is one. */
  static findDuplicate(email: string, courseId: string | null, quizId: string | null) {
    return prisma.assignment.findFirst({
      where: { email, courseId, quizId, revokedAt: null },
    });
  }
}
