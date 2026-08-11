/**
 * File: quiz-api.ts
 * Description: Client for the quiz, question and attempt endpoints.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import HttpHelper from '@/utils/http-helper';

export interface QuizOption {
  id: string;
  order: number;
  text: string;
  /** Absent on learner-facing reads — the API strips it so answers can't be scraped. */
  isCorrect?: boolean;
}

export interface QuizQuestion {
  id: string;
  order: number;
  prompt: string;
  hint: string | null;
  /** Module number the hint points back to, e.g. "1.2". */
  hintModuleNumber: string | null;
  options: QuizOption[];
}

export interface Quiz {
  id: string;
  title: string;
  description: string | null;
  /** Every quiz belongs to a module; null only on rows predating that rule. */
  moduleId: string | null;
  /** Position within the module, shared with element ordering. */
  order: number;
  published: boolean;
  showAnswers: boolean;
  dueDate: string | null;
  /** Minutes allowed once started. Null means untimed. */
  timeLimitMinutes: number | null;
  questions: QuizQuestion[];
}

/**
 * A run at a quiz, as the server sees it.
 *
 * The deadline is the server's, not the browser's, which is what lets someone
 * close the tab and come back to the time they had left. `serverNow` is sent
 * alongside so the page can correct for a device clock that disagrees.
 */
export interface QuizSession {
  sessionId: string;
  startedAt: string;
  expiresAt: string | null;
  timeLimitMinutes: number | null;
  secondsRemaining: number | null;
  serverNow: string;
  /** They had already started and the clock has run out since. */
  expired: boolean;
}

export interface DeletedQuiz {
  id: string;
  title: string;
  deletedAt: string;
  /** Where it came from, so the recycle bin can say which course it belonged to. */
  module: { title: string; course: { id: string; title: string } | null } | null;
}

/** What the create-question form sends; the API requires exactly one correct option. */
export interface QuestionInput {
  prompt: string;
  hint?: string | null;
  hintModuleNumber?: string | null;
  options: Array<{ text: string; isCorrect: boolean }>;
}

export interface AttemptResult {
  score: number;
  total: number;
  /** The clock had run out by the time this was graded. */
  timedOut: boolean;
  showAnswers: boolean;
  /** Only populated when the author allows answers to be revealed. */
  correctOptionIds: string[];
}

export const quizApi = {
  /** Learner view: published quizzes, answers stripped by the API. */
  getQuizzes: async (): Promise<Quiz[]> => {
    const response = await HttpHelper.get('quizzes');
    return response.quizzes ?? [];
  },

  /** Author view: drafts included and answers intact, for editing. */
  getQuizzesForAuthor: async (): Promise<Quiz[]> => {
    const response = await HttpHelper.get('quizzes/manage');
    return response.quizzes ?? [];
  },

  getDeletedQuizzes: async (): Promise<DeletedQuiz[]> => {
    const response = await HttpHelper.get('quizzes/deleted');
    return response.quizzes ?? [];
  },

  createQuiz: (quiz: { title: string; description?: string; moduleId: string }) =>
    HttpHelper.post('quizzes', quiz),

  updateQuiz: (
    quizId: string,
    data: {
      title?: string;
      description?: string | null;
      /** Move a quiz to a different module. */
      moduleId?: string | null;
      published?: boolean;
      showAnswers?: boolean;
      dueDate?: string | null;
      timeLimitMinutes?: number | null;
    },
  ) => HttpHelper.put(`quizzes/${quizId}`, data),

  /**
   * Opens a run, or reports the one already open. Safe to call on every load —
   * an in-progress run comes back untouched rather than restarting the clock.
   */
  startSession: (quizId: string): Promise<QuizSession> =>
    HttpHelper.post(`quizzes/${quizId}/start`, {}),

  /** Grades server-side and records the attempt. `answers` is questionId -> optionId. */
  submitAttempt: (quizId: string, answers: Record<string, string>): Promise<AttemptResult> =>
    HttpHelper.post(`quizzes/${quizId}/attempt`, { answers }),

  deleteQuiz: (quizId: string) => HttpHelper.delete(`quizzes/${quizId}`),

  restoreQuiz: (quizId: string) => HttpHelper.post(`quizzes/${quizId}/restore`, {}),

  /** Restores every deleted quiz. */
  restoreAllQuizzes: () => HttpHelper.post('quizzes/deleted/restore-all', {}),

  /** Permanent — removes every deleted quiz. */
  purgeAllQuizzes: () => HttpHelper.delete('quizzes/deleted'),

  purgeQuiz: (quizId: string) => HttpHelper.delete(`quizzes/deleted/${quizId}`),

  addQuestion: (quizId: string, question: QuestionInput) =>
    HttpHelper.post(`quizzes/${quizId}/questions`, question),

  /** Replaces the prompt and the whole option set for an existing question. */
  updateQuestion: (questionId: string, question: QuestionInput) =>
    HttpHelper.put(`quizzes/questions/${questionId}`, question),

  deleteQuestion: (questionId: string) => HttpHelper.delete(`quizzes/questions/${questionId}`),
};
