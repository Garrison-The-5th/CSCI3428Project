/**
 * File: publication-service.ts
 * Description: Versioned publishing — snapshots, version diffs and archive retention.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { logger } from '@/config/logger';
import { NotFoundError } from '@/controllers/http-errors';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import PublicationGateway from '@/gateways/publication-gateway/publication-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';

import { Prisma } from '../../../generated/prisma';

/**
 * Versioned publishing.
 *
 * A learner never reads the course rows an author is editing. They read the
 * snapshot taken the last time someone pressed publish. That one indirection is
 * what makes "nothing reaches a learner until it is published" true of edits as
 * well as additions: correcting a paragraph, reordering modules, changing a quiz
 * answer and adding a whole section are all just differences between the live
 * rows and the snapshot, and none of them are visible until a new snapshot is
 * taken.
 *
 * It also means ids stay stable. Progress is recorded against element, module
 * and quiz ids, and publishing does not mint new ones — so a learner's history
 * survives every version.
 */

/** How long a superseded version stays readable before it is cleared. */
export const ARCHIVE_DAYS = 14;

/** A quiz as it appears inside a snapshot, answers included. */
export interface SnapshotQuiz {
  id: string;
  title: string;
  description: string | null;
  moduleId: string | null;
  order: number;
  published: boolean;
  showAnswers: boolean;
  dueDate: Date | string | null;
  timeLimitMinutes: number | null;
  questions: Array<{
    id: string;
    order: number;
    prompt: string;
    hint: string | null;
    hintModuleNumber: string | null;
    options: Array<{ id: string; order: number; text: string; isCorrect: boolean }>;
  }>;
}

export interface SnapshotModule {
  id: string;
  courseId: string;
  sectionId: string | null;
  position: number;
  number: string;
  title: string;
  estimatedMinutes: number;
  elements: Array<Record<string, unknown> & { id: string }>;
  quizzes: SnapshotQuiz[];
}

export interface CourseSnapshot {
  id: string;
  title: string;
  shortDescription: string | null;
  description: string | null;
  tags: string[];
  languages: string[];
  whatYouWillLearn: string[];
  prerequisites: string[];
  required: boolean;
  dueDate: Date | string | null;
  published: boolean;
  sequential: boolean;
  publishedAt: Date | string | null;
  imageData: string | null;
  imageType: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  sections: Array<{
    id: string;
    courseId: string;
    number: number;
    title: string;
    color: string | null;
  }>;
  modules: SnapshotModule[];
  instructors: Array<Record<string, unknown>>;
}

/** What one version added over the one before it. */
export interface NewIds {
  newSectionIds: string[];
  newModuleIds: string[];
  newElementIds: string[];
  newQuizIds: string[];
}

const EMPTY_NEW: NewIds = {
  newSectionIds: [],
  newModuleIds: [],
  newElementIds: [],
  newQuizIds: [],
};

/** Every id a snapshot contains, bucketed by kind, for diffing two versions. */
function idsOf(snapshot: CourseSnapshot | null) {
  return {
    sections: new Set((snapshot?.sections ?? []).map((section) => section.id)),
    modules: new Set((snapshot?.modules ?? []).map((module) => module.id)),
    elements: new Set(
      (snapshot?.modules ?? []).flatMap((module) =>
        (module.elements ?? []).map((element) => element.id),
      ),
    ),
    quizzes: new Set(
      (snapshot?.modules ?? []).flatMap((module) => (module.quizzes ?? []).map((quiz) => quiz.id)),
    ),
  };
}

export default class PublicationService {
  /**
   * Builds the tree that becomes a version, from the course as it stands now.
   *
   * Only what a learner is allowed to see goes in: deleted rows are already
   * excluded by the gateway, and unpublished quizzes are dropped here, so an
   * author can draft a quiz inside an otherwise finished module without it
   * appearing the moment the course is republished.
   */
  static async buildSnapshot(courseId: string): Promise<CourseSnapshot> {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);

    return {
      id: course.id,
      title: course.title,
      shortDescription: course.shortDescription,
      description: course.description,
      tags: course.tags,
      languages: course.languages,
      whatYouWillLearn: course.whatYouWillLearn,
      prerequisites: course.prerequisites,
      required: course.required,
      dueDate: course.dueDate,
      published: course.published,
      sequential: course.sequential,
      publishedAt: course.publishedAt,
      imageData: course.imageData,
      imageType: course.imageType,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      sections: course.sections.map((section) => ({
        id: section.id,
        courseId: section.courseId,
        number: section.number,
        title: section.title,
        color: section.color,
      })),
      modules: course.modules.map((module) => ({
        id: module.id,
        courseId: module.courseId,
        sectionId: module.sectionId,
        position: module.position,
        number: module.number,
        title: module.title,
        estimatedMinutes: module.estimatedMinutes,
        elements: module.elements as unknown as SnapshotModule['elements'],
        quizzes: module.quizzes
          .filter((quiz) => quiz.published)
          .map((quiz) => quiz as unknown as SnapshotQuiz),
      })),
      instructors: course.instructors as unknown as Array<Record<string, unknown>>,
    };
  }

  /** The snapshot a learner is currently served, or null if never published. */
  static async getLiveSnapshot(courseId: string): Promise<CourseSnapshot | null> {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course || !course.published || course.publishedVersion < 1) return null;

    const publication = await PublicationGateway.getLive(courseId, course.publishedVersion);
    return (publication?.snapshot as unknown as CourseSnapshot) ?? null;
  }

  /**
   * What is new *to this learner*, which is not the same as what the version
   * added.
   *
   * New is only information to someone who already knows the course. To a first
   * time learner every line is equally new, and marking half of it would be
   * noise — so they get nothing.
   *
   * The test is whether they had touched this course before the version went
   * live, not whether they finished it. Someone who completed it is the obvious
   * case, but a learner half way through needs it more: a module inserted at 2.3
   * while they are on 4.1 is behind them, and without a mark they would never
   * know to go back for it.
   */
  static async getNewIdsForLearner(
    courseId: string,
    userId: number,
    /** Pass the snapshot when the caller already has it, to save re-reading it. */
    snapshot?: CourseSnapshot | null,
  ): Promise<NewIds> {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course || course.publishedVersion < 1) return EMPTY_NEW;

    // Never opened it: everything is equally new, so marking any of it says
    // nothing. First-time learners get a clean page.
    const startedAt = await CurriculumGateway.getFirstActivityAt(userId, courseId);
    if (!startedAt) return EMPTY_NEW;

    /*
     * Every version published since they began, not just the newest one's delta.
     *
     * Taking only the latest version would make the marks disappear the moment
     * an author republished for any other reason: add a module (v4 marks it),
     * fix a typo and republish (v5 adds nothing), and a learner who has been
     * away since v3 is told there is nothing new when there plainly is.
     */
    const since = await PublicationGateway.listPublishedSince(courseId, startedAt);
    if (since.length === 0) return EMPTY_NEW;

    const live = snapshot ?? (await PublicationService.getLiveSnapshot(courseId));
    // Only what still exists in the version they are being served — something
    // added in v4 and deleted in v5 must not be marked new on a page that does
    // not contain it.
    const present = idsOf(live);

    /*
     * ...and only what they have not already read.
     *
     * This is what retires a mark. Without it the pills would either stick
     * forever or, if keyed on the last visit, vanish the moment the course was
     * opened. Reading the new module is the thing that makes it no longer new,
     * which is what a learner would expect.
     */
    const [viewedModules, viewedElements, attempts] = await Promise.all([
      CurriculumGateway.getViewedModuleIds(userId),
      CurriculumGateway.getViewedElementIds(userId),
      QuizGateway.getAttemptsForUser(userId),
    ]);

    const seenModules = new Set(viewedModules.map((view) => view.moduleId));
    const seenElements = new Set(viewedElements.map((view) => view.elementId));
    const seenQuizzes = new Set(attempts.map((attempt) => attempt.quizId));

    const unseen = (ids: string[], present: Set<string>, seen: Set<string>) =>
      [...new Set(ids)].filter((id) => present.has(id) && !seen.has(id));

    const newModuleIds = unseen(
      since.flatMap((entry) => entry.newModuleIds),
      present.modules,
      seenModules,
    );
    const newElementIds = unseen(
      since.flatMap((entry) => entry.newElementIds),
      present.elements,
      seenElements,
    );
    const newQuizIds = unseen(
      since.flatMap((entry) => entry.newQuizIds),
      present.quizzes,
      seenQuizzes,
    );

    // A new section stays marked until nothing inside it is outstanding — its
    // heading stands in for its contents, so it cannot clear before they do.
    const modulesBySection = new Map<string, string[]>();
    for (const module of live?.modules ?? []) {
      if (!module.sectionId) continue;
      modulesBySection.set(module.sectionId, [
        ...(modulesBySection.get(module.sectionId) ?? []),
        module.id,
      ]);
    }

    const newSectionIds = [...new Set(since.flatMap((entry) => entry.newSectionIds))]
      .filter((id) => present.sections.has(id))
      .filter((id) => (modulesBySection.get(id) ?? []).some((m) => !seenModules.has(m)));

    return { newSectionIds, newModuleIds, newElementIds, newQuizIds };
  }

  /**
   * Puts the course as it currently stands live as the next version.
   *
   * The previous version is stamped superseded rather than deleted, which starts
   * its archive clock — it stays readable for ARCHIVE_DAYS so a bad publish can
   * be inspected against what it replaced.
   */
  static async publish(courseId: string, publishedById: number | null) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);

    const snapshot = await PublicationService.buildSnapshot(courseId);
    const previous =
      course.publishedVersion >= 1
        ? (((await PublicationGateway.getLive(courseId, course.publishedVersion))
            ?.snapshot as unknown as CourseSnapshot | undefined) ?? null)
        : null;

    // A first publish marks nothing new: everything is new, and telling a
    // learner so on every line is noise rather than information.
    const previousIds = idsOf(previous);
    const nextIds = idsOf(snapshot);
    const added = previous
      ? {
          newSectionIds: [...nextIds.sections].filter((id) => !previousIds.sections.has(id)),
          newModuleIds: [...nextIds.modules].filter((id) => !previousIds.modules.has(id)),
          newElementIds: [...nextIds.elements].filter((id) => !previousIds.elements.has(id)),
          newQuizIds: [...nextIds.quizzes].filter((id) => !previousIds.quizzes.has(id)),
        }
      : EMPTY_NEW;

    const hasAdded =
      added.newSectionIds.length +
        added.newModuleIds.length +
        added.newElementIds.length +
        added.newQuizIds.length >
      0;

    const version = course.publishedVersion + 1;

    if (course.publishedVersion >= 1) {
      await PublicationGateway.supersede(courseId, course.publishedVersion);
    }

    const publication = await PublicationGateway.create({
      courseId,
      version,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      publishedById,
      ...added,
    });

    // published:true here as well as publishedVersion, so the first publish of a
    // draft course is one action rather than two.
    //
    // draftUpdatedAt takes the publication's own timestamp rather than `now()`.
    // Stamping it separately would leave it a few milliseconds ahead, and the
    // editor would report unpublished changes the instant a publish finished.
    await CurriculumGateway.updateCourse(courseId, {
      published: true,
      publishedVersion: version,
      publishedAt: course.publishedAt ?? new Date(),
      draftUpdatedAt: publication.publishedAt,
    });

    // "Something changed" is stamped here rather than when the author typed it:
    // the dashboard's new-content notice has to mean content a learner can
    // actually open, and until this moment none of it could be.
    if (hasAdded) await CurriculumGateway.touchContent(courseId);

    return { version, added, hasNewContent: hasAdded };
  }

  /**
   * Whether the live rows have moved on from what learners are being served.
   *
   * Read off `draftUpdatedAt` rather than by diffing the tree: every content
   * mutation already touches it, and building two full snapshots on every load
   * of the editor would be absurd for a yes/no answer.
   *
   * Publishing sets `draftUpdatedAt` to the publication's own timestamp, so
   * immediately afterwards the two are equal and this is strictly false. Any
   * later edit pushes the draft past it.
   */
  static async hasUnpublishedChanges(courseId: string): Promise<boolean> {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) return false;
    // Never published: everything is outstanding by definition.
    if (course.publishedVersion < 1) return true;

    const publication = await PublicationGateway.getLive(courseId, course.publishedVersion);
    if (!publication) return true;

    return course.draftUpdatedAt.getTime() > publication.publishedAt.getTime();
  }

  /**
   * What an author has changed but not yet published, as id sets.
   *
   * Drives the New tags in the editor, which mean "not live yet" — a different
   * question from the New tags a learner sees, which mean "arrived in the
   * version you are reading".
   */
  static async getUnpublishedIds(courseId: string): Promise<NewIds> {
    const [draft, live] = await Promise.all([
      PublicationService.buildSnapshot(courseId),
      PublicationService.getLiveSnapshot(courseId),
    ]);

    // Never published: the whole course is unpublished, but tagging every line
    // says nothing, so report none and let the Publish button carry the message.
    if (!live) return EMPTY_NEW;

    const liveIds = idsOf(live);
    const draftIds = idsOf(draft);

    return {
      newSectionIds: [...draftIds.sections].filter((id) => !liveIds.sections.has(id)),
      newModuleIds: [...draftIds.modules].filter((id) => !liveIds.modules.has(id)),
      newElementIds: [...draftIds.elements].filter((id) => !liveIds.elements.has(id)),
      newQuizIds: [...draftIds.quizzes].filter((id) => !liveIds.quizzes.has(id)),
    };
  }

  /**
   * The published form of one quiz — what a learner is actually answering.
   *
   * Grading has to read this rather than the Quiz rows: an author who has
   * rewritten a question but not published it would otherwise have their draft
   * answer key applied to the version the learner is looking at, and mark them
   * wrong for answering what was on screen correctly.
   */
  static async findPublishedQuiz(quizId: string): Promise<SnapshotQuiz | null> {
    const courseId = await CurriculumGateway.courseIdFromQuiz(quizId);
    if (!courseId) return null;

    const snapshot = await PublicationService.getLiveSnapshot(courseId);
    if (!snapshot) return null;

    for (const module of snapshot.modules) {
      const found = (module.quizzes ?? []).find((quiz) => quiz.id === quizId);
      if (found) return found;
    }
    return null;
  }

  /** Published snapshots for a set of courses, skipping any never published. */
  static async getLiveSnapshots(courseIds: string[]): Promise<CourseSnapshot[]> {
    const snapshots = await Promise.all(
      courseIds.map((courseId) => PublicationService.getLiveSnapshot(courseId)),
    );
    return snapshots.filter((snapshot): snapshot is CourseSnapshot => snapshot !== null);
  }

  static listVersions(courseId: string) {
    return PublicationGateway.listForCourse(courseId);
  }

  /** One archived version's full tree, for the editor's read-only view. */
  static async getVersion(id: string) {
    const publication = await PublicationGateway.getById(id);
    if (!publication) throw new NotFoundError(`Version with ID ${id} not found`);
    return publication;
  }

  /**
   * Clears archived versions past the retention window. Never throws: this runs
   * on a timer and on ordinary reads, and a failed sweep must not take a page
   * down with it.
   */
  static async purgeExpired(days = ARCHIVE_DAYS) {
    try {
      const cutoff = new Date(Date.now() - days * 86_400_000);
      const { count } = await PublicationGateway.purgeSupersededBefore(cutoff);
      return count;
    } catch (error) {
      logger.error({ err: error }, 'Failed to expire archived course versions');
      return 0;
    }
  }
}
