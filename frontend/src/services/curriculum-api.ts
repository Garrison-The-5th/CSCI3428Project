/**
 * File: curriculum-api.ts
 * Description: Client for the course, section, element and note endpoints.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import type { CanvasData, CanvasImageAsset, CanvasLayout } from '@/components/canvas/canvas-model';
import type { Quiz } from '@/services/quiz-api';
import HttpHelper from '@/utils/http-helper';

export type { Quiz };

export type ElementType = 'YOUTUBE' | 'IMAGE' | 'TEXT' | 'PDF' | 'CANVAS';

/**
 * What the upload endpoints accept. HEIC is converted to JPEG server-side so it
 * displays everywhere; PDFs are stored as-is and shown in an embedded viewer.
 * Kept in step with backend/src/config/mediaUpload.ts.
 */
export const UPLOAD_ACCEPT =
  'image/jpeg,image/png,image/gif,image/webp,image/svg+xml,image/bmp,image/heic,image/heif,.heic,.heif,application/pdf';

/** Cover photos must render as a picture, so PDFs are not offered there. */
export const IMAGE_ONLY_ACCEPT =
  'image/jpeg,image/png,image/gif,image/webp,image/svg+xml,image/bmp,image/heic,image/heif,.heic,.heif';

export interface SectionElement {
  id: string;
  order: number;
  type: ElementType;
  videoUrl: string | null;
  imageUrl: string | null;
  /** base64 of an uploaded image or PDF, when uploaded rather than linked. */
  imageData: string | null;
  imageType: string | null;
  /** Original filename, shown on PDF downloads. */
  fileName: string | null;
  textContent: string | null;
  /** Runtime of a video element, used for the "hours of video" figure. */
  durationMinutes: number | null;
  /** A canvas's layout and the pictures it draws from. Absent on rows from before canvases. */
  canvasData?: CanvasData | null;
}

/**
 * The tints an author may put on a module.
 *
 * Deliberately pale, because the tint sits behind section titles rather than
 * beside them. Kept in step with backend/src/config/moduleColors.ts, which
 * refuses anything outside this list.
 */
export const MODULE_COLORS = [
  '#cfe0f5',
  '#d3ecd4',
  '#fbe3c8',
  '#f7d4d6',
  '#e2d7f2',
  '#cfeaea',
  '#efe4cd',
  '#e0e2e6',
] as const;

/**
 * A named group of sections and the first digit of their numbers. Module 2 holds
 * sections 2.1, 2.2, 2.3 — `number` is its 1-based place in the course.
 */
export interface CourseModule {
  id: string;
  courseId: string;
  number: number;
  title: string;
  /** Hex tint from MODULE_COLORS, or null for no tint. */
  color?: string | null;
}

/**
 * A part of a course, inside a module. `number` is "module.position" — "2.3" is
 * the third section of module 2 — and is derived by the server from where the
 * section sits, never typed in.
 */
/**
 * Lesson or quiz set.
 *
 * The same shape underneath — modules holding sections — so everything about
 * publishing, access and the learner path is shared. The kind decides which tab
 * lists it and what the editor offers.
 */
export type CourseKind = 'LESSON' | 'QUIZ_SET';

export interface CourseSection {
  id: string;
  courseId: string;
  moduleId: string | null;
  /** 1-based place within the module: the digit after the dot. */
  position: number;
  number: string;
  title: string;
  estimatedMinutes: number;
  /** Hex tint from MODULE_COLORS, or null for none. */
  color?: string | null;
  elements: SectionElement[];
  quizzes: Quiz[];
}

export interface Instructor {
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  photoData: string | null;
  photoType: string | null;
}

export interface Note {
  id: string;
  courseId: string;
  sectionId: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

/** One layer quiz, and the content a learner must see before it opens. */
export interface DirectedLock {
  quizId: string;
  sectionId: string;
  depth: number;
  requires: string[];
}

export interface Course {
  id: string;
  title: string;
  /** Absent on older payloads, which were all lessons. */
  kind?: CourseKind;
  /** One-line pitch under the title. */
  shortDescription: string | null;
  description: string | null;
  tags: string[];
  languages: string[];
  whatYouWillLearn: string[];
  prerequisites: string[];
  required: boolean;
  /**
   * When this learner's copy falls due, at 11:59 PM on the day it lands.
   *
   * Per person, not per course: it comes from their assignment, so the same
   * course handed over in January and in June carries two different dates here.
   */
  dueDate: string | null;
  /**
   * Past that deadline, so the course is closed and the ways into it are shut.
   *
   * The server's answer, not the browser's. Absent on the author-facing payloads
   * — a deadline is something a learner has, not something a course is.
   */
  locked?: boolean;
  /**
   * How long a learner gets once this is handed to them, in days.
   *
   * The deadline an author sets is a length rather than a date, so the same
   * lesson assigned today and next month gives each person the same run at it.
   * The date is stamped onto the assignment when it is made.
   */
  daysRemaining?: number | null;
  published: boolean;
  /** When on, each section unlocks only once the previous one is finished. */
  sequential: boolean;
  /**
   * Whether the deadline shuts the course, or only reports that it passed.
   *
   * On, and past 11:59 PM on the due day nothing here opens. Off, and the course
   * still says it is overdue everywhere it did before, and the learner may carry
   * on and finish. Absent on older payloads, which all locked.
   */
  lockAfterDue?: boolean;
  /**
   * Whether this course's path is built from a map rather than read straight
   * through.
   *
   * Absent on everything that predates directed learning, which reads as off.
   * On the learner side it is only a fact about how the course was built — what
   * they actually receive has already been narrowed to their branches by the
   * server, so nothing on the player has to branch on it.
   */
  directedLearning?: boolean;
  /** When the author last staged this course to its map. Author payloads only. */
  stagedAt?: string | null;
  /**
   * Which layer quizzes are still shut, and what each is waiting for.
   *
   * A layer quiz is the end of the layer above it — read that content, then say
   * what applies to you next — so it stays closed until that content has been
   * seen. Sent as plain section ids rather than as a rule, because the player
   * already knows how to ask whether a section has been viewed.
   *
   * Only present on a directed course.
   */
  directedLocks?: DirectedLock[];
  publishedAt: string | null;
  /** Which version learners are served. 0 means never published. */
  publishedVersion?: number;
  /** Bumped by every edit; compared against the live version's date. */
  draftUpdatedAt?: string;
  /** base64 cover photo shown on the Learning page. */
  imageData: string | null;
  imageType: string | null;
  createdAt: string;
  updatedAt: string;
  /** Module headings in order. The sections stay flat and point back by id. */
  modules: CourseModule[];
  sections: CourseSection[];
  instructors: Instructor[];
}

/** One module with the sections that belong to it, in order. */
export interface ModuleGroup {
  module: CourseModule;
  sections: CourseSection[];
}

/**
 * The course as the two-dimensional grid it really is: modules in order, each
 * holding its sections in order. `course.sections` arrives flat and already sorted
 * by module-then-position, so this only has to bucket it.
 *
 * Anything left without a live module — which only happens mid-edit, or on data
 * predating modules — is gathered at the end rather than dropped, so a section
 * can never quietly vanish from the page.
 */
export function moduleGroups(course: Course): ModuleGroup[] {
  const groups = course.modules.map((module) => ({ module, sections: [] as CourseSection[] }));
  const byId = new Map(groups.map((group) => [group.module.id, group]));

  const orphans: CourseSection[] = [];
  for (const section of course.sections) {
    const group = section.moduleId ? byId.get(section.moduleId) : undefined;
    if (group) group.sections.push(section);
    else orphans.push(section);
  }

  if (orphans.length > 0) {
    groups.push({
      module: {
        id: 'unmoduleed',
        courseId: course.id,
        number: groups.length + 1,
        title: 'Ungrouped',
        color: null,
      },
      sections: orphans,
    });
  }

  return groups;
}

/** An element or a quiz, as one entry in a section's ordered content list. */
export type SectionContentItem =
  | { kind: 'element'; id: string; order: number; element: SectionElement }
  | { kind: 'quiz'; id: string; order: number; quiz: Quiz };

/**
 * A section's elements and quizzes merged into the single sequence they share,
 * so a quiz can sit between two pieces of content.
 */
export function sectionContent(section: CourseSection): SectionContentItem[] {
  return [
    ...section.elements.map((element): SectionContentItem => ({
      kind: 'element',
      id: element.id,
      order: element.order,
      element,
    })),
    ...section.quizzes.map((quiz): SectionContentItem => ({
      kind: 'quiz',
      id: quiz.id,
      order: quiz.order,
      quiz,
    })),
  ].sort((a, b) => a.order - b.order);
}

/** Totals shown on the course page sidebar. */
export function courseStats(course: Course) {
  const elements = course.sections.flatMap((section) => section.elements);
  return {
    videoMinutes: elements
      .filter((element) => element.type === 'YOUTUBE')
      .reduce((sum, element) => sum + (element.durationMinutes ?? 0), 0),
    articles: elements.filter((element) => element.type === 'TEXT').length,
    resources: elements.filter((element) => element.type === 'PDF' || element.type === 'IMAGE')
      .length,
    quizzes: course.sections.reduce((sum, section) => sum + section.quizzes.length, 0),
    totalMinutes: course.sections.reduce((sum, section) => sum + section.estimatedMinutes, 0),
  };
}

/**
 * Turns a module tint into the pair of inline styles the rails use: a wash
 * behind the group and a solid rule down its left edge.
 *
 * Inline rather than a Tailwind class because the colour is data — the palette
 * lives in one array and the classes would have to be enumerated to match, which
 * is exactly the kind of duplication that goes stale.
 */
export function moduleTint(color?: string | null) {
  if (!color) return {};
  return { backgroundColor: `${color}59`, borderColor: color };
}

/** What one published version added over the one before it. */
export interface NewIds {
  newModuleIds: string[];
  newSectionIds: string[];
  newElementIds: string[];
  newQuizIds: string[];
}

/** Somebody's name as it appears against a version or an edit. */
export interface EditorRef {
  id: number;
  email: string;
  name: string | null;
}

/** One version card in the course editor's Archive tab. */
export interface CourseVersion {
  id: string;
  version: number;
  publishedAt: string;
  /** Null on the live version, which is never archived away. */
  supersededAt: string | null;
  /**
   * Set when somebody kept this version for good.
   *
   * Two different meanings of "archived" meet here, so the words are worth
   * pinning down. `supersededAt` is the ordinary one — replaced, and kept for
   * fourteen days. This is the deliberate one: kept for good, exempt from the
   * sweep, and shown in its own section above the rest.
   */
  archivedAt: string | null;
  newModuleIds: string[];
  newSectionIds: string[];
  newElementIds: string[];
  newQuizIds: string[];
  publishedBy: EditorRef | null;
  archivedBy: EditorRef | null;
}

/** Whether one item is in the live version, the one being read, or both. */
export type DiffStatus = 'added' | 'removed' | 'same';

/**
 * One archived version read against the version learners are on now.
 *
 * `course` is the two trees merged — everything either version has, in the live
 * version's order — and `status` says which is which. Anything marked `same`
 * draws exactly as it does in the editor, which is what makes the marked items
 * stand out at all.
 */
export interface VersionDiff {
  course: Course;
  status: {
    modules: Record<string, DiffStatus>;
    sections: Record<string, DiffStatus>;
    elements: Record<string, DiffStatus>;
    quizzes: Record<string, DiffStatus>;
    questions: Record<string, DiffStatus>;
  };
  version: number;
  liveVersion: number | null;
  /** Nothing differs, so there is no diff worth colouring. */
  identical: boolean;
}

/** One unpublished change: whose it is, when they made it, and whether it is yours. */
export interface EditMark {
  by: string;
  at: string;
  /**
   * Your own change.
   *
   * The server decides it — two colleagues called Sam would both be told the
   * change was theirs if the page compared names, and the page has no business
   * knowing anybody's id to tell them apart.
   */
  mine: boolean;
}

/** Unpublished changes across a course, keyed by id within each kind. */
export interface EditMarks {
  modules: Record<string, EditMark>;
  sections: Record<string, EditMark>;
  elements: Record<string, EditMark>;
  quizzes: Record<string, EditMark>;
  questions: Record<string, EditMark>;
}

/** What one editing claim covers. */
export type EditScope = 'MODULE' | 'QUESTION';

/** One thing somebody currently has open. */
export interface EditLease {
  scope: EditScope;
  targetId: string;
  userId: number;
  /** First name where there is one, else the address. What the lock says. */
  holder: string;
  /** Held by the person asking — so it is not a lock, it is their own claim. */
  mine: boolean;
}

export interface PublicationState {
  /** True when the draft has moved on from what learners are being served. */
  hasUnpublishedChanges: boolean;
  /** Items that exist in the draft but not in the live version. */
  unpublished: NewIds;
  versions: CourseVersion[];
}

export interface DeletedCourse {
  id: string;
  title: string;
  deletedAt: string;
}

/**
 * No number on either of these. A recycled item's old number now belongs to
 * whatever closed the gap behind it, so showing it would name the wrong thing.
 */
export interface DeletedSection {
  id: string;
  title: string;
  deletedAt: string;
  course: { id: string; title: string } | null;
}

export interface DeletedModule {
  id: string;
  title: string;
  deletedAt: string;
  course: { id: string; title: string } | null;
}

/** Builds a data URI for an uploaded image so it can go straight into <img src>. */
export function imageSrc(
  data: string | null,
  type: string | null,
  fallbackUrl?: string | null,
): string | null {
  if (data) return `data:${type ?? 'image/png'};base64,${data}`;
  return fallbackUrl ?? null;
}

export interface CourseProgress {
  courseId: string;
  title: string;
  required: boolean;
  /** This learner's own deadline, at 11:59 PM on the day it falls. */
  dueDate: string | null;
  /**
   * Past that deadline, so the course is closed to them.
   *
   * Decided by the server. The browser's clock is neither the one the deadline
   * was set against nor one the learner cannot change.
   */
  locked?: boolean;
  totalSections: number;
  completedSections: number;
  percentComplete: number;
  totalMinutes: number;
  remainingMinutes: number;
  quizCount?: number;
  /** They finished this course once and content has been added since. */
  hasNewContent?: boolean;
  newSectionCount?: number;
}

/**
 * A quiz chased on its own.
 *
 * Only quizzes handed over individually appear here. One that belongs to a
 * course is part of that course and is chased through it, so it has no course
 * title to carry.
 */
export interface OutstandingQuiz {
  quizId: string;
  title: string;
  questionCount: number;
  dueDate: string | null;
}

/**
 * One line on Upcoming due dates: a course, or a quiz assigned on its own.
 *
 * The two rank against one clock, so the list answers "what is due next" rather
 * than "which course is due next". A quiz inside a course is not here — it falls
 * due with the course, and both would be the same deadline printed twice.
 */
export interface Deadline {
  kind: 'course' | 'quiz';
  id: string;
  title: string;
  dueDate: string;
  overdue: boolean;
  percentComplete: number;
  completedSections: number;
  totalSections: number;
  remainingMinutes: number;
}

/** What a learner has already done — drives ticks and sequential unlocking. */
export interface LearnerProgress {
  viewedSectionIds: string[];
  /** Individual items opened. A sequential course unlocks off these, not sections. */
  viewedElementIds: string[];
  /** The same views with their timestamps, newest first. Drives Continue. */
  elementViews?: Array<{ elementId: string; viewedAt: string }>;
  attemptedQuizIds: string[];
}

export interface Dashboard {
  courseProgress: CourseProgress[];
  /** Finished courses that have gained a section or quiz since. */
  updatedCourses: CourseProgress[];
  outstandingCourses: CourseProgress[];
  outstandingQuizzes: OutstandingQuiz[];
  /** Courses and standalone quizzes together, soonest first. */
  upcomingDeadlines: Deadline[];
  totals: {
    coursesOutstanding: number;
    quizzesOutstanding: number;
    minutesRemaining: number;
  };
}

export const curriculumApi = {
  /** Learner view: the courses assigned to this person. */
  getCourses: async (): Promise<Course[]> => {
    const response = await HttpHelper.get('curriculum/courses');
    return response.courses ?? [];
  },

  /**
   * One course. Worth the separate call rather than filtering getCourses: a
   * course carries its elements' base64 media, so fetching the whole catalogue
   * to render one of them moves megabytes for nothing.
   */
  getCourse: async (courseId: string): Promise<Course | null> => {
    try {
      const response = await HttpHelper.get(`curriculum/courses/${courseId}`);
      return response.course ?? null;
    } catch {
      // Not found and not-enrolled are the same answer here, and both mean
      // "nothing to show" rather than "something broke".
      return null;
    }
  },

  /** The course plus what the version they are reading added, for the New tags. */
  getCourseWithNewIds: async (
    courseId: string,
  ): Promise<{ course: Course; newIds: NewIds } | null> => {
    try {
      const response = await HttpHelper.get(`curriculum/courses/${courseId}`);
      return response.course ? { course: response.course, newIds: response.newIds } : null;
    } catch {
      return null;
    }
  },

  /** Author view: drafts included. */
  getCoursesForAuthor: async (): Promise<Course[]> => {
    const response = await HttpHelper.get('curriculum/courses/manage');
    return response.courses ?? [];
  },

  getDeleted: (): Promise<{
    courses: DeletedCourse[];
    modules: DeletedModule[];
    sections: DeletedSection[];
    /** How long the bin keeps things before clearing them itself. */
    retentionDays: number;
  }> => HttpHelper.get('curriculum/deleted'),

  restoreCourse: (courseId: string) =>
    HttpHelper.post(`curriculum/courses/${courseId}/restore`, {}),

  restoreSection: (sectionId: string) =>
    HttpHelper.post(`curriculum/sections/${sectionId}/restore`, {}),

  /** Restores every deleted course and section. */
  restoreAllDeleted: () => HttpHelper.post('curriculum/deleted/restore-all', {}),

  /** Permanent — empties the curriculum side of the recycle bin. */
  purgeAllDeleted: () => HttpHelper.delete('curriculum/deleted'),

  purgeCourse: (courseId: string) => HttpHelper.delete(`curriculum/deleted/courses/${courseId}`),

  purgeSection: (sectionId: string) =>
    HttpHelper.delete(`curriculum/deleted/sections/${sectionId}`),

  uploadCourseImage: (courseId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return HttpHelper.postFormData(`curriculum/courses/${courseId}/image`, form);
  },

  uploadSectionImage: (sectionId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return HttpHelper.postFormData(`curriculum/sections/${sectionId}/image`, form);
  },

  createCourse: (title: string) => HttpHelper.post('curriculum/courses', { title }),

  /** A course that holds one quiz per section and no elements. */
  createQuizSet: (title: string) => HttpHelper.post('curriculum/quiz-sets', { title }),

  updateCourse: (
    courseId: string,
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
      daysRemaining?: number | null;
      published?: boolean;
      sequential?: boolean;
      lockAfterDue?: boolean;
      instructorIds?: string[];
    },
  ) => HttpHelper.put(`curriculum/courses/${courseId}`, data),

  // ---- Publishing ----

  /**
   * Puts the course live as a new version. The same call whether it is the first
   * publish or an update — the server works out which and says so.
   */
  publishCourse: (
    courseId: string,
  ): Promise<{ message: string; version: number; hasNewContent: boolean; added: NewIds }> =>
    HttpHelper.post(`curriculum/courses/${courseId}/publish`, {}),

  /** Whether there is anything to publish, what, and the version history. */
  getPublicationState: (courseId: string): Promise<PublicationState> =>
    HttpHelper.get(`curriculum/courses/${courseId}/publication`),

  /** One archived version's full tree, for the read-only view. */
  getVersion: async (versionId: string): Promise<{ version: number; snapshot: Course }> => {
    const response = await HttpHelper.get(`curriculum/versions/${versionId}`);
    return response.version;
  },

  /**
   * Puts an archived version back in front of learners.
   *
   * Republished under a new number rather than rewound, so the version being
   * rolled back from is itself archived and a restore can be undone.
   */
  restoreVersion: (
    versionId: string,
  ): Promise<{ message: string; version: number; restoredFrom: number }> =>
    HttpHelper.post(`curriculum/versions/${versionId}/restore`, {}),

  /** Permanently removes one archived version. The live one cannot be deleted. */
  deleteVersion: (versionId: string): Promise<{ message: string; version: number }> =>
    HttpHelper.delete(`curriculum/versions/${versionId}`),

  /** One version read against the one learners are on now, for its version card. */
  getVersionDiff: (versionId: string): Promise<VersionDiff> =>
    HttpHelper.get(`curriculum/versions/${versionId}/diff`),

  /**
   * Keeps a version for good, or lets it go back to the ordinary history.
   *
   * Releasing is not deleting: the version returns to the fourteen-day list with
   * its countdown starting again from that moment.
   */
  setVersionArchived: (
    versionId: string,
    archived: boolean,
  ): Promise<{ message: string; version: number; archived: boolean }> =>
    HttpHelper.post(`curriculum/versions/${versionId}/archive`, { archived }),

  // ---- Working alongside somebody else ----

  /** What has changed since the last publish, and who changed it. */
  getEditMarks: async (courseId: string): Promise<EditMarks> => {
    const response = await HttpHelper.get(`curriculum/courses/${courseId}/edit-marks`);
    return response.marks;
  },

  /** What is currently open in this course, and by whom. */
  getEditLeases: async (courseId: string): Promise<EditLease[]> => {
    const response = await HttpHelper.get(`curriculum/courses/${courseId}/edit-leases`);
    return response.leases ?? [];
  },

  /**
   * Takes or renews a claim on one module or question.
   *
   * The same call for both, so the editor sends one thing on opening something
   * and every few seconds after. `granted` is false when somebody else got there
   * first, and `holder` is then the name to put on the lock.
   */
  claimEditLease: (
    courseId: string,
    scope: EditScope,
    targetId: string,
  ): Promise<{ granted: boolean; holder: string | null }> =>
    HttpHelper.post(`curriculum/courses/${courseId}/edit-leases`, { scope, targetId }),

  /** Gives up one claim, or — with no target — everything held in the course. */
  releaseEditLease: (
    courseId: string,
    target?: { scope: EditScope; targetId: string },
  ): Promise<unknown> =>
    HttpHelper.delete(`curriculum/courses/${courseId}/edit-leases`, target ?? {}),

  /**
   * Type-ahead over people already in the system.
   *
   * `accountsOnly` narrows it to people who can actually sign in. A User row is
   * created the moment somebody is assigned anything, so the unfiltered search
   * offers addresses with no login behind them — fine for naming an author,
   * wrong for enrolling somebody on the platform.
   */
  searchUsers: async (
    query: string,
    { accountsOnly = false } = {},
  ): Promise<Array<{ id: number; email: string; name: string | null }>> => {
    const response = await HttpHelper.get(
      `auth/search?q=${encodeURIComponent(query)}${accountsOnly ? '&accounts=1' : ''}`,
    );
    return response.users ?? [];
  },

  /**
   * Whether one exact address belongs to somebody who can sign in.
   *
   * What the link-only column checks before handing out a private URL: a person
   * with an account should get the work on their Learning page rather than a
   * link that is a credential in its own right.
   */
  hasAccount: async (email: string): Promise<boolean> => {
    const response = await HttpHelper.get(`auth/has-account?email=${encodeURIComponent(email)}`);
    return response.hasAccount === true;
  },

  // ---- Per-course contributors ----

  getContributors: async (
    courseId: string,
  ): Promise<Array<{ id: number; email: string; name: string | null }>> => {
    const response = await HttpHelper.get(`curriculum/courses/${courseId}/contributors`);
    return response.contributors ?? [];
  },

  setContributors: (courseId: string, emails: string[]) =>
    HttpHelper.put(`curriculum/courses/${courseId}/contributors`, { emails }),

  // ---- Instructors ----

  getInstructors: async (): Promise<Instructor[]> => {
    const response = await HttpHelper.get('curriculum/instructors');
    return response.instructors ?? [];
  },

  createInstructor: (data: { name: string; title?: string; bio?: string }) =>
    HttpHelper.post('curriculum/instructors', data),

  updateInstructor: (id: string, data: { name?: string; title?: string; bio?: string }) =>
    HttpHelper.put(`curriculum/instructors/${id}`, data),

  uploadInstructorPhoto: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return HttpHelper.postFormData(`curriculum/instructors/${id}/photo`, form);
  },

  deleteInstructor: (id: string) => HttpHelper.delete(`curriculum/instructors/${id}`),

  // ---- Learner notes ----

  getNotes: async (courseId: string): Promise<Note[]> => {
    const response = await HttpHelper.get(`curriculum/courses/${courseId}/notes`);
    return response.notes ?? [];
  },

  createNote: (courseId: string, body: string, sectionId?: string | null) =>
    HttpHelper.post(`curriculum/courses/${courseId}/notes`, { body, sectionId }),

  updateNote: (noteId: string, body: string) =>
    HttpHelper.put(`curriculum/notes/${noteId}`, { body }),

  deleteNote: (noteId: string) => HttpHelper.delete(`curriculum/notes/${noteId}`),

  deleteCourse: (courseId: string) => HttpHelper.delete(`curriculum/courses/${courseId}`),

  // ---- Modules ----

  /** A module is a title and the place in the course it should sit at. */
  createModule: (
    courseId: string,
    data: { title: string; number?: number; color?: string | null },
  ) => HttpHelper.post(`curriculum/courses/${courseId}/modules`, data),

  updateModule: (
    moduleId: string,
    data: { title?: string; number?: number; color?: string | null },
  ) => HttpHelper.put(`curriculum/modules/${moduleId}`, data),

  /** Soft delete — the module's sections go to the recycle bin with it. */
  deleteModule: (moduleId: string) => HttpHelper.delete(`curriculum/modules/${moduleId}`),

  restoreModule: (moduleId: string) =>
    HttpHelper.post(`curriculum/modules/${moduleId}/restore`, {}),

  purgeModule: (moduleId: string) => HttpHelper.delete(`curriculum/deleted/modules/${moduleId}`),

  // ---- Sections ----

  /** Lands at the end of `moduleId`, or at `position` within it when given. */
  createSection: (
    courseId: string,
    data: {
      moduleId?: string;
      position?: number;
      title: string;
      estimatedMinutes: number;
      color?: string | null;
    },
  ) => HttpHelper.post(`curriculum/courses/${courseId}/sections`, data),

  /** Numbers come from position in the grid, so they are not editable here. */
  updateSection: (
    sectionId: string,
    data: { title?: string; estimatedMinutes?: number; color?: string | null },
  ) => HttpHelper.put(`curriculum/sections/${sectionId}`, data),

  /**
   * Sends the whole grid: modules in their new order, each with its section ids
   * in theirs. The server derives every number from these positions.
   */
  reorderStructure: (courseId: string, modules: Array<{ id: string; sectionIds: string[] }>) =>
    HttpHelper.put(`curriculum/courses/${courseId}/structure`, { modules }),

  deleteSection: (sectionId: string) => HttpHelper.delete(`curriculum/sections/${sectionId}`),

  createElement: (
    sectionId: string,
    element: {
      type: ElementType;
      videoUrl?: string;
      imageUrl?: string;
      textContent?: string;
      durationMinutes?: number;
    },
  ) => HttpHelper.post(`curriculum/sections/${sectionId}/elements`, element),

  updateElement: (
    elementId: string,
    data: {
      textContent?: string | null;
      videoUrl?: string | null;
      imageUrl?: string | null;
      durationMinutes?: number | null;
      /** The layout only — pictures are uploaded on their own and kept by the server. */
      canvas?: CanvasLayout;
    },
  ) => HttpHelper.put(`curriculum/elements/${elementId}`, data),

  /** Uploads an image or PDF into an existing image block. */
  uploadElementFile: (elementId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return HttpHelper.postFormData(`curriculum/elements/${elementId}/file`, form);
  },

  /** Stores a picture on a canvas. Same rules as a cover photo; placing it is up to the editor. */
  uploadCanvasImage: async (
    elementId: string,
    file: File,
  ): Promise<CanvasImageAsset & { imageId: string }> => {
    const form = new FormData();
    form.append('file', file);
    const response = await HttpHelper.postFormData(
      `curriculum/elements/${elementId}/canvas-images`,
      form,
    );
    return response.image;
  },

  deleteElement: (elementId: string) => HttpHelper.delete(`curriculum/elements/${elementId}`),

  /** Sends a section's elements and quizzes in their new combined order. */
  reorderSectionContent: (
    sectionId: string,
    items: Array<{ kind: 'element' | 'quiz'; id: string }>,
  ) => HttpHelper.put(`curriculum/sections/${sectionId}/content-order`, { items }),

  /** Sections auto-complete on view. */
  recordSectionView: (sectionId: string) =>
    HttpHelper.post(`curriculum/sections/${sectionId}/view`, {}),

  /** One item seen — what unlocks the next on a sequential course. */
  recordElementView: (elementId: string) =>
    HttpHelper.post(`curriculum/elements/${elementId}/view`, {}),

  getDashboard: (): Promise<Dashboard> => HttpHelper.get('curriculum/dashboard'),

  getProgress: (): Promise<LearnerProgress> => HttpHelper.get('curriculum/progress'),
};
