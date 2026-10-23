/**
 * File: auth-controller.ts
 * Description: Auth controller for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
import { Request, Response } from 'express';

import {
  authenticateAndAttachUser,
  AuthenticatedRequest,
} from '@/controllers/auth-controller/auth-middleware';
import { requireAuthor, requireRole } from '@/controllers/auth-controller/authorization-middleware';
import { controller, del, get, post, put, use } from '@/controllers/decorators';
import { fail } from '@/controllers/http-errors';
import { rateLimit } from '@/controllers/middleware/rate-limit';
import AdminAccessService, {
  ManagedRole,
} from '@/services/admin-access-service/admin-access-service';
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
    // Whether the page may offer the role switches, or only show roles.
    return res.send({ users, canManageAdmins: AdminAccessService.canManage() });
  }

  /**
   * Grants or removes admin access. Changes the role in Keycloak, so it is in
   * the person's next token and in the realm's own list of admins.
   * Body: { admin: boolean }.
   */
  @put('/users/:id/admin')
  @use(requireRole('admin'))
  @use(authenticateAndAttachUser)
  async setAdmin(req: AuthenticatedRequest, res: Response) {
    return AuthController.changeRole(req, res, 'admin');
  }

  /**
   * Grants or removes author access — creating courses and quizzes, and
   * everything else except the Users page. Body: { author: boolean }.
   */
  @put('/users/:id/author')
  @use(requireRole('admin'))
  @use(authenticateAndAttachUser)
  async setAuthor(req: AuthenticatedRequest, res: Response) {
    return AuthController.changeRole(req, res, 'author');
  }

  /**
   * Deletes somebody's account — their Keycloak login, and every record of
   * them here: progress, quiz results, notes, completions and assignments.
   * Content they wrote stays, uncredited. Cannot be undone.
   */
  @del('/users/:id')
  @use(requireRole('admin'))
  @use(authenticateAndAttachUser)
  async deleteUser(req: AuthenticatedRequest, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).send({ errorMessage: 'A valid user id is required' });
    }
    try {
      const result = await AdminAccessService.deleteUser(req.user!, id);
      return res.send({
        message: result.rolesRemoved
          ? 'Data deleted and their access to this app removed'
          : 'Data deleted. Their roles in this app could not be checked from here, so remove ' +
            "any admin or author role on the app's Keycloak client.",
        ...result,
      });
    } catch (error) {
      return fail(res, error, 'Error deleting user');
    }
  }

  private static async changeRole(req: AuthenticatedRequest, res: Response, role: ManagedRole) {
    const id = Number(req.params.id);
    const enabled = (req.body as Record<string, unknown>)[role];
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).send({ errorMessage: 'A valid user id is required' });
    }
    if (typeof enabled !== 'boolean') {
      return res.status(400).send({ errorMessage: `${role} must be true or false` });
    }
    const label = role === 'admin' ? 'Admin' : 'Author';
    try {
      const user = await AdminAccessService.setRole(req.user!, id, role, enabled);
      return res.send({
        message: enabled ? `${label} access granted` : `${label} access removed`,
        user,
      });
    } catch (error) {
      return fail(res, error, `Error changing ${role} access`);
    }
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

  /** Admin only: mails a subject and message to everyone on the newsletter list. */
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
