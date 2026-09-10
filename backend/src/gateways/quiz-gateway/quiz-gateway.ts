/**
 * File: quiz-gateway.ts
 * Description: All database access for quizzes, questions, attempts and sessions.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { Prisma, QuizType } from '../../../generated/prisma';
import { prisma } from '../../../prisma/prisma-client';

type Db = Prisma.TransactionClient;

// Questions and their options always travel together, so every read pulls the full tree.
const questionTree = {
  questions: {
    orderBy: { order: 'asc' },
    include: { options: { orderBy: { order: 'asc' } } },
  },
} satisfies Prisma.QuizInclude;

export default class QuizGateway {
  /** Learner view: published, non-deleted quizzes. */
  static getPublishedQuizzes() {
    return prisma.quiz.findMany({
      where: { deletedAt: null, published: true },
      orderBy: { title: 'asc' },
      include: questionTree,
    });
  }

  /**
   * Published quizzes reduced to what the dashboard reads. It shows a title, a
   * due date and a question count — never the questions themselves, which is
   * where the weight is.
   */
  static getQuizzesForDashboard() {
    return prisma.quiz.findMany({
      where: { deletedAt: null, published: true },
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        type: true,
        sectionId: true,
        dueDate: true,
        questions: { select: { id: true } },
      },
    });
  }

  /**
   * Which quizzes an author may reach, as a `where` clause.
   *
   * A quiz belongs to whoever owns the course its section sits in, so the access
   * decision is made once over courses and handed down here as a list of ids.
   *
   * `includeOrphans` covers the quiz that has no section at all. Nothing in the
   * app creates one any more — every quiz is written inside a set or a lesson —
   * but older rows exist, and they belong to no course, so like an unowned
   * course they stay with the global authors rather than with nobody.
   */
  static quizzesInCourses(courseIds: string[], includeOrphans: boolean): Prisma.QuizWhereInput {
    return {
      OR: [
        { section: { courseId: { in: courseIds } } },
        ...(includeOrphans ? [{ sectionId: null }] : []),
      ],
    };
  }

  /** Author view: everything not deleted that this person may reach. */
  static getQuizzesForAuthor(courseIds: string[], includeOrphans: boolean) {
    return prisma.quiz.findMany({
      where: { deletedAt: null, ...QuizGateway.quizzesInCourses(courseIds, includeOrphans) },
      orderBy: { title: 'asc' },
      include: questionTree,
    });
  }

  static getQuizById(id: string, live = false) {
    return prisma.quiz.findFirst({
      where: { id, deletedAt: null, ...(live ? { published: true } : {}) },
      include: questionTree,
    });
  }

  /**
   * The one-time link inside a course, if it has one.
   *
   * Two callers, both needing the same lookup: the rule that a one-time link
   * owns its whole quiz set, and the check that a link is not about to be sent
   * for a quiz still in draft. Selects three columns rather than reading the
   * course tree, which would drag every question, option and piece of base64
   * media along to answer what is nearly a yes-or-no question.
   *
   * Deliberately not filtered on `published` — both callers need to know it is
   * there precisely so they can say something about the state it is in.
   */
  static findOneTimeQuiz(courseId: string) {
    return prisma.quiz.findFirst({
      where: { deletedAt: null, type: QuizType.ONE_TIME, section: { courseId, deletedAt: null } },
      select: { id: true, title: true, published: true },
    });
  }

  /**
   * Marks every quiz in a course published, which is what publishing the course
   * now does. Returns how many changed, so a publish can say nothing when
   * nothing did.
   */
  static publishQuizzesInCourse(courseId: string) {
    return prisma.quiz.updateMany({
      where: { deletedAt: null, published: false, section: { courseId, deletedAt: null } },
      data: { published: true },
    });
  }

  /**
   * Fixes the kind of every quiz in a course, the first time it goes live.
   *
   * Separate from the flag above because the conditions differ: `published` is
   * only worth writing where it is false, while this has to reach quizzes that
   * were already published in an earlier version and have somehow been left
   * unlocked. Once set it is never cleared, so re-running it is harmless.
   */
  static lockQuizTypesInCourse(courseId: string) {
    return prisma.quiz.updateMany({
      where: { deletedAt: null, typeLocked: false, section: { courseId, deletedAt: null } },
      data: { typeLocked: true },
    });
  }

  static createQuiz(data: {
    title: string;
    description?: string | null;
    type?: QuizType;
    sectionId?: string | null;
    order?: number;
    published?: boolean;
    dueDate?: Date | null;
    timeLimitMinutes?: number | null;
  }) {
    return prisma.quiz.create({ data, include: questionTree });
  }

  static updateQuiz(
    id: string,
    data: Partial<{
      title: string;
      description: string | null;
      type: QuizType;
      sectionId: string | null;
      order: number;
      published: boolean;
      showResults: boolean;
      showAnswers: boolean;
      dueDate: Date | null;
      timeLimitMinutes: number | null;
    }>,
  ) {
    return prisma.quiz.update({ where: { id }, data, include: questionTree });
  }

  /** Soft delete, so the quiz can be restored from the admin dashboard. */
  static softDeleteQuiz(id: string) {
    return prisma.quiz.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  static restoreQuiz(id: string) {
    return prisma.quiz.update({ where: { id }, data: { deletedAt: null } });
  }

  /** The bin lists a quiz under the course it came from, so name that too. */
  static getDeletedQuizzes(courseIds: string[], includeOrphans: boolean) {
    return prisma.quiz.findMany({
      where: {
        deletedAt: { not: null },
        ...QuizGateway.quizzesInCourses(courseIds, includeOrphans),
      },
      orderBy: { deletedAt: 'desc' },
      select: {
        id: true,
        title: true,
        deletedAt: true,
        section: { select: { title: true, course: { select: { id: true, title: true } } } },
      },
    });
  }

  /** Only matches an already soft-deleted quiz, so live content can't be hard deleted. */
  static findDeletedQuiz(id: string) {
    return prisma.quiz.findFirst({ where: { id, deletedAt: { not: null } } });
  }

  /** Permanent. Questions, options and attempts go with it via ON DELETE CASCADE. */
  static hardDeleteQuiz(id: string) {
    return prisma.quiz.delete({ where: { id } });
  }

  static restoreAllQuizzes(courseIds: string[], includeOrphans: boolean) {
    return prisma.quiz.updateMany({
      where: {
        deletedAt: { not: null },
        ...QuizGateway.quizzesInCourses(courseIds, includeOrphans),
      },
      data: { deletedAt: null },
    });
  }

  static purgeQuizzes(courseIds: string[], includeOrphans: boolean) {
    return prisma.quiz.deleteMany({
      where: {
        deletedAt: { not: null },
        ...QuizGateway.quizzesInCourses(courseIds, includeOrphans),
      },
    });
  }

  static purgeQuizzesDeletedBefore(cutoff: Date) {
    return prisma.quiz.deleteMany({ where: { deletedAt: { not: null, lt: cutoff } } });
  }

  static getQuestionById(id: string) {
    return prisma.question.findUnique({ where: { id }, include: { options: true } });
  }

  static getLastQuestionOrder(quizId: string, db: Db = prisma) {
    return db.question.findFirst({ where: { quizId }, orderBy: { order: 'desc' } });
  }

  static shiftQuestionsFrom(quizId: string, fromOrder: number, db: Db) {
    return db.question.updateMany({
      where: { quizId, order: { gte: fromOrder } },
      data: { order: { increment: 1 } },
    });
  }

  static createQuestion(
    quizId: string,
    data: { prompt: string; hint?: string | null; hintSectionNumber?: string | null },
    order: number,
    options: Array<{ text: string; isCorrect: boolean }>,
    db: Db,
  ) {
    return db.question.create({
      data: {
        quizId,
        order,
        ...data,
        options: {
          create: options.map((option, index) => ({
            text: option.text,
            isCorrect: option.isCorrect,
            order: index + 1,
          })),
        },
      },
      include: { options: { orderBy: { order: 'asc' } } },
    });
  }

  /** Replaces the prompt/hint and, when given, the whole option set for a question. */
  static updateQuestion(
    id: string,
    data: {
      prompt?: string;
      hint?: string | null;
      hintSectionNumber?: string | null;
      options?: Array<{ text: string; isCorrect: boolean }>;
    },
  ) {
    const { options, ...fields } = data;

    return prisma.question.update({
      where: { id },
      data: {
        ...fields,
        ...(options !== undefined
          ? {
              options: {
                deleteMany: {},
                create: options.map((option, index) => ({
                  text: option.text,
                  isCorrect: option.isCorrect,
                  order: index + 1,
                })),
              },
            }
          : {}),
      },
      include: { options: { orderBy: { order: 'asc' } } },
    });
  }

  // Options are removed by the ON DELETE CASCADE foreign key.
  /**
   * Rewrites the order of every question in one quiz.
   *
   * Two passes, because `order` is not unique in the database but the sequence
   * still has to end up dense and collision-free while it is being rewritten:
   * everything is parked in a range nothing else occupies, then written down to
   * its final place. One pass would have question 2 taking position 1 while the
   * old question 1 still held it.
   *
   * Scoped by `quizId` on every write so an id from another quiz — a stale tab,
   * a hand-made request — cannot be dragged into this one.
   */
  static reorderQuestions(quizId: string, orderedIds: string[], db: Db) {
    const PARK = 100_000;

    return Promise.all([
      ...orderedIds.map((id, index) =>
        db.question.updateMany({ where: { id, quizId }, data: { order: PARK + index } }),
      ),
    ]).then(() =>
      Promise.all(
        orderedIds.map((id, index) =>
          db.question.updateMany({ where: { id, quizId }, data: { order: index + 1 } }),
        ),
      ),
    );
  }

  static deleteQuestion(id: string) {
    return prisma.question.delete({ where: { id } });
  }

  // ---- Timed quiz sessions ----

  /** The run this person currently has open on this quiz, if any. */
  static findOpenSession(userId: number, quizId: string) {
    return prisma.quizSession.findFirst({
      where: { userId, quizId, submittedAt: null },
      orderBy: { startedAt: 'desc' },
    });
  }

  static createSession(data: { userId: number; quizId: string; expiresAt: Date | null }) {
    return prisma.quizSession.create({ data });
  }

  static closeSession(id: string) {
    return prisma.quizSession.update({
      where: { id },
      data: { submittedAt: new Date() },
    });
  }

  static recordAttempt(userId: number, quizId: string, score: number, total: number) {
    return prisma.quizAttempt.create({ data: { userId, quizId, score, total } });
  }

  /** Whether this person has ever handed this quiz in — the one-time gate. */
  static async hasAttempted(userId: number, quizId: string): Promise<boolean> {
    const attempt = await prisma.quizAttempt.findFirst({
      where: { userId, quizId },
      select: { id: true },
    });
    return attempt !== null;
  }

  /** Stores the paper alongside an attempt. Only one-time quizzes keep one. */
  static recordAnswers(
    attemptId: string,
    answers: Array<{
      questionId: string;
      order: number;
      prompt: string;
      chosen: string[];
      correct: string[];
      wasCorrect: boolean;
    }>,
  ) {
    if (answers.length === 0) return Promise.resolve({ count: 0 });
    return prisma.quizAnswer.createMany({
      data: answers.map((answer) => ({ attemptId, ...answer })),
    });
  }

  /**
   * The most recent attempt at one quiz, paper included, so a result can be
   * handed back without the learner sitting it again. Only a one-time quiz keeps
   * a paper, which is the one kind that needs this.
   */
  static findLatestAttempt(userId: number, quizId: string) {
    return prisma.quizAttempt.findFirst({
      where: { userId, quizId },
      orderBy: { completedAt: 'desc' },
      select: {
        id: true,
        score: true,
        total: true,
        answers: { orderBy: { order: 'asc' } },
      },
    });
  }

  static getAttemptsForUser(userId: number) {
    return prisma.quizAttempt.findMany({
      where: { userId },
      orderBy: { completedAt: 'desc' },
    });
  }

  /**
   * One person's attempts at quizzes of a given kind, papers included.
   *
   * Reads the quiz title off the row rather than off a snapshot: a one-time quiz
   * stands alone, so there is no published course version to look it up in.
   */
  static getAnsweredAttempts(userId: number, type: QuizType) {
    return prisma.quizAttempt.findMany({
      where: { userId, quiz: { type } },
      orderBy: { completedAt: 'desc' },
      select: {
        id: true,
        score: true,
        total: true,
        completedAt: true,
        quiz: { select: { id: true, title: true, type: true } },
        answers: { orderBy: { order: 'asc' } },
      },
    });
  }

  static runTransaction<T>(fn: (db: Db) => Promise<T>) {
    return prisma.$transaction(fn);
  }
}
