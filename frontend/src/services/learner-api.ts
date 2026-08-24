/**
 * File: learner-api.ts
 * Description: One learner-facing API surface over the JWT and token endpoints.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * One learner-facing API surface, whichever way you got in.
 *
 * Signed-in users hit the JWT endpoints; guests on an assignment link hit the
 * token endpoints, which return the same shapes scoped to what their email was
 * assigned. Pages call these and never branch on the mode themselves.
 */
import { useGuest } from '@/contexts/guest-context';
import { assignmentApi } from '@/services/assignment-api';
import {
  Course,
  curriculumApi,
  Dashboard,
  LearnerProgress,
  NewIds,
  Note,
} from '@/services/curriculum-api';
import { AttemptResult, Quiz, QuizAnswers, quizApi, QuizSession } from '@/services/quiz-api';

export interface LearnerApi {
  getCourses: () => Promise<Course[]>;
  /** One course, without dragging the rest of the catalogue along. */
  getCourse: (courseId: string) => Promise<Course | null>;
  /**
   * The course plus what has appeared in it since this person last looked.
   *
   * On the interface rather than reached for directly, so no page has to know
   * whether it is serving a signed-in learner or a link holder — both can have
   * been part way through when a new version went live.
   */
  getCourseWithNewIds: (courseId: string) => Promise<{ course: Course; newIds: NewIds } | null>;
  getQuizzes: () => Promise<Quiz[]>;
  getDashboard: () => Promise<Dashboard>;
  getProgress: () => Promise<LearnerProgress>;
  recordSectionView: (sectionId: string) => Promise<unknown>;
  /** One item seen. Credits its section too, so callers never need both. */
  recordElementView: (elementId: string) => Promise<unknown>;
  /**
   * Reports the run already open at a quiz, without opening one. What lets the
   * player show a quiz's details behind a Start button and skip that screen for
   * a run already under way.
   */
  peekQuiz: (quizId: string) => Promise<QuizSession>;
  /** Opens a run at a quiz, or reports the one already open. */
  startQuiz: (quizId: string) => Promise<QuizSession>;
  submitAttempt: (quizId: string, answers: QuizAnswers) => Promise<AttemptResult>;
  getNotes: (courseId: string) => Promise<Note[]>;
  createNote: (courseId: string, body: string, sectionId?: string | null) => Promise<unknown>;
  updateNote: (noteId: string, body: string) => Promise<unknown>;
  deleteNote: (noteId: string) => Promise<unknown>;
}

export function makeLearnerApi(token: string | null): LearnerApi {
  if (token) {
    return {
      getCourses: () => assignmentApi.getCourses(token),
      // A link opens exactly one course, so its catalogue is already the answer
      // — there is nothing cheaper to ask for.
      getCourse: async (courseId) =>
        (await assignmentApi.getCourses(token)).find((c) => c.id === courseId) ?? null,
      getCourseWithNewIds: async (courseId) => {
        const course =
          (await assignmentApi.getCourses(token)).find((c) => c.id === courseId) ?? null;
        if (!course) return null;
        return { course, newIds: await assignmentApi.getNewIds(token, courseId) };
      },
      getQuizzes: () => assignmentApi.getQuizzes(token),
      getDashboard: () => assignmentApi.getDashboard(token),
      getProgress: () => assignmentApi.getProgress(token),
      recordSectionView: (sectionId) => assignmentApi.recordView(token, sectionId),
      recordElementView: (elementId) => assignmentApi.recordElementView(token, elementId),
      peekQuiz: (quizId) => assignmentApi.peekSession(token, quizId),
      startQuiz: (quizId) => assignmentApi.startSession(token, quizId),
      submitAttempt: (quizId, answers) => assignmentApi.submitAttempt(token, quizId, answers),
      getNotes: (courseId) => assignmentApi.getNotes(token, courseId),
      createNote: (courseId, body, sectionId) =>
        assignmentApi.createNote(token, courseId, body, sectionId),
      updateNote: (noteId, body) => assignmentApi.updateNote(token, noteId, body),
      deleteNote: (noteId) => assignmentApi.deleteNote(token, noteId),
    };
  }

  return {
    getCourses: () => curriculumApi.getCourses(),
    getCourse: (courseId) => curriculumApi.getCourse(courseId),
    getCourseWithNewIds: (courseId) => curriculumApi.getCourseWithNewIds(courseId),
    getQuizzes: () => quizApi.getQuizzes(),
    getDashboard: () => curriculumApi.getDashboard(),
    getProgress: () => curriculumApi.getProgress(),
    recordSectionView: (sectionId) => curriculumApi.recordSectionView(sectionId),
    recordElementView: (elementId) => curriculumApi.recordElementView(elementId),
    peekQuiz: (quizId) => quizApi.peekSession(quizId),
    startQuiz: (quizId) => quizApi.startSession(quizId),
    submitAttempt: (quizId, answers) => quizApi.submitAttempt(quizId, answers),
    getNotes: (courseId) => curriculumApi.getNotes(courseId),
    createNote: (courseId, body, sectionId) => curriculumApi.createNote(courseId, body, sectionId),
    updateNote: (noteId, body) => curriculumApi.updateNote(noteId, body),
    deleteNote: (noteId) => curriculumApi.deleteNote(noteId),
  };
}

/** The right API for the current visitor. */
export function useLearnerApi(): LearnerApi {
  const { token } = useGuest();
  return makeLearnerApi(token);
}
