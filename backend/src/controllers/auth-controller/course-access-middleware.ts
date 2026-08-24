/**
 * File: course-access-middleware.ts
 * Description: Per-course edit rights, and the marker that flags a course as edited.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { NextFunction, Response } from 'express';

import { clientAddress } from '@/config/client-address';
import { logger, logSecurityEvent } from '@/config/logger';
import { AuthenticatedRequest } from '@/controllers/auth-controller/auth-middleware';
import { AUTHOR_ROLES } from '@/controllers/auth-controller/authorization-middleware';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import PublicationGateway from '@/gateways/publication-gateway/publication-gateway';

/**
 * Guards edits to a course's content.
 *
 * Two ways to pass: holding a global authoring role (admin / contributor in
 * Keycloak), or being named as a contributor on this particular course. Using
 * `requireAuthor` alone would let only the first group through, which is why a
 * per-course author was previously refused with a 403 before any query ran.
 *
 * Every mutation names something inside a course — a section, an element, a quiz —
 * so the caller supplies a resolver that maps the request back to a course id.
 */
export type CourseResolver = (req: AuthenticatedRequest) => Promise<string | null>;

/** Reads a route param, allowing for Express 5's `string | string[]`. */
const param = (req: AuthenticatedRequest, name: string) => String(req.params[name]);

export const fromCourseParam =
  (name = 'id'): CourseResolver =>
  async (req) =>
    param(req, name);

export const fromModuleParam =
  (name = 'id'): CourseResolver =>
  (req) =>
    CurriculumGateway.courseIdFromModule(param(req, name));

export const fromSectionParam =
  (name = 'id'): CourseResolver =>
  (req) =>
    CurriculumGateway.courseIdFromSection(param(req, name));

export const fromElementParam =
  (name = 'id'): CourseResolver =>
  (req) =>
    CurriculumGateway.courseIdFromElement(param(req, name));

export const fromQuizParam =
  (name = 'id'): CourseResolver =>
  (req) =>
    CurriculumGateway.courseIdFromQuiz(param(req, name));

export const fromQuestionParam =
  (name = 'id'): CourseResolver =>
  (req) =>
    CurriculumGateway.courseIdFromQuestion(param(req, name));

/**
 * A published version back to the course it belongs to.
 *
 * Restoring or deleting one changes what learners are served, so it is gated the
 * same way as editing the course itself rather than by the looser global-author
 * check that guards merely *reading* an archived version.
 */
export const fromVersionParam =
  (name = 'id'): CourseResolver =>
  async (req) => {
    const publication = await PublicationGateway.getById(param(req, name));
    return publication?.courseId ?? null;
  };

/** Resolves the course from `sectionId` in the body — used when creating a quiz. */
export const fromSectionInBody: CourseResolver = async (req) => {
  const { sectionId } = (req.body ?? {}) as { sectionId?: string };
  return sectionId ? CurriculumGateway.courseIdFromSection(sectionId) : null;
};

/**
 * Marks the course's draft as ahead of what learners are served, once the
 * request has actually succeeded.
 *
 * Hung off the response rather than called by each handler on purpose. Learners
 * read a published snapshot, so *every* edit — a renamed module as much as a
 * new section — has to register as an unpublished change, and a rule that has to
 * be remembered at thirty call sites is a rule that will be missed at one.
 *
 * Only non-GET requests that ended 2xx count, so a refused or failed edit does
 * not leave the editor claiming there is something to publish.
 */
function markDraftEditedOnSuccess(req: AuthenticatedRequest, res: Response, courseId: string) {
  if (req.method === 'GET' || req.method === 'HEAD') return;

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    void CurriculumGateway.touchDraft(courseId).catch((error) => {
      logger.error({ err: error }, `Could not mark course ${courseId} as edited`);
    });
  });
}

export interface CourseEditorOptions {
  /**
   * Whether a successful write should mark the course's draft as ahead of what
   * learners are served. On for every ordinary edit.
   *
   * Off for publishing, which is the one write whose purpose is to make the two
   * agree. Publishing aligns `draftUpdatedAt` with the version it has just
   * written; this marker then fired on the way out and pushed the draft back in
   * front of it, so a course reported unpublished changes from the moment it was
   * published — for ever, since every publish re-armed it and nothing else could
   * clear it.
   */
  marksDraftEdited?: boolean;
}

export function requireCourseEditor(
  resolve: CourseResolver,
  { marksDraftEdited = true }: CourseEditorOptions = {},
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth || !req.user) {
      return res.status(401).send({ errorMessage: 'Unauthorized Request' });
    }

    const isGlobalAuthor = AUTHOR_ROLES.some((role) => req.auth!.roles.includes(role));

    try {
      // Resolved even for a global author, who needs no permission check: the
      // course id is what the draft marker below is keyed on, and skipping the
      // lookup would mean edits by admins never registered as unpublished.
      const courseId = await resolve(req);

      if (!courseId) {
        // A global author editing something unresolvable is still allowed
        // through — the handler will produce the real 404 with a better message.
        if (isGlobalAuthor) return next();
        return res.status(404).send({ errorMessage: 'That content could not be found' });
      }

      req.courseId = courseId;

      if (!isGlobalAuthor && !(await CurriculumGateway.isContributor(req.user.id, courseId))) {
        logSecurityEvent('access.denied', {
          userId: req.user.id,
          email: req.auth.email,
          ip: clientAddress(req),
          method: req.method,
          path: req.path,
          resource: courseId,
          reason: 'not a global author and not a contributor on this course',
        });
        return res.status(403).send({ errorMessage: 'You do not have edit access to that course' });
      }

      // Successful decisions are recorded too (§3.4.2): an audit that only
      // holds refusals cannot answer "who changed this course".
      logSecurityEvent('access.granted', {
        userId: req.user.id,
        email: req.auth.email,
        ip: clientAddress(req),
        method: req.method,
        path: req.path,
        resource: courseId,
      });

      if (marksDraftEdited) markDraftEditedOnSuccess(req, res, courseId);
      return next();
    } catch (error) {
      logger.error({ err: error }, 'course access check failed');
      return res.status(500).send({ errorMessage: 'Could not check your access' });
    }
  };
}
