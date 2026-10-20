/**
 * File: quiz-controller.ts
 * Description: HTTP routes for quizzes, questions, sessions and attempts.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { Request, Response } from 'express';

import {
  authenticateAndAttachUser,
  AuthenticatedRequest,
} from '@/controllers/auth-controller/auth-middleware';
import {
  type CourseReach,
  courseReach,
  requireAuthor,
} from '@/controllers/auth-controller/authorization-middleware';
import {
  fromQuestionParam,
  fromQuizParam,
  fromSectionInBody,
  requireCourseEditor,
} from '@/controllers/auth-controller/course-access-middleware';
import { controller, del, get, post, put, use } from '@/controllers/decorators';
import { fail } from '@/controllers/http-errors';
import { rateLimit } from '@/controllers/middleware/rate-limit';
import EditAttributionService from '@/services/edit-attribution-service/edit-attribution-service';
import QuizService, { QuestionInput } from '@/services/quiz-service/quiz-service';

// req.params values are typed `string | string[]` in Express 5, so normalize before use.
function param(req: Request, name: string): string {
  return String(req.params[name]);
}

/**
 * How far the caller reaches: every course's quizzes for an admin; for an
 * author, the scoped listings widened by exactly the quizzes that belong to no
 * course — see `QuizGateway.quizzesInCourses`.
 */
function isGlobalAuthor(req: AuthenticatedRequest): CourseReach {
  return courseReach(req.auth!.roles);
}

@controller('/quizzes')
export default class QuizController {
  /**
   * Learner view: the quizzes this person can reach, with the correct answers
   * stripped out. Scoped to what they are enrolled on, like the Learning page.
   */
  @get('/')
  @use(authenticateAndAttachUser)
  async getQuizzes(req: AuthenticatedRequest, res: Response) {
    const quizzes = await QuizService.getQuizzesForLearner(req.user!.email);
    return res.send({ quizzes });
  }

  /**
   * Author view: drafts included, answers intact so they can be edited — and
   * only the quizzes inside courses this person owns or was named on.
   */
  @get('/manage')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async getQuizzesForAuthor(req: AuthenticatedRequest, res: Response) {
    const quizzes = await QuizService.getQuizzesForAuthor(req.user!.id, isGlobalAuthor(req));
    return res.send({ quizzes });
  }

  @get('/deleted')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async getDeletedQuizzes(req: AuthenticatedRequest, res: Response) {
    const quizzes = await QuizService.getDeletedQuizzes(req.user!.id, isGlobalAuthor(req));
    return res.send({ quizzes });
  }

  /** Restores this person's deleted quizzes in one go. */
  @post('/deleted/restore-all')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async restoreAllQuizzes(req: AuthenticatedRequest, res: Response) {
    try {
      const restored = await QuizService.restoreAllQuizzes(req.user!.id, isGlobalAuthor(req));
      return res.send({ message: 'Quizzes restored', restored });
    } catch (error) {
      return fail(res, error, 'Error restoring quizzes');
    }
  }

  /** Permanently removes this person's deleted quizzes. */
  @del('/deleted')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async purgeAllQuizzes(req: AuthenticatedRequest, res: Response) {
    try {
      const purged = await QuizService.purgeAllQuizzes(req.user!.id, isGlobalAuthor(req));
      return res.send({ message: 'Deleted quizzes permanently removed', purged });
    } catch (error) {
      return fail(res, error, 'Error emptying deleted quizzes');
    }
  }

  /**
   * Permanently removes one deleted quiz. Guarded by the course that owns it,
   * with the draft marker off — the row is about to stop existing.
   */
  @del('/deleted/:id')
  @use(requireCourseEditor(fromQuizParam('id'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async purgeQuiz(req: Request, res: Response) {
    try {
      await QuizService.purgeQuiz(param(req, 'id'));
      return res.send({ message: 'Quiz permanently deleted' });
    } catch (error) {
      return fail(res, error, 'Error permanently deleting quiz');
    }
  }

  /** One quiz for a learner: authenticated, scoped to what they can reach. */
  @get('/:id')
  @use(authenticateAndAttachUser)
  async getQuiz(req: AuthenticatedRequest, res: Response) {
    const quiz = await QuizService.getQuizForLearner(req.user!.email, param(req as Request, 'id'));

    if (!quiz) {
      return res.status(404).send({ errorMessage: 'Quiz not found' });
    }

    return res.send({ quiz });
  }

  /**
   * A quiz inside a section is guarded by that section's course, exactly as
   * before. A standalone quiz — an exam or a one-time link — resolves to no
   * course, which `requireCourseEditor` lets only a global author past; a
   * per-course contributor has no course to be a contributor on.
   */
  @post('/')
  @use(requireCourseEditor(fromSectionInBody))
  @use(authenticateAndAttachUser)
  async createQuiz(req: Request, res: Response) {
    try {
      const quiz = await QuizService.createQuiz(
        req.body as {
          title?: string;
          description?: string | null;
          type?: string | null;
          sectionId?: string | null;
        },
      );
      // Stamped here rather than by the middleware: a new row has no id until
      // it exists, and the route names the section it went into.
      await EditAttributionService.stamp(
        'QUIZ',
        quiz.id,
        (req as AuthenticatedRequest).user?.id ?? null,
      );
      return res.send({ message: 'Quiz created successfully', quiz });
    } catch (error) {
      return fail(res, error, 'Error creating quiz');
    }
  }

  @put('/:id')
  @use(requireCourseEditor(fromQuizParam('id'), { attributes: { kind: 'QUIZ' } }))
  @use(authenticateAndAttachUser)
  async updateQuiz(req: Request, res: Response) {
    try {
      const quiz = await QuizService.updateQuiz(param(req, 'id'), req.body);
      return res.send({ message: 'Quiz updated successfully', quiz });
    } catch (error) {
      return fail(res, error, 'Error updating quiz');
    }
  }

  /** Soft delete — the quiz moves to the recycle bin and can be restored. */
  @del('/:id')
  @use(requireCourseEditor(fromQuizParam('id')))
  @use(authenticateAndAttachUser)
  async deleteQuiz(req: Request, res: Response) {
    try {
      await QuizService.deleteQuiz(param(req, 'id'));
      return res.send({ message: 'Quiz moved to the recycle bin' });
    } catch (error) {
      return fail(res, error, 'Error deleting quiz');
    }
  }

  @post('/:id/restore')
  @use(requireCourseEditor(fromQuizParam('id')))
  @use(authenticateAndAttachUser)
  async restoreQuiz(req: Request, res: Response) {
    try {
      await QuizService.restoreQuiz(param(req, 'id'));
      return res.send({ message: 'Quiz restored' });
    } catch (error) {
      return fail(res, error, 'Error restoring quiz');
    }
  }

  /**
   * Reports the run already open, and starts nothing.
   *
   * The player asks this before it shows a quiz, so it can put the details and a
   * Start button in front of an unopened one and go straight into a run already
   * ticking. Reading it must never be what starts the clock, which is why this
   * is a separate GET rather than a flag on the POST below.
   */
  @get('/:id/session')
  @use(authenticateAndAttachUser)
  async peekSession(req: AuthenticatedRequest, res: Response) {
    try {
      await QuizService.assertCanRun(req.user!, param(req as Request, 'id'), isGlobalAuthor(req));
      const session = await QuizService.peekSession(req.user!.id, param(req as Request, 'id'));
      return res.send(session);
    } catch (error) {
      return fail(res, error, 'Error reading quiz session');
    }
  }

  /**
   * Starts the clock, or reports the clock already running. Safe to call on every
   * page load: an open run is handed back untouched rather than restarted.
   */
  @post('/:id/start')
  @use(authenticateAndAttachUser)
  async startSession(req: AuthenticatedRequest, res: Response) {
    try {
      await QuizService.assertCanRun(req.user!, param(req as Request, 'id'), isGlobalAuthor(req));
      const session = await QuizService.startSession(req.user!.id, param(req as Request, 'id'));
      return res.send(session);
    } catch (error) {
      return fail(res, error, 'Error starting quiz');
    }
  }

  /** Grades server-side and records the attempt so the quiz stops being outstanding. */
  @post('/:id/attempt')
  @use(rateLimit({ max: 30, windowMs: 60_000, subject: 'user', scope: 'quiz-attempt' }))
  @use(authenticateAndAttachUser)
  async submitAttempt(req: AuthenticatedRequest, res: Response) {
    try {
      const { answers } = req.body as { answers?: Record<string, string | string[]> };
      await QuizService.assertCanRun(req.user!, param(req as Request, 'id'), isGlobalAuthor(req));
      const result = await QuizService.submitAttempt(
        req.user!.id,
        param(req as Request, 'id'),
        answers ?? {},
      );
      return res.send({ message: 'Attempt recorded', ...result });
    } catch (error) {
      return fail(res, error, 'Error recording attempt');
    }
  }

  @post('/:quizId/questions')
  @use(requireCourseEditor(fromQuizParam('quizId')))
  @use(authenticateAndAttachUser)
  async addQuestion(req: Request, res: Response) {
    const { afterOrder } = req.body as { afterOrder?: number };

    try {
      const question = await QuizService.addQuestion(
        param(req, 'quizId'),
        req.body as QuestionInput,
        afterOrder,
      );
      await EditAttributionService.stamp(
        'QUESTION',
        question.id,
        (req as AuthenticatedRequest).user?.id ?? null,
      );
      return res.send({ message: 'Question added successfully', question });
    } catch (error) {
      return fail(res, error, 'Error adding question');
    }
  }

  /**
   * Reorders a quiz's questions. Body: { questionIds: [...] } in the new order.
   *
   * Attributed to the quiz rather than to any one question: moving question
   * three above question one changes the quiz, and marking a single question as
   * edited would put the tag on whichever one happened to be dragged.
   */
  @put('/:quizId/question-order')
  @use(
    requireCourseEditor(fromQuizParam('quizId'), { attributes: { kind: 'QUIZ', param: 'quizId' } }),
  )
  @use(authenticateAndAttachUser)
  async reorderQuestions(req: Request, res: Response) {
    try {
      const { questionIds } = req.body as { questionIds?: unknown };
      if (!Array.isArray(questionIds) || questionIds.some((id) => typeof id !== 'string')) {
        return res.status(400).send({ errorMessage: 'questionIds must be a list of question ids' });
      }

      const quiz = await QuizService.reorderQuestions(param(req, 'quizId'), questionIds);
      return res.send({ message: 'Questions reordered', quiz });
    } catch (error) {
      return fail(res, error, 'Error reordering questions');
    }
  }

  @put('/questions/:id')
  @use(requireCourseEditor(fromQuestionParam('id'), { attributes: { kind: 'QUESTION' } }))
  @use(authenticateAndAttachUser)
  async updateQuestion(req: Request, res: Response) {
    try {
      const question = await QuizService.updateQuestion(param(req, 'id'), req.body);
      return res.send({ message: 'Question updated successfully', question });
    } catch (error) {
      return fail(res, error, 'Error updating question');
    }
  }

  @del('/questions/:id')
  @use(requireCourseEditor(fromQuestionParam('id')))
  @use(authenticateAndAttachUser)
  async deleteQuestion(req: Request, res: Response) {
    try {
      await QuizService.deleteQuestion(param(req, 'id'));
      return res.send({ message: 'Question deleted successfully' });
    } catch (error) {
      return fail(res, error, 'Error deleting question');
    }
  }
}
