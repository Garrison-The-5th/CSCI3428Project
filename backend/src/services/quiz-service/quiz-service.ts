/**
 * File: quiz-service.ts
 * Description: Quiz grading, answer redaction, question validation and timed sessions.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { optionalText, requiredText } from '@/config/validation';
import { NotFoundError } from '@/controllers/http-errors';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import EnrolmentService from '@/services/enrolment-service/enrolment-service';
import PublicationService from '@/services/publication-service/publication-service';

export interface OptionInput {
  text: string;
  isCorrect?: boolean;
}

export interface QuestionInput {
  prompt?: string;
  hint?: string | null;
  hintModuleNumber?: string | null;
  options?: OptionInput[];
}

/**
 * Quizzes are multiple choice only: a question needs at least two options and
 * exactly one of them must be flagged correct.
 */
function validateOptions(options: OptionInput[]): Array<{ text: string; isCorrect: boolean }> {
  if (!Array.isArray(options) || options.length < 2) {
    throw new Error('a question needs at least 2 options');
  }

  if (options.length > 10) {
    throw new Error('a question may have at most 10 options');
  }

  const cleaned = options.map((option) => ({
    text: requiredText(option?.text, 'option', 'every option'),
    isCorrect: option.isCorrect === true,
  }));

  const correctCount = cleaned.filter((option) => option.isCorrect).length;
  if (correctCount !== 1) {
    throw new Error('exactly one option must be marked isCorrect');
  }

  return cleaned;
}

function parseDate(value: string | null | undefined, field: string): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} is not a valid date`);
  return parsed;
}

/**
 * Minutes a learner gets on a quiz. Blank means untimed, which is the default
 * and stays distinct from zero — a zero-minute quiz would be over before it
 * started, so it is refused rather than quietly treated as untimed.
 */
function parseTimeLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;

  const minutes = Number(value);
  if (!Number.isFinite(minutes) || !Number.isInteger(minutes) || minutes < 1) {
    throw new Error('time limit must be a whole number of minutes, 1 or more');
  }

  return minutes;
}

/**
 * How long is left, in whole seconds, allowing for the clock having already run
 * out. Null for an untimed run.
 */
function secondsRemaining(expiresAt: Date | null): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
}

/**
 * Strips `isCorrect` before a quiz goes to a learner, so the answers cannot be
 * read out of the network response. Authors get the unredacted version from the
 * separate /manage endpoints.
 *
 * Typed structurally rather than against the Prisma row, because it now has two
 * callers with genuinely different shapes: a quiz read from the database, and
 * one lifted out of a published snapshot. Both have questions with options, and
 * that is all this needs to know.
 */
export function redactAnswers<
  T extends { questions: Array<{ options: Array<Record<string, unknown>> }> },
>(quiz: T): T {
  return {
    ...quiz,
    questions: quiz.questions.map((question) => ({
      ...question,
      // Destructured out rather than deleted — this is how the key is dropped.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      options: question.options.map(({ isCorrect, ...option }) => option),
    })),
  } as T;
}

export default class QuizService {
  /** Learner view, answers redacted. */
  static async getPublishedQuizzes() {
    const quizzes = await QuizGateway.getPublishedQuizzes();
    return quizzes.map(redactAnswers);
  }

  /**
   * The quizzes this person can actually reach, as published.
   *
   * Taken from the enrolled courses' snapshots rather than the Quiz table, so a
   * quiz an author has drafted, edited or removed since the last publish behaves
   * here exactly as it does everywhere else a learner looks.
   */
  static async getQuizzesForLearner(email: string) {
    const [courses, enrolment] = await Promise.all([
      CurriculumGateway.getPublishedCourses(),
      EnrolmentService.forEmail(email),
    ]);

    const snapshots = await PublicationService.getLiveSnapshots(
      courses.filter((course) => enrolment.courseIds.has(course.id)).map((course) => course.id),
    );

    const fromCourses = snapshots.flatMap((snapshot) =>
      snapshot.modules.flatMap((module) => module.quizzes ?? []),
    );

    // A quiz assigned on its own has no course snapshot behind it, so it is read
    // from its own row — there is nothing else to read.
    const standalone = enrolment.quizIds.size
      ? (await QuizGateway.getPublishedQuizzes()).filter(
          (quiz) =>
            enrolment.quizIds.has(quiz.id) &&
            !fromCourses.some((published) => published.id === quiz.id),
        )
      : [];

    return [...fromCourses, ...standalone].map((quiz) => redactAnswers(quiz));
  }

  /** Author view, answers included. */
  static getAllQuizzes() {
    return QuizGateway.getAllQuizzes();
  }

  static getQuizById(id: string, live = false) {
    return QuizGateway.getQuizById(id, live);
  }

  /**
   * One quiz, if this person can reach it — answers stripped. Unreachable is
   * reported as not found, so this cannot be used to enumerate quizzes.
   */
  static async getQuizForLearner(email: string, id: string) {
    const reachable = await QuizService.getQuizzesForLearner(email);
    return reachable.find((quiz) => quiz.id === id) ?? null;
  }

  /** Every quiz belongs to a module; a module may hold several. */
  static async createQuiz(data: {
    title?: string;
    description?: string | null;
    moduleId?: string | null;
    dueDate?: string | null;
    timeLimitMinutes?: number | string | null;
  }) {
    const quizTitle = requiredText(data.title, 'title', 'quiz title');
    if (!data.moduleId) {
      throw new Error('a quiz must belong to a module');
    }

    const module = await CurriculumGateway.getModuleById(data.moduleId);
    if (!module) throw new NotFoundError(`Module with ID ${data.moduleId} not found`);

    // Silent for the same reason module creation is: an unpublished quiz cannot
    // be reached, so the announcement waits until the course is published.
    return QuizGateway.createQuiz({
      title: quizTitle,
      description: optionalText(data.description, 'description', 'quiz description') ?? null,
      moduleId: data.moduleId,
      // Elements and quizzes share one sequence, so append after whichever is last.
      order: (await CurriculumGateway.getLastContentOrder(data.moduleId)) + 1,
      timeLimitMinutes: parseTimeLimit(data.timeLimitMinutes),
      dueDate:
        data.dueDate !== undefined
          ? parseDate(data.dueDate, 'dueDate')
          : await QuizService.inheritedDueDate(data.moduleId),
    });
  }

  /**
   * A quiz with no due date of its own inherits the due date of the course that
   * owns its module.
   */
  static async inheritedDueDate(moduleId: string | null): Promise<Date | null> {
    if (!moduleId) return null;

    const module = await CurriculumGateway.getModuleById(moduleId);
    if (!module) return null;

    const course = await CurriculumGateway.getCourseById(module.courseId);
    return course?.dueDate ?? null;
  }

  static async updateQuiz(
    id: string,
    data: {
      title?: string;
      description?: string | null;
      moduleId?: string | null;
      published?: boolean;
      showAnswers?: boolean;
      dueDate?: string | null;
      timeLimitMinutes?: number | string | null;
    },
  ) {
    const quiz = await QuizGateway.getQuizById(id);
    if (!quiz) {
      throw new NotFoundError(`Quiz with ID ${id} not found`);
    }

    const nextTitle =
      data.title !== undefined ? requiredText(data.title, 'title', 'quiz title') : undefined;
    const nextDescription = optionalText(data.description, 'description', 'quiz description');

    // Check the target module up front so a bad id gives a readable message
    // instead of a raw foreign key violation.
    if (data.moduleId) {
      const module = await CurriculumGateway.getModuleById(data.moduleId);
      if (!module) throw new NotFoundError(`Module with ID ${data.moduleId} not found`);
    }

    return QuizGateway.updateQuiz(id, {
      ...(nextTitle !== undefined ? { title: nextTitle } : {}),
      ...(data.description !== undefined ? { description: nextDescription ?? null } : {}),
      ...(data.moduleId !== undefined ? { moduleId: data.moduleId || null } : {}),
      ...(data.published !== undefined ? { published: data.published === true } : {}),
      ...(data.showAnswers !== undefined ? { showAnswers: data.showAnswers === true } : {}),
      ...(data.dueDate !== undefined ? { dueDate: parseDate(data.dueDate, 'dueDate') } : {}),
      ...(data.timeLimitMinutes !== undefined
        ? { timeLimitMinutes: parseTimeLimit(data.timeLimitMinutes) }
        : {}),
    });
  }

  static async deleteQuiz(id: string) {
    const quiz = await QuizGateway.getQuizById(id);
    if (!quiz) {
      throw new NotFoundError(`Quiz with ID ${id} not found`);
    }
    return QuizGateway.softDeleteQuiz(id);
  }

  /** Restoring is guarded by requireAuthor, so it touches the draft itself. */
  static async restoreQuiz(id: string) {
    const restored = await QuizGateway.restoreQuiz(id);
    if (restored.moduleId) {
      const module = await CurriculumGateway.getModuleById(restored.moduleId);
      if (module) await CurriculumGateway.touchDraft(module.courseId);
    }
    return restored;
  }

  /**
   * Permanently removes a single quiz from the recycle bin. Refuses anything that
   * is not already soft deleted, so a live quiz cannot be destroyed by calling
   * this endpoint directly.
   */
  static async purgeQuiz(id: string) {
    const quiz = await QuizGateway.findDeletedQuiz(id);
    if (!quiz) throw new NotFoundError(`Quiz with ID ${id} is not in the recycle bin`);
    return QuizGateway.hardDeleteQuiz(id);
  }

  static async restoreAllQuizzes() {
    const { count } = await QuizGateway.restoreAllQuizzes();
    return count;
  }

  static async purgeAllQuizzes() {
    const { count } = await QuizGateway.purgeQuizzes();
    return count;
  }

  static async addQuestion(quizId: string, data: QuestionInput, afterOrder?: number) {
    const prompt = requiredText(data.prompt, 'prompt', 'question prompt');

    const quiz = await QuizGateway.getQuizById(quizId);
    if (!quiz) {
      throw new NotFoundError(`Quiz with ID ${quizId} not found`);
    }

    const options = validateOptions(data.options ?? []);
    const fields = {
      prompt,
      hint: optionalText(data.hint, 'hint', 'hint') ?? null,
      hintModuleNumber: optionalText(data.hintModuleNumber, 'tag', 'hint module number') ?? null,
    };

    return QuizGateway.runTransaction(async (db) => {
      let insertOrder: number;

      if (afterOrder === undefined) {
        const last = await QuizGateway.getLastQuestionOrder(quizId, db);
        insertOrder = (last?.order ?? 0) + 1;
      } else {
        insertOrder = afterOrder + 1;
        await QuizGateway.shiftQuestionsFrom(quizId, insertOrder, db);
      }

      return QuizGateway.createQuestion(quizId, fields, insertOrder, options, db);
    });
  }

  static async updateQuestion(id: string, data: QuestionInput) {
    const question = await QuizGateway.getQuestionById(id);
    if (!question) {
      throw new NotFoundError(`Question with ID ${id} not found`);
    }

    const nextPrompt =
      data.prompt !== undefined
        ? requiredText(data.prompt, 'prompt', 'question prompt')
        : undefined;

    return QuizGateway.updateQuestion(id, {
      ...(nextPrompt !== undefined ? { prompt: nextPrompt } : {}),
      ...(data.hint !== undefined ? { hint: optionalText(data.hint, 'hint', 'hint') ?? null } : {}),
      ...(data.hintModuleNumber !== undefined
        ? { hintModuleNumber: optionalText(data.hintModuleNumber, 'tag', 'hint module') ?? null }
        : {}),
      ...(data.options !== undefined ? { options: validateOptions(data.options) } : {}),
    });
  }

  static async deleteQuestion(id: string) {
    const question = await QuizGateway.getQuestionById(id);
    if (!question) {
      throw new NotFoundError(`Question with ID ${id} not found`);
    }
    return QuizGateway.deleteQuestion(id);
  }

  // ---- Timed runs ----

  /**
   * Opens a run at a quiz, or hands back the one already open.
   *
   * The deadline is worked out here and stored, never sent up by the browser, so
   * the countdown is anchored to real time: closing the tab, reloading, or coming
   * back tomorrow all resume the same clock rather than restarting it. Calling
   * this again mid-run deliberately returns the existing session — that is what
   * makes leaving and returning safe, and what stops a refresh buying more time.
   */
  static async startSession(userId: number, quizId: string) {
    // The published version, so the clock matches the time limit they were
    // shown rather than one an author has since changed. Falls back to the live
    // row for a quiz assigned on its own; `live` there keeps the guarantee that
    // a draft or recycled quiz cannot be started from a known id.
    const quiz =
      (await PublicationService.findPublishedQuiz(quizId)) ??
      (await QuizGateway.getQuizById(quizId, true));
    if (!quiz) throw new NotFoundError(`Quiz with ID ${quizId} not found`);

    const open = await QuizGateway.findOpenSession(userId, quizId);
    const session =
      open ??
      (await QuizGateway.createSession({
        userId,
        quizId,
        expiresAt: quiz.timeLimitMinutes
          ? new Date(Date.now() + quiz.timeLimitMinutes * 60_000)
          : null,
      }));

    return {
      sessionId: session.id,
      startedAt: session.startedAt.toISOString(),
      expiresAt: session.expiresAt ? session.expiresAt.toISOString() : null,
      timeLimitMinutes: quiz.timeLimitMinutes,
      secondsRemaining: secondsRemaining(session.expiresAt),
      /** So the page can correct for a clock that disagrees with the server's. */
      serverNow: new Date().toISOString(),
      /** True when they had already started and the clock has since run out. */
      expired: session.expiresAt !== null && session.expiresAt.getTime() <= Date.now(),
    };
  }

  /**
   * Grades a submission server-side and records the attempt. The correct answers
   * come back only when the author has turned on `showAnswers` for the quiz.
   * `answers` maps question id -> chosen option id.
   *
   * A run that is over still grades. The clock decides how long they had, not
   * whether the work counts, and the browser cannot be relied on to submit at the
   * exact moment it expires — a tab asleep for ten seconds must not lose the
   * answers already given.
   */
  static async submitAttempt(userId: number, quizId: string, answers: Record<string, string>) {
    // Graded against the published version, which is the one they answered.
    //
    // Reading the Quiz rows here would apply an author's unpublished answer key
    // to the questions actually on screen — marking someone wrong for correctly
    // answering what they were shown. Falling back to the live row covers a quiz
    // assigned on its own, which has no course snapshot behind it; `live` there
    // keeps the old guarantee that a draft or recycled quiz cannot be submitted
    // against.
    const quiz =
      (await PublicationService.findPublishedQuiz(quizId)) ??
      (await QuizGateway.getQuizById(quizId, true));
    if (!quiz) throw new NotFoundError(`Quiz with ID ${quizId} not found`);

    const session = await QuizGateway.findOpenSession(userId, quizId);
    const timedOut = Boolean(session?.expiresAt && session.expiresAt.getTime() <= Date.now());

    const total = quiz.questions.length;
    const score = quiz.questions.filter((question) =>
      question.options.some((option) => option.isCorrect && option.id === answers?.[question.id]),
    ).length;

    await QuizGateway.recordAttempt(userId, quizId, score, total);
    // Closing the run is what lets the next Start hand out a fresh clock.
    if (session) await QuizGateway.closeSession(session.id);

    return {
      score,
      total,
      timedOut,
      showAnswers: quiz.showAnswers,
      // Only disclosed when the author allows it.
      correctOptionIds: quiz.showAnswers
        ? quiz.questions
            .map((question) => question.options.find((option) => option.isCorrect)?.id)
            .filter((id): id is string => Boolean(id))
        : [],
    };
  }

  static getAttemptsForUser(userId: number) {
    return QuizGateway.getAttemptsForUser(userId);
  }
}
