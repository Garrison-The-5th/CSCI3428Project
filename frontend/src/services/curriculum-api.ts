/**
 * File: curriculum-api.ts
 * Description: Client for the course, module, element and note endpoints.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import type { Quiz } from '@/services/quiz-api';
import HttpHelper from '@/utils/http-helper';

export type { Quiz };

export type ElementType = 'YOUTUBE' | 'IMAGE' | 'TEXT' | 'PDF';

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

export interface ModuleElement {
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
}

/**
 * The tints an author may put on a section.
 *
 * Deliberately pale, because the tint sits behind module titles rather than
 * beside them. Kept in step with backend/src/config/sectionColors.ts, which
 * refuses anything outside this list.
 */
export const SECTION_COLORS = [
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
 * A named group of modules and the first digit of their numbers. Section 2 holds
 * modules 2.1, 2.2, 2.3 — `number` is its 1-based place in the course.
 */
export interface CourseSection {
  id: string;
  courseId: string;
  number: number;
  title: string;
  /** Hex tint from SECTION_COLORS, or null for no tint. */
  color?: string | null;
}

/**
 * A part of a course, inside a section. `number` is "section.position" — "2.3" is
 * the third module of section 2 — and is derived by the server from where the
 * module sits, never typed in.
 */
export interface CourseModule {
  id: string;
  courseId: string;
  sectionId: string | null;
  /** 1-based place within the section: the digit after the dot. */
  position: number;
  number: string;
  title: string;
  estimatedMinutes: number;
  elements: ModuleElement[];
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
  moduleId: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Course {
  id: string;
  title: string;
  /** One-line pitch under the title. */
  shortDescription: string | null;
  description: string | null;
  tags: string[];
  languages: string[];
  whatYouWillLearn: string[];
  prerequisites: string[];
  required: boolean;
  dueDate: string | null;
  published: boolean;
  /** When on, each module unlocks only once the previous one is finished. */
  sequential: boolean;
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
  /** Section headings in order. The modules stay flat and point back by id. */
  sections: CourseSection[];
  modules: CourseModule[];
  instructors: Instructor[];
}

/** One section with the modules that belong to it, in order. */
export interface SectionGroup {
  section: CourseSection;
  modules: CourseModule[];
}

/**
 * The course as the two-dimensional grid it really is: sections in order, each
 * holding its modules in order. `course.modules` arrives flat and already sorted
 * by section-then-position, so this only has to bucket it.
 *
 * Anything left without a live section — which only happens mid-edit, or on data
 * predating sections — is gathered at the end rather than dropped, so a module
 * can never quietly vanish from the page.
 */
export function sectionGroups(course: Course): SectionGroup[] {
  const groups = course.sections.map((section) => ({ section, modules: [] as CourseModule[] }));
  const byId = new Map(groups.map((group) => [group.section.id, group]));

  const orphans: CourseModule[] = [];
  for (const module of course.modules) {
    const group = module.sectionId ? byId.get(module.sectionId) : undefined;
    if (group) group.modules.push(module);
    else orphans.push(module);
  }

  if (orphans.length > 0) {
    groups.push({
      section: {
        id: 'unsectioned',
        courseId: course.id,
        number: groups.length + 1,
        title: 'Ungrouped',
        color: null,
      },
      modules: orphans,
    });
  }

  return groups;
}

/** An element or a quiz, as one entry in a module's ordered content list. */
export type ModuleContentItem =
  | { kind: 'element'; id: string; order: number; element: ModuleElement }
  | { kind: 'quiz'; id: string; order: number; quiz: Quiz };

/**
 * A module's elements and quizzes merged into the single sequence they share,
 * so a quiz can sit between two pieces of content.
 */
export function moduleContent(module: CourseModule): ModuleContentItem[] {
  return [
    ...module.elements.map((element): ModuleContentItem => ({
      kind: 'element',
      id: element.id,
      order: element.order,
      element,
    })),
    ...module.quizzes.map((quiz): ModuleContentItem => ({
      kind: 'quiz',
      id: quiz.id,
      order: quiz.order,
      quiz,
    })),
  ].sort((a, b) => a.order - b.order);
}

/** Totals shown on the course page sidebar. */
export function courseStats(course: Course) {
  const elements = course.modules.flatMap((module) => module.elements);
  return {
    videoMinutes: elements
      .filter((element) => element.type === 'YOUTUBE')
      .reduce((sum, element) => sum + (element.durationMinutes ?? 0), 0),
    articles: elements.filter((element) => element.type === 'TEXT').length,
    resources: elements.filter((element) => element.type === 'PDF' || element.type === 'IMAGE')
      .length,
    quizzes: course.modules.reduce((sum, module) => sum + module.quizzes.length, 0),
    totalMinutes: course.modules.reduce((sum, module) => sum + module.estimatedMinutes, 0),
  };
}

/**
 * Turns a section tint into the pair of inline styles the rails use: a wash
 * behind the group and a solid rule down its left edge.
 *
 * Inline rather than a Tailwind class because the colour is data — the palette
 * lives in one array and the classes would have to be enumerated to match, which
 * is exactly the kind of duplication that goes stale.
 */
export function sectionTint(color?: string | null) {
  if (!color) return {};
  return { backgroundColor: `${color}59`, borderColor: color };
}

/** What one published version added over the one before it. */
export interface NewIds {
  newSectionIds: string[];
  newModuleIds: string[];
  newElementIds: string[];
  newQuizIds: string[];
}

/** One row in the course editor's version history. */
export interface CourseVersion {
  id: string;
  version: number;
  publishedAt: string;
  /** Null on the live version, which is never archived away. */
  supersededAt: string | null;
  newSectionIds: string[];
  newModuleIds: string[];
  newElementIds: string[];
  newQuizIds: string[];
  publishedBy: { id: number; email: string; name: string | null } | null;
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
export interface DeletedModule {
  id: string;
  title: string;
  deletedAt: string;
  course: { id: string; title: string } | null;
}

export interface DeletedSection {
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
  dueDate: string | null;
  totalModules: number;
  completedModules: number;
  percentComplete: number;
  totalMinutes: number;
  remainingMinutes: number;
  quizCount?: number;
  /** They finished this course once and content has been added since. */
  hasNewContent?: boolean;
  newModuleCount?: number;
}

export interface OutstandingQuiz {
  quizId: string;
  title: string;
  courseTitle: string | null;
  questionCount: number;
  /** The quiz's own due date, or the course's when it has none. */
  dueDate: string | null;
}

/** What a learner has already done — drives ticks and sequential unlocking. */
export interface LearnerProgress {
  viewedModuleIds: string[];
  /** Individual items opened. A sequential course unlocks off these, not modules. */
  viewedElementIds: string[];
  attemptedQuizIds: string[];
}

export interface Dashboard {
  courseProgress: CourseProgress[];
  /** Finished courses that have gained a module or quiz since. */
  updatedCourses: CourseProgress[];
  outstandingCourses: CourseProgress[];
  outstandingQuizzes: OutstandingQuiz[];
  upcomingDeadlines: CourseProgress[];
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
    sections: DeletedSection[];
    modules: DeletedModule[];
    /** How long the bin keeps things before clearing them itself. */
    retentionDays: number;
  }> => HttpHelper.get('curriculum/deleted'),

  restoreCourse: (courseId: string) =>
    HttpHelper.post(`curriculum/courses/${courseId}/restore`, {}),

  restoreModule: (moduleId: string) =>
    HttpHelper.post(`curriculum/modules/${moduleId}/restore`, {}),

  /** Restores every deleted course and module. */
  restoreAllDeleted: () => HttpHelper.post('curriculum/deleted/restore-all', {}),

  /** Permanent — empties the curriculum side of the recycle bin. */
  purgeAllDeleted: () => HttpHelper.delete('curriculum/deleted'),

  purgeCourse: (courseId: string) => HttpHelper.delete(`curriculum/deleted/courses/${courseId}`),

  purgeModule: (moduleId: string) => HttpHelper.delete(`curriculum/deleted/modules/${moduleId}`),

  uploadCourseImage: (courseId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return HttpHelper.postFormData(`curriculum/courses/${courseId}/image`, form);
  },

  uploadModuleImage: (moduleId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return HttpHelper.postFormData(`curriculum/modules/${moduleId}/image`, form);
  },

  createCourse: (title: string) => HttpHelper.post('curriculum/courses', { title }),

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
      published?: boolean;
      sequential?: boolean;
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

  /** Type-ahead over people already in the system. */
  searchUsers: async (
    query: string,
  ): Promise<Array<{ id: number; email: string; name: string | null }>> => {
    const response = await HttpHelper.get(`auth/search?q=${encodeURIComponent(query)}`);
    return response.users ?? [];
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

  createNote: (courseId: string, body: string, moduleId?: string | null) =>
    HttpHelper.post(`curriculum/courses/${courseId}/notes`, { body, moduleId }),

  updateNote: (noteId: string, body: string) =>
    HttpHelper.put(`curriculum/notes/${noteId}`, { body }),

  deleteNote: (noteId: string) => HttpHelper.delete(`curriculum/notes/${noteId}`),

  deleteCourse: (courseId: string) => HttpHelper.delete(`curriculum/courses/${courseId}`),

  // ---- Sections ----

  /** A section is a title and the place in the course it should sit at. */
  createSection: (
    courseId: string,
    data: { title: string; number?: number; color?: string | null },
  ) => HttpHelper.post(`curriculum/courses/${courseId}/sections`, data),

  updateSection: (
    sectionId: string,
    data: { title?: string; number?: number; color?: string | null },
  ) => HttpHelper.put(`curriculum/sections/${sectionId}`, data),

  /** Soft delete — the section's modules go to the recycle bin with it. */
  deleteSection: (sectionId: string) => HttpHelper.delete(`curriculum/sections/${sectionId}`),

  restoreSection: (sectionId: string) =>
    HttpHelper.post(`curriculum/sections/${sectionId}/restore`, {}),

  purgeSection: (sectionId: string) =>
    HttpHelper.delete(`curriculum/deleted/sections/${sectionId}`),

  // ---- Modules ----

  /** Lands at the end of `sectionId`, or at `position` within it when given. */
  createModule: (
    courseId: string,
    data: { sectionId?: string; position?: number; title: string; estimatedMinutes: number },
  ) => HttpHelper.post(`curriculum/courses/${courseId}/modules`, data),

  /** Numbers come from position in the grid, so they are not editable here. */
  updateModule: (moduleId: string, data: { title?: string; estimatedMinutes?: number }) =>
    HttpHelper.put(`curriculum/modules/${moduleId}`, data),

  /**
   * Sends the whole grid: sections in their new order, each with its module ids
   * in theirs. The server derives every number from these positions.
   */
  reorderStructure: (courseId: string, sections: Array<{ id: string; moduleIds: string[] }>) =>
    HttpHelper.put(`curriculum/courses/${courseId}/structure`, { sections }),

  deleteModule: (moduleId: string) => HttpHelper.delete(`curriculum/modules/${moduleId}`),

  createElement: (
    moduleId: string,
    element: {
      type: ElementType;
      videoUrl?: string;
      imageUrl?: string;
      textContent?: string;
      durationMinutes?: number;
    },
  ) => HttpHelper.post(`curriculum/modules/${moduleId}/elements`, element),

  updateElement: (
    elementId: string,
    data: {
      textContent?: string | null;
      videoUrl?: string | null;
      imageUrl?: string | null;
      durationMinutes?: number | null;
    },
  ) => HttpHelper.put(`curriculum/elements/${elementId}`, data),

  deleteElement: (elementId: string) => HttpHelper.delete(`curriculum/elements/${elementId}`),

  /** Sends a module's elements and quizzes in their new combined order. */
  reorderModuleContent: (
    moduleId: string,
    items: Array<{ kind: 'element' | 'quiz'; id: string }>,
  ) => HttpHelper.put(`curriculum/modules/${moduleId}/content-order`, { items }),

  /** Modules auto-complete on view. */
  recordModuleView: (moduleId: string) =>
    HttpHelper.post(`curriculum/modules/${moduleId}/view`, {}),

  /** One item seen — what unlocks the next on a sequential course. */
  recordElementView: (elementId: string) =>
    HttpHelper.post(`curriculum/elements/${elementId}/view`, {}),

  getDashboard: (): Promise<Dashboard> => HttpHelper.get('curriculum/dashboard'),

  getProgress: (): Promise<LearnerProgress> => HttpHelper.get('curriculum/progress'),
};
