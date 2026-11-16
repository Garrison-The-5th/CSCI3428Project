/**
 * File: curriculum-controller.ts
 * Description: HTTP routes for courses, models, sections, notes and progress.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { Request, Response } from 'express';

import { originFromRequest } from '@/config/app-url';
import { mediaUpload } from '@/config/media-upload';
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
  fromCourseParam,
  fromModelParam,
  fromSectionParam,
  fromVersionParam,
  requireCourseEditor,
} from '@/controllers/auth-controller/course-access-middleware';
import { controller, del, get, post, put, use } from '@/controllers/decorators';
import { fail } from '@/controllers/http-errors';
import { enforceUploadQuota } from '@/controllers/middleware/rate-limit';
import CurriculumService from '@/services/curriculum-service/curriculum-service';
import DashboardService from '@/services/dashboard-service/dashboard-service';
import DefaultTutorialService from '@/services/default-tutorial-service/default-tutorial-service';
import EditAttributionService from '@/services/edit-attribution-service/edit-attribution-service';
import EditLeaseService, {
  EDIT_LEASE_HEARTBEAT_MS,
} from '@/services/edit-lease-service/edit-lease-service';
import NotificationService from '@/services/notification-service/notification-service';
import PublicationService from '@/services/publication-service/publication-service';

import { EditScope } from '../../../generated/prisma';

// req.params values are typed `string | string[]` in Express 5, so normalize before use.
function param(req: Request, name: string): string {
  return String(req.params[name]);
}

/**
 * How far the caller reaches: every course for an admin; for an author, the
 * scoped listings widened by exactly the courses that belong to nobody — see
 * `CurriculumGateway.accessibleCourses`.
 */
/** Only the two scopes exist; anything else is a bad request, not a new kind. */
function parseEditScope(value: unknown): EditScope {
  if (value === EditScope.MODEL || value === EditScope.QUESTION) return value;
  throw new Error('scope must be MODEL or QUESTION');
}

/** How far this person's author role reaches — see `CourseReach`. */
function isGlobalAuthor(req: AuthenticatedRequest): CourseReach {
  return courseReach(req.auth!.roles);
}

@controller('/curriculum')
export default class CurriculumController {
  /**
   * Learner view: the published courses assigned to this person. Learning is
   * assigned rather than browsed, so this needs to know who is asking.
   */
  @get('/courses')
  @use(authenticateAndAttachUser)
  async getCourses(req: AuthenticatedRequest, res: Response) {
    const courses = await CurriculumService.getCoursesForLearner(req.user!.email);
    return res.send({ courses });
  }

  /**
   * Courses this person may edit: the ones they created, plus the ones they were
   * named on. Powers the Course Editor page.
   *
   * An admin gets the whole catalogue. The author role alone does not — it
   * adds only the courses left unowned by the ownership backfill.
   */
  @get('/courses/editable')
  @use(authenticateAndAttachUser)
  async getEditableCourses(req: AuthenticatedRequest, res: Response) {
    const global = isGlobalAuthor(req);
    const courses = await CurriculumService.getEditableCourses(req.user!.id, global);
    // A plain boolean on the wire: the page asks `=== true`, and an admin's
    // reach is `'all'`.
    return res.send({ courses, isGlobalAuthor: Boolean(global) });
  }

  /** The people named as editors on a course. Only someone who may edit it can see the list. */
  @get('/courses/:id/contributors')
  @use(authenticateAndAttachUser)
  async getContributors(req: AuthenticatedRequest, res: Response) {
    const courseId = param(req as Request, 'id');
    if (!(await CurriculumService.canEditCourse(req.user!.id, courseId, isGlobalAuthor(req)))) {
      return res.status(403).send({ errorMessage: 'You cannot edit that course' });
    }
    const contributors = await CurriculumService.getContributors(courseId);
    return res.send({ contributors });
  }

  /**
   * Naming the other authors on a course. Whoever may edit it may share it —
   * which for a course somebody created means its owner, and no other admin.
   *
   * Not a content edit, so it does not mark the draft as ahead of what learners
   * are served.
   */
  @put('/courses/:id/contributors')
  @use(requireCourseEditor(fromCourseParam('id'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async setContributors(req: Request, res: Response) {
    try {
      const { emails } = req.body as { emails?: string[] };
      const course = await CurriculumService.setContributors(param(req, 'id'), emails ?? []);
      return res.send({ message: 'Contributors updated', contributors: course.contributors });
    } catch (error) {
      return fail(res, error, 'Error updating contributors');
    }
  }

  /** Author view: drafts included, and only what this person owns or was named on. */
  @get('/courses/manage')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async getCoursesForAuthor(req: AuthenticatedRequest, res: Response) {
    const courses = await CurriculumService.getCoursesForAuthor(req.user!.id, isGlobalAuthor(req));
    return res.send({ courses });
  }

  /**
   * The recycle bin's courses, holding only what this person may edit.
   *
   * Courses only — quiz sets among them. A model or section deleted inside a
   * live course is in that course's Archive tab (`/courses/:courseId/deleted`),
   * and standalone quizzes come from `/quizzes/deleted`.
   *
   * Scoped by the same rule as the libraries a course was deleted from —
   * otherwise deleting one would put it back in front of every other admin.
   */
  @get('/deleted')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async getDeleted(req: AuthenticatedRequest, res: Response) {
    const deleted = await CurriculumService.getDeletedItems(req.user!.id, isGlobalAuthor(req));
    return res.send(deleted);
  }

  /** Restores this person's deleted courses in one go. Models and sections are not touched. */
  @post('/deleted/restore-all')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async restoreAll(req: AuthenticatedRequest, res: Response) {
    try {
      const restored = await CurriculumService.restoreAll(req.user!.id, isGlobalAuthor(req));
      return res.send({ message: 'Recycle bin restored', restored });
    } catch (error) {
      return fail(res, error, 'Error restoring items');
    }
  }

  /**
   * Empties this person's recycle bin of courses. Permanent. A model or section
   * deleted inside a live course is in that course's Archive and survives this.
   */
  @del('/deleted')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async purgeAll(req: AuthenticatedRequest, res: Response) {
    try {
      const purged = await CurriculumService.purgeAll(req.user!.id, isGlobalAuthor(req));
      return res.send({ message: 'Recycle bin emptied', purged });
    } catch (error) {
      return fail(res, error, 'Error emptying the recycle bin');
    }
  }

  /**
   * What one course's Archive tab lists as deleted: its models (each with the
   * sections that come back with it), its other sections, and its quizzes.
   *
   * Guarded like every other read of a course's draft, so the single access
   * rule decides it. Reading changes nothing, so the draft marker is off.
   */
  @get('/courses/:courseId/deleted')
  @use(requireCourseEditor(fromCourseParam('courseId'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async getDeletedStructure(req: Request, res: Response) {
    try {
      return res.send(await CurriculumService.getDeletedStructure(param(req, 'courseId')));
    } catch (error) {
      return fail(res, error, 'Error loading deleted items');
    }
  }

  // Purging is guarded per course like every other write, and with the draft
  // marker off: the row is about to stop existing, so there is no draft left to
  // mark as ahead of what learners are served.

  /** Permanently removes one deleted course. */
  @del('/deleted/courses/:id')
  @use(requireCourseEditor(fromCourseParam('id'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async purgeCourse(req: Request, res: Response) {
    try {
      await CurriculumService.purgeCourse(param(req, 'id'));
      return res.send({ message: 'Course permanently deleted' });
    } catch (error) {
      return fail(res, error, 'Error permanently deleting course');
    }
  }

  /** Permanently removes one deleted section. */
  @del('/deleted/sections/:id')
  @use(requireCourseEditor(fromSectionParam('id'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async purgeSection(req: Request, res: Response) {
    try {
      await CurriculumService.purgeSection(param(req, 'id'));
      return res.send({ message: 'Section permanently deleted' });
    } catch (error) {
      return fail(res, error, 'Error permanently deleting section');
    }
  }

  /**
   * One course for a learner. Authenticated and scoped to their enrolment like
   * the list is — a course they are not on is reported as not found rather than
   * refused, so this cannot be used to enumerate the catalogue.
   */
  @get('/courses/:id')
  @use(authenticateAndAttachUser)
  async getCourse(req: AuthenticatedRequest, res: Response) {
    const found = await CurriculumService.getCourseWithNewIdsForLearner(
      req.user!.email,
      param(req as Request, 'id'),
    );

    if (!found) {
      return res.status(404).send({ errorMessage: 'Course not found' });
    }

    // newIds rides along so the player can mark what arrived in this version
    // without a second round trip.
    return res.send({ course: found.course, newIds: found.newIds });
  }

  /** Creates a course from just a name; everything else is set by editing it. */
  @post('/courses')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async createCourse(req: AuthenticatedRequest, res: Response) {
    try {
      const { title } = req.body as { title?: string };
      // Stamped with its author here and nowhere else: this is the only route
      // that brings a lesson into existence, so it is the only place ownership
      // can be established.
      const course = await CurriculumService.createCourse(title, undefined, req.user!.id);
      return res.send({ message: 'Course created successfully', course });
    } catch (error) {
      return fail(res, error, 'Error creating course');
    }
  }

  /**
   * Creates a quiz set from just a name.
   *
   * Its own route rather than a `kind` on the one above, so that "make me a quiz
   * set" cannot be reached by putting an unexpected value in a body meant to
   * create a lesson — and so the two can diverge in what they accept later
   * without either growing a mode flag.
   */
  @post('/quiz-sets')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async createQuizSet(req: AuthenticatedRequest, res: Response) {
    try {
      const { title } = req.body as { title?: string };
      const course = await CurriculumService.createQuizSet(title, req.user!.id);
      return res.send({ message: 'Quiz set created successfully', course });
    } catch (error) {
      return fail(res, error, 'Error creating quiz set');
    }
  }

  /** Edits a course's settings and landing page. Cannot publish — that is the publish endpoint. */
  @put('/courses/:id')
  @use(requireCourseEditor(fromCourseParam('id')))
  @use(authenticateAndAttachUser)
  async updateCourse(req: Request, res: Response) {
    try {
      const course = await CurriculumService.updateCourse(param(req, 'id'), req.body);
      return res.send({ message: 'Course updated successfully', course });
    } catch (error) {
      return fail(res, error, 'Error updating course');
    }
  }

  /**
   * Puts the course live as a new version.
   *
   * The same action whether it is the first publish or the twentieth: it
   * snapshots the course as it currently stands and points learners at it. What
   * the editor calls "Publish updated course" is this.
   */
  // Publishing must not count as an edit of the draft: it is the write that makes
  // the draft and the published version agree, and marking it would push the
  // draft back in front of the version it had just written.
  @post('/courses/:id/publish')
  @use(requireCourseEditor(fromCourseParam('id'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async publishCourse(req: AuthenticatedRequest, res: Response) {
    try {
      const result = await PublicationService.publish(
        param(req as Request, 'id'),
        req.user?.id ?? null,
      );

      // New content is announced only once it can actually be reached, which is
      // now rather than when the author typed it.
      //
      // Never for the default tutorial. Everybody who has finished it is on it,
      // which is everybody, and an admin polishing the guide should not mail
      // the whole organisation. The New marks inside the course still appear.
      const courseId = param(req as Request, 'id');
      if (result.hasNewContent && !(await DefaultTutorialService.is(courseId))) {
        void NotificationService.announceNewContent(courseId, originFromRequest(req as Request));
      }

      return res.send({
        message:
          result.version === 1
            ? 'Published — learners can see it now'
            : `Version ${result.version} published`,
        ...result,
      });
    } catch (error) {
      return fail(res, error, 'Error publishing course');
    }
  }

  /**
   * Whether there is anything to publish, and what. Drives the editor's publish
   * button and the New tags it draws on unpublished content.
   */
  @get('/courses/:id/publication')
  @use(requireCourseEditor(fromCourseParam('id')))
  @use(authenticateAndAttachUser)
  async getPublicationState(req: Request, res: Response) {
    const courseId = param(req, 'id');
    const [hasUnpublishedChanges, unpublished, versions] = await Promise.all([
      PublicationService.hasUnpublishedChanges(courseId),
      PublicationService.getUnpublishedIds(courseId),
      PublicationService.listVersions(courseId),
    ]);

    return res.send({ hasUnpublishedChanges, unpublished, versions });
  }

  /**
   * One archived version's full tree, for the editor's read-only view.
   *
   * Gated per course rather than on the global authoring role: a version is the
   * course's own content, so reading one is reading the course.
   */
  @get('/versions/:id')
  @use(requireCourseEditor(fromVersionParam('id')))
  @use(authenticateAndAttachUser)
  async getVersion(req: Request, res: Response) {
    try {
      const version = await PublicationService.getVersion(param(req, 'id'));
      return res.send({ version });
    } catch (error) {
      return fail(res, error, 'Error loading that version');
    }
  }

  /**
   * Puts an archived version back in front of learners, as a new version.
   *
   * Gated per course rather than on the global authoring role: this changes what
   * every learner on the course is reading, so it belongs to whoever may edit
   * that course — the same rule as publishing it in the first place.
   */
  @post('/versions/:id/restore')
  @use(requireCourseEditor(fromVersionParam('id')))
  @use(authenticateAndAttachUser)
  async restoreVersion(req: AuthenticatedRequest, res: Response) {
    try {
      const result = await PublicationService.restoreVersion(
        param(req as Request, 'id'),
        req.user?.id ?? null,
      );

      return res.send({
        message: `Version ${result.restoredFrom} restored — published as version ${result.version}`,
        ...result,
      });
    } catch (error) {
      return fail(res, error, 'Error restoring that version');
    }
  }

  /**
   * One version read against the one learners are on now, for the version card.
   *
   * Separate from `getVersion` because it is a different question and a heavier
   * answer: this loads both trees and merges them, and the plain read is still
   * what the restore path wants.
   */
  @get('/versions/:id/diff')
  @use(requireCourseEditor(fromVersionParam('id')))
  @use(authenticateAndAttachUser)
  async getVersionDiff(req: Request, res: Response) {
    try {
      const diff = await PublicationService.getVersionDiff(param(req, 'id'));
      return res.send(diff);
    } catch (error) {
      return fail(res, error, 'Error comparing that version');
    }
  }

  /**
   * Keeps one version for good, or lets it go back to the ordinary history.
   *
   * Gated per course for the same reason restoring is: a version is the course's
   * own content, so deciding how long it is kept belongs to whoever may edit it.
   */
  @post('/versions/:id/archive')
  @use(requireCourseEditor(fromVersionParam('id')))
  @use(authenticateAndAttachUser)
  async setVersionArchived(req: AuthenticatedRequest, res: Response) {
    try {
      const archived = (req.body as { archived?: unknown })?.archived !== false;
      const result = await PublicationService.setVersionArchived(
        param(req as Request, 'id'),
        archived,
        req.user?.id ?? null,
      );

      return res.send({
        message: archived
          ? `Version ${result.version} will be kept permanently`
          : `Version ${result.version} moved back to version history`,
        ...result,
      });
    } catch (error) {
      return fail(res, error, 'Error updating that version');
    }
  }

  /** Permanently removes one archived version. The live one is refused. */
  @del('/versions/:id')
  @use(requireCourseEditor(fromVersionParam('id')))
  @use(authenticateAndAttachUser)
  async deleteVersion(req: Request, res: Response) {
    try {
      const result = await PublicationService.deleteVersion(param(req, 'id'));
      return res.send({ message: `Version ${result.version} deleted`, ...result });
    } catch (error) {
      return fail(res, error, 'Error deleting that version');
    }
  }

  /**
   * What has been changed since the last publish, and who changed it.
   *
   * Its own call rather than a field on the course, so the tree the editor draws
   * stays the tree that gets published — see EditAttributionService.marksForCourse.
   */
  @get('/courses/:id/edit-marks')
  @use(requireCourseEditor(fromCourseParam('id')))
  @use(authenticateAndAttachUser)
  async getEditMarks(req: AuthenticatedRequest, res: Response) {
    try {
      const marks = await EditAttributionService.marksForCourse(
        param(req as Request, 'id'),
        req.user?.id ?? null,
      );
      return res.send({ marks });
    } catch (error) {
      return fail(res, error, 'Error loading recent edits');
    }
  }

  /**
   * What is locked in this course right now, and by whom.
   *
   * Polled by every open editor. Deliberately cheap: one indexed read of a table
   * that holds a handful of rows per course, returning ids and first names and
   * nothing else. There is no socket layer here, and adding one to answer a
   * question this small would be a great deal of machinery for a list that
   * changes when somebody clicks into a model.
   */
  @get('/courses/:id/edit-leases')
  @use(requireCourseEditor(fromCourseParam('id')))
  @use(authenticateAndAttachUser)
  async listEditLeases(req: AuthenticatedRequest, res: Response) {
    try {
      const leases = await EditLeaseService.listForCourse(
        param(req as Request, 'id'),
        req.user!.id,
      );
      return res.send({ leases, heartbeatMs: EDIT_LEASE_HEARTBEAT_MS });
    } catch (error) {
      return fail(res, error, 'Error loading who is editing');
    }
  }

  /**
   * Takes or renews a claim on one model or question.
   *
   * The same call for both, so the editor has one thing to send on opening
   * something and every few seconds after — and so a claim that lapsed while a
   * tab was asleep is simply taken again rather than needing a separate path.
   */
  @post('/courses/:id/edit-leases')
  @use(requireCourseEditor(fromCourseParam('id')))
  @use(authenticateAndAttachUser)
  async claimEditLease(req: AuthenticatedRequest, res: Response) {
    try {
      const body = req.body as { scope?: unknown; targetId?: unknown };
      const scope = parseEditScope(body.scope);
      const targetId = String(body.targetId ?? '').trim();
      if (!targetId) throw new Error('targetId is required');

      const result = await EditLeaseService.claim(
        param(req as Request, 'id'),
        scope,
        targetId,
        req.user!.id,
      );

      return res.send({ ...result, heartbeatMs: EDIT_LEASE_HEARTBEAT_MS });
    } catch (error) {
      return fail(res, error, 'Error claiming that for editing');
    }
  }

  /**
   * Gives up a claim. With no `targetId`, gives up everything this person holds
   * in the course — what an editor sends on its way out.
   */
  @del('/courses/:id/edit-leases')
  @use(requireCourseEditor(fromCourseParam('id')))
  @use(authenticateAndAttachUser)
  async releaseEditLease(req: AuthenticatedRequest, res: Response) {
    try {
      const body = (req.body ?? {}) as { scope?: unknown; targetId?: unknown };
      const targetId = String(body.targetId ?? '').trim();
      const courseId = param(req as Request, 'id');

      const result = targetId
        ? await EditLeaseService.release(parseEditScope(body.scope), targetId, req.user!.id)
        : await EditLeaseService.releaseAll(courseId, req.user!.id);

      // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
      return res.send(result);
    } catch (error) {
      return fail(res, error, 'Error releasing that');
    }
  }

  /** Soft delete — the course moves to the recycle bin and can be restored. */
  @del('/courses/:id')
  @use(requireCourseEditor(fromCourseParam('id')))
  @use(authenticateAndAttachUser)
  async deleteCourse(req: Request, res: Response) {
    try {
      await CurriculumService.deleteCourse(param(req, 'id'));
      return res.send({ message: 'Course moved to the recycle bin' });
    } catch (error) {
      return fail(res, error, 'Error deleting course');
    }
  }

  /** Takes a course back out of the recycle bin. */
  @post('/courses/:id/restore')
  @use(requireCourseEditor(fromCourseParam('id')))
  @use(authenticateAndAttachUser)
  async restoreCourse(req: Request, res: Response) {
    try {
      await CurriculumService.restoreCourse(param(req, 'id'));
      return res.send({ message: 'Course restored' });
    } catch (error) {
      return fail(res, error, 'Error restoring course');
    }
  }

  /** Uploads the course cover photo shown on the Learning page. */
  @post('/courses/:id/image')
  @use(enforceUploadQuota)
  @use(mediaUpload.single('file'))
  @use(requireCourseEditor(fromCourseParam('id')))
  @use(authenticateAndAttachUser)
  async uploadCourseImage(req: Request, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).send({ errorMessage: 'No file uploaded' });
      }
      const course = await CurriculumService.setCourseImage(param(req, 'id'), req.file);
      return res.send({ message: 'Course photo updated', course });
    } catch (error) {
      return fail(res, error, 'Error uploading course photo');
    }
  }

  /** Removes the course cover photo. Lessons and quiz sets both use this. */
  @del('/courses/:id/image')
  @use(requireCourseEditor(fromCourseParam('id')))
  @use(authenticateAndAttachUser)
  async removeCourseImage(req: Request, res: Response) {
    try {
      const course = await CurriculumService.removeCourseImage(param(req, 'id'));
      return res.send({ message: 'Course photo removed', course });
    } catch (error) {
      return fail(res, error, 'Error removing course photo');
    }
  }

  // ---- Models ----

  /** A course's live models in order, for the editor. */
  @get('/courses/:courseId/models')
  @use(requireCourseEditor(fromCourseParam('courseId')))
  @use(authenticateAndAttachUser)
  async getModels(req: Request, res: Response) {
    const models = await CurriculumService.getModels(param(req, 'courseId'));
    return res.send({ models });
  }

  /** A model takes a title and the place in the course it should occupy. */
  @post('/courses/:courseId/models')
  @use(requireCourseEditor(fromCourseParam('courseId')))
  @use(authenticateAndAttachUser)
  async createModel(req: Request, res: Response) {
    try {
      const model = await CurriculumService.createModel(param(req, 'courseId'), req.body);
      await EditAttributionService.stamp(
        'MODEL',
        model?.id ?? '',
        (req as AuthenticatedRequest).user?.id ?? null,
      );
      return res.send({ message: 'Model created successfully', model });
    } catch (error) {
      return fail(res, error, 'Error creating model');
    }
  }

  /** Renames, recolours or moves a model; the grid renumbers around a move. */
  @put('/models/:id')
  @use(requireCourseEditor(fromModelParam('id'), { attributes: { kind: 'MODEL' } }))
  @use(authenticateAndAttachUser)
  async updateModel(req: Request, res: Response) {
    try {
      const model = await CurriculumService.updateModel(param(req, 'id'), req.body);
      return res.send({ message: 'Model updated successfully', model });
    } catch (error) {
      return fail(res, error, 'Error updating model');
    }
  }

  /** Soft delete — the model and its sections move to the course's Archive. */
  @del('/models/:id')
  @use(requireCourseEditor(fromModelParam('id'), { attributes: { kind: 'MODEL' } }))
  @use(authenticateAndAttachUser)
  async deleteModel(req: Request, res: Response) {
    try {
      await CurriculumService.deleteModel(param(req, 'id'));
      return res.send({ message: 'Model moved to the Archive' });
    } catch (error) {
      return fail(res, error, 'Error deleting model');
    }
  }

  /** Takes a model back out of the Archive, onto the end of its course, sections and all. */
  @post('/models/:id/restore')
  @use(requireCourseEditor(fromModelParam('id'), { attributes: { kind: 'MODEL' } }))
  @use(authenticateAndAttachUser)
  async restoreModel(req: Request, res: Response) {
    try {
      await CurriculumService.restoreModel(param(req, 'id'));
      return res.send({ message: 'Model restored' });
    } catch (error) {
      return fail(res, error, 'Error restoring model');
    }
  }

  /** Permanently removes one deleted model. */
  @del('/deleted/models/:id')
  @use(requireCourseEditor(fromModelParam('id'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async purgeModel(req: Request, res: Response) {
    try {
      await CurriculumService.purgeModel(param(req, 'id'));
      return res.send({ message: 'Model permanently deleted' });
    } catch (error) {
      return fail(res, error, 'Error permanently deleting model');
    }
  }

  // ---- Sections ----

  /**
   * Adds a section to a model and credits the author with it. `type` is
   * required: a section is one piece of content, chosen when it is made.
   */
  @post('/courses/:courseId/sections')
  @use(requireCourseEditor(fromCourseParam('courseId')))
  @use(authenticateAndAttachUser)
  async createSection(req: Request, res: Response) {
    const { type } = (req.body ?? {}) as { type?: string };
    if (!type) {
      return res.status(400).send({ errorMessage: 'type is required' });
    }

    try {
      const section = await CurriculumService.createSection(param(req, 'courseId'), req.body);
      await EditAttributionService.stamp(
        'SECTION',
        section?.id ?? '',
        (req as AuthenticatedRequest).user?.id ?? null,
      );
      return res.send({ message: 'Section created successfully', section });
    } catch (error) {
      return fail(res, error, 'Error creating section');
    }
  }

  /**
   * Applies a new grid for the whole course — used by drag-to-reorder.
   * Body: { models: [{ id, sectionIds: [...] }] }, outer index the model and
   * inner index the section. Numbers are derived, never sent.
   */
  @put('/courses/:courseId/structure')
  @use(requireCourseEditor(fromCourseParam('courseId')))
  @use(authenticateAndAttachUser)
  async reorderStructure(req: Request, res: Response) {
    try {
      const { models } = req.body as {
        models?: Array<{ id: string; sectionIds: string[] }>;
      };

      if (!Array.isArray(models)) {
        return res.status(400).send({ errorMessage: 'models array is required' });
      }

      const course = await CurriculumService.reorderStructure(param(req, 'courseId'), models);
      return res.send({ message: 'Course structure updated', course });
    } catch (error) {
      return fail(res, error, 'Error reordering the course');
    }
  }

  /**
   * Changes a section's title, time estimate, colour or content; also the
   * canvas auto-save. Moving it is done by reorder.
   */
  @put('/sections/:id')
  @use(requireCourseEditor(fromSectionParam('id'), { attributes: { kind: 'SECTION' } }))
  @use(authenticateAndAttachUser)
  async updateSection(req: Request, res: Response) {
    try {
      const section = await CurriculumService.updateSection(param(req, 'id'), req.body);
      return res.send({ message: 'Section updated successfully', section });
    } catch (error) {
      return fail(res, error, 'Error updating section');
    }
  }

  /** Soft delete — the section moves to the course's Archive and can be restored. */
  @del('/sections/:id')
  @use(requireCourseEditor(fromSectionParam('id'), { attributes: { kind: 'SECTION' } }))
  @use(authenticateAndAttachUser)
  async deleteSection(req: Request, res: Response) {
    try {
      await CurriculumService.deleteSection(param(req, 'id'));
      return res.send({ message: 'Section moved to the Archive' });
    } catch (error) {
      return fail(res, error, 'Error deleting section');
    }
  }

  /** Takes a section back out of the Archive, onto the end of its model. */
  @post('/sections/:id/restore')
  @use(requireCourseEditor(fromSectionParam('id'), { attributes: { kind: 'SECTION' } }))
  @use(authenticateAndAttachUser)
  async restoreSection(req: Request, res: Response) {
    try {
      await CurriculumService.restoreSection(param(req, 'id'));
      return res.send({ message: 'Section restored' });
    } catch (error) {
      return fail(res, error, 'Error restoring section');
    }
  }

  /** Uploads an image or PDF into an IMAGE or PDF section, replacing what it held. */
  @post('/sections/:id/file')
  @use(enforceUploadQuota)
  @use(mediaUpload.single('file'))
  @use(requireCourseEditor(fromSectionParam('id'), { attributes: { kind: 'SECTION' } }))
  @use(authenticateAndAttachUser)
  async uploadSectionFile(req: Request, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).send({ errorMessage: 'No file uploaded' });
      }
      const section = await CurriculumService.replaceUploadedFile(param(req, 'id'), req.file);
      return res.send({ message: 'File added', section });
    } catch (error) {
      return fail(res, error, 'Error uploading file');
    }
  }

  /**
   * Sections auto-complete on view, so opening one records progress. A
   * sequential course unlocks section by section, so this is also what opens
   * the next one.
   */
  @post('/sections/:id/view')
  @use(authenticateAndAttachUser)
  async recordSectionView(req: AuthenticatedRequest, res: Response) {
    try {
      await CurriculumService.recordSectionView(req.user!.id, param(req as Request, 'id'));
      return res.send({ message: 'Progress recorded' });
    } catch (error) {
      return fail(res, error, 'Error recording progress');
    }
  }

  /**
   * Uploads a picture onto a canvas. Placing it is the editor's job; this only
   * stores it, after the same checks a cover photo goes through.
   */
  @post('/sections/:id/canvas-images')
  @use(enforceUploadQuota)
  @use(mediaUpload.single('file'))
  @use(requireCourseEditor(fromSectionParam('id'), { attributes: { kind: 'SECTION' } }))
  @use(authenticateAndAttachUser)
  async uploadCanvasImage(req: Request, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).send({ errorMessage: 'No file uploaded' });
      }
      const image = await CurriculumService.addCanvasImage(param(req, 'id'), req.file);
      return res.send({ message: 'Picture added', image });
    } catch (error) {
      return fail(res, error, 'Error uploading picture');
    }
  }

  /**
   * The items new canvases in this canvas's course start with. Items only — the
   * pictures stay on the server until a canvas is made from them.
   */
  @get('/sections/:id/canvas-template')
  @use(requireCourseEditor(fromSectionParam('id')))
  @use(authenticateAndAttachUser)
  async getCanvasTemplate(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.courseId) return res.status(404).send({ errorMessage: 'Canvas not found' });
      return res.send(await CurriculumService.getCanvasTemplate(req.courseId));
    } catch (error) {
      return fail(res, error, 'Error loading the canvas defaults');
    }
  }

  /**
   * Adds one of this canvas's items to its course's defaults (`include: true`),
   * or takes it out. Defaults only shape canvases made later, which learners
   * never see until they are published, so this does not mark the draft edited.
   */
  @put('/sections/:id/canvas-template')
  @use(requireCourseEditor(fromSectionParam('id'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async setCanvasTemplateItem(req: AuthenticatedRequest, res: Response) {
    try {
      if (!req.courseId) return res.status(404).send({ errorMessage: 'Canvas not found' });
      const { item, include } = (req.body ?? {}) as { item?: unknown; include?: unknown };
      const template = await CurriculumService.setCanvasTemplateItem(
        param(req as Request, 'id'),
        req.courseId,
        item,
        include === true,
      );
      return res.send({ message: 'Canvas defaults updated', ...template });
    } catch (error) {
      return fail(res, error, 'Error updating the canvas defaults');
    }
  }

  /**
   * What this learner has already done. The player needs it to draw ticks and,
   * on a sequential course, to know which sections are unlocked.
   */
  @get('/progress')
  @use(authenticateAndAttachUser)
  async getProgress(req: AuthenticatedRequest, res: Response) {
    const progress = await CurriculumService.getLearnerProgress(req.user!.id);
    return res.send(progress);
  }

  /** Everything the home dashboard needs for the signed-in user. */
  @get('/dashboard')
  @use(authenticateAndAttachUser)
  async getDashboard(req: AuthenticatedRequest, res: Response) {
    const dashboard = await DashboardService.getDashboard(req.user!.id, req.user!.email);
    return res.send(dashboard);
  }

  // ---- Instructors ----

  /**
   * Authors only. The list carries bios and photos, which are staff details
   * rather than course content — a learner reads instructors off the course
   * they were given, not from a directory of everyone.
   */
  @get('/instructors')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async getInstructors(req: Request, res: Response) {
    const instructors = await CurriculumService.getInstructors();
    return res.send({ instructors });
  }

  /** Creates an instructor profile. Instructors are shared, so any author may. */
  @post('/instructors')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async createInstructor(req: Request, res: Response) {
    try {
      const instructor = await CurriculumService.createInstructor(req.body);
      return res.send({ message: 'Instructor created', instructor });
    } catch (error) {
      return fail(res, error, 'Error creating instructor');
    }
  }

  /** Edits an instructor profile. */
  @put('/instructors/:id')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async updateInstructor(req: Request, res: Response) {
    try {
      const instructor = await CurriculumService.updateInstructor(param(req, 'id'), req.body);
      return res.send({ message: 'Instructor updated', instructor });
    } catch (error) {
      return fail(res, error, 'Error updating instructor');
    }
  }

  /** Sets an instructor's photo from an uploaded image (counts toward the upload quota). */
  @post('/instructors/:id/photo')
  @use(enforceUploadQuota)
  @use(mediaUpload.single('file'))
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async uploadInstructorPhoto(req: Request, res: Response) {
    try {
      if (!req.file) return res.status(400).send({ errorMessage: 'No file uploaded' });
      const instructor = await CurriculumService.setInstructorPhoto(param(req, 'id'), req.file);
      return res.send({ message: 'Photo updated', instructor });
    } catch (error) {
      return fail(res, error, 'Error uploading instructor photo');
    }
  }

  /** Permanently deletes an instructor profile. */
  @del('/instructors/:id')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async deleteInstructor(req: Request, res: Response) {
    try {
      await CurriculumService.deleteInstructor(param(req, 'id'));
      return res.send({ message: 'Instructor deleted' });
    } catch (error) {
      return fail(res, error, 'Error deleting instructor');
    }
  }

  // ---- Learner notes ----

  /** The signed-in learner's own notes on a course. */
  @get('/courses/:courseId/notes')
  @use(authenticateAndAttachUser)
  async getNotes(req: AuthenticatedRequest, res: Response) {
    const notes = await CurriculumService.getNotes(req.user!.id, param(req as Request, 'courseId'));
    return res.send({ notes });
  }

  /** Saves a note for the signed-in learner. */
  @post('/courses/:courseId/notes')
  @use(authenticateAndAttachUser)
  async createNote(req: AuthenticatedRequest, res: Response) {
    try {
      const note = await CurriculumService.createNote(
        req.user!.id,
        param(req as Request, 'courseId'),
        req.body,
      );
      return res.send({ message: 'Note saved', note });
    } catch (error) {
      return fail(res, error, 'Error saving note');
    }
  }

  /** Rewrites one of the signed-in learner's own notes. */
  @put('/notes/:id')
  @use(authenticateAndAttachUser)
  async updateNote(req: AuthenticatedRequest, res: Response) {
    try {
      const { body } = req.body as { body?: string };
      await CurriculumService.updateNote(param(req as Request, 'id'), req.user!.id, body);
      return res.send({ message: 'Note updated' });
    } catch (error) {
      return fail(res, error, 'Error updating note');
    }
  }

  /** Deletes one of the signed-in learner's own notes. */
  @del('/notes/:id')
  @use(authenticateAndAttachUser)
  async deleteNote(req: AuthenticatedRequest, res: Response) {
    try {
      await CurriculumService.deleteNote(param(req as Request, 'id'), req.user!.id);
      return res.send({ message: 'Note deleted' });
    } catch (error) {
      return fail(res, error, 'Error deleting note');
    }
  }
}
