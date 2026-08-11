/**
 * File: quiz-gateway.ts
 * Description: All database access for quizzes, questions, attempts and sessions.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { Prisma } from '../../../generated/prisma';
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
        moduleId: true,
        dueDate: true,
        questions: { select: { id: true } },
      },
    });
  }

  /** Author view: everything that has not been deleted. */
  static getAllQuizzes() {
    return prisma.quiz.findMany({
      where: { deletedAt: null },
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

  static createQuiz(data: {
    title: string;
    description?: string | null;
    moduleId?: string | null;
    order?: number;
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
      moduleId: string | null;
      courseId: string | null;
      published: boolean;
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
  static getDeletedQuizzes() {
    return prisma.quiz.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: {
        id: true,
        title: true,
        deletedAt: true,
        module: { select: { title: true, course: { select: { id: true, title: true } } } },
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

  static restoreAllQuizzes() {
    return prisma.quiz.updateMany({
      where: { deletedAt: { not: null } },
      data: { deletedAt: null },
    });
  }

  static purgeQuizzes() {
    return prisma.quiz.deleteMany({ where: { deletedAt: { not: null } } });
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
    data: { prompt: string; hint?: string | null; hintModuleNumber?: string | null },
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
      hintModuleNumber?: string | null;
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

  static getAttemptsForUser(userId: number) {
    return prisma.quizAttempt.findMany({
      where: { userId },
      orderBy: { completedAt: 'desc' },
    });
  }

  static runTransaction<T>(fn: (db: Db) => Promise<T>) {
    return prisma.$transaction(fn);
  }
}
