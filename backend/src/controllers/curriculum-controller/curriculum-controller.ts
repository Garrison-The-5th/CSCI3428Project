/**
 * File: curriculum-controller.ts
 * Description: HTTP routes for courses, modules, sections, elements, notes and progress.
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
  AUTHOR_ROLES,
  requireAuthor,
} from '@/controllers/auth-controller/authorization-middleware';
import {
  fromCourseParam,
  fromElementParam,
  fromModuleParam,
  fromSectionParam,
  fromVersionParam,
  requireCourseEditor,
} from '@/controllers/auth-controller/course-access-middleware';
import { controller, del, get, post, put, use } from '@/controllers/decorators';
import { fail } from '@/controllers/http-errors';
import { enforceUploadQuota } from '@/controllers/middleware/rate-limit';
import CurriculumService from '@/services/curriculum-service/curriculum-service';
import DashboardService from '@/services/dashboard-service/dashboard-service';
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
 * Whether the caller holds a global authoring role.
 *
 * It no longer means "may reach every course". It widens the scoped listings by
 * exactly the courses that belong to nobody — see
 * `CurriculumGateway.accessibleCourses`.
 */
/** Only the two scopes exist; anything else is a bad request, not a new kind. */
function parseEditScope(value: unknown): EditScope {
  if (value === EditScope.MODULE || value === EditScope.QUESTION) return value;
  throw new Error('scope must be MODULE or QUESTION');
}

function isGlobalAuthor(req: AuthenticatedRequest): boolean {
  return AUTHOR_ROLES.some((role) => req.auth!.roles.includes(role));
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
   * A global authoring role no longer widens this to the whole catalogue — it
   * adds only the courses left unowned by the ownership backfill.
   */
  @get('/courses/editable')
  @use(authenticateAndAttachUser)
  async getEditableCourses(req: AuthenticatedRequest, res: Response) {
    const global = isGlobalAuthor(req);
    const courses = await CurriculumService.getEditableCourses(req.user!.id, global);
    return res.send({ courses, isGlobalAuthor: global });
  }

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
   * The recycle bin, holding only what this person may edit.
   *
   * The bin is one list of everything deleted, so it is scoped by the same rule
   * as the libraries it was deleted from — otherwise deleting a course would put
   * it back in front of every other admin.
   */
  @get('/deleted')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async getDeleted(req: AuthenticatedRequest, res: Response) {
    const deleted = await CurriculumService.getDeletedItems(req.user!.id, isGlobalAuthor(req));
    return res.send(deleted);
  }

  /** Restores this person's deleted courses and sections in one go. */
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

  /** Empties this person's recycle bin. Permanent — nothing survives this. */
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
      if (result.hasNewContent) {
        void NotificationService.announceNewContent(
          param(req as Request, 'id'),
          originFromRequest(req as Request),
        );
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
   * changes when somebody clicks into a module.
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
   * Takes or renews a claim on one module or question.
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

  // ---- Modules ----

  @get('/courses/:courseId/modules')
  @use(requireCourseEditor(fromCourseParam('courseId')))
  @use(authenticateAndAttachUser)
  async getModules(req: Request, res: Response) {
    const modules = await CurriculumService.getModules(param(req, 'courseId'));
    return res.send({ modules });
  }

  /** A module takes a title and the place in the course it should occupy. */
  @post('/courses/:courseId/modules')
  @use(requireCourseEditor(fromCourseParam('courseId')))
  @use(authenticateAndAttachUser)
  async createModule(req: Request, res: Response) {
    try {
      const module = await CurriculumService.createModule(param(req, 'courseId'), req.body);
      await EditAttributionService.stamp(
        'MODULE',
        module?.id ?? '',
        (req as AuthenticatedRequest).user?.id ?? null,
      );
      return res.send({ message: 'Module created successfully', module });
    } catch (error) {
      return fail(res, error, 'Error creating module');
    }
  }

  @put('/modules/:id')
  @use(requireCourseEditor(fromModuleParam('id'), { attributes: { kind: 'MODULE' } }))
  @use(authenticateAndAttachUser)
  async updateModule(req: Request, res: Response) {
    try {
      const module = await CurriculumService.updateModule(param(req, 'id'), req.body);
      return res.send({ message: 'Module updated successfully', module });
    } catch (error) {
      return fail(res, error, 'Error updating module');
    }
  }

  /** Soft delete — the module and its sections move to the recycle bin. */
  @del('/modules/:id')
  @use(requireCourseEditor(fromModuleParam('id'), { attributes: { kind: 'MODULE' } }))
  @use(authenticateAndAttachUser)
  async deleteModule(req: Request, res: Response) {
    try {
      await CurriculumService.deleteModule(param(req, 'id'));
      return res.send({ message: 'Module moved to the recycle bin' });
    } catch (error) {
      return fail(res, error, 'Error deleting module');
    }
  }

  @post('/modules/:id/restore')
  @use(requireCourseEditor(fromModuleParam('id'), { attributes: { kind: 'MODULE' } }))
  @use(authenticateAndAttachUser)
  async restoreModule(req: Request, res: Response) {
    try {
      await CurriculumService.restoreModule(param(req, 'id'));
      return res.send({ message: 'Module restored' });
    } catch (error) {
      return fail(res, error, 'Error restoring module');
    }
  }

  /** Permanently removes one deleted module. */
  @del('/deleted/modules/:id')
  @use(requireCourseEditor(fromModuleParam('id'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async purgeModule(req: Request, res: Response) {
    try {
      await CurriculumService.purgeModule(param(req, 'id'));
      return res.send({ message: 'Module permanently deleted' });
    } catch (error) {
      return fail(res, error, 'Error permanently deleting module');
    }
  }

  // ---- Sections ----

  @post('/courses/:courseId/sections')
  @use(requireCourseEditor(fromCourseParam('courseId')))
  @use(authenticateAndAttachUser)
  async createSection(req: Request, res: Response) {
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
   * Body: { modules: [{ id, sectionIds: [...] }] }, outer index the module and
   * inner index the section. Numbers are derived, never sent.
   */
  @put('/courses/:courseId/structure')
  @use(requireCourseEditor(fromCourseParam('courseId')))
  @use(authenticateAndAttachUser)
  async reorderStructure(req: Request, res: Response) {
    try {
      const { modules } = req.body as {
        modules?: Array<{ id: string; sectionIds: string[] }>;
      };

      if (!Array.isArray(modules)) {
        return res.status(400).send({ errorMessage: 'modules array is required' });
      }

      const course = await CurriculumService.reorderStructure(param(req, 'courseId'), modules);
      return res.send({ message: 'Course structure updated', course });
    } catch (error) {
      return fail(res, error, 'Error reordering the course');
    }
  }

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

  /** Soft delete — the section moves to the recycle bin and can be restored. */
  @del('/sections/:id')
  @use(requireCourseEditor(fromSectionParam('id'), { attributes: { kind: 'SECTION' } }))
  @use(authenticateAndAttachUser)
  async deleteSection(req: Request, res: Response) {
    try {
      await CurriculumService.deleteSection(param(req, 'id'));
      return res.send({ message: 'Section moved to the recycle bin' });
    } catch (error) {
      return fail(res, error, 'Error deleting section');
    }
  }

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

  /** Uploads an image or PDF and stores it on the section as an element. */
  @post('/sections/:id/image')
  @use(enforceUploadQuota)
  @use(mediaUpload.single('file'))
  @use(requireCourseEditor(fromSectionParam('id'), { attributes: { kind: 'SECTION' } }))
  @use(authenticateAndAttachUser)
  async uploadSectionImage(req: Request, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).send({ errorMessage: 'No file uploaded' });
      }
      const element = await CurriculumService.addUploadedElement(param(req, 'id'), req.file);
      await EditAttributionService.stamp(
        'ELEMENT',
        element.id,
        (req as AuthenticatedRequest).user?.id ?? null,
      );
      return res.send({ message: 'File added', element });
    } catch (error) {
      return fail(res, error, 'Error uploading file');
    }
  }

  /** Sections auto-complete on view, so opening one records progress. */
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
   * Records one piece of content as seen. A sequential course unlocks item by
   * item, so this is what opens the next one.
   */
  @post('/elements/:id/view')
  @use(authenticateAndAttachUser)
  async recordElementView(req: AuthenticatedRequest, res: Response) {
    try {
      await CurriculumService.recordElementView(req.user!.id, param(req as Request, 'id'));
      return res.send({ message: 'Progress recorded' });
    } catch (error) {
      return fail(res, error, 'Error recording progress');
    }
  }

  /**
   * Reorders a section's content, where elements and quizzes are interleaved.
   * Body: { items: [{ kind: 'element' | 'quiz', id }] } in the new order.
   */
  @put('/sections/:id/content-order')
  @use(requireCourseEditor(fromSectionParam('id'), { attributes: { kind: 'SECTION' } }))
  @use(authenticateAndAttachUser)
  async reorderSectionContent(req: Request, res: Response) {
    try {
      const { items } = req.body as { items?: Array<{ kind: 'element' | 'quiz'; id: string }> };

      if (!Array.isArray(items)) {
        return res.status(400).send({ errorMessage: 'items array is required' });
      }

      const section = await CurriculumService.reorderSectionContent(param(req, 'id'), items);
      return res.send({ message: 'Content reordered', section });
    } catch (error) {
      return fail(res, error, 'Error reordering content');
    }
  }

  @post('/sections/:sectionId/elements')
  @use(requireCourseEditor(fromSectionParam('sectionId')))
  @use(authenticateAndAttachUser)
  async createElement(req: Request, res: Response) {
    const { type } = req.body as { type?: string };

    if (!type) {
      return res.status(400).send({ errorMessage: 'type is required' });
    }

    try {
      const element = await CurriculumService.createElement(param(req, 'sectionId'), req.body);
      // Stamped here rather than by the middleware: a new row has no id until it
      // exists, and the route names the section it went into, not the element.
      await EditAttributionService.stamp(
        'ELEMENT',
        element.id,
        (req as AuthenticatedRequest).user?.id ?? null,
      );
      return res.send({ message: 'Element created successfully', element });
    } catch (error) {
      return fail(res, error, 'Error creating element');
    }
  }

  @put('/elements/:id')
  @use(requireCourseEditor(fromElementParam('id'), { attributes: { kind: 'ELEMENT' } }))
  @use(authenticateAndAttachUser)
  async updateElement(req: Request, res: Response) {
    try {
      const element = await CurriculumService.updateElement(param(req, 'id'), req.body);
      return res.send({ message: 'Element updated successfully', element });
    } catch (error) {
      return fail(res, error, 'Error updating element');
    }
  }

  @del('/elements/:id')
  @use(requireCourseEditor(fromElementParam('id'), { attributes: { kind: 'ELEMENT' } }))
  @use(authenticateAndAttachUser)
  async deleteElement(req: Request, res: Response) {
    try {
      await CurriculumService.deleteElement(param(req, 'id'));
      return res.send({ message: 'Element deleted successfully' });
    } catch (error) {
      return fail(res, error, 'Error deleting element');
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

  @get('/courses/:courseId/notes')
  @use(authenticateAndAttachUser)
  async getNotes(req: AuthenticatedRequest, res: Response) {
    const notes = await CurriculumService.getNotes(req.user!.id, param(req as Request, 'courseId'));
    return res.send({ notes });
  }

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
