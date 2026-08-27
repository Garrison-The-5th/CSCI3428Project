/**
 * File: quiz-service.ts
 * Description: Quiz grading, answer redaction, question validation and timed sessions.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { optionalText, parseDaysRemaining, requiredText } from '@/config/validation';
import { ConflictError, NotFoundError } from '@/controllers/http-errors';
import AssignmentGateway from '@/gateways/assignment-gateway/assignment-gateway';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import EnrolmentService from '@/services/enrolment-service/enrolment-service';
import PublicationService from '@/services/publication-service/publication-service';

import { CourseKind, QuizType } from '../../../generated/prisma';

export interface OptionInput {
  text: string;
  isCorrect?: boolean;
}

export interface QuestionInput {
  prompt?: string;
  hint?: string | null;
  hintSectionNumber?: string | null;
  options?: OptionInput[];
}

/**
 * Every question is multiple choice or multiple answer: at least two options, and
 * at least one of them correct.
 *
 * The old rule was exactly one, which is what made every question a single
 * choice. Allowing more is the whole of multiple-answer support at this layer —
 * a question with two correct options is graded as all-or-nothing further down,
 * and the runner draws checkboxes instead of radios when it sees more than one.
 * A question with *no* correct option is still refused: it cannot be passed.
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
  if (correctCount === 0) {
    throw new Error('at least one option must be marked correct');
  }
  if (correctCount === cleaned.length) {
    throw new Error('marking every option correct leaves nothing to answer');
  }

  return cleaned;
}

/**
 * Refusing a second go at a one-time quiz.
 *
 * Its own class so the controllers can answer 409 rather than the generic 400
 * every other validation failure gets — "you have already done this" is a state
 * the page has to render differently, not a bad request.
 */
export class AlreadyCompletedError extends ConflictError {
  constructor() {
    super('You have already completed this quiz');
  }
}

/**
 * What a learner sent for one question, as a list of option ids.
 *
 * Single-answer questions used to send a bare string and the older clients still
 * do, so both shapes are accepted. Anything else — a number, an object, a nested
 * array — is read as no answer rather than trusted into the grader.
 */
function chosenIds(answer: string | string[] | undefined): string[] {
  if (typeof answer === 'string') return answer ? [answer] : [];
  if (!Array.isArray(answer)) return [];
  return [...new Set(answer.filter((id): id is string => typeof id === 'string' && id !== ''))];
}

const QUIZ_TYPES = Object.values(QuizType) as string[];

/**
 * Reads a quiz kind off a request body, defaulting to EXAM.
 *
 * Absent means EXAM rather than an error, because "a quiz" with nothing said
 * about it is the ordinary graded kind — that is what the Create a Quiz form
 * sends. Anything present but unrecognised is refused outright rather than
 * quietly falling back, so a typo in a client cannot silently create the wrong
 * kind of quiz.
 */
export function parseQuizType(value: unknown): QuizType {
  if (value === undefined || value === null || value === '') return QuizType.EXAM;
  if (!QUIZ_TYPES.includes(value as string)) {
    throw new Error(`type must be one of ${QUIZ_TYPES.join(', ')}`);
  }
  return value as QuizType;
}

/**
 * Where each kind of quiz is allowed to live, and what it is allowed to carry.
 *
 * Stated once, and applied on both create and update, so a quiz cannot be made
 * legally and then edited into an impossible shape — switching a learning check
 * out of its section has to be refused here rather than discovered later.
 *
 * `sectionKind` is the kind of course owning `sectionId`, and is null when the
 * quiz sits in no section at all. It is what separates the two places a section
 * can be: a lesson's sections carry the learning either side of the quiz, while
 * a quiz set's sections are nothing but rows in a list of quizzes.
 */
function enforceTypeRules(
  type: QuizType,
  sectionId: string | null,
  timeLimitMinutes: number | null,
  sectionKind: CourseKind | null,
): { sectionId: string | null; timeLimitMinutes: number | null } {
  if (type === QuizType.LEARNING_CHECK) {
    if (!sectionId) {
      throw new Error('a learning check lives inside a section — pick one for it');
    }
    // Never timed. A learning check is there to make somebody stop and think,
    // and a clock turns that into a different exercise.
    return { sectionId, timeLimitMinutes: null };
  }

  if (type === QuizType.ONE_TIME) {
    // A one-time link may own a quiz set's section, because that section is only
    // the row that carries its name, minutes, colour and order — authoring
    // furniture, not a place a learner can browse to. What keeps it unreachable
    // except through its link is `BROWSABLE_QUIZ_TYPES` and the LINK-only
    // assignment that delivers it, neither of which depends on it being
    // sectionless.
    //
    // A lesson section is the opposite: it sits in a run of content a learner
    // walks through, so a quiz in one is reached by reading the lesson. That is
    // exactly what a one-time link must never be.
    if (sectionId && sectionKind !== CourseKind.QUIZ_SET) {
      throw new Error(
        'a one-time link is only reached through its link, so it cannot sit in a lesson section',
      );
    }
    return { sectionId, timeLimitMinutes };
  }

  return { sectionId, timeLimitMinutes };
}

/**
 * A one-time link owns its whole quiz set.
 *
 * The link is issued for the course, and opening it hands the holder everything
 * in that course — so a second quiz sitting beside a one-time link would be
 * handed over with it, and would be reachable again by anyone who kept the URL
 * until the one-time quiz closed it. One set, one section, one quiz is the only
 * shape where "one attempt, then gone" means what it says.
 *
 * Checked on the quiz side here and on the section side in CurriculumService, so
 * neither order of operations can get around it: you cannot make the only quiz
 * in a two-quiz set one-time, and you cannot add a second quiz to a set whose
 * quiz is one-time.
 */
async function assertOneTimeIsAlone(sectionId: string): Promise<void> {
  const section = await CurriculumGateway.getSectionById(sectionId);
  if (!section) return;

  const siblings = await CurriculumGateway.getSectionsForRenumber(section.courseId);
  if (siblings.length > 1) {
    throw new Error(
      'a one-time link has to be the only quiz in its set — remove the others, or make a new set ' +
        'for it',
    );
  }
}

/** The kind of course a section belongs to, or null when there is no section. */
async function courseKindOfSection(sectionId: string | null): Promise<CourseKind | null> {
  if (!sectionId) return null;
  const section = await CurriculumGateway.getSectionById(sectionId);
  if (!section) throw new NotFoundError(`Section with ID ${sectionId} not found`);
  const course = await CurriculumGateway.getCourseById(section.courseId);
  return course?.kind ?? CourseKind.LESSON;
}

/**
 * Which kinds a learner may find by browsing.
 *
 * A learning check belongs to the piece of learning around it and is taken in
 * place, and a one-time quiz is only ever reached through the link it was sent
 * in — showing either on the Quizzes tab would be wrong for opposite reasons.
 */
export const BROWSABLE_QUIZ_TYPES: QuizType[] = [QuizType.EXAM];

function isBrowsable(quiz: { type?: QuizType | null }): boolean {
  // Rows and snapshots written before the three kinds existed have no type and
  // were all exams, so a missing type reads as one.
  return BROWSABLE_QUIZ_TYPES.includes(quiz.type ?? QuizType.EXAM);
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
 * One run, as the page reads it.
 *
 * `serverNow` travels with it so the browser can correct for a device clock that
 * disagrees with the server's, and `expired` says the run was already open and
 * has since run out — which is a different thing from never having started.
 */
function describeSession(
  session: { id: string; startedAt: Date; expiresAt: Date | null },
  timeLimitMinutes: number | null,
) {
  return {
    sessionId: session.id,
    startedAt: session.startedAt.toISOString(),
    expiresAt: session.expiresAt ? session.expiresAt.toISOString() : null,
    timeLimitMinutes,
    secondsRemaining: secondsRemaining(session.expiresAt),
    serverNow: new Date().toISOString(),
    expired: session.expiresAt !== null && session.expiresAt.getTime() <= Date.now(),
  };
}

/**
 * A quiz nobody has opened yet. It still carries the time limit, because that is
 * what the details panel in front of the Start button has to show.
 */
function idleSession(timeLimitMinutes: number | null) {
  const now = new Date().toISOString();
  return {
    sessionId: null,
    startedAt: now,
    expiresAt: null,
    timeLimitMinutes,
    secondsRemaining: null,
    serverNow: now,
    expired: false,
  };
}

/** A learning check, which has no clock and so nothing to resume. */
function learningCheckSession() {
  return idleSession(null);
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

    const fromCourses = snapshots
      // Quiz sets only.
      //
      // The Quizzes tab lists what was built on the Create a quiz side; a
      // lesson's quizzes belong to the lesson around them and are taken in
      // place, from the Learning tab. Listing those here offered the same quiz
      // in two places, one of which stripped it of everything it was written to
      // follow on from.
      .filter((snapshot) => snapshot.kind === CourseKind.QUIZ_SET)
      .flatMap((snapshot) => snapshot.sections.flatMap((section) => section.quizzes ?? []))
      // Learning checks are taken inside the lesson they belong to and are never
      // listed here; a one-time quiz is reached only through its link, and the
      // filter is written on kind rather than on placement so neither can slip
      // through on a technicality.
      .filter(isBrowsable);

    // A quiz assigned on its own has no course snapshot behind it, so it is read
    // from its own row — there is nothing else to read.
    //
    // A one-time quiz is excluded even when the address it was sent to belongs to
    // a real account. That is the point of it: the link is the only way in, and
    // signing in must not turn a one-off into a permanent entry on their list.
    const standalone = enrolment.quizIds.size
      ? (await QuizGateway.getPublishedQuizzes()).filter(
          (quiz) =>
            enrolment.quizIds.has(quiz.id) &&
            isBrowsable(quiz) &&
            // Nothing that belongs to a course. A quiz inside a lesson is part of
            // that lesson and is taken there; one inside a quiz set has already
            // come through the snapshots above, as published rather than as the
            // author's working copy.
            quiz.sectionId === null &&
            !fromCourses.some((published) => published.id === quiz.id),
        )
      : [];

    return [...fromCourses, ...standalone].map((quiz) => redactAnswers(quiz));
  }

  /** Author view, answers included. */
  /**
   * Author view: the quizzes inside the courses this person may edit.
   *
   * A quiz has no owner of its own — it belongs to the course whose section it
   * sits in — so the access decision is made once over courses and the quiz
   * queries are scoped to what comes back.
   */
  static async getQuizzesForAuthor(userId: number, isGlobalAuthor: boolean) {
    const courseIds = await CurriculumGateway.getAccessibleCourseIds(userId, isGlobalAuthor);
    return QuizGateway.getQuizzesForAuthor(courseIds, isGlobalAuthor);
  }

  /** The quizzes in this person's recycle bin. */
  static async getDeletedQuizzes(userId: number, isGlobalAuthor: boolean) {
    const courseIds = await CurriculumGateway.getAccessibleCourseIds(userId, isGlobalAuthor);
    return QuizGateway.getDeletedQuizzes(courseIds, isGlobalAuthor);
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

  /**
   * Creates a quiz of one of the three kinds. `type` defaults to EXAM, which is
   * what the Create a Quiz page offers first and what every existing quiz is.
   *
   * Where it may sit follows from the kind rather than from what the caller asks
   * for — see `enforceTypeRules`.
   */
  static async createQuiz(data: {
    title?: string;
    description?: string | null;
    type?: string | null;
    sectionId?: string | null;
    dueDate?: string | null;
    timeLimitMinutes?: number | string | null;
  }) {
    const quizTitle = requiredText(data.title, 'title', 'quiz title');
    const type = parseQuizType(data.type);

    // The section is resolved before the rules are applied, because where a
    // one-time link may sit depends on what kind of course owns that section —
    // and a bad id should say so rather than surface as a foreign key violation.
    const requestedSectionId = data.sectionId || null;
    const sectionKind = await courseKindOfSection(requestedSectionId);

    const { sectionId, timeLimitMinutes } = enforceTypeRules(
      type,
      requestedSectionId,
      parseTimeLimit(data.timeLimitMinutes),
      sectionKind,
    );

    if (type === QuizType.ONE_TIME && sectionId) await assertOneTimeIsAlone(sectionId);

    // Silent for the same reason section creation is: nothing an author writes
    // reaches a learner until the course is published, so the announcement waits
    // for that.
    return QuizGateway.createQuiz({
      title: quizTitle,
      description: optionalText(data.description, 'description', 'quiz description') ?? null,
      type,
      sectionId,
      // Published on creation, because a quiz no longer has a publish state of
      // its own — its course's does the gating, and the snapshot taken at
      // publish time is what learners actually read. The column stays true so
      // the handful of places still reading it directly (the dashboard's
      // trimmed query, a quiz standing on its own) do not treat a live quiz as
      // a draft.
      published: true,
      // Elements and quizzes share one sequence, so append after whichever is
      // last. A standalone quiz has no sequence to join.
      order: sectionId ? (await CurriculumGateway.getLastContentOrder(sectionId)) + 1 : 0,
      timeLimitMinutes,
      dueDate:
        data.dueDate !== undefined
          ? parseDate(data.dueDate, 'dueDate')
          : await QuizService.inheritedDueDate(sectionId),
    });
  }

  /**
   * A quiz with no due date of its own inherits the due date of the course that
   * owns its section.
   */
  static async inheritedDueDate(sectionId: string | null): Promise<Date | null> {
    if (!sectionId) return null;

    const section = await CurriculumGateway.getSectionById(sectionId);
    if (!section) return null;

    const course = await CurriculumGateway.getCourseById(section.courseId);
    return course?.dueDate ?? null;
  }

  static async updateQuiz(
    id: string,
    data: {
      title?: string;
      description?: string | null;
      type?: string | null;
      sectionId?: string | null;
      published?: boolean;
      showResults?: boolean;
      showAnswers?: boolean;
      allowMultipleAttempts?: boolean;
      dueDate?: string | null;
      daysRemaining?: number | string | null;
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

    // The rules are checked against what the quiz will be once this edit lands,
    // not against what was sent — changing only the type has to be judged against
    // the section it is already in, and vice versa.
    const type = data.type !== undefined ? parseQuizType(data.type) : quiz.type;
    const daysRemaining = parseDaysRemaining(data.daysRemaining);
    const sectionId =
      data.sectionId !== undefined ? data.sectionId || null : (quiz.sectionId ?? null);
    const timeLimitMinutes =
      data.timeLimitMinutes !== undefined
        ? parseTimeLimit(data.timeLimitMinutes)
        : quiz.timeLimitMinutes;

    // Resolved first: it both checks the target section up front — so a bad id
    // gives a readable message instead of a raw foreign key violation — and
    // tells the rules whether that section belongs to a lesson or a quiz set.
    const sectionKind = await courseKindOfSection(sectionId);

    const settled = enforceTypeRules(type, sectionId, timeLimitMinutes, sectionKind);

    if (settled.sectionId && type === QuizType.ONE_TIME) {
      await assertOneTimeIsAlone(settled.sectionId);
    }

    // A quiz moving into a section for the first time has to join that section's
    // content sequence, or it lands at 0 and sits above everything.
    const order =
      settled.sectionId && settled.sectionId !== quiz.sectionId
        ? (await CurriculumGateway.getLastContentOrder(settled.sectionId)) + 1
        : undefined;

    return QuizGateway.updateQuiz(id, {
      ...(nextTitle !== undefined ? { title: nextTitle } : {}),
      ...(data.description !== undefined ? { description: nextDescription ?? null } : {}),
      ...(data.type !== undefined ? { type } : {}),
      ...(settled.sectionId !== (quiz.sectionId ?? null) ? { sectionId: settled.sectionId } : {}),
      ...(order !== undefined ? { order } : {}),
      ...(data.published !== undefined ? { published: data.published === true } : {}),
      ...(data.showResults !== undefined ? { showResults: data.showResults === true } : {}),
      ...(data.showAnswers !== undefined ? { showAnswers: data.showAnswers === true } : {}),
      // Only an exam has sittings to count. A learning check is always
      // retakeable and a one-time link never is, so the flag is stored as false
      // on both rather than left to say something the runner would ignore.
      ...(data.allowMultipleAttempts !== undefined
        ? { allowMultipleAttempts: type === QuizType.EXAM && data.allowMultipleAttempts === true }
        : type !== QuizType.EXAM && quiz.allowMultipleAttempts
          ? { allowMultipleAttempts: false }
          : {}),
      ...(data.dueDate !== undefined ? { dueDate: parseDate(data.dueDate, 'dueDate') } : {}),
      ...(daysRemaining !== undefined ? { daysRemaining } : {}),
      ...(settled.timeLimitMinutes !== quiz.timeLimitMinutes
        ? { timeLimitMinutes: settled.timeLimitMinutes }
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
    if (restored.sectionId) {
      const section = await CurriculumGateway.getSectionById(restored.sectionId);
      if (section) await CurriculumGateway.touchDraft(section.courseId);
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

  static async restoreAllQuizzes(userId: number, isGlobalAuthor: boolean) {
    const courseIds = await CurriculumGateway.getAccessibleCourseIds(userId, isGlobalAuthor);
    const { count } = await QuizGateway.restoreAllQuizzes(courseIds, isGlobalAuthor);
    return count;
  }

  static async purgeAllQuizzes(userId: number, isGlobalAuthor: boolean) {
    const courseIds = await CurriculumGateway.getAccessibleCourseIds(userId, isGlobalAuthor);
    const { count } = await QuizGateway.purgeQuizzes(courseIds, isGlobalAuthor);
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
      hintSectionNumber: optionalText(data.hintSectionNumber, 'tag', 'hint section number') ?? null,
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
      ...(data.hintSectionNumber !== undefined
        ? { hintSectionNumber: optionalText(data.hintSectionNumber, 'tag', 'hint section') ?? null }
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
   * The quiz a run is opened against: the published version, so the clock matches
   * the time limit the learner was shown rather than one an author has changed
   * since. Falls back to the live row for a quiz assigned on its own, which has
   * no course snapshot behind it; `live` there keeps the guarantee that a draft
   * or recycled quiz cannot be started from a known id.
   */
  private static async quizForRun(quizId: string) {
    const quiz =
      (await PublicationService.findPublishedQuiz(quizId)) ??
      (await QuizGateway.getQuizById(quizId, true));
    if (!quiz) throw new NotFoundError(`Quiz with ID ${quizId} not found`);
    return quiz;
  }

  /**
   * Whether this quiz gets one sitting and no more.
   *
   * Stated once because three places have to agree about it: the peek that
   * decides which screen a learner lands on, the start that hands out a clock,
   * and the submit that grades. A one-time link is always single-sitting. An
   * exam is unless its author allowed multiple attempts. A learning check never
   * is — it keeps no mark, so there is nothing a retake could spoil, and being
   * able to have another go at one is the point of it.
   */
  private static isSingleSitting(type: QuizType, allowMultipleAttempts?: boolean | null): boolean {
    if (type === QuizType.ONE_TIME) return true;
    return type === QuizType.EXAM && allowMultipleAttempts !== true;
  }

  /**
   * Whether this person is already part way through this quiz, without starting
   * one if they are not.
   *
   * This is what lets the player show the details of a quiz — its length, its
   * questions, its clock — behind a Start button, and then skip that screen for
   * somebody coming back to a run already ticking. Asking `startSession` instead
   * would answer the question by starting the clock, which is the one thing
   * looking at a quiz must never do.
   *
   * A learning check has no run to be part way through and reports `started`
   * true, because it is taken in place with no gate in front of it.
   */
  static async peekSession(userId: number, quizId: string) {
    const quiz = await QuizService.quizForRun(quizId);
    const type = quiz.type ?? QuizType.EXAM;

    const attempted = await QuizGateway.hasAttempted(userId, quizId);

    /*
     * Whether they may sit it again, which is a different question from whether
     * they have.
     *
     * A one-time link never reopens — that is the whole of what it is. An exam
     * reopens only when its author allowed multiple attempts. A learning check
     * always does: it keeps no mark, so there is nothing a retake could spoil.
     *
     * Asked of `hasAttempted` rather than of whether a paper came back, so this
     * gate reads the same fact `startSession` and `submitAttempt` read. A paper
     * is a nicety that an old attempt may not have; being closed is not.
     */
    const closed = attempted && QuizService.isSingleSitting(type, quiz.allowMultipleAttempts);

    /*
     * The paper from a sitting already done.
     *
     * Fetched for every kind, not just the one that cannot be retaken. Coming
     * back to a quiz you have finished — stepping back through a lesson, or
     * reopening one from the rail — has to show what it showed when you handed
     * it in, and the only place that survives a page load is the attempt row.
     * What is drawn from it is still the author's two toggles, carried on the
     * result itself, so a second look and a first one disclose exactly the same
     * things.
     */
    const previous = attempted ? await QuizService.previousResult(userId, quiz) : null;

    if (closed) {
      return {
        ...idleSession(quiz.timeLimitMinutes),
        started: false,
        completed: true,
        result: previous,
      };
    }

    if (type === QuizType.LEARNING_CHECK) {
      return { ...learningCheckSession(), started: true, completed: false, result: previous };
    }

    const open = await QuizGateway.findOpenSession(userId, quizId);
    if (!open) {
      return {
        ...idleSession(quiz.timeLimitMinutes),
        started: false,
        completed: false,
        result: previous,
      };
    }

    return {
      ...describeSession(open, quiz.timeLimitMinutes),
      started: true,
      completed: false,
      // A run is open, so the questions are what they came back for — an older
      // attempt's marks alongside them would be marking the wrong paper.
      result: null,
    };
  }

  /**
   * The marked paper from an attempt already sat, in the shape the runner draws
   * a fresh one in.
   *
   * The stored paper keeps option *text* rather than option ids — it is written
   * to be readable on its own in the admin dashboard, long after the quiz may
   * have been edited — so the correct options are matched back by text against
   * the quiz as it stands. A question whose wording has changed since simply
   * matches nothing and is left unmarked, which is the honest answer: the paper
   * says what they were asked, and this quiz no longer asks it.
   */
  private static async previousResult(
    userId: number,
    quiz: {
      id: string;
      type?: QuizType | null;
      showResults?: boolean | null;
      showAnswers: boolean;
      questions: Array<{ id: string; options: Array<{ id: string; text: string }> }>;
    },
  ) {
    const attempt = await QuizGateway.findLatestAttempt(userId, quiz.id);
    if (!attempt) return null;

    /** The options of one question, looked up by the text the paper recorded. */
    const idsByText = (questionId: string, texts: string[]) => {
      const question = quiz.questions.find((entry) => entry.id === questionId);
      if (!question) return [];
      return question.options.filter((option) => texts.includes(option.text)).map((o) => o.id);
    };

    const correctOptionIds = quiz.showAnswers
      ? attempt.answers.flatMap((answer) => idsByText(answer.questionId, answer.correct))
      : [];

    /*
     * A learning check's mark is deliberately not stored — the attempt row
     * carries 0 of 0 — so the ring is counted back off the paper instead. That
     * keeps the rule intact (nothing about how they did is kept anywhere it
     * could be reported on) while still letting the screen they saw on the day
     * come back the same.
     */
    const marked = attempt.answers.filter((answer) => answer.wasCorrect).length;
    const scored = attempt.total > 0 || attempt.answers.length === 0;

    return {
      score: scored ? attempt.score : marked,
      total: scored ? attempt.total : attempt.answers.length,
      // The clock is long gone; what matters now is the mark, not how it ended.
      timedOut: false,
      type: quiz.type ?? QuizType.EXAM,
      showResults: quiz.showResults ?? true,
      showAnswers: quiz.showAnswers,
      perQuestion: attempt.answers.map((answer) => ({
        questionId: answer.questionId,
        correct: answer.wasCorrect,
        // What they ticked, so the paper comes back filled in rather than blank
        // with marks floating beside empty options.
        chosenOptionIds: idsByText(answer.questionId, answer.chosen),
      })),
      correctOptionIds,
    };
  }

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
    const quiz = await QuizService.quizForRun(quizId);

    const type = quiz.type ?? QuizType.EXAM;

    // One sitting means one sitting, whichever way they come back at it. That
    // covers a one-time link always, and an exam whose author did not allow
    // multiple attempts — the same pair `peekSession` reports as closed, stated
    // again here so the door cannot be walked past by calling start directly.
    if (QuizService.isSingleSitting(type, quiz.allowMultipleAttempts)) {
      if (await QuizGateway.hasAttempted(userId, quizId)) throw new AlreadyCompletedError();
    }

    // A learning check has no clock and nothing to resume, so it never opens a
    // run — creating one would leave a row open forever, because nothing about a
    // learning check ever closes it.
    if (type === QuizType.LEARNING_CHECK) {
      return { ...learningCheckSession(), started: true, completed: false };
    }

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

    return { ...describeSession(session, quiz.timeLimitMinutes), started: true, completed: false };
  }

  /**
   * Grades a submission server-side and records the attempt.
   *
   * `answers` maps question id -> the option ids they chose. A single-answer
   * question sends one id; a multiple-answer question sends several, and is
   * marked right only when the set matches exactly — half the correct options is
   * not half a mark, because partial credit on an unordered set is a judgement
   * call the author never made.
   *
   * What comes back depends on the kind and on the author's settings:
   *   - `perQuestion` is always sent. A learning check is a tick or a cross per
   *     question and nothing else, and that is what carries it.
   *   - `score`/`total` are real for an exam and a one-time quiz. For a learning
   *     check the mark is not kept anywhere, so nothing is stored and the count
   *     comes back purely so the ring has something to draw if results are on.
   *   - `correctOptionIds` still only appears when the author allows it.
   *
   * A run that is over still grades. The clock decides how long they had, not
   * whether the work counts, and the browser cannot be relied on to submit at the
   * exact moment it expires — a tab asleep for ten seconds must not lose the
   * answers already given.
   */
  static async submitAttempt(
    userId: number,
    quizId: string,
    answers: Record<string, string | string[]>,
  ) {
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

    const type = quiz.type ?? QuizType.EXAM;

    if (QuizService.isSingleSitting(type, quiz.allowMultipleAttempts)) {
      if (await QuizGateway.hasAttempted(userId, quizId)) throw new AlreadyCompletedError();
    }

    const session =
      type === QuizType.LEARNING_CHECK ? null : await QuizGateway.findOpenSession(userId, quizId);
    const timedOut = Boolean(session?.expiresAt && session.expiresAt.getTime() <= Date.now());

    const marked = quiz.questions.map((question) => {
      const chosen = new Set(chosenIds(answers?.[question.id]));
      const correct = question.options.filter((option) => option.isCorrect).map((o) => o.id);

      return {
        questionId: question.id,
        order: question.order,
        prompt: question.prompt,
        correct: correct.every((id) => chosen.has(id)) && chosen.size === correct.length,
        chosenIds: [...chosen],
        correctIds: correct,
        chosenTexts: question.options.filter((o) => chosen.has(o.id)).map((o) => o.text),
        correctTexts: question.options.filter((o) => o.isCorrect).map((o) => o.text),
      };
    });

    const total = marked.length;
    const score = marked.filter((entry) => entry.correct).length;

    // A learning check's mark is deliberately not kept: what the dashboard needs
    // from it is that an attempt happened at all, which is the row itself.
    const attempt = await QuizGateway.recordAttempt(
      userId,
      quizId,
      type === QuizType.LEARNING_CHECK ? 0 : score,
      type === QuizType.LEARNING_CHECK ? 0 : total,
    );

    // Handing a quiz in credits the section it sits in.
    //
    // A section counts as done when it has been viewed *and* its quizzes have
    // been attempted (see DashboardService.isSectionComplete), and until now the
    // view half was only ever recorded by opening a piece of content. A quiz set
    // has no content — its sections hold nothing but the quiz — so somebody could
    // sit a whole set, score full marks, and still show nought per cent, which is
    // exactly what a one-time link did: the dashboard knew about the attempt and
    // the course knew nothing.
    //
    // Recording it here rather than in the player because it is a fact about
    // what happened, not about what was rendered: you cannot hand in a quiz
    // without having been in the section it belongs to, whichever page you did
    // it from and whether you were signed in or on a link.
    if (quiz.sectionId) {
      await CurriculumGateway.recordSectionView(userId, quiz.sectionId);
    }

    /*
     * The paper is kept for every kind now.
     *
     * It used to be one-time only, on the reasoning that a retake would
     * supersede it anyway. What that missed is coming *back* to a quiz already
     * handed in — stepping backwards through a lesson, or reopening one from the
     * rail — where the learner has to see what they saw when they submitted, and
     * the attempt row alone cannot say which questions they got right or what
     * they ticked.
     *
     * It discloses nothing new: `previousResult` runs the author's own
     * `showResults` and `showAnswers` toggles over it exactly as submission
     * does, so a second look shows neither more nor less than the first.
     */
    await QuizGateway.recordAnswers(
      attempt.id,
      marked.map((entry) => ({
        questionId: entry.questionId,
        order: entry.order,
        prompt: entry.prompt,
        chosen: entry.chosenTexts,
        correct: entry.correctTexts,
        wasCorrect: entry.correct,
      })),
    );

    // Only a one-time quiz closes the link it arrived on, so opening that URL
    // again says so plainly instead of offering the quiz a second time.
    if (type === QuizType.ONE_TIME) {
      await AssignmentGateway.markQuizCompleted(userId, quizId);
    }

    // Closing the run is what lets the next Start hand out a fresh clock.
    if (session) await QuizGateway.closeSession(session.id);

    return {
      score,
      total,
      timedOut,
      type,
      /** Off means the learner is moved straight on without being told how they did. */
      showResults: quiz.showResults ?? true,
      showAnswers: quiz.showAnswers,
      /** A tick or a cross per question, in the order they were asked. */
      perQuestion: marked.map((entry) => ({
        questionId: entry.questionId,
        correct: entry.correct,
        // Sent back so the marked paper reads the same on a later visit as it
        // does now — see `previousResult`, which rebuilds this from the record.
        chosenOptionIds: entry.chosenIds,
      })),
      // Only disclosed when the author allows it. Every correct option of every
      // question, so a multiple-answer question marks all of its answers.
      correctOptionIds: quiz.showAnswers ? marked.flatMap((entry) => entry.correctIds) : [],
    };
  }

  static getAttemptsForUser(userId: number) {
    return QuizGateway.getAttemptsForUser(userId);
  }

  /** Completed one-time quizzes for one person, papers included, for the dashboard. */
  static getCompletedOneTimeQuizzes(userId: number) {
    return QuizGateway.getAnsweredAttempts(userId, QuizType.ONE_TIME);
  }
}
