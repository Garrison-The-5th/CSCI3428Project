/**
 * File: tour-controller.ts
 * Description: The signed-in user's place in the first-login walkthrough.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */
import { Response } from 'express';

import {
  authenticateAndAttachUser,
  AuthenticatedRequest,
} from '@/controllers/auth-controller/auth-middleware';
import { controller, get, put, use } from '@/controllers/decorators';
import { fail } from '@/controllers/http-errors';
import { rateLimit } from '@/controllers/middleware/rate-limit';
import TourService from '@/services/tour-service/tour-service';

/**
 * Acts on the caller only, like the rest of `/me`: the identity comes from the
 * verified token and there is no id to put in the path.
 *
 * Guests have no route here. Their tour state lives in their browser, because a
 * link acts as whoever owns the address and must not be able to rewrite an
 * account holder's progress through the tour.
 */
@controller('/me/tour')
export default class TourController {
  /** Where the caller is in the walkthrough, and the course it leads into. */
  @get('/')
  @use(authenticateAndAttachUser)
  async getTour(req: AuthenticatedRequest, res: Response) {
    try {
      return res.send(await TourService.get(req.user!.id));
    } catch (error) {
      return fail(res, error, 'Could not load the tour');
    }
  }

  /**
   * Records where the caller is. Body `{ status, step }`.
   *
   * Written once per step, so a person working through the tour makes sixteen
   * of these and a person replaying it a few more. The limit is far above that
   * and far below a script.
   */
  @put('/')
  @use(rateLimit({ max: 120, windowMs: 60 * 60 * 1000, subject: 'user', scope: 'tour' }))
  @use(authenticateAndAttachUser)
  async saveTour(req: AuthenticatedRequest, res: Response) {
    try {
      return res.send(await TourService.save(req.user!.id, req.body));
    } catch (error) {
      return fail(res, error, 'Could not save your place in the tour');
    }
  }
}
