/**
 * File: course-map-controller.ts
 * Description: HTTP routes for a course's directed-learning map.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
import { Request, Response } from 'express';

import {
  authenticateAndAttachUser,
  AuthenticatedRequest,
} from '@/controllers/auth-controller/auth-middleware';
import {
  type CourseReach,
  courseReach,
} from '@/controllers/auth-controller/authorization-middleware';
import {
  fromCourseParam,
  fromNodeParam,
  requireCourseEditor,
} from '@/controllers/auth-controller/course-access-middleware';
import { controller, del, get, post, put, use } from '@/controllers/decorators';
import { fail } from '@/controllers/http-errors';
import CourseMapService from '@/services/course-map-service/course-map-service';

/**
 * The mapping tab's endpoints.
 *
 * Kept apart from the curriculum controller, which is already long and is about
 * a different thing: that one is the course as an author writes it, this one is
 * the course as a learner will be led through it.
 *
 * Every route is gated by `requireCourseEditor`, the same rule that guards
 * editing the course itself — a map decides what a learner is served, so drawing
 * one is an edit to the course by any reading.
 */

function param(req: Request, name: string): string {
  return String(req.params[name]);
}

function isGlobalAuthor(req: AuthenticatedRequest): CourseReach {
  return courseReach(req.auth!.roles);
}

@controller('/course-map')
export default class CourseMapController {
  /** The whole map: nodes, connections, the staging pool and what blocks a publish. */
  @get('/:courseId')
  @use(requireCourseEditor(fromCourseParam('courseId'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async getMap(req: AuthenticatedRequest, res: Response) {
    try {
      return res.send(await CourseMapService.getMap(param(req as Request, 'courseId')));
    } catch (error) {
      return fail(res, error, 'Error loading course map');
    }
  }

  /** Turns directed learning on or off for this course. */
  @put('/:courseId/directed')
  @use(requireCourseEditor(fromCourseParam('courseId')))
  @use(authenticateAndAttachUser)
  async setDirected(req: AuthenticatedRequest, res: Response) {
    try {
      const map = await CourseMapService.setDirected(
        param(req as Request, 'courseId'),
        req.body?.directedLearning === true,
      );
      return res.send({
        map,
        message: map.directedLearning
          ? 'Directed learning is on — map this course before publishing it'
          : 'Directed learning is off — this course reads straight through again',
      });
    } catch (error) {
      return fail(res, error, 'Error changing directed learning');
    }
  }

  /**
   * Stage: the soft publish between writing content and mapping it. Nothing here
   * reaches a learner.
   */
  @post('/:courseId/stage')
  @use(requireCourseEditor(fromCourseParam('courseId')))
  @use(authenticateAndAttachUser)
  async stage(req: AuthenticatedRequest, res: Response) {
    try {
      const map = await CourseMapService.stage(param(req as Request, 'courseId'));
      return res.send({ map, message: 'Staged — your content is ready to map' });
    } catch (error) {
      return fail(res, error, 'Error staging this course');
    }
  }

  /**
   * The course as this map would deliver it, for a given set of answers.
   *
   * What the authoring preview reads, so that previewing a mapped course walks
   * the branches rather than reading every section in the editor's order. The
   * answers are in the request rather than in the database: an author trying
   * their own course must not end up with a learning path recorded against them.
   *
   * A POST because it carries a body, not because it changes anything. Nothing
   * here is written.
   */
  @post('/:courseId/preview')
  @use(requireCourseEditor(fromCourseParam('courseId'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async preview(req: AuthenticatedRequest, res: Response) {
    try {
      const raw = (req.body?.choices ?? {}) as Record<string, unknown>;
      const byDepth = new Map<number, string[]>();
      for (const [depth, nodeIds] of Object.entries(raw)) {
        if (!Array.isArray(nodeIds)) continue;
        byDepth.set(Number(depth), nodeIds.map(String));
      }

      return res.send(
        await CourseMapService.previewFor(param(req as Request, 'courseId'), byDepth),
      );
    } catch (error) {
      return fail(res, error, 'Error previewing this map');
    }
  }

  // ---- Nodes ----

  @post('/:courseId/nodes')
  @use(requireCourseEditor(fromCourseParam('courseId')))
  @use(authenticateAndAttachUser)
  async createNode(req: AuthenticatedRequest, res: Response) {
    try {
      const node = await CourseMapService.createNode(param(req as Request, 'courseId'), req.body);
      return res.status(201).send({ node });
    } catch (error) {
      return fail(res, error, 'Error adding that node');
    }
  }

  /**
   * Every node's position at once — what the toolbar's Align layers button sends.
   *
   * A whole-map statement rather than a run of moves, because that is what it
   * is: see `CourseMapService.setLayout` for why sending it one node at a time
   * would rebuild the layer quizzes off a half-moved map.
   */
  @put('/:courseId/layout')
  @use(requireCourseEditor(fromCourseParam('courseId'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async setLayout(req: AuthenticatedRequest, res: Response) {
    try {
      const raw = Array.isArray(req.body?.positions) ? req.body.positions : [];
      const positions = raw
        .filter(
          (at: unknown): at is { id: unknown; x: unknown; y: unknown } =>
            at !== null && typeof at === 'object',
        )
        .map((at: { id: unknown; x: unknown; y: unknown }) => ({
          id: String(at.id),
          x: Number(at.x),
          y: Number(at.y),
        }))
        .filter((at: { x: number; y: number }) => Number.isFinite(at.x) && Number.isFinite(at.y));

      const map = await CourseMapService.setLayout(param(req as Request, 'courseId'), positions);
      return res.send({ map });
    } catch (error) {
      return fail(res, error, 'Error tidying the map');
    }
  }

  /**
   * Renames a node, or moves it on the canvas.
   *
   * `marksDraftEdited` is off because the two are not the same kind of change
   * and this one route carries both. A rename rewrites the option a layer quiz
   * offers and is plainly an edit; dragging a box is usually tidying and changes
   * nothing a learner will ever see. The service can tell which it was — see
   * `CourseMapService.updateNode` — and marks the draft through `syncQuizzes`
   * only when something actually moved in the course rather than on the screen.
   */
  @put('/nodes/:id')
  @use(requireCourseEditor(fromNodeParam('id'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async updateNode(req: AuthenticatedRequest, res: Response) {
    try {
      const node = await CourseMapService.updateNode(param(req as Request, 'id'), req.body);
      return res.send({ node });
    } catch (error) {
      return fail(res, error, 'Error updating that node');
    }
  }

  @del('/nodes/:id')
  @use(requireCourseEditor(fromNodeParam('id')))
  @use(authenticateAndAttachUser)
  async deleteNode(req: AuthenticatedRequest, res: Response) {
    try {
      await CourseMapService.deleteNode(param(req as Request, 'id'));
      return res.send({ message: 'Node removed — its content is back in staging' });
    } catch (error) {
      return fail(res, error, 'Error removing that node');
    }
  }

  /** The content list of one node, in its new order. */
  @put('/nodes/:id/items')
  @use(requireCourseEditor(fromNodeParam('id')))
  @use(authenticateAndAttachUser)
  async setItems(req: AuthenticatedRequest, res: Response) {
    try {
      const sectionIds = Array.isArray(req.body?.sectionIds) ? req.body.sectionIds : [];
      const map = await CourseMapService.setNodeItems(param(req as Request, 'id'), sectionIds);
      return res.send({ map });
    } catch (error) {
      return fail(res, error, 'Error moving that content');
    }
  }

  // ---- Connections ----

  @post('/nodes/:id/children')
  @use(requireCourseEditor(fromNodeParam('id')))
  @use(authenticateAndAttachUser)
  async connect(req: AuthenticatedRequest, res: Response) {
    try {
      const map = await CourseMapService.connect(
        param(req as Request, 'id'),
        String(req.body?.childId ?? ''),
      );
      return res.send({ map });
    } catch (error) {
      return fail(res, error, 'Error connecting those nodes');
    }
  }

  @del('/nodes/:id/children/:childId')
  @use(requireCourseEditor(fromNodeParam('id')))
  @use(authenticateAndAttachUser)
  async disconnect(req: AuthenticatedRequest, res: Response) {
    try {
      const map = await CourseMapService.disconnect(
        param(req as Request, 'id'),
        param(req as Request, 'childId'),
      );
      return res.send({ map });
    } catch (error) {
      return fail(res, error, 'Error disconnecting those nodes');
    }
  }

  // ---- Imported courses ----

  /** Courses this person may add to staging, minus what is already there. */
  @get('/:courseId/available')
  @use(requireCourseEditor(fromCourseParam('courseId'), { marksDraftEdited: false }))
  @use(authenticateAndAttachUser)
  async available(req: AuthenticatedRequest, res: Response) {
    try {
      const courses = await CourseMapService.availableCourses(
        param(req as Request, 'courseId'),
        req.user!.id,
        isGlobalAuthor(req),
      );
      return res.send({ courses });
    } catch (error) {
      return fail(res, error, 'Error loading courses');
    }
  }

  @post('/:courseId/imports')
  @use(requireCourseEditor(fromCourseParam('courseId')))
  @use(authenticateAndAttachUser)
  async addImport(req: AuthenticatedRequest, res: Response) {
    try {
      const map = await CourseMapService.addImport(
        param(req as Request, 'courseId'),
        String(req.body?.sourceCourseId ?? ''),
        req.user!.id,
        isGlobalAuthor(req),
      );
      return res.send({ map, message: 'Added to staging' });
    } catch (error) {
      return fail(res, error, 'Error adding that course to staging');
    }
  }

  @del('/:courseId/imports/:sourceCourseId')
  @use(requireCourseEditor(fromCourseParam('courseId')))
  @use(authenticateAndAttachUser)
  async removeImport(req: AuthenticatedRequest, res: Response) {
    try {
      const map = await CourseMapService.removeImport(
        param(req as Request, 'courseId'),
        param(req as Request, 'sourceCourseId'),
      );
      return res.send({ map, message: 'Removed from staging' });
    } catch (error) {
      return fail(res, error, 'Error removing that course from staging');
    }
  }
}
