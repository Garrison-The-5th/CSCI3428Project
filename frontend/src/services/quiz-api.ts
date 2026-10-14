/**
 * File: quiz-api.ts
 * Description: Client for the quiz, question and attempt endpoints.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
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
  /** Section number the hint points back to, e.g. "1.2". */
  hintSectionNumber: string | null;
  options: QuizOption[];
  /**
   * Sent on learner-facing reads, where `isCorrect` is stripped and so cannot be
   * counted. Absent on author reads, which count `isCorrect` instead.
   */
  multiAnswer?: boolean;
}

/**
 * The three kinds of quiz. Which one it is decides where it may live, whether it
 * can be timed, whether the mark is kept, and whether it is ever listed.
 *
 * LEARNING_CHECK — inside a lesson section only, never timed, mark never stored,
 *                  never listed. Must be attempted before the learner may move on.
 * EXAM           — standalone or in a section, may be timed, scored, listed.
 * ONE_TIME       — reached through its link only. One attempt, then gone, and
 *                  never listed even to somebody signed in with the address it
 *                  was sent to. May stand alone or be the whole of a quiz set;
 *                  never in a lesson section.
 */
export type QuizType = 'LEARNING_CHECK' | 'EXAM' | 'ONE_TIME' | 'DIRECTED';

/**
 * The kinds an author may pick from.
 *
 * DIRECTED is missing on purpose: a layer quiz is generated from a course map,
 * its options are the map's connections, and it is rewritten every time a node
 * moves. The editor never offers it, and the server refuses it if asked.
 */
export const AUTHORABLE_QUIZ_TYPES: QuizType[] = ['LEARNING_CHECK', 'EXAM', 'ONE_TIME'];

export const QUIZ_TYPE_LABELS: Record<QuizType, string> = {
  LEARNING_CHECK: 'Learning check',
  EXAM: 'Exam',
  ONE_TIME: 'One-time link',
  DIRECTED: 'Directed learning quiz',
};

export const QUIZ_TYPE_HINTS: Record<QuizType, string> = {
  LEARNING_CHECK:
    'Sits inside a section. No timer, no stored mark — the learner sees a tick or a cross per ' +
    'question, and cannot move on until they have attempted it.',
  EXAM: 'Scored and reported.',
  ONE_TIME:
    'Sent as a link. One attempt only, then it disappears — and it never shows on the Quizzes ' +
    'tab, only asscessable with the link.',
  DIRECTED:
    'Generated from the course map. Asks the learner which branches apply to them, and what ' +
    'they tick is what unlocks the next layer. Never timed, never scored, always retakeable.',
};

/**
 * What each kind is allowed to have, so the editor can grey out the rest.
 *
 * One control, because one is all that is actually disabled anywhere. Several
 * more used to be answered here — where a kind may live, whether it may be
 * shared, whether it owns a deadline — and nothing read them, so they were
 * documentation of intent dressed up as logic: a caller could consult one, get a
 * confident answer, and be wrong, because the real rule lives on the server and
 * had drifted. Where a quiz may sit is decided there, because it depends on the
 * kind of course owning the section and this has only the quiz. A deadline is
 * decided by the course, because a quiz never has one of its own.
 */
export function quizCapabilities(type: QuizType) {
  return {
    /** A learning check is deliberately unhurried. */
    canBeTimed: type !== 'LEARNING_CHECK',
  };
}

export interface Quiz {
  id: string;
  title: string;
  description: string | null;
  type: QuizType;
  /** The section it sits in. Null for a standalone exam or a one-time quiz. */
  sectionId: string | null;
  /** Position within the section, shared with element ordering. */
  order: number;
  published: boolean;
  /** Show the score ring after submitting. Off moves them straight on. */
  showResults: boolean;
  showAnswers: boolean;
  /**
   * Whether an exam may be sat again. Off is what an exam means unless the
   * author says otherwise, and it is what decides whether Restart Quiz appears on
   * the result screen.
   *
   * Ignored on the other two kinds: a learning check is always retakeable and a
   * one-time link never is. Optional because older payloads predate it.
   */
  allowMultipleAttempts?: boolean;
  /**
   * Whether `type` may still be changed.
   *
   * Set by the first publish and never cleared. What a quiz is decides how a
   * learner can be given it, and an exam already sitting on somebody's Quizzes
   * tab does not stop sitting there because it was later relabelled a one-time
   * link — so the choice is fixed before that can happen.
   */
  typeLocked?: boolean;
  /**
   * When this learner's copy falls due, at 11:59 PM on the day it lands.
   *
   * A quiz inside a course carries the course's date: it is due with the course
   * around it, whatever is written on its own row.
   */
  dueDate: string | null;
  /**
   * Past that deadline, so it can no longer be taken.
   *
   * The server's answer. Absent on the author-facing payloads — a deadline is
   * something a learner has, not something a quiz is.
   */
  locked?: boolean;
  /**
   * How long a learner gets once this is handed to them, in days.
   *
   * This is the deadline an author sets now. The date itself is worked out when
   * the assignment is made — see assignment-api — so the same quiz sent today
   * and next month gives each person the same run at it.
   */
  daysRemaining?: number | null;
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
  /** Null for a learning check, which has no clock and so nothing to resume. */
  sessionId: string | null;
  startedAt: string;
  expiresAt: string | null;
  timeLimitMinutes: number | null;
  secondsRemaining: number | null;
  serverNow: string;
  /** They had already started and the clock has run out since. */
  expired: boolean;
  /**
   * Whether a run is under way. Always true from `startSession`; from
   * `peekSession` it is what decides between showing the quiz's details behind a
   * Start button and going straight back into a clock already ticking.
   */
  started: boolean;
  /** A one-time quiz they have already handed in, so there is nothing to open. */
  completed: boolean;
  /**
   * The paper from an attempt already sat, when there is one.
   *
   * Any kind of quiz can have one. Coming back to something already handed in —
   * stepping back through a lesson, reopening it from the rail — has to show
   * what it showed on the day rather than an empty form, and this is what
   * carries that. The author's toggles govern what is in it, exactly as they do
   * on submission, so a second look discloses nothing a first one did not.
   *
   * Null while a run is open: the questions are then what the learner came back
   * for, and an older attempt's marks would be marking the wrong paper.
   */
  result: AttemptResult | null;
}

export interface DeletedQuiz {
  id: string;
  title: string;
  deletedAt: string;
  /** Where it came from, so the recycle bin can say which course it belonged to. */
  section: { title: string; course: { id: string; title: string } | null } | null;
}

/**
 * What the create-question form sends.
 *
 * At least one option must be correct and at least one must not. More than one
 * correct option makes it a multiple-answer question, which the runner draws
 * with checkboxes and marks all-or-nothing.
 */
export interface QuestionInput {
  prompt: string;
  hint?: string | null;
  hintSectionNumber?: string | null;
  options: Array<{ text: string; isCorrect: boolean }>;
}

/**
 * A question is multiple-answer when more than one of its options is correct.
 *
 * A learner's copy has no `isCorrect` to count, so the server's `multiAnswer`
 * flag is what decides it there.
 */
export function isMultiAnswer(question: QuizQuestion): boolean {
  if (question.multiAnswer !== undefined) return question.multiAnswer;
  return question.options.filter((option) => option.isCorrect).length > 1;
}

/**
 * What a learner sends: question id -> the option ids they picked.
 *
 * A list even for a single-choice question, so the runner has one shape to hold
 * and the grader one shape to read. The API still accepts a bare string for
 * anything older.
 */
export type QuizAnswers = Record<string, string[]>;

export interface AttemptResult {
  score: number;
  total: number;
  /** The clock had run out by the time this was graded. */
  timedOut: boolean;
  type: QuizType;
  /** Off means the learner is moved straight on without seeing how they did. */
  showResults: boolean;
  showAnswers: boolean;
  /**
   * A tick or a cross per question — the whole of a learning check's feedback —
   * and what they ticked, so a marked paper can be redrawn on a later visit
   * rather than coming back with its marks beside empty options.
   */
  perQuestion: Array<{ questionId: string; correct: boolean; chosenOptionIds?: string[] }>;
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

  /** `sectionId` is omitted for a standalone exam or a one-time quiz. */
  createQuiz: (quiz: {
    title: string;
    description?: string;
    type?: QuizType;
    sectionId?: string | null;
  }) => HttpHelper.post('quizzes', quiz),

  updateQuiz: (
    quizId: string,
    data: {
      title?: string;
      description?: string | null;
      type?: QuizType;
      /** Move a quiz to a different section, or out of one with null. */
      sectionId?: string | null;
      published?: boolean;
      showResults?: boolean;
      showAnswers?: boolean;
      allowMultipleAttempts?: boolean;
      dueDate?: string | null;
      daysRemaining?: number | null;
      timeLimitMinutes?: number | null;
    },
  ) => HttpHelper.put(`quizzes/${quizId}`, data),

  /**
   * Reports the run already open, and starts nothing.
   *
   * This is what the player asks before it draws a quiz, so that looking at one
   * is never what starts its clock — the details and a Start button when there
   * is no run, straight back into the questions when there is.
   */
  peekSession: (quizId: string): Promise<QuizSession> =>
    HttpHelper.get(`quizzes/${quizId}/session`),

  /**
   * Opens a run, or reports the one already open. Safe to call on every load —
   * an in-progress run comes back untouched rather than restarting the clock.
   */
  startSession: (quizId: string): Promise<QuizSession> =>
    HttpHelper.post(`quizzes/${quizId}/start`, {}),

  /** Grades server-side and records the attempt. `answers` is questionId -> optionId. */
  submitAttempt: (quizId: string, answers: QuizAnswers): Promise<AttemptResult> =>
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

  /**
   * Updates an existing question. Options left out are kept — which is the only
   * way a directed learning quiz may be saved, since its options are the map's.
   */
  updateQuestion: (questionId: string, question: Partial<QuestionInput>) =>
    HttpHelper.put(`quizzes/questions/${questionId}`, question),

  deleteQuestion: (questionId: string) => HttpHelper.delete(`quizzes/questions/${questionId}`),

  /**
   * Puts the questions in the order given. The list must name every question in
   * the quiz — the server refuses a partial one rather than guessing at the rest.
   */
  reorderQuestions: (quizId: string, questionIds: string[]) =>
    HttpHelper.put(`quizzes/${quizId}/question-order`, { questionIds }),
};
