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
import { requireAuthor } from '@/controllers/auth-controller/authorization-middleware';
import {
  fromModuleInBody,
  fromQuestionParam,
  fromQuizParam,
  requireCourseEditor,
} from '@/controllers/auth-controller/course-access-middleware';
import { controller, del, get, post, put, use } from '@/controllers/decorators';
import { fail } from '@/controllers/http-errors';
import { rateLimit } from '@/controllers/middleware/rate-limit';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import QuizService, { QuestionInput } from '@/services/quiz-service/quiz-service';

// req.params values are typed `string | string[]` in Express 5, so normalize before use.
function param(req: Request, name: string): string {
  return String(req.params[name]);
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

  /** Author view: drafts included, answers intact so they can be edited. */
  @get('/manage')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async getQuizzesForAuthor(req: Request, res: Response) {
    const quizzes = await QuizService.getAllQuizzes();
    return res.send({ quizzes });
  }

  @get('/deleted')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async getDeletedQuizzes(req: Request, res: Response) {
    const quizzes = await QuizGateway.getDeletedQuizzes();
    return res.send({ quizzes });
  }

  /** Restores every deleted quiz in one go. */
  @post('/deleted/restore-all')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async restoreAllQuizzes(req: Request, res: Response) {
    try {
      const restored = await QuizService.restoreAllQuizzes();
      return res.send({ message: 'Quizzes restored', restored });
    } catch (error) {
      return fail(res, error, 'Error restoring quizzes');
    }
  }

  /** Permanently removes every deleted quiz. */
  @del('/deleted')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async purgeAllQuizzes(req: Request, res: Response) {
    try {
      const purged = await QuizService.purgeAllQuizzes();
      return res.send({ message: 'Deleted quizzes permanently removed', purged });
    } catch (error) {
      return fail(res, error, 'Error emptying deleted quizzes');
    }
  }

  /** Permanently removes one deleted quiz. */
  @del('/deleted/:id')
  @use(requireAuthor())
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

  @post('/')
  @use(requireCourseEditor(fromModuleInBody))
  @use(authenticateAndAttachUser)
  async createQuiz(req: Request, res: Response) {
    try {
      const quiz = await QuizService.createQuiz(
        req.body as { title?: string; description?: string | null; moduleId?: string | null },
      );
      return res.send({ message: 'Quiz created successfully', quiz });
    } catch (error) {
      return fail(res, error, 'Error creating quiz');
    }
  }

  @put('/:id')
  @use(requireCourseEditor(fromQuizParam('id')))
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
  @use(requireAuthor())
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
   * Starts the clock, or reports the clock already running. Safe to call on every
   * page load: an open run is handed back untouched rather than restarted.
   */
  @post('/:id/start')
  @use(authenticateAndAttachUser)
  async startSession(req: AuthenticatedRequest, res: Response) {
    try {
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
      const { answers } = req.body as { answers?: Record<string, string> };
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
      return res.send({ message: 'Question added successfully', question });
    } catch (error) {
      return fail(res, error, 'Error adding question');
    }
  }

  @put('/questions/:id')
  @use(requireCourseEditor(fromQuestionParam('id')))
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
