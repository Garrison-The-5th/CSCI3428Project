/**
 * File: curriculum-service.ts
 * Description: Course, module, section and element rules, including the numbering grid.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-25
 */
import { addCanvasImage, emptyCanvas, mergeCanvasLayout } from '@/config/canvas';
import { logger } from '@/config/logger';
import { normalizeUpload } from '@/config/media-upload';
import { parseModuleColor } from '@/config/module-colors';
import { sanitizeRichText } from '@/config/rich-text';
import {
  cleanStringList,
  type FieldName,
  isLockedOut,
  optionalText,
  parseDaysRemaining,
  requiredText,
  safeUrl,
  withinLimit,
} from '@/config/validation';
import { NotFoundError } from '@/controllers/http-errors';
import CurriculumGateway, { CourseReach } from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import AuthService from '@/services/auth-service/auth-service';
import CourseMapService from '@/services/course-map-service/course-map-service';
import { DirectedLock } from '@/services/course-map-service/directed-path';
import EnrolmentService, {
  dueFor,
  Enrolment,
} from '@/services/enrolment-service/enrolment-service';
import PublicationService, {
  CourseSnapshot,
} from '@/services/publication-service/publication-service';
import QuizService, { redactAnswers } from '@/services/quiz-service/quiz-service';

import { CourseKind, ElementType, Prisma, QuizType } from '../../../generated/prisma';

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
 * A course is a two-dimensional grid: modules are the outer index and sections
 * the inner one, both 1-based and always contiguous. Section "2.3" is the third
 * section of the second module, and nothing else can be expressed — there is no
 * free-text number to validate any more, because position in the grid is the
 * only source of truth.
 *
 * Every write that can move something calls `renumberCourse`, which rewrites the
 * whole grid. That is what keeps a drag, a delete, or an insert in the middle
 * from ever leaving a hole.
 */

/** "2.3" — what the learner sees. */
export function toNumber(moduleNumber: number, position: number): string {
  return `${moduleNumber}.${position}`;
}

/**
 * "000002.000003" — the stored ordering key. Zero padding is what stops "1.10"
 * from sorting before "1.2" under plain string comparison.
 */
export function toSortKey(moduleNumber: number, position: number): string {
  return `${String(moduleNumber).padStart(6, '0')}.${String(position).padStart(6, '0')}`;
}

/**
 * A module's place in the course, as typed by the author. Out-of-range values
 * are clamped rather than rejected: "put it at 9" in a four-module course means
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
 * Strips the answer key out of every quiz in a course tree, and the one-time
 * links out of it entirely.
 *
 * A course carries its sections' quizzes, and those carry questions and options —
 * `isCorrect` and all. The gateway reads the tree whole, so any course sent to a
 * learner has to come through here first, or the correct answers ship with it.
 * The quiz endpoints and the guest-link path already redact; this is the same
 * guarantee for the course path.
 *
 * One-time links are dropped for a different reason. A one-time link may now own
 * a quiz set's section, and this is the browsing path — the Learning and Quizzes
 * tabs of somebody signed in. Leaving them in would list a quiz whose whole
 * promise is that the link it was sent in is the only way to it, which is the
 * thing that must stay true even for the person the link was addressed to. The
 * token path does not come through here, so the link itself still opens it.
 */
function redactCourse<
  T extends {
    sections: Array<{
      quizzes: Array<{
        type?: QuizType | null;
        questions: Array<{ options: Array<Record<string, unknown>> }>;
      }>;
    }>;
  },
>(course: T): T {
  return {
    ...course,
    sections: course.sections.map((section) => ({
      ...section,
      quizzes: section.quizzes
        .filter((quiz) => quiz.type !== QuizType.ONE_TIME)
        .map((quiz) => redactAnswers(quiz)),
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

/**
 * A course as this particular learner sees it: their deadline, not the course's.
 *
 * The date printed on a course is the same for everybody, which is exactly what
 * a deadline must not be — the same course handed over in January and in June
 * cannot fall due on one date. The real one is stamped on their assignment, so
 * it is swapped in here, once, on the way out to them. Anything they hold with
 * no deadline, and anything reached without an assignment at all, keeps the
 * course's own date.
 *
 * The quizzes inside come along with it: a quiz in a course is due with the
 * course, so nothing inside can fall due on a date of its own.
 */
function withLearnerDueDate<
  T extends { id: string; dueDate: Date | string | null; lockAfterDue?: boolean },
>(course: T, enrolment: Enrolment): T & { dueDate: Date | null; locked: boolean } {
  const due = dueFor(
    enrolment.dueByCourseId,
    course.id,
    course.dueDate ? new Date(course.dueDate) : null,
  );

  const settled = {
    ...course,
    dueDate: due,
    // Answered here rather than in the browser. A lock the client works out
    // from its own clock is a lock the learner can move, and the clock it
    // would use is not the one the deadline was set against.
    //
    // Past the deadline is not the same as shut: a course whose author turned
    // `lockAfterDue` off still reports itself overdue and still opens.
    locked: isLockedOut(due, course.lockAfterDue),
  };

  if (due === null || !('sections' in course)) return settled;

  return {
    ...settled,
    sections: (course.sections as Array<{ quizzes?: Array<{ dueDate: unknown }> }>).map(
      (section) => ({
        ...section,
        quizzes: (section.quizzes ?? []).map((quiz) => ({ ...quiz, dueDate: due })),
      }),
    ),
  };
}

/** A published course narrowed to one learner's branches, plus what gates them. */
export type DirectedSnapshot = CourseSnapshot & { directedLocks?: DirectedLock[] };

/**
 * Narrows a directed course to the branches this person picked.
 *
 * Runs on every learner-facing read of a course, and does nothing at all unless
 * the snapshot says it was published as a directed one — which no snapshot taken
 * before maps existed does. What comes back is an ordinary course tree in the
 * map's order, so the player, the progress sums and the dashboard all carry on
 * reading a normal course and never learn a map was involved.
 *
 * Someone who has answered nothing gets the root's content and the first quiz,
 * which is the right place for a course to start: it cannot ask what applies to
 * you before you have read what everybody reads.
 */
function withDirectedPath(
  course: CourseSnapshot,
  userId: number | null,
): Promise<DirectedSnapshot> {
  // The rule itself lives on CourseMapService, because four places need it and
  // for a long time only these two had it — see the note there.
  return CourseMapService.forLearner(course, userId);
}

export default class CurriculumService {
  /**
   * Learner view: the published courses this person has actually been enrolled
   * on. Being published makes a course eligible to be assigned, not visible to
   * everyone.
   */
  static async getCoursesForLearner(email: string) {
    const [courses, enrolment, user] = await Promise.all([
      CurriculumGateway.getPublishedCourses(),
      EnrolmentService.forEmail(email),
      AuthService.getUserByEmail(email),
    ]);

    const enrolled = courses.filter((course) => enrolment.courseIds.has(course.id));
    const published = await Promise.all(
      enrolled.map((course) => PublicationService.getLiveSnapshot(course.id)),
    );

    // Served from each course's published snapshot, never from the rows an
    // author is editing — reading the live tables here would leak every
    // unpublished change. A missing snapshot means the course has never been
    // published, so there is nothing for this person to open.
    //
    // Narrowed to their branches here as well as on the course itself, and not
    // only for tidiness: this is what the Learning page counts progress out of,
    // and a directed course measured against every branch would tell somebody
    // they were a third of the way through a course they had in fact finished.
    return Promise.all(
      published
        .filter((snapshot): snapshot is NonNullable<typeof snapshot> => snapshot !== null)
        .map(async (snapshot) =>
          withLearnerDueDate(
            redactCourse(await withDirectedPath(snapshot, user?.id ?? null)),
            enrolment,
          ),
        ),
    );
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
    if (!snapshot) return null;

    const user = await AuthService.getUserByEmail(email);
    const directed = await withDirectedPath(snapshot, user?.id ?? null);

    return withLearnerDueDate(redactCourse(directed), enrolment);
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
      : { newModuleIds: [], newSectionIds: [], newElementIds: [], newQuizIds: [] };

    return { course, newIds };
  }

  /**
   * Author view: drafts included, and only what this person may edit.
   *
   * `isGlobalAuthor` is `'all'` for an admin, who sees every course. For an
   * author it admits the unowned courses that predate the ownership column and
   * nothing more — see `CurriculumGateway.accessibleCourses`.
   */
  static getCoursesForAuthor(userId: number, isGlobalAuthor: CourseReach) {
    return CurriculumGateway.getCoursesForAuthor(userId, isGlobalAuthor);
  }

  static getCourseById(id: string, live = false) {
    return CurriculumGateway.getCourseById(id, live);
  }

  /**
   * A course starts as just a name; everything else is filled in by editing it.
   * It gets one empty module so the author can add a section immediately —
   * sections live inside modules, so a course with none has nowhere to put them.
   */
  static async createCourse(
    title?: string,
    kind: CourseKind = CourseKind.LESSON,
    createdById: number | null = null,
  ) {
    const clean = requiredText(title, 'title', 'title');

    const course = await CurriculumGateway.createCourse(clean, kind, createdById);

    /*
     * One module to hang sections off, because a section cannot exist without
     * one — it is where its number's first digit comes from.
     *
     * A quiz set has exactly this one for its whole life: the author sees a flat
     * list of quizzes and never learns the module is there. Naming it after the
     * set rather than "Module 1" keeps the rail readable in the previews, which
     * do show it.
     */
    await CurriculumGateway.createModule({
      courseId: course.id,
      number: 1,
      title: kind === CourseKind.QUIZ_SET ? clean : 'Module 1',
    });
    return CurriculumGateway.getCourseById(course.id);
  }

  /**
   * A quiz set: a course that holds exactly one quiz and no elements.
   *
   * Deliberately the same Course underneath, rather than a parallel model. It
   * buys publishing, versioning, contributors, assignment and the learner path
   * for nothing, and means a quiz set can be handed out exactly as a lesson is.
   *
   * The quiz is made here rather than by the author afterwards. A set holds one
   * quiz and only ever one — an exam, or a one-time link — so the empty set the
   * author used to land in was a state with exactly one legal move in it, and a
   * structure pane whose whole job was to offer that move. Both are gone: the
   * container arrives with its quiz, and the editor opens on the questions.
   *
   * The section under it is the row that carries the name, the minutes and the
   * order; the author never sees it as a thing of its own.
   */
  static async createQuizSet(title?: string, createdById: number | null = null) {
    // Cleaned here as well as inside createCourse, so the section and the quiz
    // are named from what the author typed rather than from whatever the
    // gateway echoes back — the round trip is a read of the new row, and
    // depending on a field of it to name two more is a needless coupling.
    const clean = requiredText(title, 'title', 'title');

    const course = await CurriculumService.createCourse(clean, CourseKind.QUIZ_SET, createdById);
    if (!course) throw new Error('the quiz set could not be created');

    const section = await CurriculumService.createSection(course.id, {
      title: clean,
      estimatedMinutes: 0,
    });
    if (!section) throw new Error('the quiz could not be created');

    // Exam is what "a quiz" means until the author says otherwise, and the
    // editor's type picker is where they say it.
    await QuizService.createQuiz({
      title: clean,
      sectionId: section.id,
      type: QuizType.EXAM,
    });

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
      lockAfterDue?: boolean;
      daysRemaining?: number | string | null;
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

    const daysRemaining = parseDaysRemaining(data.daysRemaining);

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
      ...(data.lockAfterDue !== undefined ? { lockAfterDue: data.lockAfterDue === true } : {}),
      ...(daysRemaining !== undefined ? { daysRemaining } : {}),
      // Only ever false here — publishing goes through PublicationService.
      ...(data.published !== undefined ? { published: false } : {}),
      ...(data.sequential !== undefined ? { sequential: data.sequential === true } : {}),
      ...(data.instructorIds !== undefined
        ? { instructors: { set: data.instructorIds.map((instructorId) => ({ id: instructorId })) } }
        : {}),
    });
  }

  // ---- Per-course contributors ----

  static getEditableCourses(userId: number, isGlobalAuthor: CourseReach) {
    return CurriculumGateway.getCoursesForAuthor(userId, isGlobalAuthor);
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
   * Whether this person may edit this course: they made it, or they were named
   * on it. A global authoring role adds only the unowned courses that predate
   * ownership being recorded.
   */
  static canEditCourse(userId: number, courseId: string, isGlobalAuthor: CourseReach) {
    return CurriculumGateway.canEditCourse(userId, courseId, isGlobalAuthor);
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
    data: { body?: string; sectionId?: string | null },
  ) {
    const body = requiredText(data.body, 'noteBody', 'note');
    return CurriculumGateway.createNote({
      userId,
      courseId,
      sectionId: data.sectionId || null,
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
  static async getDeletedItems(userId: number, isGlobalAuthor: CourseReach) {
    await CurriculumService.purgeExpired();

    // One access decision for the whole bin, so a course and the sections that
    // went down with it can never disagree about who may see them.
    const courseIds = await CurriculumGateway.getAccessibleCourseIds(userId, isGlobalAuthor);

    const [courses, modules, sections] = await Promise.all([
      CurriculumGateway.getDeletedCourses(courseIds),
      CurriculumGateway.getDeletedModules(courseIds),
      CurriculumGateway.getDeletedSections(courseIds),
    ]);
    return { courses, modules, sections, retentionDays: RECYCLE_BIN_DAYS };
  }

  /**
   * Permanently removes anything deleted more than RECYCLE_BIN_DAYS ago.
   *
   * Outermost first, so a course going takes its modules and sections with it by
   * cascade and the later passes only have to deal with what outlived a parent
   * that is still live. Never throws: this runs on a timer and on ordinary reads,
   * and a failed sweep must not take the page down with it.
   */
  static async purgeExpired(days = RECYCLE_BIN_DAYS) {
    const cutoff = new Date(Date.now() - days * 86_400_000);

    try {
      const courses = await CurriculumGateway.purgeCoursesDeletedBefore(cutoff);
      const modules = await CurriculumGateway.purgeModulesDeletedBefore(cutoff);
      const sections = await CurriculumGateway.purgeSectionsDeletedBefore(cutoff);
      const quizzes = await QuizGateway.purgeQuizzesDeletedBefore(cutoff);

      return {
        courses: courses.count,
        modules: modules.count,
        sections: sections.count,
        quizzes: quizzes.count,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to expire recycle bin items');
      return { courses: 0, modules: 0, sections: 0, quizzes: 0 };
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

  static async purgeSection(id: string) {
    const section = await CurriculumGateway.findDeletedSection(id);
    if (!section) throw new NotFoundError(`Section with ID ${id} is not in the recycle bin`);
    return CurriculumGateway.hardDeleteSection(id);
  }

  static async purgeModule(id: string) {
    const module = await CurriculumGateway.findDeletedModule(id);
    if (!module) throw new NotFoundError(`Module with ID ${id} is not in the recycle bin`);
    return CurriculumGateway.hardDeleteModule(id);
  }

  /** Empties the bin back into place, for this person's courses only. */
  static async restoreAll(userId: number, isGlobalAuthor: CourseReach) {
    const courseIds = await CurriculumGateway.getAccessibleCourseIds(userId, isGlobalAuthor);

    // Outermost first: restoring a section whose module is still deleted would
    // leave it stranded, and restoring a container does not touch its contents.
    const courses = await CurriculumGateway.restoreAllCourses(courseIds);
    const modules = await CurriculumGateway.restoreAllModules(courseIds);
    const sections = await CurriculumGateway.restoreAllSections(courseIds);

    // Everything came back on the parked numbers it was deleted with, so the
    // grid has to be rebuilt before any of it is readable.
    for (const courseId of await CurriculumGateway.getLiveCourseIds(courseIds)) {
      await CurriculumGateway.runTransaction((db) =>
        CurriculumService.renumberCourse(courseId, db),
      );
    }

    return { courses: courses.count, modules: modules.count, sections: sections.count };
  }

  static async purgeAll(userId: number, isGlobalAuthor: CourseReach) {
    const courseIds = await CurriculumGateway.getAccessibleCourseIds(userId, isGlobalAuthor);

    // Deleting a course cascades to its modules and sections, so work outward in
    // and let each later pass clear whatever survived because its parent is live.
    const courses = await CurriculumGateway.purgeCourses(courseIds);
    const modules = await CurriculumGateway.purgeModules(courseIds);
    const sections = await CurriculumGateway.purgeSections(courseIds);
    return { courses: courses.count, modules: modules.count, sections: sections.count };
  }

  // ---- Modules and the numbering grid ----

  /**
   * Rewrites every module number and section number in a course so the grid runs
   * 1..n with no gaps, in the order things currently sit. Every mutation that can
   * disturb the grid finishes by calling this, which is why nothing else in this
   * file ever computes a number.
   *
   * Both passes park their rows on throwaway values first. The unique indexes on
   * (courseId, number) for modules and sections are checked row by row, and
   * renumbering permutes values among existing rows — closing a gap turns
   * "1.2, 1.3" into "1.1, 1.2", which collides half way through unless the old
   * values are out of the way.
   */
  static async renumberCourse(courseId: string, db: Prisma.TransactionClient) {
    const modules = await CurriculumGateway.getModules(courseId, db);
    const sections = await CurriculumGateway.getSectionsForRenumber(courseId, db);

    // Park below every number the course holds, recycled modules included.
    // Plain -1, -2… would be wrong: a module soft-deleted a moment ago is
    // already sitting down there, and parking on top of it trips the same unique
    // index this is trying to step around.
    const floor = await CurriculumGateway.getLowestModuleNumber(courseId, db);
    for (const [index, module] of modules.entries()) {
      await CurriculumGateway.updateModule(module.id, { number: floor - (index + 1) }, db);
    }
    for (const [index, section] of sections.entries()) {
      await CurriculumGateway.updateSection(
        section.id,
        { number: `renumbering-${index}-${section.id}`, sortKey: `renumbering-${index}` },
        db,
      );
    }

    const sectionsByModule = new Map<string, typeof sections>();
    for (const section of sections) {
      if (!section.moduleId) continue;
      const bucket = sectionsByModule.get(section.moduleId) ?? [];
      bucket.push(section);
      sectionsByModule.set(section.moduleId, bucket);
    }

    for (const [index, module] of modules.entries()) {
      const moduleNumber = index + 1;
      await CurriculumGateway.updateModule(module.id, { number: moduleNumber }, db);

      const owned = sectionsByModule.get(module.id) ?? [];
      for (const [sectionIndex, section] of owned.entries()) {
        const position = sectionIndex + 1;
        await CurriculumGateway.updateSection(
          section.id,
          {
            position,
            number: toNumber(moduleNumber, position),
            sortKey: toSortKey(moduleNumber, position),
          },
          db,
        );
      }
    }
  }

  /**
   * Writes the intended module order somewhere no live or recycled number can
   * reach, keeping that order under an ascending sort. renumberCourse reads it
   * back and turns it into 1..n.
   *
   * Ordering and numbering are separated like this because the unique index on
   * (courseId, number) makes it impossible to shuffle numbers among existing
   * rows in place — some intermediate state always collides. Saying "this is the
   * order" in a range nothing else occupies sidesteps the problem entirely.
   */
  static async parkModuleOrder(
    courseId: string,
    ordered: Array<{ id: string }>,
    db: Prisma.TransactionClient,
  ) {
    const floor = await CurriculumGateway.getLowestModuleNumber(courseId, db);
    // Ascending within the band, so a sort by number reproduces `ordered`.
    const base = floor - ordered.length;

    for (const [index, module] of ordered.entries()) {
      await CurriculumGateway.updateModule(module.id, { number: base + index }, db);
    }
  }

  static getModules(courseId: string) {
    return CurriculumGateway.getModules(courseId);
  }

  /**
   * A module is just a title and a place in the course. The place is where the
   * author says it goes: asking for 2 in a three-module course pushes the old
   * module 2 and everything after it down one.
   */
  static async createModule(
    courseId: string,
    data: { title?: string; number?: number | string; color?: string | null },
  ) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);
    const moduleTitle = requiredText(data.title, 'title', 'module title');

    const color = parseModuleColor(data.color);
    const existing = await CurriculumGateway.getModules(courseId);
    const place = validatePlace(data.number, existing.length + 1, 'module number');

    const module = await CurriculumGateway.runTransaction(async (db) => {
      // Born out of the way; the ordering pass below is what decides its place.
      const floor = await CurriculumGateway.getLowestModuleNumber(courseId, db);
      const created = await CurriculumGateway.createModule(
        { courseId, number: floor - 1, title: moduleTitle, color },
        db,
      );

      const ordered = [...existing];
      ordered.splice(place - 1, 0, created);

      await CurriculumService.parkModuleOrder(courseId, ordered, db);
      await CurriculumService.renumberCourse(courseId, db);
      return created;
    });

    return CurriculumGateway.getModuleById(module.id);
  }

  static async updateModule(
    id: string,
    data: { title?: string; number?: number | string; color?: string | null },
  ) {
    const module = await CurriculumGateway.getModuleById(id);
    if (!module) throw new NotFoundError(`Module with ID ${id} not found`);

    const nextModuleTitle =
      data.title !== undefined ? requiredText(data.title, 'title', 'module title') : undefined;

    // Validated before the transaction opens: a bad colour should fail the whole
    // request rather than roll back a renumber half way through.
    const color = data.color !== undefined ? parseModuleColor(data.color) : undefined;
    const existing = await CurriculumGateway.getModules(module.courseId);

    await CurriculumGateway.runTransaction(async (db) => {
      if (nextModuleTitle !== undefined) {
        await CurriculumGateway.updateModule(id, { title: nextModuleTitle }, db);
      }

      if (color !== undefined) {
        await CurriculumGateway.updateModule(id, { color }, db);
      }

      if (data.number !== undefined) {
        const place = validatePlace(data.number, existing.length, 'module number');
        const reordered = existing.filter((current) => current.id !== id);
        reordered.splice(place - 1, 0, module);

        await CurriculumService.parkModuleOrder(module.courseId, reordered, db);
      }

      await CurriculumService.renumberCourse(module.courseId, db);
    });

    return CurriculumGateway.getModuleById(id);
  }

  /**
   * Soft delete — recoverable from the admin dashboard. The module's sections go
   * with it, because a section with no module has no number.
   */
  static async deleteModule(id: string) {
    const module = await CurriculumGateway.getModuleById(id);
    if (!module) throw new NotFoundError(`Module with ID ${id} not found`);

    const sections = await CurriculumGateway.getSectionsForRenumber(module.courseId);

    return CurriculumGateway.runTransaction(async (db) => {
      for (const section of sections.filter((current) => current.moduleId === id)) {
        await CurriculumGateway.softDeleteSection(section.id, db);
      }
      const deleted = await CurriculumGateway.softDeleteModule(id, module.courseId, db);
      await CurriculumService.renumberCourse(module.courseId, db);
      return deleted;
    });
  }

  /**
   * Restoring puts the module back on the end of the course. Its old place has
   * long since been taken by whatever closed the gap, so there is nowhere to put
   * it back to — the end is the one position that is always free and never
   * displaces anyone.
   */
  static async restoreModule(id: string) {
    const module = await CurriculumGateway.findDeletedModule(id);
    if (!module) throw new NotFoundError(`Module with ID ${id} is not in the recycle bin`);

    const restored = await CurriculumGateway.runTransaction(async (db) => {
      const brought = await CurriculumGateway.restoreModule(id, module.courseId, db);
      await CurriculumService.renumberCourse(module.courseId, db);
      return brought;
    });

    await CurriculumGateway.touchDraft(module.courseId);
    return restored;
  }

  // ---- Sections ----

  /**
   * Adds a section to a module. `position` is where in that module it goes,
   * defaulting to the end; the grid renumbers around it either way.
   */
  static async createSection(
    courseId: string,
    data: {
      moduleId?: string;
      position?: number | string;
      title?: string;
      estimatedMinutes?: number | string;
      color?: string | null;
    },
  ) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);

    // A quiz set holding a one-time link is closed to anything else. The link is
    // issued for the whole course, so a second quiz beside it would be handed
    // over with it and would still be reachable by anyone keeping the URL after
    // the one-time quiz closed. QuizService guards the same rule from the other
    // side — see `assertOneTimeIsAlone` — so neither order of operations gets
    // around it.
    if (await QuizGateway.findOneTimeQuiz(courseId)) {
      throw new Error(
        'this set is a one-time link, which has to be the only quiz in it — make a new set for ' +
          'anything else',
      );
    }

    const sectionTitle = requiredText(data.title, 'title', 'section title');
    // Validated before the transaction opens: a bad colour should fail the whole
    // request rather than roll back a renumber half way through.
    const color = data.color !== undefined ? parseModuleColor(data.color) : null;

    const modules = await CurriculumGateway.getModules(courseId);
    if (modules.length === 0) {
      throw new Error('add a module before adding sections — a section lives inside one');
    }

    // A course map's generated quiz modules hold their own quiz and nothing
    // else — the map writes them, and a section put there by hand would be
    // deleted with the module the next time the map changed.
    const layerModules = await CourseMapService.layerModuleIds(courseId);
    if (data.moduleId && layerModules.has(data.moduleId)) {
      throw new Error(
        'directed learning quiz modules are built by the course map and cannot hold new sections',
      );
    }

    // No module named means the last one the author wrote, which is where an
    // author adding sections in order expects them to land. The map's quiz
    // modules sit after those and are skipped.
    const authored = modules.filter((current) => !layerModules.has(current.id));
    const module = data.moduleId
      ? modules.find((current) => current.id === data.moduleId)
      : authored[authored.length - 1];
    if (!module) {
      throw new NotFoundError(
        data.moduleId
          ? `Module with ID ${data.moduleId} not found in this course`
          : 'add a module before adding sections — a section lives inside one',
      );
    }

    const siblings = (await CurriculumGateway.getSectionsForRenumber(courseId)).filter(
      (section) => section.moduleId === module.id,
    );
    const place = validatePlace(data.position, siblings.length + 1, 'section position');
    const estimatedMinutes = validateMinutes(data.estimatedMinutes);

    const section = await CurriculumGateway.runTransaction(async (db) => {
      // Open the slot before filling it. The other way round leaves two sections
      // briefly sharing a position, and position is what decides the order — the
      // renumber pass would have nothing to break the tie with.
      for (const sibling of siblings.filter((current) => current.position >= place)) {
        await CurriculumGateway.updateSection(sibling.id, { position: sibling.position + 1 }, db);
      }

      const created = await CurriculumGateway.createSection(
        {
          courseId,
          moduleId: module.id,
          position: place,
          // Parked: renumberCourse writes the real number a moment later, and
          // this cannot collide with one in use.
          number: `inserting-${module.id}`,
          sortKey: `inserting-${module.id}`,
          title: sectionTitle,
          estimatedMinutes,
          color,
        },
        db,
      );

      await CurriculumService.renumberCourse(courseId, db);
      return created;
    });

    // Deliberately silent. A section that has not been published cannot be
    // reached, so telling learners about it now would send them looking for
    // something that is not there. The publish endpoint announces instead.
    return CurriculumGateway.getSectionById(section.id);
  }

  /**
   * Title and time only. A section's number is its place in the grid, so it moves
   * by being dragged, not by being typed.
   */
  static async updateSection(
    id: string,
    data: { title?: string; estimatedMinutes?: number | string; color?: string | null },
  ) {
    const existing = await CurriculumGateway.getSectionById(id);
    if (!existing) throw new NotFoundError(`Section with ID ${id} not found`);

    const nextTitle =
      data.title !== undefined ? requiredText(data.title, 'title', 'section title') : undefined;

    return CurriculumGateway.updateSection(id, {
      ...(nextTitle !== undefined ? { title: nextTitle } : {}),
      ...(data.estimatedMinutes !== undefined
        ? { estimatedMinutes: validateMinutes(data.estimatedMinutes) }
        : {}),
      // Same closed palette a module uses; anything outside it is refused rather
      // than stored, because the tint is rendered as a raw inline style.
      ...(data.color !== undefined ? { color: parseModuleColor(data.color) } : {}),
    });
  }

  /**
   * Applies a whole new grid in one transaction — what the drag-to-reorder UI
   * sends. `modules` is the two-dimensional array itself: outer entries are the
   * modules in their new order, each carrying its section ids in theirs. Numbers
   * are never sent, because they are entirely implied by the positions.
   */
  static async reorderStructure(
    courseId: string,
    modules: Array<{ id: string; sectionIds: string[] }>,
  ) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);
    if (!Array.isArray(modules)) throw new Error('modules must be a list');

    const knownModules = new Set(course.modules.map((module) => module.id));
    if (modules.some((entry) => !knownModules.has(entry.id))) {
      throw new Error('reorder included a module that is not in this course');
    }
    if (new Set(modules.map((entry) => entry.id)).size !== modules.length) {
      throw new Error('reorder listed the same module twice');
    }
    if (modules.length !== knownModules.size) {
      throw new Error('reorder must list every module in the course');
    }

    const knownSections = new Set(course.sections.map((section) => section.id));
    const orderedSectionIds = modules.flatMap((entry) => entry.sectionIds);
    if (orderedSectionIds.some((sectionId) => !knownSections.has(sectionId))) {
      throw new Error('reorder included a section that is not in this course');
    }
    if (new Set(orderedSectionIds).size !== orderedSectionIds.length) {
      throw new Error('reorder listed the same section twice');
    }
    if (orderedSectionIds.length !== knownSections.size) {
      throw new Error('reorder must list every section in the course');
    }

    // A map's quiz module keeps exactly the section it was built with: nothing
    // moves in, and its own section does not move out.
    const layerModules = await CourseMapService.layerModuleIds(courseId);
    if (layerModules.size > 0) {
      const homeOf = new Map(course.sections.map((section) => [section.id, section.moduleId]));
      for (const entry of modules) {
        for (const sectionId of entry.sectionIds) {
          const home = homeOf.get(sectionId) ?? null;
          const intoLayer = layerModules.has(entry.id);
          const outOfLayer = home !== null && layerModules.has(home);
          if ((intoLayer || outOfLayer) && home !== entry.id) {
            throw new Error(
              'directed learning quiz modules are built by the course map — sections cannot be ' +
                'moved into or out of them',
            );
          }
        }
      }
    }

    await CurriculumGateway.runTransaction(async (db) => {
      // State the arrangement — module order, then each section's module and
      // place within it — and let renumberCourse turn it into numbers. Section
      // numbers are parked first because the requested arrangement will reuse
      // values that other sections still hold.
      await CurriculumService.parkModuleOrder(courseId, modules, db);

      for (const [index, sectionId] of orderedSectionIds.entries()) {
        await CurriculumGateway.updateSection(
          sectionId,
          { number: `reordering-${index}-${sectionId}`, sortKey: `reordering-${index}` },
          db,
        );
      }

      for (const entry of modules) {
        for (const [position, sectionId] of entry.sectionIds.entries()) {
          await CurriculumGateway.updateSection(
            sectionId,
            { moduleId: entry.id, position: position + 1 },
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
  static async deleteSection(id: string) {
    const section = await CurriculumGateway.getSectionById(id);
    if (!section) throw new NotFoundError(`Section with ID ${id} not found`);

    return CurriculumGateway.runTransaction(async (db) => {
      const deleted = await CurriculumGateway.softDeleteSection(id, db);
      await CurriculumService.renumberCourse(section.courseId, db);
      return deleted;
    });
  }

  /** Restoring puts the section back on the end of its module, then renumbers. */
  static async restoreSection(id: string) {
    const section = await CurriculumGateway.findDeletedSection(id);
    if (!section) throw new NotFoundError(`Section with ID ${id} is not in the recycle bin`);

    // A section only has a number because it sits in a module. Restoring it into
    // one that is itself in the bin would leave it live but unnumbered and
    // unreachable, so the module has to come back first.
    const module = section.moduleId
      ? await CurriculumGateway.getModuleById(section.moduleId)
      : null;
    if (!module) {
      throw new Error("restore this section's module first — a section lives inside one");
    }

    const restored = await CurriculumGateway.runTransaction(async (db) => {
      const brought = await CurriculumGateway.restoreSection(id, module.id, db);
      await CurriculumService.renumberCourse(section.courseId, db);
      return brought;
    });

    await CurriculumGateway.touchDraft(section.courseId);
    return restored;
  }

  /**
   * Stores an uploaded file on a section. Images become IMAGE elements (HEIC is
   * transcoded to JPEG first), PDFs become PDF elements shown in a viewer.
   */
  static async addUploadedElement(sectionId: string, file: Express.Multer.File) {
    const section = await CurriculumGateway.getSectionById(sectionId);
    if (!section) throw new NotFoundError(`Section with ID ${sectionId} not found`);

    const normalized = await normalizeUpload(file);

    return CurriculumGateway.runTransaction(async (db) => {
      const last = await CurriculumGateway.getLastElementOrder(sectionId, db);
      return CurriculumGateway.createElement(
        sectionId,
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
    sectionId: string,
    data: {
      type: string;
      videoUrl?: string;
      imageUrl?: string;
      textContent?: string;
      durationMinutes?: number | string;
    },
  ) {
    const section = await CurriculumGateway.getSectionById(sectionId);
    if (!section) throw new NotFoundError(`Section with ID ${sectionId} not found`);

    if (!ELEMENT_TYPES.includes(data.type)) {
      throw new Error(`type must be one of ${ELEMENT_TYPES.join(', ')}`);
    }
    const type = data.type as ElementType;
    // Picked apart rather than spread: the route hands over the whole body, and
    // only these fields belong on a new element.
    const { durationMinutes, videoUrl, imageUrl, textContent } = data;
    const rest = { videoUrl, imageUrl, textContent };

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
      const last = await CurriculumGateway.getLastContentOrder(sectionId, db);
      return CurriculumGateway.createElement(
        sectionId,
        {
          ...rest,
          type,
          // Only meaningful for video, and drives the "hours of video" figure.
          durationMinutes: type === 'YOUTUBE' ? validateMinutes(durationMinutes) || null : null,
          // A canvas starts blank; pictures, text and shapes are added in the editor.
          ...(type === 'CANVAS'
            ? { canvasData: emptyCanvas() as unknown as Prisma.InputJsonValue }
            : {}),
        },
        last + 1,
        db,
      );
    });
  }

  /**
   * Applies a new order across a section's content, where elements and quizzes are
   * interleaved in one list. `items` is the new order, front to back.
   */
  static async reorderSectionContent(
    sectionId: string,
    items: Array<{ kind: 'element' | 'quiz'; id: string }>,
  ) {
    const section = await CurriculumGateway.getSectionById(sectionId);
    if (!section) throw new NotFoundError(`Section with ID ${sectionId} not found`);

    if (!Array.isArray(items)) throw new Error('items must be a list');

    const { elementIds, quizIds } = await CurriculumGateway.getSectionContentIds(sectionId);
    for (const item of items) {
      const known = item.kind === 'element' ? elementIds.has(item.id) : quizIds.has(item.id);
      if (!known) throw new Error('reorder included an item that is not in this section');
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
    return CurriculumGateway.getSectionById(sectionId);
  }

  static async updateElement(
    id: string,
    data: Partial<{
      type: string;
      videoUrl: string | null;
      imageUrl: string | null;
      textContent: string | null;
      durationMinutes: number | string | null;
      canvas: unknown;
    }>,
  ) {
    // Picked apart rather than spread: the route hands over the whole body, and
    // spreading it would let a request write columns no field here names — the
    // stored picture pool among them, which only the upload route may fill.
    const { type, durationMinutes, canvas, videoUrl, imageUrl, textContent } = data;
    const rest = { videoUrl, imageUrl, textContent };

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

    // A canvas sends its layout only. The pictures it draws from stay as stored
    // and are merged back in, so they never travel with an auto-save.
    let canvasData: Prisma.InputJsonValue | undefined;
    if (canvas !== undefined) {
      const element = await CurriculumGateway.getElementCanvas(id);
      if (!element) throw new NotFoundError(`Element with ID ${id} not found`);
      if (element.type !== 'CANVAS') throw new Error('Only a canvas has a canvas layout');
      canvasData = mergeCanvasLayout(
        canvas,
        element.canvasData,
      ) as unknown as Prisma.InputJsonValue;
    }

    return CurriculumGateway.updateElement(id, {
      ...rest,
      ...(type !== undefined ? { type: type as ElementType } : {}),
      ...(durationMinutes !== undefined
        ? { durationMinutes: durationMinutes === null ? null : validateMinutes(durationMinutes) }
        : {}),
      ...(canvasData !== undefined ? { canvasData } : {}),
    });
  }

  /**
   * Adds an uploaded picture to a canvas's pool.
   *
   * Accepts exactly what a course cover photo accepts — the same upload rules,
   * HEIC converted to JPEG, PDFs refused — because a canvas picture has to
   * render as a picture. Returns the picture so the editor can place it without
   * fetching the whole element again.
   */
  static async addCanvasImage(elementId: string, file: Express.Multer.File) {
    const element = await CurriculumGateway.getElementCanvas(elementId);
    if (!element) throw new NotFoundError(`Element with ID ${elementId} not found`);
    if (element.type !== 'CANVAS') throw new Error('Pictures can only be added to a canvas');

    const normalized = await normalizeUpload(file);
    if (normalized.isPdf) throw new Error('A canvas picture must be an image, not a PDF');

    const upload = {
      data: normalized.buffer.toString('base64'),
      mimeType: normalized.mimeType,
      fileName: file.originalname ? withinLimit(file.originalname, 'fileName', 'file name') : null,
    };
    const { canvas, imageId } = addCanvasImage(element.canvasData, upload);
    await CurriculumGateway.updateElement(elementId, {
      canvasData: canvas as unknown as Prisma.InputJsonValue,
    });
    return { imageId, ...canvas.images[imageId] };
  }

  /**
   * Stores an uploaded file on an element that already exists — the image block
   * an author added and is now filling. Same rules as a section upload: images
   * become IMAGE (HEIC transcoded), PDFs become PDF, and any linked URL goes.
   */
  static async replaceUploadedFile(elementId: string, file: Express.Multer.File) {
    const element = await CurriculumGateway.getElementCanvas(elementId);
    if (!element) throw new NotFoundError(`Element with ID ${elementId} not found`);
    if (element.type !== 'IMAGE' && element.type !== 'PDF') {
      throw new Error('Only an image or PDF block takes an uploaded file');
    }

    const normalized = await normalizeUpload(file);

    return CurriculumGateway.updateElement(elementId, {
      type: normalized.isPdf ? 'PDF' : 'IMAGE',
      imageData: normalized.buffer.toString('base64'),
      imageType: normalized.mimeType,
      imageUrl: null,
      fileName: file.originalname ? withinLimit(file.originalname, 'fileName', 'file name') : null,
    });
  }

  static deleteElement(id: string) {
    return CurriculumGateway.deleteElement(id);
  }

  static async recordSectionView(userId: number, sectionId: string) {
    const section = await CurriculumGateway.getSectionById(sectionId);
    if (!section) throw new NotFoundError(`Section with ID ${sectionId} not found`);
    return CurriculumGateway.recordSectionView(userId, sectionId);
  }

  /**
   * Records that one piece of content was opened, and credits its section at the
   * same time. Opening anything inside a section has always counted as opening
   * the section, and doing both here means a sequential course cannot end up with
   * an element ticked inside a section that still looks untouched.
   */
  static async recordElementView(userId: number, elementId: string) {
    const element = await CurriculumGateway.getElementById(elementId);
    if (!element) throw new NotFoundError(`Element with ID ${elementId} not found`);

    await CurriculumGateway.recordSectionView(userId, element.sectionId);
    return CurriculumGateway.recordElementView(userId, elementId);
  }

  static getViewedSectionIds(userId: number) {
    return CurriculumGateway.getViewedSectionIds(userId);
  }

  /** Viewed sections and elements, and attempted quizzes — what "done" is measured against. */
  static async getLearnerProgress(userId: number) {
    const [views, elementViews, attempts] = await Promise.all([
      CurriculumGateway.getViewedSectionIds(userId),
      CurriculumGateway.getViewedElementIds(userId),
      QuizGateway.getAttemptsForUser(userId),
    ]);

    return {
      viewedSectionIds: views.map((view) => view.sectionId),
      viewedElementIds: elementViews.map((view) => view.elementId),
      // Newest first, so a page that needs "the last thing they opened" can take
      // the head of this rather than re-deriving it from the course order.
      elementViews: elementViews.map((view) => ({
        elementId: view.elementId,
        viewedAt: view.viewedAt.toISOString(),
      })),
      attemptedQuizIds: [...new Set(attempts.map((attempt) => attempt.quizId))],
    };
  }
}
