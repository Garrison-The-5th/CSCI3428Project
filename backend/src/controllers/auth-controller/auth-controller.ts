/**
 * File: auth-controller.ts
 * Description: Auth controller for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
import { Request, Response } from 'express';

import { authenticateAndAttachUser } from '@/controllers/auth-controller/auth-middleware';
import { requireAuthor, requireRole } from '@/controllers/auth-controller/authorization-middleware';
import { controller, get, post, use } from '@/controllers/decorators';
import { rateLimit } from '@/controllers/middleware/rate-limit';
import AuthService from '@/services/auth-service/auth-service';
import EmailService from '@/services/email-service/email-service';

/** Generous enough for a person, tight enough to stop a script. */
const subscribeLimit = rateLimit({ max: 5, windowMs: 60_000 });

@controller('/auth')
export default class AuthController {
  // get all users including 'admin' and 'user' roles, each labelled author /
  // student / no account for the Users page badges
  @get('/all-users')
  @use(requireRole('admin'))
  @use(authenticateAndAttachUser)
  async getAllUsers(req: Request, res: Response) {
    const users = await AuthService.getAllWithRoles();
    return res.send({ users });
  }

  // get all users with 'user' role only
  @get('/users')
  @use(requireRole('admin'))
  @use(authenticateAndAttachUser)
  async getUsers(req: Request, res: Response) {
    const users = await AuthService.getUsers();
    return res.send({ users });
  }

  /**
   * Type-ahead for pickers that name a person — assigning contributors or
   * students. Author-level rather than admin, since authors do the naming.
   */
  @get('/search')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async searchUsers(req: Request, res: Response) {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const users = await AuthService.searchUsers(query);
    return res.send({ users });
  }

  /**
   * Public by design — anyone may put their address down. Rate limited because
   * of it: the handler upserts a User row, so an open endpoint that mints rows
   * from unauthenticated input is worth a ceiling.
   */
  @post('/subscribe')
  @use(subscribeLimit)
  async subscribeUser(req: Request, res: Response) {
    const { email, name } = req.body as { email?: string; name?: string | null };

    if (!email) {
      return res.status(400).send({ errorMessage: 'Email is required' });
    }

    const user = await AuthService.subscribeByEmail({
      email,
      name: name ?? null,
    });

    return res.send({
      message: 'Subscription updated successfully',
      user,
    });
  }

  @post('/send-email-to-subscribers')
  @use(requireRole('admin'))
  @use(authenticateAndAttachUser)
  async sendEmailToSubscribers(req: Request, res: Response) {
    const { subject, message } = req.body as { subject?: string; message?: string };

    if (!subject?.trim() || !message?.trim()) {
      return res.status(400).send({ errorMessage: 'Subject and message are required' });
    }

    const subscribers = await AuthService.getSubscribedUsers();

    if (subscribers.length === 0) {
      return res.status(400).send({ errorMessage: 'No subscribed users found' });
    }

    const result = await EmailService.sendBroadcastEmail({
      recipients: subscribers.map((user) => ({
        email: user.email,
        name: user.name,
      })),
      subject: subject.trim(),
      message: message.trim(),
    });

    return res.send({
      message: 'Email sent to subscribed users',
      result,
    });
  }
}
