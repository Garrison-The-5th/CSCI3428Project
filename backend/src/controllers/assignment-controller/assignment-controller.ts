/**
 * File: assignment-controller.ts
 * Description: Author-facing routes for assignment links and learner insights.
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
import { controller, del, get, post, put, use } from '@/controllers/decorators';
import { fail } from '@/controllers/http-errors';
import { rateLimit } from '@/controllers/middleware/rate-limit';
import AssignmentService from '@/services/assignment-service/assignment-service';
import InsightsService from '@/services/insights-service/insights-service';

// req.params values are typed `string | string[]` in Express 5.
function param(req: Request, name: string): string {
  return String(req.params[name]);
}

/** The signed-in author, in the shape the mail layer wants for a From address. */
function assignerFrom(req: AuthenticatedRequest) {
  const user = req.user;
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name ?? req.auth?.name ?? null };
}

/** Author-facing management of assignment links. */
@controller('/assignments')
export default class AssignmentController {
  /** Links for one course (?courseId=) or one quiz (?quizId=), with progress. */
  @get('/')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async list(req: Request, res: Response) {
    const courseId = typeof req.query.courseId === 'string' ? req.query.courseId : undefined;
    const quizId = typeof req.query.quizId === 'string' ? req.query.quizId : undefined;

    if (!courseId && !quizId) {
      return res.status(400).send({ errorMessage: 'courseId or quizId is required' });
    }

    const assignments = await AssignmentService.listWithProgress({ courseId, quizId });
    return res.send({ assignments });
  }

  /**
   * Every course that has been handed to someone, as summary cards. Separate from
   * `/` because the dashboard wants the shape of the whole programme, not one
   * course's roster.
   */
  @get('/courses')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async assignedCourses(req: Request, res: Response) {
    const courses = await AssignmentService.listAssignedCourses();
    return res.send({ courses });
  }

  /**
   * Learners and how far they have got, for the dashboard's Student insights.
   *
   * An admin sees everyone; anyone else sees only the people they assigned to.
   * Admins are deliberately unscoped — assignments made before the assigner was
   * recorded belong to nobody, and someone has to be able to see them.
   */
  @get('/insights')
  @use(rateLimit({ max: 60, windowMs: 60_000, subject: 'user', scope: 'insights' }))
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async insights(req: AuthenticatedRequest, res: Response) {
    const isAdmin = req.auth?.roles.includes('admin') === true;
    const learners = await InsightsService.listLearners(isAdmin ? null : (req.user?.id ?? null));
    return res.send({ learners, scope: isAdmin ? 'all' : 'mine' });
  }

  /** One learner's full picture, for the drill-down page. */
  @get('/insights/:email')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async learnerInsight(req: AuthenticatedRequest, res: Response) {
    const isAdmin = req.auth?.roles.includes('admin') === true;
    const learner = await InsightsService.getLearner(
      decodeURIComponent(param(req as Request, 'email')),
      isAdmin ? null : (req.user?.id ?? null),
    );

    if (!learner) {
      return res.status(404).send({ errorMessage: 'That learner holds nothing you assigned' });
    }

    return res.send({ learner });
  }

  @post('/')
  @use(rateLimit({ max: 60, windowMs: 60 * 60 * 1000, subject: 'user', scope: 'assign' }))
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async assign(req: AuthenticatedRequest, res: Response) {
    try {
      const { delivery, ...assignment } = await AssignmentService.assign(
        req.body,
        assignerFrom(req),
      );
      // The assignment is saved either way; the message says whether the person
      // has actually been told yet.
      return res.send({
        message: delivery.sent
          ? `Assigned — ${assignment.email} has been emailed`
          : `Assigned. ${delivery.reason}`,
        assignment,
        delivery,
      });
    } catch (error) {
      return fail(res, error, 'Error creating assignment');
    }
  }

  /** Moves one person's due date. Everyone else on the course keeps theirs. */
  @put('/:id')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async update(req: Request, res: Response) {
    try {
      const { dueDate } = req.body as { dueDate?: string | null };
      const assignment = await AssignmentService.setDueDate(param(req, 'id'), dueDate ?? null);
      return res.send({
        message: assignment.dueDate ? 'Due date updated' : 'Due date cleared',
        assignment,
      });
    } catch (error) {
      return fail(res, error, 'Error updating assignment');
    }
  }

  /** Turns a link off without losing the record or the progress behind it. */
  @post('/:id/revoke')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async revoke(req: Request, res: Response) {
    try {
      await AssignmentService.revoke(param(req, 'id'));
      return res.send({ message: 'Link turned off' });
    } catch (error) {
      return fail(res, error, 'Error revoking assignment');
    }
  }

  /**
   * Turns a link back on and tells the person it works again.
   *
   * The mail is rate limited, and a refusal is reported rather than thrown: the
   * switch has already flipped, and failing the request would leave the button
   * disagreeing with the database.
   */
  @post('/:id/restore')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async restore(req: AuthenticatedRequest, res: Response) {
    try {
      const id = param(req as Request, 'id');
      await AssignmentService.restore(id);
      const delivery = await AssignmentService.resend(id, assignerFrom(req));

      return res.send({
        message: delivery.sent
          ? 'Link turned back on and re-sent'
          : `Link turned back on. ${delivery.reason ?? 'No email was sent.'}`,
        delivery,
      });
    } catch (error) {
      return fail(res, error, 'Error restoring assignment');
    }
  }

  /** Sends the same message again, on demand. */
  @post('/:id/resend')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async resend(req: AuthenticatedRequest, res: Response) {
    try {
      const delivery = await AssignmentService.resend(
        param(req as Request, 'id'),
        assignerFrom(req),
      );
      return res.send({
        message: delivery.sent ? 'Email sent again' : (delivery.reason ?? 'Nothing was sent'),
        delivery,
      });
    } catch (error) {
      return fail(res, error, 'Error resending assignment email');
    }
  }

  @del('/:id')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async remove(req: Request, res: Response) {
    try {
      await AssignmentService.remove(param(req, 'id'));
      return res.send({ message: 'Assignment deleted and their progress cleared' });
    } catch (error) {
      return fail(res, error, 'Error deleting assignment');
    }
  }
}
