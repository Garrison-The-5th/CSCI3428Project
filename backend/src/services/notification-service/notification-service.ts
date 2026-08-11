/**
 * File: notification-service.ts
 * Description: Announces new course content to learners who had already finished.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { logger } from '@/config/logger';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import EmailService, { NewContentItem } from '@/services/email-service/email-service';

/**
 * Telling people a course they had already finished has grown.
 *
 * Only people who finished get a message: someone still working through a course
 * will meet the new modules on their way past, so mailing them is noise. Having
 * finished is exactly the state where new content would otherwise go unnoticed.
 *
 * Everything here is fire-and-forget. It is triggered by an author adding a
 * module or a quiz, and that edit has already been saved by the time this runs —
 * a mail outage must never turn into a failed save.
 */

/**
 * How long to wait after telling someone before telling them again.
 *
 * An author building out a section adds five modules in five minutes; without a
 * quiet period that is five emails about the same course. One message per course
 * per learner per day, and it names everything added since they finished rather
 * than only the module that triggered it, so nothing is lost by waiting.
 */
const QUIET_PERIOD_MS = 24 * 60 * 60 * 1000;

export default class NotificationService {
  /**
   * Emails everyone who has completed this course about what has appeared since.
   *
   * `completedAt` is per learner, so two people who finished at different times
   * correctly get different lists. Someone inside the quiet period is skipped
   * entirely and picks the omitted items up in their next message, because the
   * list is always computed from their completion date rather than from the last
   * mail.
   */
  static async announceNewContent(courseId: string) {
    try {
      const course = await CurriculumGateway.getCourseById(courseId);
      // Nothing to announce about a draft — nobody can have finished it.
      if (!course || !course.published || course.deletedAt) return;

      const completions = await CurriculumGateway.getCompletionsForCourse(courseId);
      const now = Date.now();

      for (const completion of completions) {
        if (completion.notifiedAt && now - completion.notifiedAt.getTime() < QUIET_PERIOD_MS) {
          continue;
        }

        const items = await NotificationService.newItemsSince(courseId, completion.completedAt);
        if (items.length === 0) continue;

        const delivery = await EmailService.sendNewContentEmail({
          to: completion.user.email,
          courseId,
          courseTitle: course.title,
          items,
        });

        // Only start the quiet period once something actually went out, so a
        // mail outage does not silently swallow the notice for a whole day.
        if (delivery.sent) {
          await CurriculumGateway.markCompletionNotified(completion.id);
        }
      }
    } catch (error) {
      logger.error({ err: error }, `Failed to announce new content for course ${courseId}`);
    }
  }

  /** Modules and published quizzes added to a course since a moment, in reading order. */
  static async newItemsSince(courseId: string, since: Date): Promise<NewContentItem[]> {
    const [modules, quizzes] = await Promise.all([
      CurriculumGateway.getModulesAddedSince(courseId, since),
      CurriculumGateway.getQuizzesAddedSince(courseId, since),
    ]);

    const sectionLabel = (section: { number: number; title: string } | null) =>
      section ? `${section.number}. ${section.title}` : 'Ungrouped';

    const newModuleIds = new Set(modules.map((module) => module.id));

    return [
      ...modules.map((module): NewContentItem => ({
        kind: 'module',
        number: module.number,
        title: module.title,
        section: sectionLabel(module.section),
      })),
      // A quiz inside a module that is itself new would be listed twice over —
      // the module line already covers it.
      ...quizzes
        .filter((quiz) => quiz.module && !newModuleIds.has(quiz.module.id))
        .map((quiz): NewContentItem => ({
          kind: 'quiz',
          number: quiz.module!.number,
          title: quiz.title,
          section: sectionLabel(quiz.module!.section),
        })),
    ];
  }
}
