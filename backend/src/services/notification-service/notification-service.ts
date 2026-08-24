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
 * will meet the new sections on their way past, so mailing them is noise. Having
 * finished is exactly the state where new content would otherwise go unnoticed.
 *
 * Everything here is fire-and-forget. It is triggered by an author adding a
 * section or a quiz, and that edit has already been saved by the time this runs —
 * a mail outage must never turn into a failed save.
 */

/**
 * How long to wait after telling someone before telling them again.
 *
 * An author building out a module adds five sections in five minutes; without a
 * quiet period that is five emails about the same course. One message per course
 * per learner per day, and it names everything added since they finished rather
 * than only the section that triggered it, so nothing is lost by waiting.
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

  /** Sections and published quizzes added to a course since a moment, in reading order. */
  static async newItemsSince(courseId: string, since: Date): Promise<NewContentItem[]> {
    const [sections, quizzes] = await Promise.all([
      CurriculumGateway.getSectionsAddedSince(courseId, since),
      CurriculumGateway.getQuizzesAddedSince(courseId, since),
    ]);

    const moduleLabel = (module: { number: number; title: string } | null) =>
      module ? `${module.number}. ${module.title}` : 'Ungrouped';

    const newSectionIds = new Set(sections.map((section) => section.id));

    return [
      ...sections.map((section): NewContentItem => ({
        kind: 'section',
        number: section.number,
        title: section.title,
        module: moduleLabel(section.module),
      })),
      // A quiz inside a section that is itself new would be listed twice over —
      // the section line already covers it.
      ...quizzes
        .filter((quiz) => quiz.section && !newSectionIds.has(quiz.section.id))
        .map((quiz): NewContentItem => ({
          kind: 'quiz',
          number: quiz.section!.number,
          title: quiz.title,
          module: moduleLabel(quiz.section!.module),
        })),
    ];
  }
}
