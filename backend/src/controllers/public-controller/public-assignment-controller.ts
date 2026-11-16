/**
 * File: public-assignment-controller.ts
 * Description: Token-authenticated routes for guests on an assignment link.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { Request, Response } from 'express';

import { logger, safeForLog } from '@/config/logger';
import { controller, del, get, post, put, use } from '@/controllers/decorators';
import { rateLimit } from '@/controllers/middleware/rate-limit';
import AssignmentService, {
  AssignmentError,
} from '@/services/assignment-service/assignment-service';

/**
 * Public, token-authenticated routes for assigned learning.
 *
 * The token stands in for a login: it resolves to the email it was issued to, and
 * everything here is scoped to what that email has been assigned. Deliberately
 * separate from the signed-in controllers, so there is no code path from a guest
 * token to an author endpoint.
 */

// req.params values are typed `string | string[]` in Express 5.
function param(req: Request, name: string): string {
  return String(req.params[name]);
}

/** Turns a token failure into the right status and a message worth showing. */
function sendFailure(res: Response, error: unknown) {
  if (error instanceof AssignmentError) {
    const messages: Record<string, string> = {
      'not-found': 'This link is not valid.',
      revoked: 'This link has been turned off by the person who sent it.',
      expired: 'This link has expired.',
      unavailable: 'This training is not available right now.',
      'sign-in': 'This training is on your account — sign in to reach it.',
      idle:
        'This link has not been used for a long time and has been closed. ' +
        'Ask whoever sent it to send it again.',
      completed:
        'You have completed this quiz and seen your result, so this link is no longer enabled. ' +
        'Ask whoever sent it if you need to see it again.',
    };
    // 404 for every case so a probe cannot tell a real token from a fake one.
    return res.status(404).send({ errorMessage: messages[error.reason], reason: error.reason });
  }

  const message = error instanceof Error ? error.message : 'Something went wrong';
  logger.warn({ reason: safeForLog(message, 200) }, 'public assignment request failed');
  return res.status(400).send({ errorMessage: message });
}

const readLimit = rateLimit({ max: 120, windowMs: 60_000 });
const writeLimit = rateLimit({ max: 60, windowMs: 60_000 });

@controller('/public/assignments')
export default class PublicAssignmentController {
  /** Who this link belongs to — used to greet the guest and prove the link works. */
  @get('/:token/session')
  @use(readLimit)
  async getSession(req: Request, res: Response) {
    try {
      const user = await AssignmentService.getSessionUser(param(req, 'token'));
      return res.send({ user });
    } catch (error) {
      return sendFailure(res, error);
    }
  }

  /** Every course assigned to this email. */
  @get('/:token/courses')
  @use(readLimit)
  async getCourses(req: Request, res: Response) {
    try {
      const courses = await AssignmentService.getSessionCourses(param(req, 'token'));
      return res.send({ courses });
    } catch (error) {
      return sendFailure(res, error);
    }
  }

  /** Every quiz assigned to this email, directly or through a course. */
  @get('/:token/quizzes')
  @use(readLimit)
  async getQuizzes(req: Request, res: Response) {
    try {
      const quizzes = await AssignmentService.getSessionQuizzes(param(req, 'token'));
      return res.send({ quizzes });
    } catch (error) {
      return sendFailure(res, error);
    }
  }

  /** The same dashboard a signed-in learner gets, over assigned content only. */
  @get('/:token/dashboard')
  @use(readLimit)
  async getDashboard(req: Request, res: Response) {
    try {
      const dashboard = await AssignmentService.getSessionDashboard(param(req, 'token'));
      return res.send(dashboard);
    } catch (error) {
      return sendFailure(res, error);
    }
  }

  /** What the link's holder has viewed and attempted so far. */
  @get('/:token/progress')
  @use(readLimit)
  async getProgress(req: Request, res: Response) {
    try {
      const progress = await AssignmentService.getSessionProgress(param(req, 'token'));
      return res.send(progress);
    } catch (error) {
      return sendFailure(res, error);
    }
  }

  /**
   * Marks a section as viewed by the link's holder — which is also what unlocks
   * the next one on a sequential course.
   */
  @post('/:token/sections/:sectionId/view')
  @use(writeLimit)
  async recordView(req: Request, res: Response) {
    try {
      await AssignmentService.recordView(param(req, 'token'), param(req, 'sectionId'));
      return res.send({ message: 'Progress recorded' });
    } catch (error) {
      return sendFailure(res, error);
    }
  }

  /**
   * Reports the run already open on an assigned quiz, and starts nothing — what
   * lets the player show its details behind a Start button, and skip that screen
   * for a link holder coming back to a clock already ticking.
   */
  @get('/:token/quizzes/:quizId/session')
  @use(readLimit)
  async peekQuiz(req: Request, res: Response) {
    try {
      const session = await AssignmentService.peekQuiz(param(req, 'token'), param(req, 'quizId'));
      return res.send(session);
    } catch (error) {
      return sendFailure(res, error);
    }
  }

  /** Starts the clock on an assigned quiz, or reports the one already running. */
  @post('/:token/quizzes/:quizId/start')
  @use(writeLimit)
  async startQuiz(req: Request, res: Response) {
    try {
      const session = await AssignmentService.startQuiz(param(req, 'token'), param(req, 'quizId'));
      return res.send(session);
    } catch (error) {
      return sendFailure(res, error);
    }
  }

  /** Grades and records a quiz handed in through the link. */
  @post('/:token/quizzes/:quizId/attempt')
  @use(writeLimit)
  async submitAttempt(req: Request, res: Response) {
    try {
      const { answers } = req.body as { answers?: Record<string, string | string[]> };
      const result = await AssignmentService.submitAttempt(
        param(req, 'token'),
        param(req, 'quizId'),
        answers ?? {},
      );
      return res.send({ message: 'Attempt recorded', ...result });
    } catch (error) {
      return sendFailure(res, error);
    }
  }

  /** What arrived in this course since the link holder last worked on it. */
  @get('/:token/courses/:courseId/new')
  @use(readLimit)
  async getNewIds(req: Request, res: Response) {
    try {
      const newIds = await AssignmentService.getSessionNewIds(
        param(req, 'token'),
        param(req, 'courseId'),
      );
      return res.send({ newIds });
    } catch (error) {
      return sendFailure(res, error);
    }
  }

  /** The link holder's notes on a course. */
  @get('/:token/courses/:courseId/notes')
  @use(readLimit)
  async getNotes(req: Request, res: Response) {
    try {
      const notes = await AssignmentService.getNotes(param(req, 'token'), param(req, 'courseId'));
      return res.send({ notes });
    } catch (error) {
      return sendFailure(res, error);
    }
  }

  /** Saves a note for the link's holder. */
  @post('/:token/courses/:courseId/notes')
  @use(writeLimit)
  async createNote(req: Request, res: Response) {
    try {
      const { body, sectionId } = req.body as { body?: string; sectionId?: string | null };
      const note = await AssignmentService.createNote(
        param(req, 'token'),
        param(req, 'courseId'),
        body ?? '',
        sectionId,
      );
      return res.send({ message: 'Note saved', note });
    } catch (error) {
      return sendFailure(res, error);
    }
  }

  /** Rewrites one of the link holder's notes. */
  @put('/:token/notes/:noteId')
  @use(writeLimit)
  async updateNote(req: Request, res: Response) {
    try {
      const { body } = req.body as { body?: string };
      await AssignmentService.updateNote(param(req, 'token'), param(req, 'noteId'), body ?? '');
      return res.send({ message: 'Note updated' });
    } catch (error) {
      return sendFailure(res, error);
    }
  }

  /** Deletes one of the link holder's notes. */
  @del('/:token/notes/:noteId')
  @use(writeLimit)
  async deleteNote(req: Request, res: Response) {
    try {
      await AssignmentService.deleteNote(param(req, 'token'), param(req, 'noteId'));
      return res.send({ message: 'Note deleted' });
    } catch (error) {
      return sendFailure(res, error);
    }
  }
}
