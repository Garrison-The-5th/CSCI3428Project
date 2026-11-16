/**
 * File: curriculum-service.ts
 * Description: Course, model and section rules, including the numbering grid.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-25
 */
import {
  addCanvasImage,
  canvasFromTemplate,
  mergeCanvasLayout,
  setTemplateItem,
  templateItems,
} from '@/config/canvas';
import { logger } from '@/config/logger';
import { normalizeUpload } from '@/config/media-upload';
import { parseModelColor } from '@/config/model-colors';
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
import DefaultTutorialService from '@/services/default-tutorial-service/default-tutorial-service';
import EnrolmentService, {
  dueFor,
  Enrolment,
} from '@/services/enrolment-service/enrolment-service';
import PublicationService, {
  CourseSnapshot,
} from '@/services/publication-service/publication-service';
import QuizService, { redactAnswers } from '@/services/quiz-service/quiz-service';

import { CourseKind, Prisma, QuizType, SectionType } from '../../../generated/prisma';

const SECTION_TYPES = Object.values(SectionType) as string[];

/** The content a section may be given, as it arrives from a request. */
export interface SectionContentInput {
  videoUrl?: string | null;
  imageUrl?: string | null;
  textContent?: string | null;
  durationMinutes?: number | string | null;
}

/**
 * What a section is, read from a request.
 *
 * Required, with no fallback. A section is one piece of content and its type is
 * the first thing an author chooses, so a request that does not name one is
 * refused rather than quietly made into text.
 */
export function parseSectionType(value: unknown): SectionType {
  if (typeof value !== 'string' || !SECTION_TYPES.includes(value)) {
    throw new Error(`a section needs a type — one of ${SECTION_TYPES.join(', ')}`);
  }
  return value as SectionType;
}

/**
 * Cleans the content fields of a section before they are stored.
 *
 * One function for create and update, so an edit can never be a way around a
 * check that creation makes. Only fields that were sent come back.
 */
function cleanSectionContent(type: SectionType, data: SectionContentInput) {
  const out: {
    videoUrl?: string | null;
    imageUrl?: string | null;
    textContent?: string | null;
    durationMinutes?: number | null;
  } = {};

  // Lesson text is rendered as markup for learners, so clean it before storing.
  if (data.textContent !== undefined) {
    out.textContent = data.textContent
      ? withinLimit(sanitizeRichText(data.textContent), 'richText', 'lesson text')
      : data.textContent;
  }

  // Linked media is a URL the learner's browser will fetch, so the scheme is
  // checked before it is stored — `javascript:` and `data:` are not links
  // (§3.3.2). Uploaded media does not come through here.
  if (data.videoUrl !== undefined) out.videoUrl = safeUrl(data.videoUrl, 'video link') ?? null;
  if (data.imageUrl !== undefined) out.imageUrl = safeUrl(data.imageUrl, 'image URL') ?? null;

  // Only meaningful for video, and drives the "hours of video" figure.
  if (data.durationMinutes !== undefined) {
    out.durationMinutes =
      type === SectionType.YOUTUBE && data.durationMinutes !== null
        ? validateMinutes(data.durationMinutes) || null
        : null;
  }

  return out;
}

/**
 * How long something stays in the recycle bin before it goes for good.
 *
 * Two weeks is long enough to notice a mistake and short enough that the bin
 * does not quietly become a second copy of the database — deleted courses carry
 * their sections, and sections carry base64 media.
 */
export const RECYCLE_BIN_DAYS = 14;

/**
 * A course is a two-dimensional grid: models are the outer index and sections
 * the inner one, both 1-based and always contiguous. Section "2.3" is the third
 * section of the second model, and nothing else can be expressed — there is no
 * free-text number to validate any more, because position in the grid is the
 * only source of truth.
 *
 * Every write that can move something calls `renumberCourse`, which rewrites the
 * whole grid. That is what keeps a drag, a delete, or an insert in the middle
 * from ever leaving a hole.
 */

/** "2.3" — what the learner sees. */
export function toNumber(modelNumber: number, position: number): string {
  return `${modelNumber}.${position}`;
}

/**
 * "000002.000003" — the stored ordering key. Zero padding is what stops "1.10"
 * from sorting before "1.2" under plain string comparison.
 */
export function toSortKey(modelNumber: number, position: number): string {
  return `${String(modelNumber).padStart(6, '0')}.${String(position).padStart(6, '0')}`;
}

/**
 * A model's place in the course, as typed by the author. Out-of-range values
 * are clamped rather than rejected: "put it at 9" in a four-model course means
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

/**
 * A whole number of minutes, 0 or more. Blank means 0 (no estimate given);
 * fractions are rounded rather than refused.
 */
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
    // object, and snapshots carry their sections' media.
    const user = await AuthService.getUserByEmail(email);
    const newIds = user
      ? await PublicationService.getNewIdsForLearner(courseId, user.id, course)
      : { newModelIds: [], newSectionIds: [], newQuizIds: [] };

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

  /**
   * One course straight from the live tables — the author's draft, not the
   * published snapshot. Learner-facing reads go through getCourseForLearner.
   */
  static getCourseById(id: string, live = false) {
    return CurriculumGateway.getCourseById(id, live);
  }

  /**
   * A course starts as just a name; everything else is filled in by editing it.
   * It gets one empty model so the author can add a section immediately —
   * sections live inside models, so a course with none has nowhere to put them.
   */
  static async createCourse(
    title?: string,
    kind: CourseKind = CourseKind.LESSON,
    createdById: number | null = null,
  ) {
    const clean = requiredText(title, 'title', 'title');

    const course = await CurriculumGateway.createCourse(clean, kind, createdById);

    /*
     * One model to hang sections off, because a section cannot exist without
     * one — it is where its number's first digit comes from.
     *
     * A quiz set has exactly this one for its whole life: the author sees a flat
     * list of quizzes and never learns the model is there. Naming it after the
     * set rather than "Model 1" keeps the rail readable in the previews, which
     * do show it.
     */
    await CurriculumGateway.createModel({
      courseId: course.id,
      number: 1,
      title: kind === CourseKind.QUIZ_SET ? clean : 'Model 1',
    });
    return CurriculumGateway.getCourseById(course.id);
  }

  /**
   * A quiz set: a course that holds exactly one quiz and nothing else.
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
   * The QUIZ section under it is the row that carries the name, the minutes and
   * the order; the author never sees it as a thing of its own.
   */
  static async createQuizSet(title?: string, createdById: number | null = null) {
    // Cleaned here as well as inside createCourse, so the section and the quiz
    // are named from what the author typed rather than from whatever the
    // gateway echoes back — the round trip is a read of the new row, and
    // depending on a field of it to name two more is a needless coupling.
    const clean = requiredText(title, 'title', 'title');

    const course = await CurriculumService.createCourse(clean, CourseKind.QUIZ_SET, createdById);
    if (!course) throw new Error('the quiz set could not be created');

    // Exam is what "a quiz" means until the author says otherwise, and the
    // editor's type picker is where they say it. Creating a QUIZ section makes
    // its quiz with it.
    const section = await CurriculumService.createSection(course.id, {
      title: clean,
      type: SectionType.QUIZ,
      quizType: QuizType.EXAM,
      estimatedMinutes: 0,
    });
    if (!section) throw new Error('the quiz could not be created');

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

  /**
   * Edits a course's settings and landing-page details. Only the fields present
   * in `data` change; each is validated and bounded before anything is written.
   * Cannot publish — see the check below — but can unpublish.
   */
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
      /** Never accepted; named here only so the tutorial's guard below can see it. */
      kind?: unknown;
    },
  ) {
    const course = await CurriculumGateway.getCourseById(id);
    if (!course) throw new NotFoundError(`Course with ID ${id} not found`);

    // Unpublishing is the one way this route takes content away from learners,
    // and the default tutorial is the one course that must never go. `kind` is
    // never written by this route for any course; it is refused outright for
    // the tutorial so that a request trying it gets an answer rather than a
    // silent no-op.
    if (data.published === false) await DefaultTutorialService.assertNotTutorial(id, 'unpublish');
    if (data.kind !== undefined) await DefaultTutorialService.assertNotTutorial(id, 'kind');

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

  /** The courses this person may edit — the same scope as the author view. */
  static getEditableCourses(userId: number, isGlobalAuthor: CourseReach) {
    return CurriculumGateway.getCoursesForAuthor(userId, isGlobalAuthor);
  }

  /** People named as editors on a course, beyond its owner. */
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

  /** Every instructor profile, alphabetically. */
  static getInstructors() {
    return CurriculumGateway.getInstructors();
  }

  /** Creates an instructor profile with a required name and optional title and bio. */
  static createInstructor(data: { name?: string; title?: string | null; bio?: string | null }) {
    return CurriculumGateway.createInstructor({
      name: requiredText(data.name, 'title', 'instructor name'),
      title: optionalText(data.title, 'title', 'instructor job title') ?? null,
      bio: optionalText(data.bio, 'bio', 'instructor biography') ?? null,
    });
  }

  /** Edits an instructor profile. Blank title or bio clears it; a blank name is refused. */
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

  /** Stores an instructor's photo as base64, with the same upload rules as a cover photo. */
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

  /** Permanently deletes an instructor profile; 404 if it does not exist. */
  static async deleteInstructor(id: string) {
    const instructor = await CurriculumGateway.getInstructorById(id);
    if (!instructor) throw new NotFoundError(`Instructor with ID ${id} not found`);
    return CurriculumGateway.deleteInstructor(id);
  }

  // ---- Learner notes ----

  /** This learner's own notes on a course, newest first. */
  static getNotes(userId: number, courseId: string) {
    return CurriculumGateway.getNotes(userId, courseId);
  }

  /** Saves a learner note, optionally tied to the section it was written on. */
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

  /**
   * Rewrites a note. Someone else's note is reported as not found, the same as
   * a missing one, so note ids cannot be probed.
   */
  static async updateNote(id: string, userId: number, body?: string) {
    const clean = requiredText(body, 'noteBody', 'note');
    const { count } = await CurriculumGateway.updateNote(id, userId, clean);
    if (count === 0) throw new NotFoundError(`Note with ID ${id} not found`);
  }

  /** Deletes a note, with the same not-found rule as updateNote. */
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

  /**
   * Takes the cover photo off, leaving the course with the placeholder card.
   * Like any other edit, learners keep seeing the old photo until the next
   * publish.
   */
  static async removeCourseImage(id: string) {
    const course = await CurriculumGateway.getCourseById(id);
    if (!course) throw new NotFoundError(`Course with ID ${id} not found`);

    return CurriculumGateway.updateCourse(id, { imageData: null, imageType: null });
  }

  /** Soft delete — recoverable from the admin dashboard. */
  static async deleteCourse(id: string) {
    const course = await CurriculumGateway.getCourseById(id);
    if (!course) throw new NotFoundError(`Course with ID ${id} not found`);
    await DefaultTutorialService.assertNotTutorial(id, 'delete');
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
   * The courses currently in the recycle bin, expired items already gone.
   *
   * Courses only (quiz sets are courses, so they are here too). A deleted model
   * or section belongs to a course that is still live and is found in that
   * course's Archive tab — see `getDeletedStructure` — and standalone quizzes
   * are listed by QuizService.
   *
   * Sweeping on read is what makes the two-week rule true without a scheduler:
   * the one place the bin is ever looked at is also the place it is tidied, so
   * what comes back can never contain something that should already have expired.
   * `index.ts` runs the same sweep on a timer for the case where nobody looks.
   */
  static async getDeletedItems(userId: number, isGlobalAuthor: CourseReach) {
    await CurriculumService.purgeExpired();

    const courseIds = await CurriculumGateway.getAccessibleCourseIds(userId, isGlobalAuthor);
    const courses = await CurriculumGateway.getDeletedCourses(courseIds);
    return { courses, retentionDays: RECYCLE_BIN_DAYS };
  }

  /**
   * What one course's Archive tab lists as deleted: models, sections and
   * quizzes, expired ones already gone.
   *
   * Shaped the way it is restored. A deleted model carries its deleted sections
   * nested, because restoring the model brings every one of them back. A
   * section whose model is still live stands on its own. A QUIZ section is
   * listed as the quiz it holds, since that is what the author deleted and what
   * they will look for — and its section is left out of `sections`, so the same
   * thing is never offered twice.
   *
   * The caller has already been checked against this course by
   * `requireCourseEditor`, which goes through `accessibleCourses`.
   */
  static async getDeletedStructure(courseId: string) {
    await CurriculumService.purgeExpired();

    const [{ models, sections }, quizzes] = await Promise.all([
      CurriculumGateway.getDeletedStructure(courseId),
      QuizGateway.getQuizzesInDeletedSections(courseId),
    ]);

    const deletedModelIds = new Set(models.map((model) => model.id));
    const quizBySection = new Map(quizzes.map((quiz) => [quiz.sectionId, quiz]));
    const loose = sections.filter(
      (section) => !section.modelId || !deletedModelIds.has(section.modelId),
    );

    return {
      models: models.map((model) => ({
        ...model,
        sections: sections
          .filter((section) => section.modelId === model.id)
          .map((section) => ({ id: section.id, title: section.title, type: section.type })),
      })),
      sections: loose
        .filter((section) => !quizBySection.has(section.id))
        .map((section) => ({
          id: section.id,
          title: section.title,
          type: section.type,
          deletedAt: section.deletedAt,
        })),
      quizzes: loose
        .filter((section) => quizBySection.has(section.id))
        .map((section) => ({
          id: quizBySection.get(section.id)!.id,
          title: quizBySection.get(section.id)!.title,
          sectionId: section.id,
          sectionTitle: section.title,
          deletedAt: section.deletedAt,
        })),
      retentionDays: RECYCLE_BIN_DAYS,
    };
  }

  /**
   * Permanently removes anything deleted more than RECYCLE_BIN_DAYS ago.
   *
   * Outermost first, so a course going takes its models and sections with it by
   * cascade and the later passes only have to deal with what outlived a parent
   * that is still live. Never throws: this runs on a timer and on ordinary reads,
   * and a failed sweep must not take the page down with it.
   */
  static async purgeExpired(days = RECYCLE_BIN_DAYS) {
    const cutoff = new Date(Date.now() - days * 86_400_000);

    try {
      const courses = await CurriculumGateway.purgeCoursesDeletedBefore(cutoff);
      const models = await CurriculumGateway.purgeModelsDeletedBefore(cutoff);
      const sections = await CurriculumGateway.purgeSectionsDeletedBefore(cutoff);
      const quizzes = await QuizGateway.purgeQuizzesDeletedBefore(cutoff);

      return {
        courses: courses.count,
        models: models.count,
        sections: sections.count,
        quizzes: quizzes.count,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to expire recycle bin items');
      return { courses: 0, models: 0, sections: 0, quizzes: 0 };
    }
  }

  /**
   * Permanently removes a single course from the recycle bin. Refuses anything
   * that is not already soft deleted, so a live course cannot be destroyed by
   * calling this endpoint directly.
   */
  static async purgeCourse(id: string) {
    // Cannot be in the bin to begin with — `deleteCourse` refuses it — but a
    // permanent delete is worth a second lock.
    await DefaultTutorialService.assertNotTutorial(id, 'delete');
    const course = await CurriculumGateway.findDeletedCourse(id);
    if (!course) throw new NotFoundError(`Course with ID ${id} is not in the recycle bin`);
    return CurriculumGateway.hardDeleteCourse(id);
  }

  /** Permanently removes one section from the bin; refuses live sections, like purgeCourse. */
  static async purgeSection(id: string) {
    const section = await CurriculumGateway.findDeletedSection(id);
    if (!section) throw new NotFoundError(`Section with ID ${id} is not in the recycle bin`);
    return CurriculumGateway.hardDeleteSection(id);
  }

  /** Permanently removes one model from the bin; refuses live models, like purgeCourse. */
  static async purgeModel(id: string) {
    const model = await CurriculumGateway.findDeletedModel(id);
    if (!model) throw new NotFoundError(`Model with ID ${id} is not in the recycle bin`);
    return CurriculumGateway.hardDeleteModel(id);
  }

  /**
   * "Restore all" in the recycle bin: every deleted course this person may edit.
   *
   * Courses only. The models and sections deleted inside a live course are not
   * the bin's to restore — they are in that course's Archive — and a restored
   * course comes back exactly as it went, so there is no grid to rebuild.
   */
  static async restoreAll(userId: number, isGlobalAuthor: CourseReach) {
    const courseIds = await CurriculumGateway.getAccessibleCourseIds(userId, isGlobalAuthor);
    const courses = await CurriculumGateway.restoreAllCourses(courseIds);
    return { courses: courses.count };
  }

  /**
   * "Empty recycle bin": permanently deletes the deleted courses among this
   * person's. A model or section deleted inside a live course is left alone —
   * it is in that course's Archive and expires there on its own clock.
   */
  static async purgeAll(userId: number, isGlobalAuthor: CourseReach) {
    const courseIds = await CurriculumGateway.getAccessibleCourseIds(userId, isGlobalAuthor);
    const courses = await CurriculumGateway.purgeCourses(courseIds);
    return { courses: courses.count };
  }

  // ---- Models and the numbering grid ----

  /**
   * Rewrites every model number and section number in a course so the grid runs
   * 1..n with no gaps, in the order things currently sit. Every mutation that can
   * disturb the grid finishes by calling this, which is why nothing else in this
   * file ever computes a number.
   *
   * Both passes park their rows on throwaway values first. The unique indexes on
   * (courseId, number) for models and sections are checked row by row, and
   * renumbering permutes values among existing rows — closing a gap turns
   * "1.2, 1.3" into "1.1, 1.2", which collides half way through unless the old
   * values are out of the way.
   */
  static async renumberCourse(courseId: string, db: Prisma.TransactionClient) {
    const models = await CurriculumGateway.getModels(courseId, db);
    const sections = await CurriculumGateway.getSectionsForRenumber(courseId, db);

    // Park below every number the course holds, recycled models included.
    // Plain -1, -2… would be wrong: a model soft-deleted a moment ago is
    // already sitting down there, and parking on top of it trips the same unique
    // index this is trying to step around.
    const floor = await CurriculumGateway.getLowestModelNumber(courseId, db);
    for (const [index, model] of models.entries()) {
      await CurriculumGateway.updateModel(model.id, { number: floor - (index + 1) }, db);
    }
    for (const [index, section] of sections.entries()) {
      await CurriculumGateway.updateSection(
        section.id,
        { number: `renumbering-${index}-${section.id}`, sortKey: `renumbering-${index}` },
        db,
      );
    }

    const sectionsByModel = new Map<string, typeof sections>();
    for (const section of sections) {
      if (!section.modelId) continue;
      const bucket = sectionsByModel.get(section.modelId) ?? [];
      bucket.push(section);
      sectionsByModel.set(section.modelId, bucket);
    }

    for (const [index, model] of models.entries()) {
      const modelNumber = index + 1;
      await CurriculumGateway.updateModel(model.id, { number: modelNumber }, db);

      const owned = sectionsByModel.get(model.id) ?? [];
      for (const [sectionIndex, section] of owned.entries()) {
        const position = sectionIndex + 1;
        await CurriculumGateway.updateSection(
          section.id,
          {
            position,
            number: toNumber(modelNumber, position),
            sortKey: toSortKey(modelNumber, position),
          },
          db,
        );
      }
    }
  }

  /**
   * Writes the intended model order somewhere no live or recycled number can
   * reach, keeping that order under an ascending sort. renumberCourse reads it
   * back and turns it into 1..n.
   *
   * Ordering and numbering are separated like this because the unique index on
   * (courseId, number) makes it impossible to shuffle numbers among existing
   * rows in place — some intermediate state always collides. Saying "this is the
   * order" in a range nothing else occupies sidesteps the problem entirely.
   */
  static async parkModelOrder(
    courseId: string,
    ordered: Array<{ id: string }>,
    db: Prisma.TransactionClient,
  ) {
    const floor = await CurriculumGateway.getLowestModelNumber(courseId, db);
    // Ascending within the band, so a sort by number reproduces `ordered`.
    const base = floor - ordered.length;

    for (const [index, model] of ordered.entries()) {
      await CurriculumGateway.updateModel(model.id, { number: base + index }, db);
    }
  }

  /** A course's live models in number order. */
  static getModels(courseId: string) {
    return CurriculumGateway.getModels(courseId);
  }

  /**
   * A model is just a title and a place in the course. The place is where the
   * author says it goes: asking for 2 in a three-model course pushes the old
   * model 2 and everything after it down one.
   */
  static async createModel(
    courseId: string,
    data: { title?: string; number?: number | string; color?: string | null },
  ) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);
    const modelTitle = requiredText(data.title, 'title', 'model title');

    const color = parseModelColor(data.color);
    const existing = await CurriculumGateway.getModels(courseId);
    const place = validatePlace(data.number, existing.length + 1, 'model number');

    const model = await CurriculumGateway.runTransaction(async (db) => {
      // Born out of the way; the ordering pass below is what decides its place.
      const floor = await CurriculumGateway.getLowestModelNumber(courseId, db);
      const created = await CurriculumGateway.createModel(
        { courseId, number: floor - 1, title: modelTitle, color },
        db,
      );

      const ordered = [...existing];
      ordered.splice(place - 1, 0, created);

      await CurriculumService.parkModelOrder(courseId, ordered, db);
      await CurriculumService.renumberCourse(courseId, db);
      return created;
    });

    return CurriculumGateway.getModelById(model.id);
  }

  /**
   * Renames, recolours and/or moves a model. A new `number` is a place in the
   * course, like createModel's: the model is lifted out and reinserted there,
   * and the whole grid renumbers around it in the same transaction.
   */
  static async updateModel(
    id: string,
    data: { title?: string; number?: number | string; color?: string | null },
  ) {
    const model = await CurriculumGateway.getModelById(id);
    if (!model) throw new NotFoundError(`Model with ID ${id} not found`);

    const nextModelTitle =
      data.title !== undefined ? requiredText(data.title, 'title', 'model title') : undefined;

    // Validated before the transaction opens: a bad colour should fail the whole
    // request rather than roll back a renumber half way through.
    const color = data.color !== undefined ? parseModelColor(data.color) : undefined;
    const existing = await CurriculumGateway.getModels(model.courseId);

    await CurriculumGateway.runTransaction(async (db) => {
      if (nextModelTitle !== undefined) {
        await CurriculumGateway.updateModel(id, { title: nextModelTitle }, db);
      }

      if (color !== undefined) {
        await CurriculumGateway.updateModel(id, { color }, db);
      }

      if (data.number !== undefined) {
        const place = validatePlace(data.number, existing.length, 'model number');
        const reordered = existing.filter((current) => current.id !== id);
        reordered.splice(place - 1, 0, model);

        await CurriculumService.parkModelOrder(model.courseId, reordered, db);
      }

      await CurriculumService.renumberCourse(model.courseId, db);
    });

    return CurriculumGateway.getModelById(id);
  }

  /**
   * Soft delete — recoverable from the course's Archive tab. The model's
   * sections go with it, because a section with no model has no number.
   */
  static async deleteModel(id: string) {
    const model = await CurriculumGateway.getModelById(id);
    if (!model) throw new NotFoundError(`Model with ID ${id} not found`);

    const sections = await CurriculumGateway.getSectionsForRenumber(model.courseId);

    return CurriculumGateway.runTransaction(async (db) => {
      for (const section of sections.filter((current) => current.modelId === id)) {
        await CurriculumGateway.softDeleteSection(section.id, db);
      }
      const deleted = await CurriculumGateway.softDeleteModel(id, model.courseId, db);
      await CurriculumService.renumberCourse(model.courseId, db);
      return deleted;
    });
  }

  /**
   * Restoring puts the model back on the end of the course. Its old place has
   * long since been taken by whatever closed the gap, so there is nowhere to put
   * it back to — the end is the one position that is always free and never
   * displaces anyone.
   *
   * Its sections come back with it, all of them, in the order they held. A
   * model restored empty would be a heading with nothing under it, and the
   * author would have to find and restore each section by hand to undo one
   * delete.
   */
  static async restoreModel(id: string) {
    const model = await CurriculumGateway.findDeletedModel(id);
    if (!model) throw new NotFoundError(`Model with ID ${id} is not in the recycle bin`);

    const restored = await CurriculumGateway.runTransaction(async (db) => {
      const brought = await CurriculumGateway.restoreModel(id, model.courseId, db);
      for (const section of await CurriculumGateway.getDeletedSectionsOfModel(id, db)) {
        await CurriculumGateway.restoreSection(section.id, id, db);
        await QuizGateway.restoreQuizzesInSection(section.id, db);
      }
      await CurriculumService.renumberCourse(model.courseId, db);
      return brought;
    });

    await CurriculumGateway.touchDraft(model.courseId);
    return restored;
  }

  // ---- Sections ----

  /**
   * Adds a section to a model. `position` is where in that model it goes,
   * defaulting to the end; the grid renumbers around it either way.
   *
   * `type` is required and is the first thing decided: a section is one piece
   * of content, so there is no such thing as a blank one. Its content can come
   * with it or be filled in afterwards. A QUIZ section is made together with
   * its quiz (`quizType`, an exam unless said otherwise), because a QUIZ section
   * with no quiz is a state with nothing in it for an author or a learner.
   */
  static async createSection(
    courseId: string,
    data: {
      modelId?: string;
      position?: number | string;
      title?: string;
      type?: string;
      /** For a QUIZ section: which kind of quiz to make inside it. */
      quizType?: string | null;
      estimatedMinutes?: number | string;
      color?: string | null;
    } & SectionContentInput,
  ) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);

    const type = parseSectionType(data.type);
    // A quiz set is a list of quizzes and nothing else.
    if (course.kind === CourseKind.QUIZ_SET && type !== SectionType.QUIZ) {
      throw new Error('a quiz set holds quizzes only');
    }
    const content = cleanSectionContent(type, data);

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
    const color = data.color !== undefined ? parseModelColor(data.color) : null;

    const models = await CurriculumGateway.getModels(courseId);
    if (models.length === 0) {
      throw new Error('add a model before adding sections — a section lives inside one');
    }

    // A course map's generated quiz models hold their own quiz and nothing
    // else — the map writes them, and a section put there by hand would be
    // deleted with the model the next time the map changed.
    const layerModels = await CourseMapService.layerModelIds(courseId);
    if (data.modelId && layerModels.has(data.modelId)) {
      throw new Error(
        'directed learning quiz models are built by the course map and cannot hold new sections',
      );
    }

    // No model named means the last one the author wrote, which is where an
    // author adding sections in order expects them to land. The map's quiz
    // models sit after those and are skipped.
    const authored = models.filter((current) => !layerModels.has(current.id));
    const model = data.modelId
      ? models.find((current) => current.id === data.modelId)
      : authored[authored.length - 1];
    if (!model) {
      throw new NotFoundError(
        data.modelId
          ? `Model with ID ${data.modelId} not found in this course`
          : 'add a model before adding sections — a section lives inside one',
      );
    }

    const siblings = (await CurriculumGateway.getSectionsForRenumber(courseId)).filter(
      (section) => section.modelId === model.id,
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

      // A canvas starts with whatever the course's authors marked as defaults —
      // blank if it has none.
      const template =
        type === SectionType.CANVAS
          ? await CurriculumGateway.getCanvasTemplate(courseId, db)
          : null;

      const created = await CurriculumGateway.createSection(
        {
          courseId,
          modelId: model.id,
          position: place,
          // Parked: renumberCourse writes the real number a moment later, and
          // this cannot collide with one in use.
          number: `inserting-${model.id}`,
          sortKey: `inserting-${model.id}`,
          title: sectionTitle,
          type,
          estimatedMinutes,
          color,
          ...content,
          ...(type === SectionType.CANVAS
            ? { canvasData: canvasFromTemplate(template) as unknown as Prisma.InputJsonValue }
            : {}),
        },
        db,
      );

      await CurriculumService.renumberCourse(courseId, db);
      return created;
    });

    if (type === SectionType.QUIZ) {
      try {
        await QuizService.createQuiz({
          title: sectionTitle,
          sectionId: section.id,
          type: data.quizType,
        });
      } catch (error) {
        // The quiz was refused (a kind this course cannot hold, say). Take the
        // section back out rather than leave a QUIZ section with no quiz in it.
        await CurriculumGateway.runTransaction(async (db) => {
          await db.section.delete({ where: { id: section.id } });
          await CurriculumService.renumberCourse(courseId, db);
        });
        throw error;
      }
    }

    // Deliberately silent. A section that has not been published cannot be
    // reached, so telling learners about it now would send them looking for
    // something that is not there. The publish endpoint announces instead.
    return CurriculumGateway.getSectionById(section.id);
  }

  /**
   * Edits a section: its heading (title, time, colour) and its content.
   *
   * Not its number — that is its place in the grid, so it moves by being
   * dragged, not by being typed — and not its type, which was chosen when it was
   * made. Content goes through the same sanitising and URL checks as on
   * creation. This is also the canvas auto-save path: `canvas` is the layout
   * only, and the pictures it draws from are merged back in from what is stored.
   */
  static async updateSection(
    id: string,
    data: {
      title?: string;
      estimatedMinutes?: number | string;
      color?: string | null;
      type?: string;
      canvas?: unknown;
    } & SectionContentInput,
  ) {
    const existing = await CurriculumGateway.getSectionById(id);
    if (!existing) throw new NotFoundError(`Section with ID ${id} not found`);

    // Sending the type it already has is allowed, so a form that posts every
    // field back is not an error.
    if (data.type !== undefined && data.type !== existing.type) {
      throw new Error(
        "a section's type is chosen when it is created — add a new section for different content",
      );
    }

    const nextTitle =
      data.title !== undefined ? requiredText(data.title, 'title', 'section title') : undefined;

    // Picked apart rather than spread: the route hands over the whole body, and
    // spreading it would let a request write columns no field here names — the
    // stored picture pool among them, which only the upload route may fill.
    const content = cleanSectionContent(existing.type, {
      videoUrl: data.videoUrl,
      imageUrl: data.imageUrl,
      textContent: data.textContent,
      durationMinutes: data.durationMinutes,
    });

    let canvasData: Prisma.InputJsonValue | undefined;
    if (data.canvas !== undefined) {
      if (existing.type !== SectionType.CANVAS) {
        throw new Error('Only a canvas has a canvas layout');
      }
      canvasData = mergeCanvasLayout(
        data.canvas,
        existing.canvasData,
      ) as unknown as Prisma.InputJsonValue;
    }

    return CurriculumGateway.updateSection(id, {
      ...(nextTitle !== undefined ? { title: nextTitle } : {}),
      ...(data.estimatedMinutes !== undefined
        ? { estimatedMinutes: validateMinutes(data.estimatedMinutes) }
        : {}),
      // Same closed palette a model uses; anything outside it is refused rather
      // than stored, because the tint is rendered as a raw inline style.
      ...(data.color !== undefined ? { color: parseModelColor(data.color) } : {}),
      ...content,
      ...(canvasData !== undefined ? { canvasData } : {}),
    });
  }

  /**
   * Applies a whole new grid in one transaction — what the drag-to-reorder UI
   * sends. `models` is the two-dimensional array itself: outer entries are the
   * models in their new order, each carrying its section ids in theirs. Numbers
   * are never sent, because they are entirely implied by the positions.
   */
  static async reorderStructure(
    courseId: string,
    models: Array<{ id: string; sectionIds: string[] }>,
  ) {
    const course = await CurriculumGateway.getCourseById(courseId);
    if (!course) throw new NotFoundError(`Course with ID ${courseId} not found`);
    if (!Array.isArray(models)) throw new Error('models must be a list');

    const knownModels = new Set(course.models.map((model) => model.id));
    if (models.some((entry) => !knownModels.has(entry.id))) {
      throw new Error('reorder included a model that is not in this course');
    }
    if (new Set(models.map((entry) => entry.id)).size !== models.length) {
      throw new Error('reorder listed the same model twice');
    }
    if (models.length !== knownModels.size) {
      throw new Error('reorder must list every model in the course');
    }

    const knownSections = new Set(course.sections.map((section) => section.id));
    const orderedSectionIds = models.flatMap((entry) => entry.sectionIds);
    if (orderedSectionIds.some((sectionId) => !knownSections.has(sectionId))) {
      throw new Error('reorder included a section that is not in this course');
    }
    if (new Set(orderedSectionIds).size !== orderedSectionIds.length) {
      throw new Error('reorder listed the same section twice');
    }
    if (orderedSectionIds.length !== knownSections.size) {
      throw new Error('reorder must list every section in the course');
    }

    // A map's quiz model keeps exactly the section it was built with: nothing
    // moves in, and its own section does not move out.
    const layerModels = await CourseMapService.layerModelIds(courseId);
    if (layerModels.size > 0) {
      const homeOf = new Map(course.sections.map((section) => [section.id, section.modelId]));
      for (const entry of models) {
        for (const sectionId of entry.sectionIds) {
          const home = homeOf.get(sectionId) ?? null;
          const intoLayer = layerModels.has(entry.id);
          const outOfLayer = home !== null && layerModels.has(home);
          if ((intoLayer || outOfLayer) && home !== entry.id) {
            throw new Error(
              'directed learning quiz models are built by the course map — sections cannot be ' +
                'moved into or out of them',
            );
          }
        }
      }
    }

    await CurriculumGateway.runTransaction(async (db) => {
      // State the arrangement — model order, then each section's model and
      // place within it — and let renumberCourse turn it into numbers. Section
      // numbers are parked first because the requested arrangement will reuse
      // values that other sections still hold.
      await CurriculumService.parkModelOrder(courseId, models, db);

      for (const [index, sectionId] of orderedSectionIds.entries()) {
        await CurriculumGateway.updateSection(
          sectionId,
          { number: `reordering-${index}-${sectionId}`, sortKey: `reordering-${index}` },
          db,
        );
      }

      for (const entry of models) {
        for (const [position, sectionId] of entry.sectionIds.entries()) {
          await CurriculumGateway.updateSection(
            sectionId,
            { modelId: entry.id, position: position + 1 },
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

  /**
   * Soft delete — recoverable from the course's Archive tab.
   *
   * A QUIZ section takes its quiz into the bin with it, so the two are never in
   * different states: deleting the section and deleting the quiz are the same
   * act reached from two buttons.
   */
  static async deleteSection(id: string) {
    const section = await CurriculumGateway.getSectionById(id);
    if (!section) throw new NotFoundError(`Section with ID ${id} not found`);

    return CurriculumGateway.runTransaction(async (db) => {
      const deleted = await CurriculumGateway.softDeleteSection(id, db);
      if (section.type === SectionType.QUIZ) await QuizGateway.softDeleteQuizzesInSection(id, db);
      await CurriculumService.renumberCourse(section.courseId, db);
      return deleted;
    });
  }

  /**
   * Restoring puts the section back on the end of its model, then renumbers. A
   * QUIZ section's quiz comes back with it.
   */
  static async restoreSection(id: string) {
    const section = await CurriculumGateway.findDeletedSection(id);
    if (!section) throw new NotFoundError(`Section with ID ${id} is not in the recycle bin`);

    // A section only has a number because it sits in a model. Restoring it into
    // one that is itself in the bin would leave it live but unnumbered and
    // unreachable, so the model has to come back first.
    const model = section.modelId ? await CurriculumGateway.getModelById(section.modelId) : null;
    if (!model) {
      throw new Error("restore this section's model first — a section lives inside one");
    }

    const restored = await CurriculumGateway.runTransaction(async (db) => {
      const brought = await CurriculumGateway.restoreSection(id, model.id, db);
      await QuizGateway.restoreQuizzesInSection(id, db);
      await CurriculumService.renumberCourse(section.courseId, db);
      return brought;
    });

    await CurriculumGateway.touchDraft(section.courseId);
    return restored;
  }

  /**
   * Adds an uploaded picture to a canvas section's pool.
   *
   * Accepts exactly what a course cover photo accepts — the same upload rules,
   * HEIC converted to JPEG, PDFs refused — because a canvas picture has to
   * render as a picture. Returns the picture so the editor can place it without
   * fetching the whole section again.
   */
  static async addCanvasImage(sectionId: string, file: Express.Multer.File) {
    const section = await CurriculumGateway.getSectionCanvas(sectionId);
    if (!section) throw new NotFoundError(`Section with ID ${sectionId} not found`);
    if (section.type !== SectionType.CANVAS) {
      throw new Error('Pictures can only be added to a canvas');
    }

    const normalized = await normalizeUpload(file);
    if (normalized.isPdf) throw new Error('A canvas picture must be an image, not a PDF');

    const upload = {
      data: normalized.buffer.toString('base64'),
      mimeType: normalized.mimeType,
      fileName: file.originalname ? withinLimit(file.originalname, 'fileName', 'file name') : null,
    };
    const { canvas, imageId } = addCanvasImage(section.canvasData, upload);
    await CurriculumGateway.updateSection(sectionId, {
      canvasData: canvas as unknown as Prisma.InputJsonValue,
    });
    return { imageId, ...canvas.images[imageId] };
  }

  /** The default items of the course a canvas belongs to, without their picture data. */
  static async getCanvasTemplate(courseId: string) {
    return { items: templateItems(await CurriculumGateway.getCanvasTemplate(courseId)) };
  }

  /**
   * Makes one item of a canvas a default for every new canvas in its course, or
   * stops it being one. Pictures are copied from the canvas's stored pool.
   */
  static async setCanvasTemplateItem(
    sectionId: string,
    courseId: string,
    item: unknown,
    include: boolean,
  ) {
    const section = await CurriculumGateway.getSectionCanvas(sectionId);
    if (!section) throw new NotFoundError(`Section with ID ${sectionId} not found`);
    if (section.type !== SectionType.CANVAS) {
      throw new Error('Only a canvas item can be a default');
    }

    const template = setTemplateItem(
      await CurriculumGateway.getCanvasTemplate(courseId),
      item,
      section.canvasData,
      include,
    );
    await CurriculumGateway.saveCanvasTemplate(
      courseId,
      template as unknown as Prisma.InputJsonValue,
    );
    return { items: template.items };
  }

  /**
   * Stores an uploaded file on an IMAGE or PDF section — the block an author
   * added and is now filling. Images stay IMAGE (HEIC is transcoded to JPEG
   * first), a PDF makes it a PDF section shown in a viewer, and any linked URL
   * goes. Those two are the one pair of types a section may move between,
   * because which of them it is depends on the file rather than on a choice.
   */
  static async replaceUploadedFile(sectionId: string, file: Express.Multer.File) {
    const section = await CurriculumGateway.getSectionCanvas(sectionId);
    if (!section) throw new NotFoundError(`Section with ID ${sectionId} not found`);
    if (section.type !== SectionType.IMAGE && section.type !== SectionType.PDF) {
      throw new Error('Only an image or PDF section takes an uploaded file');
    }

    const normalized = await normalizeUpload(file);

    return CurriculumGateway.updateSection(sectionId, {
      type: normalized.isPdf ? SectionType.PDF : SectionType.IMAGE,
      imageData: normalized.buffer.toString('base64'),
      imageType: normalized.mimeType,
      imageUrl: null,
      fileName: file.originalname ? withinLimit(file.originalname, 'fileName', 'file name') : null,
    });
  }

  /** Marks a section as opened by this learner, which is what completes it. */
  static async recordSectionView(userId: number, sectionId: string) {
    const section = await CurriculumGateway.getSectionById(sectionId);
    if (!section) throw new NotFoundError(`Section with ID ${sectionId} not found`);
    return CurriculumGateway.recordSectionView(userId, sectionId);
  }

  /** Every section this learner has opened, with when. */
  static getViewedSectionIds(userId: number) {
    return CurriculumGateway.getViewedSectionIds(userId);
  }

  /** Viewed sections and attempted quizzes — what "done" is measured against. */
  static async getLearnerProgress(userId: number) {
    const [views, attempts] = await Promise.all([
      CurriculumGateway.getViewedSectionIds(userId),
      QuizGateway.getAttemptsForUser(userId),
    ]);

    return {
      viewedSectionIds: views.map((view) => view.sectionId),
      // Newest first, so a page that needs "the last thing they opened" can take
      // the head of this rather than re-deriving it from the course order.
      sectionViews: views.map((view) => ({
        sectionId: view.sectionId,
        viewedAt: view.viewedAt.toISOString(),
      })),
      attemptedQuizIds: [...new Set(attempts.map((attempt) => attempt.quizId))],
    };
  }
}
