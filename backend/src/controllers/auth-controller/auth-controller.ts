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
   *
   * `accounts=1` narrows it to people who can actually sign in. The on-platform
   * picker asks for that: a User row exists for anybody who has ever been
   * assigned anything, so an unfiltered search happily offers addresses that
   * have no login behind them, and enrolling one sends that person to a door
   * they cannot open.
   */
  @get('/search')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async searchUsers(req: Request, res: Response) {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const accountsOnly = req.query.accounts === '1' || req.query.accounts === 'true';
    const users = await AuthService.searchUsers(query, { accountsOnly });
    return res.send({ users });
  }

  /**
   * Whether one exact address already has an account.
   *
   * What the link-only picker checks before it hands out a private URL. Somebody
   * who can sign in should get the work on their Learning page, where it is
   * theirs and revocable, rather than a link that is a credential in its own
   * right — so the column refuses the address and says why.
   */
  @get('/has-account')
  @use(requireAuthor())
  @use(authenticateAndAttachUser)
  async hasAccount(req: Request, res: Response) {
    const email = typeof req.query.email === 'string' ? req.query.email : '';
    if (!email.trim()) return res.status(400).send({ errorMessage: 'email is required' });
    return res.send({ hasAccount: await AuthService.hasAccount(email) });
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
      // The mailbox can be unconfigured or unreachable without that being this
      // request's fault, so the message reports what actually happened rather
      // than claiming a send that did not occur.
      message:
        result.reason ??
        `Email sent to ${result.sentCount} of ${result.recipientCount} subscribed users`,
      result,
    });
  }
}
