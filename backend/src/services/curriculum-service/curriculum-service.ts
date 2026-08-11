/**
 * File: curriculum-service.ts
 * Description: Course, section, module and element rules, including the numbering grid.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { logger } from '@/config/logger';
import { normalizeUpload } from '@/config/media-upload';
import { sanitizeRichText } from '@/config/rich-text';
import { parseSectionColor } from '@/config/section-colors';
import {
  cleanStringList,
  type FieldName,
  optionalText,
  requiredText,
  safeUrl,
  withinLimit,
} from '@/config/validation';
import { NotFoundError } from '@/controllers/http-errors';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import AuthService from '@/services/auth-service/auth-service';
import EnrolmentService from '@/services/enrolment-service/enrolment-service';
import PublicationService from '@/services/publication-service/publication-service';
import { redactAnswers } from '@/services/quiz-service/quiz-service';

import { ElementType, Prisma } from '../../../generated/prisma';

const ELEMENT_TYPES = Object.values(ElementType) as string[];

/**
 * How long something stays in the recycle bin before it goes for good.
 *
 * Two weeks is long enough to notice a mistake and short enough that the bin
 * does not quietly become a second copy of the database — deleted courses carry
 * their elements, and elements carry base64 media.
 */
export const RECYCLE_BIN_DAYS = 14;

/**
 * A course is a two-dimensional grid: sections are the outer index and modules
 * the inner one, both 1-based and always contiguous. Module "2.3" is the third
 * module of the second section, and nothing else can be expressed — there is no
 * free-text number to validate any more, because position in the grid is the
 * only source of truth.
 *
 * Every write that can move something calls `renumberCourse`, which rewrites the
 * whole grid. That is what keeps a drag, a delete, or an insert in the middle
 * from ever leaving a hole.
 */

/** "2.3" — what the learner sees. */
export function toNumber(sectionNumber: number, position: number): string {
  return `${sectionNumber}.${position}`;
}

/**
 * "000002.000003" — the stored ordering key. Zero padding is what stops "1.10"
 * from sorting before "1.2" under plain string comparison.
 */
export function toSortKey(sectionNumber: number, position: number): string {
  return `${String(sectionNumber).padStart(6, '0')}.${String(position).padStart(6, '0')}`;
}

/**
 * A section's place in the course, as typed by the author. Out-of-range values
 * are clamped rather than rejected: "put it at 9" in a four-section course means
 * the end, which is what someone typing a big number intends.
 */
function validatePlace(value: unknown, max: number, field: string): number {
  if (value === undefined || value === null || value === '') return max;

  const place = Number(value);
  if (!Number.isFinite(place) || !Number.isInteger(place) || place < 1) {
    throw new Error(`${field} must be a whole number, 1 or higher`);
  }

  return Math.min(place, max);
}

/**
 * Strips the answer key out of every quiz in a course tree.
 *
 * A course carries its modules' quizzes, and those carry questions and options —
 * `isCorrect` and all. The gateway reads the tree whole, so any course sent to a
 * learner has to come through here first, or the correct answers ship with it.
 * The quiz endpoints and the guest-link path already redact; this is the same
 * guarantee for the course path.
 */
function redactCourse<
  T extends {
    modules: Array<{
      quizzes: Array<{ questions: Array<{ options: Array<Record<string, unknown>> }> }>;
    }>;
  },
>(course: T): T {
  return {
    ...course,
    modules: course.modules.map((module) => ({
      ...module,
      quizzes: module.quizzes.map((quiz) => redactAnswers(quiz)),
    })),
  };
}

function validateMinutes(estimatedMinutes: unknown): number {
  if (estimatedMinutes === undefined || estimatedMinutes === null || estimatedMinutes === '') {
    return 0;
  }

  const minutes = Number(estimatedMinutes);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error('expected time must be a number of minutes (0 or more)');
  }

  return Math.round(minutes);
}

export default class CurriculumService {
  /**
   * Learner view: the published courses this person has actually been enrolled
   * on. Being published makes a course eligible to be assigned, not visible to
   * everyone.
   */
  static async getCoursesForLearner(email: string) {
    const [courses, enrolment] = await Promise.all([
      CurriculumGateway.getPublishedCourses(),
      EnrolmentService.forEmail(email),
    ]);

    const enrolled = courses.filter((course) => enrolment.courseIds.has(course.id));
    const published = await Promise.all(
      enrolled.map((course) => PublicationService.getLiveSnapshot(course.id)),
    );

    // Served from each course's published snapshot, never from the rows an
    // author is editing — reading the live tables here would leak every
    // unpublished change. A missing snapshot means the course has never been
    // published, so there is nothing for this person to open.
    return published
      .filter((snapshot): snapshot is NonNullable<typeof snapshot> => snapshot !== null)
      .map(redactCourse);
  }

  /**
   * One published course, if this person is enrolled on it. Being unenrolled is
   * reported the same way as the course not existing, so this cannot be used to
   * probe for what exists.
   */
  static async getCourseForLearner(email: string, courseId: string) {
    const enrolment = await EnrolmentService.forEmail(email);
    if (!enrolment.courseIds.has(courseId)) return null;

    const snapshot = await PublicationService.getLiveSnapshot(courseId);
    return snapshot ? redactCourse(snapshot) : null;
  }

  /**
   * The published course plus what the current version added, so the player can
   * mark new content for someone who had already finished an earlier version.
   */
  static async getCourseWithNewIdsForLearner(email: string, courseId: string) {
    const course = await CurriculumService.getCourseForLearner(email, courseId);
    if (!course) return null;

    // Scoped to this person: New marks what appeared after *they* started, and
    // clears as they read it, so a first-time learner sees none.
    //
    // The course just read is handed straight back in rather than letting the
    // publication service load the snapshot a second time — they are the same
    // object, and snapshots carry their elements' media.
    const user = await AuthService.getUserByEmail(email);
    const newIds = user
      ? await PublicationService.getNewIdsForLearner(courseId, user.id, course)
      : { newSectionIds: [], newModuleIds: [], newElementIds: [], newQuizIds: [] };

    return { course, newIds };
  }

  /** Author view: drafts included. */
  static getAllCourses() {
    return CurriculumGateway.getAllCourses();
  }

  static getCourseById(id: string, live = false) {
    return CurriculumGateway.getCourseById(id, live);
  }

  /**
   * A course starts as just a name; everything else is filled in by editing it.
   * It gets one empty section so the author can add a module immediately —
   * modules live inside sections, so a course with none has nowhere to put them.
   */
  static async createCourse(title?: string) {
    const clean = requiredText(title, 'title', 'title');

    const course = await CurriculumGateway.createCourse(clean);
    await CurriculumGateway.createSection({ courseId: course.id, number: 1, title: 'Section 1' });
    return CurriculumGateway.getCourseById(course.id);
  }

  /**
   * Trims, drops blanks, de-duplicates and bounds a bullet list or tag list.
   *
   * Kept as a thin wrapper over `cleanStringList` so the many existing callers
   * do not change, but every list now carries a maximum entry count and a
   * maximum length per entry (§3.3.1).
   */
  static cleanList(values: unknown, field: FieldName = 'bullet', label = 'this list') {
    return cleanStringList(values, field, label);
  }

  static async updateCourse(
    id: string,
    data: {
      title?: string;
      shortDescription?: string | null;
      description?: string | null;
      tags?: string[];
      languages?: string[];
      whatYouWillLearn?: string[];
      prerequisites?: string[];
      required?: boolean;
      dueDate?: string | null;
      published?: boolean;
      sequential?: boolean;
      instructorIds?: string[];
    },
  ) {
    const course = await CurriculumGateway.getCourseById(id);
    if (!course) throw new NotFoundError(`Course with ID ${id} not found`);

    if (data.title !== undefined && !data.title.trim()) {
      throw new Error('title cannot be empty');
    }

    // Going live has to take a snapshot, or the course would be marked published
    // with nothing for a learner to read. Unpublishing stays here: it only hides
    // what is already published and needs no new version.
    if (data.published === true) {
      throw new Error('use the publish endpoint to put a course live');
    }

    let dueDate: Date | null | undefined;
    if (data.dueDate !== undefined) {
      if (data.dueDate === null || data.dueDate === '') {
        dueDate = null;
      } else {
        const parsed = new Date(data.dueDate);
        if (Number.isNaN(parsed.getTime())) throw new Error('dueDate is not a valid date');
        dueDate = parsed;
      }
    }

    const tags = CurriculumService.cleanList(data.tags, 'tag', 'tags');
    const languages = CurriculumService.cleanList(data.languages, 'tag', 'languages');
    const whatYouWillLearn = CurriculumService.cleanList(
      data.whatYouWillLearn,
      'bullet',
      "what you'll learn",
    );
    const prerequisites = CurriculumService.cleanList(
      data.prerequisites,
      'bullet',
      'prerequisites',
    );

    // Bounded before anything is written (§3.3.1). `optionalText` also
    // normalises "" to null, which is what the spread below already assumed.
    const title = data.title !== undefined ? requiredText(data.title, 'title', 'title') : undefined;
    const shortDescription = optionalText(
      data.shortDescription,
      'shortDescription',
      'short description',
    );
    const description = optionalText(data.description, 'description', 'description');

    // The publish date is stamped by the publish endpoint, which is the only way
    // a course goes live now. Nothing to do here.
    return CurriculumGateway.updateCourse(id, {
      ...(title !== undefined ? { title } : {}),
      ...(shortDescription !== undefined ? { shortDescription } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(tags !== undefined ? { tags } : {}),
      ...(languages !== undefined ? { languages } : {}),
      ...(whatYouWillLearn !== undefined ? { whatYouWillLearn } : {}),
      ...(prerequisites !== undefined ? { prerequisites } : {}),
      ...(data.required !== undefined ? { required: data.required === true } : {}),
      ...(dueDate !== undefined ? { dueDate } : {}),
      // Only ever false here — publishing goes through PublicationService.
      ...(data.published !== undefined ? { published: false } : {}),
      ...(data.sequential !== undefined ? { sequential: data.sequential === true } : {}),
      ...(data.instructorIds !== undefined
        ? { instructors: { set: data.instructorIds.map((instructorId) => ({ id: instructorId })) } }
        : {}),
    });
  }

  // ---- Per-course contributors ----

  static getEditableCourses(userId: number) {
    return CurriculumGateway.getEditableCourses(userId);
  }

  static getContributors(courseId: string) {
    return CurriculumGateway.getContributors(courseId);
  }

  /** Replaces the contributor list, looking people up by email address. */
  static async setContributors(courseId: string, emails: string[]) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);
    if (!Array.isArray(emails)) throw new Error('expected a list of email addresses');

    // Create a user row for anyone not seen before, so they can be named as a
    // contributor before their first sign-in.
    const users = await Promise.all(
      [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].map((email) =>
        AuthService.getOrCreateUser(email),
      ),
    );

    return CurriculumGateway.setContributors(
      courseId,
      users.map((user) => user.id),
    );
  }

  /**
   * Whether this person may edit this course. Global authors may edit anything;
   * a contributor may edit only what they are named on.
   */
  static async canEditCourse(userId: number, courseId: string, isGlobalAuthor: boolean) {
    if (isGlobalAuthor) return true;
    return CurriculumGateway.isContributor(userId, courseId);
  }

  // ---- Instructors ----

  static getInstructors() {
    return CurriculumGateway.getInstructors();
  }

  static createInstructor(data: { name?: string; title?: string | null; bio?: string | null }) {
    return CurriculumGateway.createInstructor({
      name: requiredText(data.name, 'title', 'instructor name'),
      title: optionalText(data.title, 'title', 'instructor job title') ?? null,
      bio: optionalText(data.bio, 'bio', 'instructor biography') ?? null,
    });
  }

  static async updateInstructor(
    id: string,
    data: { name?: string; title?: string | null; bio?: string | null },
  ) {
    const instructor = await CurriculumGateway.getInstructorById(id);
    if (!instructor) throw new NotFoundError(`Instructor with ID ${id} not found`);
    if (data.name !== undefined && !data.name.trim()) {
      throw new Error('instructor name cannot be empty');
    }

    return CurriculumGateway.updateInstructor(id, {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.title !== undefined ? { title: data.title?.trim() || null } : {}),
      ...(data.bio !== undefined ? { bio: data.bio?.trim() || null } : {}),
    });
  }

  static async setInstructorPhoto(id: string, file: Express.Multer.File) {
    const instructor = await CurriculumGateway.getInstructorById(id);
    if (!instructor) throw new NotFoundError(`Instructor with ID ${id} not found`);

    const normalized = await normalizeUpload(file);
    if (normalized.isPdf) throw new Error('An instructor photo must be an image, not a PDF');

    return CurriculumGateway.updateInstructor(id, {
      photoData: normalized.buffer.toString('base64'),
      photoType: normalized.mimeType,
    });
  }

  static async deleteInstructor(id: string) {
    const instructor = await CurriculumGateway.getInstructorById(id);
    if (!instructor) throw new NotFoundError(`Instructor with ID ${id} not found`);
    return CurriculumGateway.deleteInstructor(id);
  }

  // ---- Learner notes ----

  static getNotes(userId: number, courseId: string) {
    return CurriculumGateway.getNotes(userId, courseId);
  }

  static createNote(
    userId: number,
    courseId: string,
    data: { body?: string; moduleId?: string | null },
  ) {
    const body = requiredText(data.body, 'noteBody', 'note');
    return CurriculumGateway.createNote({
      userId,
      courseId,
      moduleId: data.moduleId || null,
      body,
    });
  }

  static async updateNote(id: string, userId: number, body?: string) {
    const clean = requiredText(body, 'noteBody', 'note');
    const { count } = await CurriculumGateway.updateNote(id, userId, clean);
    if (count === 0) throw new NotFoundError(`Note with ID ${id} not found`);
  }

  static async deleteNote(id: string, userId: number) {
    const { count } = await CurriculumGateway.deleteNote(id, userId);
    if (count === 0) throw new NotFoundError(`Note with ID ${id} not found`);
  }

  /**
   * Stores the course cover photo as base64. HEIC is transcoded to JPEG first so
   * it displays in every browser; PDFs are rejected because a cover must render
   * as a picture.
   */
  static async setCourseImage(id: string, file: Express.Multer.File) {
    const course = await CurriculumGateway.getCourseById(id);
    if (!course) throw new NotFoundError(`Course with ID ${id} not found`);

    const normalized = await normalizeUpload(file);
    if (normalized.isPdf) {
      throw new Error('A cover photo must be an image, not a PDF');
    }

    return CurriculumGateway.updateCourse(id, {
      imageData: normalized.buffer.toString('base64'),
      imageType: normalized.mimeType,
    });
  }

  /** Soft delete — recoverable from the admin dashboard. */
  static async deleteCourse(id: string) {
    const course = await CurriculumGateway.getCourseById(id);
    if (!course) throw new NotFoundError(`Course with ID ${id} not found`);
    return CurriculumGateway.softDeleteCourse(id);
  }

  /**
   * Restores from the recycle bin.
   *
   * These few paths are guarded by `requireAuthor` rather than
   * `requireCourseEditor`, so they miss the draft marker that middleware hangs
   * on every other edit — and bringing content back is as much an unpublished
   * change as adding it. Hence the explicit touch here and in the two below.
   */
  static async restoreCourse(id: string) {
    const restored = await CurriculumGateway.restoreCourse(id);
    await CurriculumGateway.touchDraft(id);
    return restored;
  }

  /**
   * Everything currently in the recycle bin, expired items already gone.
   *
   * Sweeping on read is what makes the two-week rule true without a scheduler:
   * the one place the bin is ever looked at is also the place it is tidied, so
   * what comes back can never contain something that should already have expired.
   * `index.ts` runs the same sweep on a timer for the case where nobody looks.
   */
  static async getDeletedItems() {
    await CurriculumService.purgeExpired();

    const [courses, sections, modules] = await Promise.all([
      CurriculumGateway.getDeletedCourses(),
      CurriculumGateway.getDeletedSections(),
      CurriculumGateway.getDeletedModules(),
    ]);
    return { courses, sections, modules, retentionDays: RECYCLE_BIN_DAYS };
  }

  /**
   * Permanently removes anything deleted more than RECYCLE_BIN_DAYS ago.
   *
   * Outermost first, so a course going takes its sections and modules with it by
   * cascade and the later passes only have to deal with what outlived a parent
   * that is still live. Never throws: this runs on a timer and on ordinary reads,
   * and a failed sweep must not take the page down with it.
   */
  static async purgeExpired(days = RECYCLE_BIN_DAYS) {
    const cutoff = new Date(Date.now() - days * 86_400_000);

    try {
      const courses = await CurriculumGateway.purgeCoursesDeletedBefore(cutoff);
      const sections = await CurriculumGateway.purgeSectionsDeletedBefore(cutoff);
      const modules = await CurriculumGateway.purgeModulesDeletedBefore(cutoff);
      const quizzes = await QuizGateway.purgeQuizzesDeletedBefore(cutoff);

      return {
        courses: courses.count,
        sections: sections.count,
        modules: modules.count,
        quizzes: quizzes.count,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to expire recycle bin items');
      return { courses: 0, sections: 0, modules: 0, quizzes: 0 };
    }
  }

  /**
   * Permanently removes a single course from the recycle bin. Refuses anything
   * that is not already soft deleted, so a live course cannot be destroyed by
   * calling this endpoint directly.
   */
  static async purgeCourse(id: string) {
    const course = await CurriculumGateway.findDeletedCourse(id);
    if (!course) throw new NotFoundError(`Course with ID ${id} is not in the recycle bin`);
    return CurriculumGateway.hardDeleteCourse(id);
  }

  static async purgeModule(id: string) {
    const module = await CurriculumGateway.findDeletedModule(id);
    if (!module) throw new NotFoundError(`Module with ID ${id} is not in the recycle bin`);
    return CurriculumGateway.hardDeleteModule(id);
  }

  static async purgeSection(id: string) {
    const section = await CurriculumGateway.findDeletedSection(id);
    if (!section) throw new NotFoundError(`Section with ID ${id} is not in the recycle bin`);
    return CurriculumGateway.hardDeleteSection(id);
  }

  static async restoreAll() {
    // Outermost first: restoring a module whose section is still deleted would
    // leave it stranded, and restoring a container does not touch its contents.
    const courses = await CurriculumGateway.restoreAllCourses();
    const sections = await CurriculumGateway.restoreAllSections();
    const modules = await CurriculumGateway.restoreAllModules();

    // Everything came back on the parked numbers it was deleted with, so the
    // grid has to be rebuilt before any of it is readable.
    for (const courseId of await CurriculumGateway.getLiveCourseIds()) {
      await CurriculumGateway.runTransaction((db) =>
        CurriculumService.renumberCourse(courseId, db),
      );
    }

    return { courses: courses.count, sections: sections.count, modules: modules.count };
  }

  static async purgeAll() {
    // Deleting a course cascades to its sections and modules, so work outward in
    // and let each later pass clear whatever survived because its parent is live.
    const courses = await CurriculumGateway.purgeCourses();
    const sections = await CurriculumGateway.purgeSections();
    const modules = await CurriculumGateway.purgeModules();
    return { courses: courses.count, sections: sections.count, modules: modules.count };
  }

  // ---- Sections and the numbering grid ----

  /**
   * Rewrites every section number and module number in a course so the grid runs
   * 1..n with no gaps, in the order things currently sit. Every mutation that can
   * disturb the grid finishes by calling this, which is why nothing else in this
   * file ever computes a number.
   *
   * Both passes park their rows on throwaway values first. The unique indexes on
   * (courseId, number) for sections and modules are checked row by row, and
   * renumbering permutes values among existing rows — closing a gap turns
   * "1.2, 1.3" into "1.1, 1.2", which collides half way through unless the old
   * values are out of the way.
   */
  static async renumberCourse(courseId: string, db: Prisma.TransactionClient) {
    const sections = await CurriculumGateway.getSections(courseId, db);
    const modules = await CurriculumGateway.getModulesForRenumber(courseId, db);

    // Park below every number the course holds, recycled sections included.
    // Plain -1, -2… would be wrong: a section soft-deleted a moment ago is
    // already sitting down there, and parking on top of it trips the same unique
    // index this is trying to step around.
    const floor = await CurriculumGateway.getLowestSectionNumber(courseId, db);
    for (const [index, section] of sections.entries()) {
      await CurriculumGateway.updateSection(section.id, { number: floor - (index + 1) }, db);
    }
    for (const [index, module] of modules.entries()) {
      await CurriculumGateway.updateModule(
        module.id,
        { number: `renumbering-${index}-${module.id}`, sortKey: `renumbering-${index}` },
        db,
      );
    }

    const modulesBySection = new Map<string, typeof modules>();
    for (const module of modules) {
      if (!module.sectionId) continue;
      const bucket = modulesBySection.get(module.sectionId) ?? [];
      bucket.push(module);
      modulesBySection.set(module.sectionId, bucket);
    }

    for (const [index, section] of sections.entries()) {
      const sectionNumber = index + 1;
      await CurriculumGateway.updateSection(section.id, { number: sectionNumber }, db);

      const owned = modulesBySection.get(section.id) ?? [];
      for (const [moduleIndex, module] of owned.entries()) {
        const position = moduleIndex + 1;
        await CurriculumGateway.updateModule(
          module.id,
          {
            position,
            number: toNumber(sectionNumber, position),
            sortKey: toSortKey(sectionNumber, position),
          },
          db,
        );
      }
    }
  }

  /**
   * Writes the intended section order somewhere no live or recycled number can
   * reach, keeping that order under an ascending sort. renumberCourse reads it
   * back and turns it into 1..n.
   *
   * Ordering and numbering are separated like this because the unique index on
   * (courseId, number) makes it impossible to shuffle numbers among existing
   * rows in place — some intermediate state always collides. Saying "this is the
   * order" in a range nothing else occupies sidesteps the problem entirely.
   */
  static async parkSectionOrder(
    courseId: string,
    ordered: Array<{ id: string }>,
    db: Prisma.TransactionClient,
  ) {
    const floor = await CurriculumGateway.getLowestSectionNumber(courseId, db);
    // Ascending within the band, so a sort by number reproduces `ordered`.
    const base = floor - ordered.length;

    for (const [index, section] of ordered.entries()) {
      await CurriculumGateway.updateSection(section.id, { number: base + index }, db);
    }
  }

  static getSections(courseId: string) {
    return CurriculumGateway.getSections(courseId);
  }

  /**
   * A section is just a title and a place in the course. The place is where the
   * author says it goes: asking for 2 in a three-section course pushes the old
   * section 2 and everything after it down one.
   */
  static async createSection(
    courseId: string,
    data: { title?: string; number?: number | string; color?: string | null },
  ) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);
    const sectionTitle = requiredText(data.title, 'title', 'section title');

    const color = parseSectionColor(data.color);
    const existing = await CurriculumGateway.getSections(courseId);
    const place = validatePlace(data.number, existing.length + 1, 'section number');

    const section = await CurriculumGateway.runTransaction(async (db) => {
      // Born out of the way; the ordering pass below is what decides its place.
      const floor = await CurriculumGateway.getLowestSectionNumber(courseId, db);
      const created = await CurriculumGateway.createSection(
        { courseId, number: floor - 1, title: sectionTitle, color },
        db,
      );

      const ordered = [...existing];
      ordered.splice(place - 1, 0, created);

      await CurriculumService.parkSectionOrder(courseId, ordered, db);
      await CurriculumService.renumberCourse(courseId, db);
      return created;
    });

    return CurriculumGateway.getSectionById(section.id);
  }

  static async updateSection(
    id: string,
    data: { title?: string; number?: number | string; color?: string | null },
  ) {
    const section = await CurriculumGateway.getSectionById(id);
    if (!section) throw new NotFoundError(`Section with ID ${id} not found`);

    const nextSectionTitle =
      data.title !== undefined ? requiredText(data.title, 'title', 'section title') : undefined;

    // Validated before the transaction opens: a bad colour should fail the whole
    // request rather than roll back a renumber half way through.
    const color = data.color !== undefined ? parseSectionColor(data.color) : undefined;
    const existing = await CurriculumGateway.getSections(section.courseId);

    await CurriculumGateway.runTransaction(async (db) => {
      if (nextSectionTitle !== undefined) {
        await CurriculumGateway.updateSection(id, { title: nextSectionTitle }, db);
      }

      if (color !== undefined) {
        await CurriculumGateway.updateSection(id, { color }, db);
      }

      if (data.number !== undefined) {
        const place = validatePlace(data.number, existing.length, 'section number');
        const reordered = existing.filter((current) => current.id !== id);
        reordered.splice(place - 1, 0, section);

        await CurriculumService.parkSectionOrder(section.courseId, reordered, db);
      }

      await CurriculumService.renumberCourse(section.courseId, db);
    });

    return CurriculumGateway.getSectionById(id);
  }

  /**
   * Soft delete — recoverable from the admin dashboard. The section's modules go
   * with it, because a module with no section has no number.
   */
  static async deleteSection(id: string) {
    const section = await CurriculumGateway.getSectionById(id);
    if (!section) throw new NotFoundError(`Section with ID ${id} not found`);

    const modules = await CurriculumGateway.getModulesForRenumber(section.courseId);

    return CurriculumGateway.runTransaction(async (db) => {
      for (const module of modules.filter((current) => current.sectionId === id)) {
        await CurriculumGateway.softDeleteModule(module.id, db);
      }
      const deleted = await CurriculumGateway.softDeleteSection(id, section.courseId, db);
      await CurriculumService.renumberCourse(section.courseId, db);
      return deleted;
    });
  }

  /**
   * Restoring puts the section back on the end of the course. Its old place has
   * long since been taken by whatever closed the gap, so there is nowhere to put
   * it back to — the end is the one position that is always free and never
   * displaces anyone.
   */
  static async restoreSection(id: string) {
    const section = await CurriculumGateway.findDeletedSection(id);
    if (!section) throw new NotFoundError(`Section with ID ${id} is not in the recycle bin`);

    const restored = await CurriculumGateway.runTransaction(async (db) => {
      const brought = await CurriculumGateway.restoreSection(id, section.courseId, db);
      await CurriculumService.renumberCourse(section.courseId, db);
      return brought;
    });

    await CurriculumGateway.touchDraft(section.courseId);
    return restored;
  }

  // ---- Modules ----

  /**
   * Adds a module to a section. `position` is where in that section it goes,
   * defaulting to the end; the grid renumbers around it either way.
   */
  static async createModule(
    courseId: string,
    data: {
      sectionId?: string;
      position?: number | string;
      title?: string;
      estimatedMinutes?: number | string;
    },
  ) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);

    const moduleTitle = requiredText(data.title, 'title', 'module title');

    const sections = await CurriculumGateway.getSections(courseId);
    if (sections.length === 0) {
      throw new Error('add a section before adding modules — a module lives inside one');
    }

    // No section named means the last one, which is where an author adding
    // modules in order expects them to land.
    const section = data.sectionId
      ? sections.find((current) => current.id === data.sectionId)
      : sections[sections.length - 1];
    if (!section)
      throw new NotFoundError(`Section with ID ${data.sectionId} not found in this course`);

    const siblings = (await CurriculumGateway.getModulesForRenumber(courseId)).filter(
      (module) => module.sectionId === section.id,
    );
    const place = validatePlace(data.position, siblings.length + 1, 'module position');
    const estimatedMinutes = validateMinutes(data.estimatedMinutes);

    const module = await CurriculumGateway.runTransaction(async (db) => {
      // Open the slot before filling it. The other way round leaves two modules
      // briefly sharing a position, and position is what decides the order — the
      // renumber pass would have nothing to break the tie with.
      for (const sibling of siblings.filter((current) => current.position >= place)) {
        await CurriculumGateway.updateModule(sibling.id, { position: sibling.position + 1 }, db);
      }

      const created = await CurriculumGateway.createModule(
        {
          courseId,
          sectionId: section.id,
          position: place,
          // Parked: renumberCourse writes the real number a moment later, and
          // this cannot collide with one in use.
          number: `inserting-${section.id}`,
          sortKey: `inserting-${section.id}`,
          title: moduleTitle,
          estimatedMinutes,
        },
        db,
      );

      await CurriculumService.renumberCourse(courseId, db);
      return created;
    });

    // Deliberately silent. A module that has not been published cannot be
    // reached, so telling learners about it now would send them looking for
    // something that is not there. The publish endpoint announces instead.
    return CurriculumGateway.getModuleById(module.id);
  }

  /**
   * Title and time only. A module's number is its place in the grid, so it moves
   * by being dragged, not by being typed.
   */
  static async updateModule(
    id: string,
    data: { title?: string; estimatedMinutes?: number | string },
  ) {
    const existing = await CurriculumGateway.getModuleById(id);
    if (!existing) throw new NotFoundError(`Module with ID ${id} not found`);

    const nextTitle =
      data.title !== undefined ? requiredText(data.title, 'title', 'module title') : undefined;

    return CurriculumGateway.updateModule(id, {
      ...(nextTitle !== undefined ? { title: nextTitle } : {}),
      ...(data.estimatedMinutes !== undefined
        ? { estimatedMinutes: validateMinutes(data.estimatedMinutes) }
        : {}),
    });
  }

  /**
   * Applies a whole new grid in one transaction — what the drag-to-reorder UI
   * sends. `sections` is the two-dimensional array itself: outer entries are the
   * sections in their new order, each carrying its module ids in theirs. Numbers
   * are never sent, because they are entirely implied by the positions.
   */
  static async reorderStructure(
    courseId: string,
    sections: Array<{ id: string; moduleIds: string[] }>,
  ) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);
    if (!Array.isArray(sections)) throw new Error('sections must be a list');

    const knownSections = new Set(course.sections.map((section) => section.id));
    if (sections.some((entry) => !knownSections.has(entry.id))) {
      throw new Error('reorder included a section that is not in this course');
    }
    if (new Set(sections.map((entry) => entry.id)).size !== sections.length) {
      throw new Error('reorder listed the same section twice');
    }
    if (sections.length !== knownSections.size) {
      throw new Error('reorder must list every section in the course');
    }

    const knownModules = new Set(course.modules.map((module) => module.id));
    const orderedModuleIds = sections.flatMap((entry) => entry.moduleIds);
    if (orderedModuleIds.some((moduleId) => !knownModules.has(moduleId))) {
      throw new Error('reorder included a module that is not in this course');
    }
    if (new Set(orderedModuleIds).size !== orderedModuleIds.length) {
      throw new Error('reorder listed the same module twice');
    }
    if (orderedModuleIds.length !== knownModules.size) {
      throw new Error('reorder must list every module in the course');
    }

    await CurriculumGateway.runTransaction(async (db) => {
      // State the arrangement — section order, then each module's section and
      // place within it — and let renumberCourse turn it into numbers. Module
      // numbers are parked first because the requested arrangement will reuse
      // values that other modules still hold.
      await CurriculumService.parkSectionOrder(courseId, sections, db);

      for (const [index, moduleId] of orderedModuleIds.entries()) {
        await CurriculumGateway.updateModule(
          moduleId,
          { number: `reordering-${index}-${moduleId}`, sortKey: `reordering-${index}` },
          db,
        );
      }

      for (const entry of sections) {
        for (const [position, moduleId] of entry.moduleIds.entries()) {
          await CurriculumGateway.updateModule(
            moduleId,
            { sectionId: entry.id, position: position + 1 },
            db,
          );
        }
      }

      await CurriculumService.renumberCourse(courseId, db);
    });

    // Read after the transaction commits — a read issued on the global client from
    // inside it would not see the new numbering.
    return CurriculumGateway.getCourseById(courseId);
  }

  /** Soft delete — recoverable from the admin dashboard. */
  static async deleteModule(id: string) {
    const module = await CurriculumGateway.getModuleById(id);
    if (!module) throw new NotFoundError(`Module with ID ${id} not found`);

    return CurriculumGateway.runTransaction(async (db) => {
      const deleted = await CurriculumGateway.softDeleteModule(id, db);
      await CurriculumService.renumberCourse(module.courseId, db);
      return deleted;
    });
  }

  /** Restoring puts the module back on the end of its section, then renumbers. */
  static async restoreModule(id: string) {
    const module = await CurriculumGateway.findDeletedModule(id);
    if (!module) throw new NotFoundError(`Module with ID ${id} is not in the recycle bin`);

    // A module only has a number because it sits in a section. Restoring it into
    // one that is itself in the bin would leave it live but unnumbered and
    // unreachable, so the section has to come back first.
    const section = module.sectionId
      ? await CurriculumGateway.getSectionById(module.sectionId)
      : null;
    if (!section) {
      throw new Error("restore this module's section first — a module lives inside one");
    }

    const restored = await CurriculumGateway.runTransaction(async (db) => {
      const brought = await CurriculumGateway.restoreModule(id, section.id, db);
      await CurriculumService.renumberCourse(module.courseId, db);
      return brought;
    });

    await CurriculumGateway.touchDraft(module.courseId);
    return restored;
  }

  /**
   * Stores an uploaded file on a module. Images become IMAGE elements (HEIC is
   * transcoded to JPEG first), PDFs become PDF elements shown in a viewer.
   */
  static async addUploadedElement(moduleId: string, file: Express.Multer.File) {
    const module = await CurriculumGateway.getModuleById(moduleId);
    if (!module) throw new NotFoundError(`Module with ID ${moduleId} not found`);

    const normalized = await normalizeUpload(file);

    return CurriculumGateway.runTransaction(async (db) => {
      const last = await CurriculumGateway.getLastElementOrder(moduleId, db);
      return CurriculumGateway.createElement(
        moduleId,
        {
          type: normalized.isPdf ? 'PDF' : 'IMAGE',
          imageData: normalized.buffer.toString('base64'),
          imageType: normalized.mimeType,
          fileName: file.originalname || null,
        },
        (last?.order ?? 0) + 1,
        db,
      );
    });
  }

  static async createElement(
    moduleId: string,
    data: {
      type: string;
      videoUrl?: string;
      imageUrl?: string;
      textContent?: string;
      durationMinutes?: number | string;
    },
  ) {
    const module = await CurriculumGateway.getModuleById(moduleId);
    if (!module) throw new NotFoundError(`Module with ID ${moduleId} not found`);

    if (!ELEMENT_TYPES.includes(data.type)) {
      throw new Error(`type must be one of ${ELEMENT_TYPES.join(', ')}`);
    }
    const type = data.type as ElementType;
    const { durationMinutes, ...rest } = data;

    // Lesson text is rendered as markup for learners, so clean it before storing.
    if (type === 'TEXT' && rest.textContent) {
      rest.textContent = withinLimit(sanitizeRichText(rest.textContent), 'richText', 'lesson text');
    }

    // Linked media is a URL the learner's browser will fetch, so the scheme is
    // checked before it is stored — `javascript:` and `data:` are not links
    // (§3.3.2). Uploaded media does not come through here.
    if (rest.videoUrl !== undefined) {
      rest.videoUrl = safeUrl(rest.videoUrl, 'video link') ?? undefined;
    }
    if (rest.imageUrl !== undefined) {
      rest.imageUrl = safeUrl(rest.imageUrl, 'image URL') ?? undefined;
    }

    return CurriculumGateway.runTransaction(async (db) => {
      // Elements and quizzes share one sequence, so start after whichever is last.
      const last = await CurriculumGateway.getLastContentOrder(moduleId, db);
      return CurriculumGateway.createElement(
        moduleId,
        {
          ...rest,
          type,
          // Only meaningful for video, and drives the "hours of video" figure.
          durationMinutes: type === 'YOUTUBE' ? validateMinutes(durationMinutes) || null : null,
        },
        last + 1,
        db,
      );
    });
  }

  /**
   * Applies a new order across a module's content, where elements and quizzes are
   * interleaved in one list. `items` is the new order, front to back.
   */
  static async reorderModuleContent(
    moduleId: string,
    items: Array<{ kind: 'element' | 'quiz'; id: string }>,
  ) {
    const module = await CurriculumGateway.getModuleById(moduleId);
    if (!module) throw new NotFoundError(`Module with ID ${moduleId} not found`);

    if (!Array.isArray(items)) throw new Error('items must be a list');

    const { elementIds, quizIds } = await CurriculumGateway.getModuleContentIds(moduleId);
    for (const item of items) {
      const known = item.kind === 'element' ? elementIds.has(item.id) : quizIds.has(item.id);
      if (!known) throw new Error('reorder included an item that is not in this module');
    }

    await CurriculumGateway.runTransaction(async (db) => {
      for (const [index, item] of items.entries()) {
        if (item.kind === 'element') {
          await CurriculumGateway.setElementOrder(item.id, index + 1, db);
        } else {
          await CurriculumGateway.setQuizOrder(item.id, index + 1, db);
        }
      }
    });

    // Read after the transaction commits so the caller sees the new order.
    return CurriculumGateway.getModuleById(moduleId);
  }

  static updateElement(
    id: string,
    data: Partial<{
      type: string;
      videoUrl: string | null;
      imageUrl: string | null;
      textContent: string | null;
      durationMinutes: number | string | null;
    }>,
  ) {
    const { type, durationMinutes, ...rest } = data;

    if (type !== undefined && !ELEMENT_TYPES.includes(type)) {
      throw new Error(`type must be one of ${ELEMENT_TYPES.join(', ')}`);
    }

    if (rest.textContent) {
      rest.textContent = withinLimit(sanitizeRichText(rest.textContent), 'richText', 'lesson text');
    }

    // Same scheme check as on create — an edit must not be a way around it.
    if (rest.videoUrl !== undefined) {
      rest.videoUrl = safeUrl(rest.videoUrl, 'video link') ?? null;
    }
    if (rest.imageUrl !== undefined) {
      rest.imageUrl = safeUrl(rest.imageUrl, 'image URL') ?? null;
    }

    return CurriculumGateway.updateElement(id, {
      ...rest,
      ...(type !== undefined ? { type: type as ElementType } : {}),
      ...(durationMinutes !== undefined
        ? { durationMinutes: durationMinutes === null ? null : validateMinutes(durationMinutes) }
        : {}),
    });
  }

  static deleteElement(id: string) {
    return CurriculumGateway.deleteElement(id);
  }

  static async recordModuleView(userId: number, moduleId: string) {
    const module = await CurriculumGateway.getModuleById(moduleId);
    if (!module) throw new NotFoundError(`Module with ID ${moduleId} not found`);
    return CurriculumGateway.recordModuleView(userId, moduleId);
  }

  /**
   * Records that one piece of content was opened, and credits its module at the
   * same time. Opening anything inside a module has always counted as opening
   * the module, and doing both here means a sequential course cannot end up with
   * an element ticked inside a module that still looks untouched.
   */
  static async recordElementView(userId: number, elementId: string) {
    const element = await CurriculumGateway.getElementById(elementId);
    if (!element) throw new NotFoundError(`Element with ID ${elementId} not found`);

    await CurriculumGateway.recordModuleView(userId, element.moduleId);
    return CurriculumGateway.recordElementView(userId, elementId);
  }

  static getViewedModuleIds(userId: number) {
    return CurriculumGateway.getViewedModuleIds(userId);
  }

  /** Viewed modules and elements, and attempted quizzes — what "done" is measured against. */
  static async getLearnerProgress(userId: number) {
    const [views, elementViews, attempts] = await Promise.all([
      CurriculumGateway.getViewedModuleIds(userId),
      CurriculumGateway.getViewedElementIds(userId),
      QuizGateway.getAttemptsForUser(userId),
    ]);

    return {
      viewedModuleIds: views.map((view) => view.moduleId),
      viewedElementIds: elementViews.map((view) => view.elementId),
      attemptedQuizIds: [...new Set(attempts.map((attempt) => attempt.quizId))],
    };
  }
}
