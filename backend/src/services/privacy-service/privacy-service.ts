/**
 * File: privacy-service.ts
 * Description: Subject-access export and erasure of a learner's personal data.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { logSecurityEvent } from '@/config/logger';
import { NotFoundError } from '@/controllers/http-errors';

import { prisma } from '../../../prisma/prisma-client';

/**
 * Personal data, on demand.
 *
 * TTG Technology Standards §3.5.3 requires that "users have a method to remove
 * or export their data on demand". This platform holds named performance
 * records — who took what, when, and what they scored — which is exactly the
 * category that obligation exists for.
 *
 * Two deliberate boundaries:
 *
 * Export returns what is *about the person*, not everything they can see. A
 * learner's export contains their own progress and notes, not the course
 * content, which is company material rather than their personal data.
 *
 * Erasure removes the person, not the record that training happened. Completion
 * counts are what a compliance obligation rests on, so erasure anonymises the
 * `User` row rather than deleting the history outright — see `eraseUser`.
 */

export interface PersonalDataExport {
  exportedAt: string;
  /** What the export covers, in plain words, for the person reading it. */
  notice: string;
  account: {
    email: string;
    name: string | null;
    role: string | null;
    subscribed: boolean;
    lastSignInAt: string | null;
  };
  assignments: Array<{
    item: string;
    kind: 'course' | 'quiz';
    assignedAt: string;
    dueDate: string | null;
    lastAccessedAt: string | null;
  }>;
  moduleProgress: Array<{ module: string; course: string; viewedAt: string }>;
  quizAttempts: Array<{ quiz: string; score: number; total: number; completedAt: string }>;
  courseCompletions: Array<{ course: string; completedAt: string; moduleCount: number }>;
  notes: Array<{ course: string; module: string | null; body: string; createdAt: string }>;
}

export default class PrivacyService {
  /**
   * Everything held about one person, as a portable JSON document.
   *
   * Ids are resolved to titles on the way out. An export full of UUIDs would
   * technically satisfy the requirement and be useless to the person receiving
   * it, which is not what "a method to export their data" means.
   */
  static async exportUser(userId: number): Promise<PersonalDataExport> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        moduleViews: { include: { module: { include: { course: true } } } },
        quizAttempts: { include: { quiz: true } },
        completions: { include: { course: true } },
        notes: { include: { course: true } },
      },
    });

    if (!user) throw new NotFoundError('No account found for that id');

    const assignments = await prisma.assignment.findMany({
      where: { email: user.email },
      include: { course: true, quiz: true },
      orderBy: { assignedAt: 'asc' },
    });

    logSecurityEvent('data.exported', { userId, email: user.email });

    return {
      exportedAt: new Date().toISOString(),
      notice:
        'This file contains the personal data this learning platform holds about you: ' +
        'your account details, what you were assigned, what you have worked through, ' +
        'your quiz results and your own notes. It does not include course material, ' +
        'which belongs to the organisation rather than to you.',
      account: {
        email: user.email,
        name: user.name,
        role: user.role,
        subscribed: user.subscribed,
        lastSignInAt: user.lastSignInAt?.toISOString() ?? null,
      },
      assignments: assignments.map((assignment) => ({
        item: assignment.course?.title ?? assignment.quiz?.title ?? 'Removed item',
        kind: assignment.courseId ? ('course' as const) : ('quiz' as const),
        assignedAt: assignment.assignedAt.toISOString(),
        dueDate: assignment.dueDate?.toISOString() ?? null,
        lastAccessedAt: assignment.lastAccessedAt?.toISOString() ?? null,
      })),
      moduleProgress: user.moduleViews.map((view) => ({
        module: `${view.module.number} ${view.module.title}`,
        course: view.module.course.title,
        viewedAt: view.viewedAt.toISOString(),
      })),
      quizAttempts: user.quizAttempts.map((attempt) => ({
        quiz: attempt.quiz.title,
        score: attempt.score,
        total: attempt.total,
        completedAt: attempt.completedAt.toISOString(),
      })),
      courseCompletions: user.completions.map((completion) => ({
        course: completion.course.title,
        completedAt: completion.completedAt.toISOString(),
        moduleCount: completion.moduleCount,
      })),
      notes: user.notes.map((note) => ({
        course: note.course.title,
        module: note.moduleId,
        body: note.body,
        createdAt: note.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Erases the person while preserving the fact that training happened.
   *
   * Anonymisation rather than deletion, and the reason matters. This is a
   * compliance platform: an organisation may be required to show that a named
   * role completed an induction on a date, and hard-deleting the row would
   * destroy that evidence along with the personal data. So identifying fields
   * are replaced with a tombstone, notes (the learner's own writing, which is
   * personal and carries no compliance value) are deleted outright, and the
   * progress rows survive attached to an unidentifiable subject.
   *
   * The email is replaced rather than nulled because it is unique and non-null,
   * and because a future assignment to the same real address must create a
   * fresh person rather than reviving this one.
   */
  static async eraseUser(userId: number): Promise<{ anonymisedId: number; notesDeleted: number }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('No account found for that id');

    const tombstone = `erased-${userId}-${Date.now()}@erased.invalid`;

    const [notes] = await prisma.$transaction([
      // The learner's own writing goes entirely — it is personal, and no
      // compliance record depends on it.
      prisma.note.deleteMany({ where: { userId } }),
      // Assignments carry the address, so they are detached from the person too.
      prisma.assignment.updateMany({
        where: { email: user.email },
        data: { email: tombstone, revokedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          email: tombstone,
          name: null,
          subscribed: false,
          // Cleared so the row can never again be mistaken for a live account.
          lastSignInAt: null,
        },
      }),
    ]);

    logSecurityEvent('data.erased', {
      userId,
      reason: `anonymised; ${notes.count} notes deleted`,
    });

    return { anonymisedId: userId, notesDeleted: notes.count };
  }
}
