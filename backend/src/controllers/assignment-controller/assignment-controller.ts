/**
 * File: assignment-controller.ts
 * Description: Author-facing routes for assignment links and learner insights.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { Request, Response } from 'express';

import { originFromRequest } from '@/config/app-url';
import {
  authenticateAndAttachUser,
  AuthenticatedRequest,
} from '@/controllers/auth-controller/auth-middleware';
import { courseReach, requireAuthor } from '@/controllers/auth-controller/authorization-middleware';
import {
  fromAssignmentParam,
  fromCourseOrQuizBody,
  fromCourseOrQuizQuery,
  requireCourseEditor,
} from '@/controllers/auth-controller/course-access-middleware';
import { controller, del, get, post, put, use } from '@/controllers/decorators';
import { fail } from '@/controllers/http-errors';
import { rateLimit } from '@/controllers/middleware/rate-limit';
import AssignmentService from '@/services/assignment-service/assignment-service';
import InsightsService from '@/services/insights-service/insights-service';

// req.params values are typed `string | string[]` in Express 5.
function param(req: Request, name: string): string {
  return String(req.params[name]);
}

/** Who to record as having set the work, for `assignedById`. */
function assignerFrom(req: AuthenticatedRequest) {
  const user = req.user;
  if (!user) return null;
  return { id: user.id };
}

/** Author-facing management of assignment links. */
@controller('/assignments')
export default class AssignmentController {
  /**
   * Links for one course (?courseId=) or one quiz (?quizId=), with progress.
   *
   * Guarded by the course itself: a roster is the list of people reading that
   * course, which belongs to whoever owns it and not to every admin.
   */
  @get('/')
  @use(requireCourseEditor(fromCourseOrQuizQuery))
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
  async assignedCourses(req: AuthenticatedRequest, res: Response) {
    const global = courseReach(req.auth!.roles);
    const courses = await AssignmentService.listAssignedCourses(req.user!.id, global);
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

  /**
   * Hands a course or quiz to somebody by email.
   *
   * Gated on the course being assigned rather than on the authoring role alone:
   * sending out somebody else's lesson under your own name is a use of their
   * content. `marksDraftEdited` is off — assigning changes nothing an author
   * wrote, so it must not make the course claim it has unpublished changes.
   */
  @post('/')
  @use(rateLimit({ max: 60, windowMs: 60 * 60 * 1000, subject: 'user', scope: 'assign' }))
  @use(requireCourseEditor(fromCourseOrQuizBody, { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async assign(req: AuthenticatedRequest, res: Response) {
    try {
      const { delivery, ...assignment } = await AssignmentService.assign(
        req.body,
        assignerFrom(req),
        // Built from this request, so the link goes to whatever address the app
        // is being used on rather than to whatever a config file last said.
        originFromRequest(req as Request),
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
  @use(requireCourseEditor(fromAssignmentParam('id'), { marksDraftEdited: false }))
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
  @use(requireCourseEditor(fromAssignmentParam('id'), { marksDraftEdited: false }))
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
  @use(requireCourseEditor(fromAssignmentParam('id'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async restore(req: AuthenticatedRequest, res: Response) {
    try {
      const id = param(req as Request, 'id');
      await AssignmentService.restore(id);
      const delivery = await AssignmentService.resend(id, originFromRequest(req as Request));

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
  /**
   * Issues a fresh link for a guest and returns its token, for the roster's
   * Copy link button. Links are stored only as hashes, so the old one cannot be
   * shown again; it stops working the moment this one is made.
   */
  @post('/:id/link')
  @use(requireCourseEditor(fromAssignmentParam('id'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async issueLink(req: AuthenticatedRequest, res: Response) {
    try {
      const token = await AssignmentService.issueNewLink(param(req as Request, 'id'));
      return res.send({ message: 'New link issued', token });
    } catch (error) {
      return fail(res, error, 'Error issuing a new link');
    }
  }

  /** Mails the assignment again. Not a content edit, so it does not mark the draft as changed. */
  @post('/:id/resend')
  @use(requireCourseEditor(fromAssignmentParam('id'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async resend(req: AuthenticatedRequest, res: Response) {
    try {
      const delivery = await AssignmentService.resend(
        param(req as Request, 'id'),
        originFromRequest(req as Request),
      );
      return res.send({
        message: delivery.sent ? 'Email sent again' : (delivery.reason ?? 'Nothing was sent'),
        delivery,
      });
    } catch (error) {
      return fail(res, error, 'Error resending assignment email');
    }
  }

  /** Deletes an assignment and clears the person's progress in what it gave them. */
  @del('/:id')
  @use(requireCourseEditor(fromAssignmentParam('id'), { marksDraftEdited: false }))
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
