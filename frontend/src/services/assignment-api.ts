/**
 * File: assignment-api.ts
 * Description: Client for assignment management and the public guest endpoints.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
import {
  Course,
  CourseKind,
  Dashboard,
  LearnerProgress,
  NewIds,
  Note,
} from '@/services/curriculum-api';
import { AttemptResult, Quiz, QuizAnswers, QuizSession } from '@/services/quiz-api';
import HttpHelper from '@/utils/http-helper';
import { API_BASE_URL } from '@/utils/utils';

/**
 * How something was handed over.
 *
 * PLATFORM — enrolled on their account; they sign in and find it on Learning.
 * LINK     — a direct URL that opens just this item with no sign-in, and which
 *            deliberately does not appear when that person logs in.
 */
export type AssignmentType = 'PLATFORM' | 'LINK';

export interface Assignment {
  id: string;
  type: AssignmentType;
  /**
   * Present only on the reply that creates a link. Links are stored as hashes,
   * so a listed assignment has no token; Copy link issues a new one.
   */
  token?: string;
  email: string;
  courseId: string | null;
  quizId: string | null;
  assignedAt: string;
  dueDate: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  lastAccessedAt: string | null;
  /** When the notification email went out. Null means it never did. */
  notifiedAt: string | null;
  /** Who set the work. Their address is the From on mail about it. */
  assignedBy?: { id: number; email: string; name: string | null } | null;
  /** Progress, present on the author-facing list. */
  name?: string | null;
  totalSections?: number;
  completedSections?: number;
  percentComplete?: number;
  attempts?: number;
  /** Latest of anything they did — reads as "who has gone quiet". */
  lastActivityAt?: string | null;
}

/** One course on the admin dashboard's Assigned learning tab. */
export interface AssignedCourse {
  courseId: string;
  title: string;
  /** Lesson or quiz set — the dashboard files the two apart. */
  kind?: CourseKind;
  imageData: string | null;
  imageType: string | null;
  published: boolean;
  totalSections: number;
  assignedCount: number;
  completedCount: number;
  overdueCount: number;
}

/** One course under a learner's name on the Student insights pages. */
export interface LearnerCourseProgress {
  courseId: string;
  title: string;
  /** Lesson or quiz set — the dashboard files the two apart. */
  kind?: CourseKind;
  imageData: string | null;
  imageType: string | null;
  dueDate: string | null;
  totalSections: number;
  completedSections: number;
  percentComplete: number;
  totalQuizzes: number;
  attemptedQuizzes: number;
  /** Mean of their best score per quiz, or null if they have not attempted any. */
  averageScore: number | null;
  lastActivityAt: string | null;
  assignedAt: string;
  revoked: boolean;
}

/**
 * One handed-in one-time quiz, with the paper.
 *
 * Filed under the learner because that is the only place it makes sense: the
 * quiz disappears from their side once submitted, so this is the record.
 */
export interface OneTimeQuizResult {
  attemptId: string;
  quizId: string;
  title: string;
  score: number;
  total: number;
  percent: number;
  completedAt: string;
  answers: Array<{
    questionId: string;
    order: number;
    prompt: string;
    /** The option texts they picked, frozen at submission. */
    chosen: string[];
    /** What would have been right. */
    correct: string[];
    wasCorrect: boolean;
  }>;
}

export interface LearnerInsight {
  email: string;
  name: string | null;
  /** They have signed in, rather than only being an address on an assignment. */
  hasAccount: boolean;
  courses: LearnerCourseProgress[];
  /** One-time quizzes they have handed in, newest first. */
  oneTimeQuizzes: OneTimeQuizResult[];
  overallPercent: number;
}

/** Whether the notification email actually went out, and why not if it didn't. */
export interface Delivery {
  sent: boolean;
  reason?: string;
}

/** Why a link did not work, so the page can explain rather than just fail. */
export type AssignmentFailure =
  | 'not-found'
  | 'revoked'
  | 'expired'
  | 'unavailable'
  | 'sign-in'
  /** The link sat unused past the inactivity timeout (§3.2.2). */
  | 'idle'
  /**
   * A one-time link that has been handed in and whose result has been read. The
   * visit after that closes it, and the author can turn it back on.
   */
  | 'completed'
  | 'error';

export class AssignmentLinkError extends Error {
  constructor(
    public reason: AssignmentFailure,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Public endpoints take the token instead of a JWT, so they bypass HttpHelper's
 * auth entirely — and they need the server's `reason` to tell revoked from
 * expired.
 */
async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!response.ok) {
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    throw new AssignmentLinkError(
      (body?.reason as AssignmentFailure) ?? 'error',
      body?.errorMessage ?? 'Something went wrong',
    );
  }

  return response.json();
}

/** The public URL handed to the assigned person. */
export function assignmentUrl(token: string): string {
  return `${window.location.origin}/a/${token}`;
}

export const assignmentApi = {
  // ---- Public, token based: a guest session over assigned content ----

  /** Confirms the link and says who it belongs to. */
  getSession: async (token: string): Promise<{ email: string; name: string | null }> => {
    const response = await publicRequest<{ user: { email: string; name: string | null } }>(
      `public/assignments/${encodeURIComponent(token)}/session`,
    );
    return response.user;
  },

  getCourses: async (token: string): Promise<Course[]> => {
    const response = await publicRequest<{ courses: Course[] }>(
      `public/assignments/${encodeURIComponent(token)}/courses`,
    );
    return response.courses ?? [];
  },

  getQuizzes: async (token: string): Promise<Quiz[]> => {
    const response = await publicRequest<{ quizzes: Quiz[] }>(
      `public/assignments/${encodeURIComponent(token)}/quizzes`,
    );
    return response.quizzes ?? [];
  },

  getDashboard: (token: string): Promise<Dashboard> =>
    publicRequest<Dashboard>(`public/assignments/${encodeURIComponent(token)}/dashboard`),

  getProgress: (token: string): Promise<LearnerProgress> =>
    publicRequest<LearnerProgress>(`public/assignments/${encodeURIComponent(token)}/progress`),

  recordView: (token: string, sectionId: string) =>
    publicRequest(`public/assignments/${encodeURIComponent(token)}/sections/${sectionId}/view`, {
      method: 'POST',
      body: '{}',
    }),

  recordElementView: (token: string, elementId: string) =>
    publicRequest(`public/assignments/${encodeURIComponent(token)}/elements/${elementId}/view`, {
      method: 'POST',
      body: '{}',
    }),

  /** The run already open on an assigned quiz. Starts nothing — see quizApi. */
  peekSession: (token: string, quizId: string) =>
    publicRequest<QuizSession>(
      `public/assignments/${encodeURIComponent(token)}/quizzes/${quizId}/session`,
    ),

  startSession: (token: string, quizId: string) =>
    publicRequest<QuizSession>(
      `public/assignments/${encodeURIComponent(token)}/quizzes/${quizId}/start`,
      { method: 'POST', body: '{}' },
    ),

  submitAttempt: (token: string, quizId: string, answers: QuizAnswers) =>
    publicRequest<AttemptResult>(
      `public/assignments/${encodeURIComponent(token)}/quizzes/${quizId}/attempt`,
      { method: 'POST', body: JSON.stringify({ answers }) },
    ),

  /** What arrived in this course since the link holder last worked on it. */
  getNewIds: async (token: string, courseId: string): Promise<NewIds> => {
    const response = await publicRequest<{ newIds: NewIds }>(
      `public/assignments/${encodeURIComponent(token)}/courses/${courseId}/new`,
    );
    return response.newIds;
  },

  getNotes: async (token: string, courseId: string): Promise<Note[]> => {
    const response = await publicRequest<{ notes: Note[] }>(
      `public/assignments/${encodeURIComponent(token)}/courses/${courseId}/notes`,
    );
    return response.notes ?? [];
  },

  createNote: (token: string, courseId: string, body: string, sectionId?: string | null) =>
    publicRequest(`public/assignments/${encodeURIComponent(token)}/courses/${courseId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body, sectionId }),
    }),

  updateNote: (token: string, noteId: string, body: string) =>
    publicRequest(`public/assignments/${encodeURIComponent(token)}/notes/${noteId}`, {
      method: 'PUT',
      body: JSON.stringify({ body }),
    }),

  deleteNote: (token: string, noteId: string) =>
    publicRequest(`public/assignments/${encodeURIComponent(token)}/notes/${noteId}`, {
      method: 'DELETE',
    }),

  // ---- Author facing ----

  list: async (target: { courseId?: string; quizId?: string }): Promise<Assignment[]> => {
    const query = target.courseId ? `courseId=${target.courseId}` : `quizId=${target.quizId}`;
    const response = await HttpHelper.get(`assignments?${query}`);
    return response.assignments ?? [];
  },

  /**
   * Hands something over. `type` is optional and normally omitted — the server
   * picks it from whether the address has an account, which is the only thing
   * the choice ever really depended on.
   */
  assign: (data: {
    email: string;
    type?: AssignmentType;
    courseId?: string | null;
    quizId?: string | null;
    dueDate?: string | null;
    /**
     * How long this person gets, in days. The server turns it into a date at the
     * moment the assignment is made; leave it out and the length set on the
     * course or quiz is used instead.
     */
    daysRemaining?: number | null;
    expiresAt?: string | null;
  }): Promise<{ message: string; assignment: Assignment; delivery: Delivery }> =>
    HttpHelper.post('assignments', data),

  /** Learners and their progress. Admins get everyone; authors get their own. */
  listInsights: async (): Promise<{ learners: LearnerInsight[]; scope: 'all' | 'mine' }> => {
    const response = await HttpHelper.get('assignments/insights');
    return { learners: response.learners ?? [], scope: response.scope ?? 'mine' };
  },

  getLearnerInsight: async (email: string): Promise<LearnerInsight | null> => {
    try {
      const response = await HttpHelper.get(`assignments/insights/${encodeURIComponent(email)}`);
      return response.learner ?? null;
    } catch {
      return null;
    }
  },

  /** Every course handed to someone, for the admin dashboard's card grid. */
  listAssignedCourses: async (): Promise<AssignedCourse[]> => {
    const response = await HttpHelper.get('assignments/courses');
    return response.courses ?? [];
  },

  /** One person's deadline. Everyone else on the course keeps theirs. */
  setDueDate: (
    id: string,
    dueDate: string | null,
  ): Promise<{ message: string; assignment: Assignment }> =>
    HttpHelper.put(`assignments/${id}`, { dueDate }),

  revoke: (id: string) => HttpHelper.post(`assignments/${id}/revoke`, {}),

  /**
   * Turning a link back on re-sends the email, so the server reports whether it
   * actually went — the send is rate limited and can be refused while the switch
   * itself still flips.
   */
  restore: (id: string): Promise<{ message: string; delivery: Delivery }> =>
    HttpHelper.post(`assignments/${id}/restore`, {}),

  /** A fresh link for a guest. The previous link stops working. */
  issueLink: async (id: string): Promise<string> => {
    const response = await HttpHelper.post(`assignments/${id}/link`, {});
    return response.token as string;
  },

  resend: (id: string): Promise<{ message: string; delivery: Delivery }> =>
    HttpHelper.post(`assignments/${id}/resend`, {}),

  remove: (id: string) => HttpHelper.delete(`assignments/${id}`),
};
