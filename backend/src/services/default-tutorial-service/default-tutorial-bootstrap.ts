/**
 * File: default-tutorial-bootstrap.ts
 * Description: Creates and publishes the default tutorial if it does not exist yet.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */
import { logger } from '@/config/logger';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import CurriculumService from '@/services/curriculum-service/curriculum-service';
import DefaultTutorialService from '@/services/default-tutorial-service/default-tutorial-service';
import PublicationService from '@/services/publication-service/publication-service';

import { Prisma } from '../../../generated/prisma';

/**
 * What a brand-new tutorial contains.
 *
 * A placeholder, not the guide: admins write the real lessons through the
 * Course Editor, and those edits are never touched by this file again. It only
 * has to be enough for the walkthrough to have a course to open and a player
 * with something in it.
 */
export const TUTORIAL_PLACEHOLDER = {
  title: 'Getting started',
  shortDescription: 'How this platform works — the place to start.',
  moduleTitle: 'Welcome',
  sectionTitle: 'Welcome to the platform',
  textContent: '<p>Tutorial content coming soon.</p>',
};

/**
 * Makes sure the default tutorial exists and is published.
 *
 * Run on every start-up rather than from the seed or a migration:
 *
 * - Production never runs the seed. The container runs `prisma migrate deploy`
 *   and then the server, so anything only the seed creates is missing from
 *   every real database.
 * - A migration cannot publish. Learners read a JSON snapshot built by
 *   `PublicationService.buildSnapshot`, and hand-writing that JSON in SQL would
 *   be a second copy of its rules, out of date the first time a field is added.
 *
 * Idempotent, and finishes a half-done job. Present and published: nothing to
 * do, which is every start-up after the first. Present but never published —
 * a previous start crashed part way — and the placeholder is added if the
 * course is still empty, then it is published. Two replicas starting at once
 * both try to create it; the partial unique index lets one win, and the loser
 * carries on with the winner's course.
 *
 * Never throws. A start-up that cannot create the tutorial should still serve
 * everything else, and will try again on the next start.
 */
export async function ensureDefaultTutorial(): Promise<string | null> {
  try {
    let courseId = await CurriculumGateway.getDefaultTutorialId();

    if (!courseId) {
      try {
        const created = await CurriculumGateway.createDefaultTutorial(TUTORIAL_PLACEHOLDER);
        courseId = created.id;
        logger.info({ courseId }, 'created the default tutorial');
      } catch (error) {
        // Another instance got there first; use theirs.
        if (!isUniqueViolation(error)) throw error;
        courseId = await CurriculumGateway.getDefaultTutorialId();
        if (!courseId) throw error;
      }
    }

    const course = await CurriculumGateway.getCourseById(courseId);
    if (course && course.publishedVersion === 0) {
      if (course.sections.length === 0) {
        const section = await CurriculumService.createSection(courseId, {
          title: TUTORIAL_PLACEHOLDER.sectionTitle,
          estimatedMinutes: 1,
        });
        if (section) {
          await CurriculumService.createElement(section.id, {
            type: 'TEXT',
            textContent: TUTORIAL_PLACEHOLDER.textContent,
          });
        }
      }
      await PublicationService.publish(courseId, null);
      logger.info({ courseId }, 'published the default tutorial');
    }

    DefaultTutorialService.clearCache();
    return courseId;
  } catch (error) {
    logger.error({ err: error }, 'could not ensure the default tutorial exists');
    return null;
  }
}

/** True for Prisma's unique-constraint failure, which is how a lost race shows up. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
