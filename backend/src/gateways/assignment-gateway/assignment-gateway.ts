/**
 * File: assignment-gateway.ts
 * Description: All database access for assignments.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { AssignmentType } from '../../../generated/prisma';
import { prisma } from '../../../prisma/prisma-client';

/** The assigner, joined onto every author-facing read so mail can come from them. */
const withAssigner = {
  assignedBy: { select: { id: true, email: true, name: true } },
} as const;

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

  static restore(id: string) {
    return prisma.assignment.update({ where: { id }, data: { revokedAt: null } });
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
        where: { userId, element: { module: { courseId } } },
      }),
      prisma.moduleProgress.deleteMany({ where: { userId, module: { courseId } } }),
      prisma.quizAttempt.deleteMany({ where: { userId, quiz: { module: { courseId } } } }),
      prisma.quizSession.deleteMany({ where: { userId, quiz: { module: { courseId } } } }),
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

  /** Existing assignment for the same person and the same item, if there is one. */
  static findDuplicate(email: string, courseId: string | null, quizId: string | null) {
    return prisma.assignment.findFirst({
      where: { email, courseId, quizId, revokedAt: null },
    });
  }
}
