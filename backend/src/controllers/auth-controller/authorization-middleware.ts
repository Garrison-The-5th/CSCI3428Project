/**
 * File: authorization-middleware.ts
 * Description: Role gates for routes, recording every access-control decision.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
import { NextFunction, Response } from 'express';

import { clientAddress } from '@/config/client-address';
import { logSecurityEvent } from '@/config/logger';
import { AuthenticatedRequest } from '@/controllers/auth-controller/auth-middleware';
import type { CourseReach } from '@/gateways/curriculum-gateway/curriculum-gateway';

export type { CourseReach };

/** Passes when the caller holds this one Keycloak role. */
export function requireRole(requiredRole: string) {
  return requireAnyRole([requiredRole]);
}

/** Passes when the caller holds at least one of the given Keycloak roles. */
export function requireAnyRole(allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      logSecurityEvent('access.denied', {
        ip: clientAddress(req),
        method: req.method,
        path: req.path,
        reason: 'no authenticated session',
      });
      return res.status(401).send({ errorMessage: 'Unauthorized Request' });
    }

    if (!allowedRoles.some((role) => req.auth!.roles.includes(role))) {
      // §3.4.2 requires failed access-control decisions to be logged with the
      // metadata needed to investigate. Recording what was required and what
      // the caller actually held is what makes a "why can't I?" ticket
      // answerable without reproducing it.
      logSecurityEvent('access.role-denied', {
        userId: req.user?.id,
        email: req.auth.email,
        ip: clientAddress(req),
        method: req.method,
        path: req.path,
        reason:
          `requires one of [${allowedRoles.join(', ')}], ` + `holds [${req.auth.roles.join(', ')}]`,
      });
      return res.status(403).send({ errorMessage: 'Forbidden' });
    }

    next();
  };
}

/**
 * Anyone who may author learning content. Contributors have the same rights as
 * admins over courses, sections and quizzes (but not over users).
 */
export const AUTHOR_ROLES = ['admin', 'contributor'];

/**
 * Guards a route on holding a *global* authoring role.
 *
 * Right for things that are not about one course — creating a course, emptying
 * the recycle bin, listing every draft. Anything that names a particular course
 * wants `requireCourseEditor` instead, which also admits somebody named as a
 * contributor on that one course but holding no global role.
 */
export const requireAuthor = () => requireAnyRole(AUTHOR_ROLES);

/**
 * How far past their own courses somebody reaches: every course for an admin,
 * the unowned ones too for an author. See `CourseReach`.
 */
export function courseReach(roles: string[]): CourseReach {
  if (roles.includes('admin')) return 'all';
  return AUTHOR_ROLES.some((role) => roles.includes(role));
}
