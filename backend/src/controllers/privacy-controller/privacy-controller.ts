/**
 * File: privacy-controller.ts
 * Description: Self-service export and erasure of the caller's own personal data.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { Response } from 'express';

import {
  authenticateAndAttachUser,
  AuthenticatedRequest,
} from '@/controllers/auth-controller/auth-middleware';
import { controller, del, get, use } from '@/controllers/decorators';
import { fail } from '@/controllers/http-errors';
import { rateLimit } from '@/controllers/middleware/rate-limit';
import PrivacyService from '@/services/privacy-service/privacy-service';

/**
 * Everything here acts on the caller and nobody else.
 *
 * There is deliberately no `:userId` parameter. A subject-access route that
 * takes an id is one authorisation slip away from being a bulk personal-data
 * exfiltration endpoint, which is the exact risk §3.5.3 warns about ("focus on
 * preventing bulk extraction"). The identity comes from the verified token, so
 * there is nothing to tamper with.
 */
@controller('/me')
export default class PrivacyController {
  /**
   * Downloads everything held about the caller, as a JSON attachment.
   *
   * Rate limited hard: an export is an expensive fan-out across every progress
   * table, and nobody legitimately needs more than a handful a day.
   */
  @get('/data')
  @use(rateLimit({ max: 5, windowMs: 60 * 60 * 1000, subject: 'user', scope: 'privacy-export' }))
  @use(authenticateAndAttachUser)
  async exportData(req: AuthenticatedRequest, res: Response) {
    try {
      const data = await PrivacyService.exportUser(req.user!.id);

      // A fixed filename and an attachment disposition (§3.10.4, §3.8.3):
      // never a name derived from user input, which is how reflective file
      // download bugs happen.
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="my-learning-data.json"');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(JSON.stringify(data, null, 2));
    } catch (error) {
      return fail(res, error, 'Could not export your data');
    }
  }

  /**
   * Erases the caller's personal data.
   *
   * Anonymises rather than deletes — the training record survives without the
   * person attached, because a compliance obligation may rest on it. The
   * response says so plainly rather than claiming a clean delete.
   */
  @del('/data')
  @use(
    rateLimit({ max: 3, windowMs: 24 * 60 * 60 * 1000, subject: 'user', scope: 'privacy-erase' }),
  )
  @use(authenticateAndAttachUser)
  async eraseData(req: AuthenticatedRequest, res: Response) {
    try {
      const result = await PrivacyService.eraseUser(req.user!.id);
      return res.send({
        message:
          'Your personal details and notes have been erased. Records that training was ' +
          'completed are kept without your name attached, because the organisation may be ' +
          'required to evidence them.',
        ...result,
      });
    } catch (error) {
      return fail(res, error, 'Could not erase your data');
    }
  }
}
