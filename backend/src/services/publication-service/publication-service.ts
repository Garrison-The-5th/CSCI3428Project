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

import { CourseKind, Prisma, QuizType } from '../../../generated/prisma';

/**
 * Versioned publishing.
 *
 * A learner never reads the course rows an author is editing. They read the
 * snapshot taken the last time someone pressed publish. That one indirection is
 * what makes "nothing reaches a learner until it is published" true of edits as
 * well as additions: correcting a paragraph, reordering sections, changing a quiz
 * answer and adding a whole module are all just differences between the live
 * rows and the snapshot, and none of them are visible until a new snapshot is
 * taken.
 *
 * It also means ids stay stable. Progress is recorded against element, section
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
  type: QuizType;
  sectionId: string | null;
  order: number;
  published: boolean;
  showResults: boolean;
  showAnswers: boolean;
  /**
   * Absent on snapshots taken before exams could be reopened, which is why it is
   * optional rather than defaulted here — an older version simply did not record
   * an answer, and `undefined` reads as "one sitting", the behaviour that
   * version actually had.
   */
  allowMultipleAttempts?: boolean;
  dueDate: Date | string | null;
  daysRemaining?: number | null;
  timeLimitMinutes: number | null;
  questions: Array<{
    id: string;
    order: number;
    prompt: string;
    hint: string | null;
    hintSectionNumber: string | null;
    options: Array<{ id: string; order: number; text: string; isCorrect: boolean }>;
  }>;
}

export interface SnapshotSection {
  id: string;
  courseId: string;
  moduleId: string | null;
  position: number;
  number: string;
  title: string;
  estimatedMinutes: number;
  color: string | null;
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
  /** Absent on snapshots predating deadlines being a length rather than a date. */
  daysRemaining?: number | null;
  published: boolean;
  sequential: boolean;
  publishedAt: Date | string | null;
  kind: CourseKind;
  imageData: string | null;
  imageType: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  modules: Array<{
    id: string;
    courseId: string;
    number: number;
    title: string;
    color: string | null;
  }>;
  sections: SnapshotSection[];
  instructors: Array<Record<string, unknown>>;
}

/** What one version added over the one before it. */
export interface NewIds {
  newModuleIds: string[];
  newSectionIds: string[];
  newElementIds: string[];
  newQuizIds: string[];
}

const EMPTY_NEW: NewIds = {
  newModuleIds: [],
  newSectionIds: [],
  newElementIds: [],
  newQuizIds: [],
};

/**
 * Rewrites a snapshot written before the two container names traded places.
 *
 * Versions published under the old naming carry `sections` for what is now a
 * module and `modules` for what is now a section, with `sectionId`/`moduleId`
 * pointing the wrong way to match. The tables were renamed by migration but the
 * snapshots are opaque JSON, and rewriting them in SQL would have meant
 * hand-editing every learner's live version — so they are remapped here instead,
 * on the one path everything reads them through.
 *
 * The tell is unambiguous: only an old snapshot has entries in `modules` that
 * carry elements, because under the new naming elements hang off sections. A
 * snapshot already in the new shape is handed straight back, and the next
 * publish retires the old one for good.
 */
function normaliseSnapshot(snapshot: CourseSnapshot | null): CourseSnapshot | null {
  if (!snapshot) return null;

  const outer = snapshot.modules as unknown as Array<Record<string, unknown>> | undefined;
  const legacy = Array.isArray(outer) && outer.some((entry) => Array.isArray(entry?.elements));
  if (!legacy) return snapshot;

  const oldInner = snapshot.modules as unknown as Array<Record<string, unknown>>;
  const oldOuter = snapshot.sections as unknown as Array<Record<string, unknown>>;

  return {
    ...snapshot,
    // Neither existed before quiz sets did, and everything published then was a
    // lesson with untinted sections.
    kind: snapshot.kind ?? CourseKind.LESSON,
    modules: oldOuter.map((entry) => ({
      id: String(entry.id),
      courseId: String(entry.courseId),
      number: Number(entry.number),
      title: String(entry.title),
      color: (entry.color as string | null) ?? null,
    })),
    sections: oldInner.map((entry) => {
      const { sectionId, quizzes, ...rest } = entry;
      return {
        ...(rest as unknown as SnapshotSection),
        moduleId: (sectionId as string | null) ?? null,
        color: (entry.color as string | null) ?? null,
        quizzes: ((quizzes ?? []) as Array<Record<string, unknown>>).map((quiz) => {
          const { moduleId, hintModuleNumber, questions, ...quizRest } = quiz;
          void hintModuleNumber;
          return {
            ...(quizRest as unknown as SnapshotQuiz),
            // Everything that predates the three kinds was an exam that showed
            // its result, which is what those defaults mean.
            type: (quiz.type as QuizType) ?? QuizType.EXAM,
            showResults: (quiz.showResults as boolean) ?? true,
            sectionId: (moduleId as string | null) ?? null,
            questions: ((questions ?? []) as Array<Record<string, unknown>>).map((question) => {
              const { hintModuleNumber: hintNumber, ...questionRest } = question;
              return {
                ...(questionRest as unknown as SnapshotQuiz['questions'][number]),
                hintSectionNumber: (hintNumber as string | null) ?? null,
              };
            }),
          };
        }),
      };
    }),
  };
}

/**
 * Bookkeeping that says nothing about what a learner would read.
 *
 * Dropped before two versions are compared. `updatedAt` is the important one:
 * Prisma stamps it on every write whether or not the values changed, and the
 * editor saves on blur — so tabbing through a field, or setting a toggle to what
 * it already was, moved it. Comparing rows as they stand would call that a
 * change to publish.
 */
const VOLATILE_KEYS = new Set([
  'createdAt',
  'updatedAt',
  'deletedAt',
  'draftUpdatedAt',
  'publishedAt',
  'publishedVersion',
  'published',
]);

/**
 * A snapshot reduced to the content itself, in a form two of them can be
 * compared in.
 *
 * Keys are sorted, because one side has been through JSON and back and the other
 * has not; dates are flattened to strings for the same reason. Array order is
 * kept — the order of sections and elements is content, not incidental.
 */
function contentOnly(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(contentOnly);

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !VOLATILE_KEYS.has(key))
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, entry]) => [key, contentOnly(entry)]));
  }

  return value;
}

/** Two snapshots hold the same content when these strings match. */
function fingerprint(snapshot: CourseSnapshot): string {
  return JSON.stringify(contentOnly(snapshot));
}

/** Every id a snapshot contains, bucketed by kind, for diffing two versions. */
function idsOf(snapshot: CourseSnapshot | null) {
  return {
    modules: new Set((snapshot?.modules ?? []).map((module) => module.id)),
    sections: new Set((snapshot?.sections ?? []).map((section) => section.id)),
    elements: new Set(
      (snapshot?.sections ?? []).flatMap((section) =>
        (section.elements ?? []).map((element) => element.id),
      ),
    ),
    quizzes: new Set(
      (snapshot?.sections ?? []).flatMap((section) =>
        (section.quizzes ?? []).map((quiz) => quiz.id),
      ),
    ),
  };
}

export default class PublicationService {
  /**
   * Builds the tree that becomes a version, from the course as it stands now.
   *
   * Only what a learner is allowed to see goes in: deleted rows are already
   * excluded by the gateway, and unpublished quizzes are dropped here, so an
   * author can draft a quiz inside an otherwise finished section without it
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
      kind: course.kind,
      imageData: course.imageData,
      imageType: course.imageType,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      modules: course.modules.map((module) => ({
        id: module.id,
        courseId: module.courseId,
        number: module.number,
        title: module.title,
        color: module.color,
      })),
      sections: course.sections.map((section) => ({
        id: section.id,
        courseId: section.courseId,
        moduleId: section.moduleId,
        position: section.position,
        number: section.number,
        title: section.title,
        estimatedMinutes: section.estimatedMinutes,
        color: section.color,
        elements: section.elements as unknown as SnapshotSection['elements'],
        // Every quiz in the course, not just the ones flagged published.
        //
        // A quiz used to carry its own publish state, which meant a course could
        // be published and still serve a section with the quiz silently missing
        // from it — the author had pressed the one Publish button they were
        // shown and had no way to know a second one existed. A course is now
        // published whole: what is in it at the moment of publishing is what
        // learners get, exactly as it already worked for elements.
        quizzes: section.quizzes.map((quiz) => quiz as unknown as SnapshotQuiz),
      })),
      instructors: course.instructors as unknown as Array<Record<string, unknown>>,
    };
  }

  /** The snapshot a learner is currently served, or null if never published. */
  static async getLiveSnapshot(courseId: string): Promise<CourseSnapshot | null> {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course || !course.published || course.publishedVersion < 1) return null;

    const publication = await PublicationGateway.getLive(courseId, course.publishedVersion);
    return normaliseSnapshot((publication?.snapshot as unknown as CourseSnapshot) ?? null);
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
   * case, but a learner half way through needs it more: a section inserted at 2.3
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
     * an author republished for any other reason: add a section (v4 marks it),
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
     * opened. Reading the new section is the thing that makes it no longer new,
     * which is what a learner would expect.
     */
    const [viewedSections, viewedElements, attempts] = await Promise.all([
      CurriculumGateway.getViewedSectionIds(userId),
      CurriculumGateway.getViewedElementIds(userId),
      QuizGateway.getAttemptsForUser(userId),
    ]);

    const seenSections = new Set(viewedSections.map((view) => view.sectionId));
    const seenElements = new Set(viewedElements.map((view) => view.elementId));
    const seenQuizzes = new Set(attempts.map((attempt) => attempt.quizId));

    const unseen = (ids: string[], present: Set<string>, seen: Set<string>) =>
      [...new Set(ids)].filter((id) => present.has(id) && !seen.has(id));

    const newSectionIds = unseen(
      since.flatMap((entry) => entry.newSectionIds),
      present.sections,
      seenSections,
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

    // A new module stays marked until nothing inside it is outstanding — its
    // heading stands in for its contents, so it cannot clear before they do.
    const sectionsByModule = new Map<string, string[]>();
    for (const section of live?.sections ?? []) {
      if (!section.moduleId) continue;
      sectionsByModule.set(section.moduleId, [
        ...(sectionsByModule.get(section.moduleId) ?? []),
        section.id,
      ]);
    }

    const newModuleIds = [...new Set(since.flatMap((entry) => entry.newModuleIds))]
      .filter((id) => present.modules.has(id))
      .filter((id) => (sectionsByModule.get(id) ?? []).some((m) => !seenSections.has(m)));

    return { newModuleIds, newSectionIds, newElementIds, newQuizIds };
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
        ? normaliseSnapshot(
            ((await PublicationGateway.getLive(courseId, course.publishedVersion))
              ?.snapshot as unknown as CourseSnapshot | undefined) ?? null,
          )
        : null;

    // A first publish marks nothing new: everything is new, and telling a
    // learner so on every line is noise rather than information.
    const previousIds = idsOf(previous);
    const nextIds = idsOf(snapshot);
    const added = previous
      ? {
          newModuleIds: [...nextIds.modules].filter((id) => !previousIds.modules.has(id)),
          newSectionIds: [...nextIds.sections].filter((id) => !previousIds.sections.has(id)),
          newElementIds: [...nextIds.elements].filter((id) => !previousIds.elements.has(id)),
          newQuizIds: [...nextIds.quizzes].filter((id) => !previousIds.quizzes.has(id)),
        }
      : EMPTY_NEW;

    const hasAdded =
      added.newModuleIds.length +
        added.newSectionIds.length +
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

    // The quizzes go live with it.
    //
    // The snapshot above is what a learner actually reads, so this is not what
    // makes them reachable — it keeps the row flag from drifting away from the
    // truth, for the few places that still read it directly: the dashboard's
    // trimmed query, and a quiz standing on its own with no course behind it to
    // publish. Without it, a quiz created before this change stays flagged draft
    // for ever while being served to everyone.
    await QuizGateway.publishQuizzesInCourse(courseId);

    // "Something changed" is stamped here rather than when the author typed it:
    // the dashboard's new-content notice has to mean content a learner can
    // actually open, and until this moment none of it could be.
    if (hasAdded) await CurriculumGateway.touchContent(courseId);

    return { version, added, hasNewContent: hasAdded };
  }

  /**
   * Whether the live rows have moved on from what learners are being served.
   *
   * Two questions, asked in that order.
   *
   * `draftUpdatedAt` answers "has anything been written since the publish?".
   * That is cheap — every content mutation touches it — and when the answer is no
   * there is nothing more to ask. It is the common case, and it costs one row.
   *
   * When something *has* been written, that on its own used to be the whole
   * answer, and it was the wrong one. A write is not a change: the editor saves
   * on blur and auto-saves as you type, so tabbing through a field, or setting a
   * toggle back to what it already was, marked a course as having something to
   * publish and nothing could clear it again. So the second question is asked
   * properly — build the snapshot the course would publish now, and compare it
   * with the one learners are reading. Same content, nothing to publish.
   *
   * The comparison ignores timestamps and row bookkeeping (see `contentOnly`),
   * because Prisma stamps `updatedAt` on every write whether the values moved or
   * not — which is the same false positive one layer down.
   *
   * The expensive half only runs after a real write, which is exactly when the
   * answer is in doubt.
   */
  static async hasUnpublishedChanges(courseId: string): Promise<boolean> {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) return false;
    // Never published: everything is outstanding by definition.
    if (course.publishedVersion < 1) return true;

    const publication = await PublicationGateway.getLive(courseId, course.publishedVersion);
    if (!publication) return true;

    if (course.draftUpdatedAt.getTime() <= publication.publishedAt.getTime()) return false;

    const live = normaliseSnapshot((publication.snapshot as unknown as CourseSnapshot) ?? null);
    if (!live) return true;

    // A failure here must not strand an author on "nothing to publish" — if the
    // comparison cannot be made, fall back to what the timestamp said.
    try {
      return fingerprint(await PublicationService.buildSnapshot(courseId)) !== fingerprint(live);
    } catch (error) {
      logger.error({ err: error }, `Could not compare course ${courseId} with its live version`);
      return true;
    }
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
      newModuleIds: [...draftIds.modules].filter((id) => !liveIds.modules.has(id)),
      newSectionIds: [...draftIds.sections].filter((id) => !liveIds.sections.has(id)),
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

    for (const section of snapshot.sections) {
      const found = (section.quizzes ?? []).find((quiz) => quiz.id === quizId);
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
   * Puts an archived version back in front of learners.
   *
   * Rolls forward rather than backwards: the old snapshot is republished under a
   * brand new version number, and the version it replaces is superseded exactly
   * as an ordinary publish would do. Nothing is rewritten and nothing is thrown
   * away, so a restore is itself undoable — the version you rolled back from is
   * now the archived one, and restoring it again returns you to where you were.
   *
   * Rewriting `Course.publishedVersion` to point at the old row instead was the
   * other option, and is worse: it would leave a superseded row live, break the
   * "every version is either live or has an archive clock" rule the retention
   * sweep depends on, and let the restored version be purged out from under the
   * learners reading it.
   *
   * The author's own draft rows are deliberately untouched. Restoring changes
   * what is *published*, and silently overwriting an author's in-progress edits
   * with a two-week-old tree is not something a button labelled Restore should
   * do. The editor will report unpublished changes afterwards, which is true.
   *
   * `newModuleIds` and friends are reset to empty rather than copied: they mean
   * "what this publish added", and a rollback adds nothing a learner has not
   * already been shown. Copying them would re-mark old content as New.
   */
  static async restoreVersion(versionId: string, restoredById: number | null) {
    const source = await PublicationGateway.getById(versionId);
    if (!source) throw new NotFoundError(`Version with ID ${versionId} not found`);

    if (source.supersededAt === null) {
      throw new Error('that version is already the one learners are reading');
    }

    const course = await CurriculumGateway.getCourseById(source.courseId);
    if (!course) throw new NotFoundError(`Course with ID ${source.courseId} not found`);

    // Off the rows, not off the course: a course rolled back once has a pointer
    // lower than versions that already exist, and reusing a number would collide
    // with the courseId+version unique constraint.
    const version = (await PublicationGateway.highestVersion(source.courseId)) + 1;

    if (course.publishedVersion >= 1) {
      await PublicationGateway.supersede(source.courseId, course.publishedVersion);
    }

    const publication = await PublicationGateway.create({
      courseId: source.courseId,
      version,
      snapshot: source.snapshot as Prisma.InputJsonValue,
      publishedById: restoredById,
      ...EMPTY_NEW,
    });

    /*
     * The draft is deliberately left reading as ahead of what is published.
     *
     * An ordinary publish may align the two, because it publishes the draft:
     * afterwards they genuinely match. A restore cannot, because it publishes
     * something else — the author's editable rows still hold the newer content
     * while learners have been put back on the older, so the two differ by
     * definition and the editor has to keep saying so.
     *
     * That has to be forced rather than left alone. `hasUnpublishedChanges` is a
     * timestamp comparison — draftUpdatedAt > the live publication's publishedAt
     * — and a publication row is stamped `now()` on insert, so a draft last
     * edited at any point in the past is automatically *older* than the restore
     * that just happened. Leaving the stamp untouched would therefore report
     * "up to date" on a course whose draft and live version plainly disagree.
     */
    const aheadOfPublication = new Date(publication.publishedAt.getTime() + 1);

    await CurriculumGateway.updateCourse(source.courseId, {
      published: true,
      publishedVersion: version,
      publishedAt: course.publishedAt ?? new Date(),
      draftUpdatedAt:
        course.draftUpdatedAt > aheadOfPublication ? course.draftUpdatedAt : aheadOfPublication,
    });

    return { version, restoredFrom: source.version };
  }

  /**
   * Removes one archived version for good.
   *
   * The live version is refused: it is what every learner is currently reading,
   * and deleting it would leave the course pointing at a version that no longer
   * exists — a published course nobody can open.
   */
  static async deleteVersion(versionId: string) {
    const publication = await PublicationGateway.getById(versionId);
    if (!publication) throw new NotFoundError(`Version with ID ${versionId} not found`);

    if (publication.supersededAt === null) {
      throw new Error('that version is the one learners are reading, so it cannot be deleted');
    }

    await PublicationGateway.deleteById(versionId);
    return { version: publication.version };
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
