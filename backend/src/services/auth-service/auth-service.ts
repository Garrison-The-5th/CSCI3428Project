/**
 * File: auth-service.ts
 * Description: User lookup, creation and sign-in bookkeeping.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
// Service is useful for adding business logic/error handling
import { logger, logSecurityEvent, safeForLog } from '@/config/logger';
import AuthGateway from '@/gateways/auth-gateway/auth-gateway';
import AdminAccessService from '@/services/admin-access-service/admin-access-service';

import { User } from '../../../generated/prisma';

/** A sign-in that would land on somebody else's record. Answered with a 403. */
export class IdentityConflictError extends Error {}

/**
 * User records, and the newsletter subscription that sits on the same row.
 *
 * Identity itself is Keycloak's job — this never checks a password. A `User` row
 * is the application's local record of somebody: created on first sign-in, and
 * also created the moment an address is assigned work, which is why the row
 * existing proves nothing about whether they have an account. `lastSignInAt` is
 * the only reliable answer to that, and `markSignedIn` is what maintains it.
 */
export default class AuthService {
  /** Every user row, unfiltered. */
  static async getAll(): Promise<User[]> {
    try {
      return await AuthGateway.getAll();
    } catch (error) {
      logger.error({ err: error }, 'Error fetching all users');
      throw new Error('Failed to retrieve all users');
    }
  }

  /**
   * Everyone, labelled by what they are.
   *
   * Several states, and someone can be more than one of them:
   *   admin   — holds the admin role
   *   author  — holds the author role (or admin), so can create content
   *   course author — named on at least one course, so can edit that course
   *   student — has been assigned something
   *   no account — an address that has never been signed into
   *
   * "No account" means never signed in. Inferring it from a missing name was
   * wrong: a realm that sends no name claim left every genuine account looking
   * like a bare address.
   */
  static async getAllWithRoles() {
    const [users, assignedEmails, holders] = await Promise.all([
      AuthGateway.getAllWithRoles(),
      AuthGateway.getAssignedEmails(),
      AdminAccessService.roleHolders(),
    ]);

    return users.map((user) => {
      const email = user.email.toLowerCase();
      const hasAccount = user.lastSignInAt !== null;
      // Keycloak's answer when it gives one; the local copy only when it cannot.
      const isAdmin = holders ? holders.admins.has(email) : user.role === 'admin';
      const hasAuthorRole = holders ? holders.authors.has(email) : user.role === 'author';
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        subscribed: user.subscribed,
        hasAccount,
        isAdmin,
        /** Holds the author role itself — what the Author switch shows. */
        hasAuthorRole,
        /** Can create content: an author, or an admin, who can do everything. */
        isAuthor: hasAuthorRole || isAdmin,
        /** Named on at least one course, which lets them edit that course only. */
        isCourseAuthor: user._count.editableCourses > 0,
        isStudent: assignedEmails.has(email),
      };
    });
  }

  /** Users whose local role is plain `user` (no author or admin role). */
  static async getUsers(): Promise<User[]> {
    try {
      return await AuthGateway.getUsers();
    } catch (error) {
      logger.error({ err: error }, 'Error fetching users');
      throw new Error('Failed to retrieve users');
    }
  }

  /** How stale a sign-in stamp may get before it is worth another write. */
  private static readonly SIGN_IN_REFRESH_MS = 60 * 60 * 1000;

  /** Records that this person signed in, at most once an hour. */
  static async markSignedIn(user: User): Promise<void> {
    const fresh =
      user.lastSignInAt !== null &&
      Date.now() - user.lastSignInAt.getTime() < AuthService.SIGN_IN_REFRESH_MS;
    if (fresh) return;

    try {
      await AuthGateway.markSignedIn(user.id);
    } catch (error) {
      // Never fatal: this is bookkeeping hung off an authenticated request.
      logger.error({ err: error, email: user.email }, 'could not record sign-in');
    }
  }

  /** Looks a user up by email, case-insensitively. Throws on an address with no "@". */
  static async getUserByEmail(email: string): Promise<User | null> {
    try {
      if (!email || !email.includes('@')) {
        throw new Error('Invalid email format');
      }
      return await AuthGateway.getUserByEmail(email.toLowerCase());
    } catch (error) {
      logger.error({ err: error }, 'Error fetching user by email');
      throw error;
    }
  }

  /**
   * Creates a user row for an address, with no Keycloak account bound yet —
   * that happens on their first sign-in. Refuses an address already in use.
   */
  static async createUser(data: { email: string; name: string | undefined }): Promise<User> {
    try {
      if (!data.email || !data.email.includes('@')) {
        throw new Error('Valid email is required');
      }

      // Check if user already exists
      const existingUser = await AuthGateway.getUserByEmail(data.email);
      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      return await AuthGateway.createUser({
        email: data.email.toLowerCase(),
        name: data.name?.trim() || null,
      });
    } catch (error) {
      logger.error({ err: error }, 'Error creating user');
      throw error;
    }
  }

  /** Renames a user; a blank name is refused. */
  static async updateUser(id: number, data: { name: string | undefined }): Promise<User> {
    try {
      if (!data.name?.trim()) {
        throw new Error('Name cannot be empty');
      }

      return await AuthGateway.updateUser(id, {
        name: data.name.trim(),
      });
    } catch (error) {
      logger.error({ err: error }, 'Error updating user');
      throw error;
    }
  }

  /**
   * Newsletter sign-up. Creates the user row if the address is new, otherwise
   * just turns the subscription on (and fills in the name if one was given).
   */
  static async subscribeByEmail(data: { email: string; name?: string | null }): Promise<User> {
    try {
      if (!data.email || !data.email.includes('@')) {
        throw new Error('Valid email is required');
      }

      return await AuthGateway.subscribeUser({
        email: data.email.toLowerCase(),
        name: data.name?.trim() || null,
      });
    } catch (error) {
      logger.error({ err: error }, 'Error subscribing user');
      throw error;
    }
  }

  /** Everyone on the newsletter list, by email. */
  static async getSubscribedUsers(): Promise<User[]> {
    try {
      return await AuthGateway.getSubscribedUsers();
    } catch (error) {
      logger.error({ err: error }, 'Error fetching subscribed users');
      throw new Error('Failed to retrieve subscribed users');
    }
  }

  /**
   * Type-ahead over existing users by email or name. `accountsOnly` limits it to
   * people who have actually signed in.
   */
  static searchUsers(query: string, options?: { accountsOnly?: boolean }) {
    return AuthGateway.searchUsers(query, options);
  }

  /** Whether this exact address belongs to somebody who has signed in. */
  static hasAccount(email: string) {
    return AuthGateway.hasAccount(email);
  }

  /**
   * The User a signed-in Keycloak account is, matched on Keycloak's fixed id
   * (`sub`) rather than the email in the token.
   *
   * A Keycloak user can change their own email. Matching on it meant typing
   * someone else's address into the account page and signing in again was
   * enough to become them here — their assignments, progress, results, notes
   * and course-editing rights. So:
   *
   * - A row already bound to this `sub` is this person, whatever the token now
   *   says the email is. A changed email is only carried over when Keycloak
   *   has verified it and nobody else here has it; otherwise the row keeps the
   *   address it had, and with it only what was always theirs.
   * - A row found by email that is bound to a *different* `sub` is somebody
   *   else's, and the sign-in is refused.
   * - A row found by email and bound to nobody is claimed. If it has never
   *   been signed into — a placeholder made by assigning work to an address —
   *   claiming it with an unverified email is exactly the takeover above, so
   *   with REQUIRE_VERIFIED_EMAIL=true it is refused; until then it is allowed
   *   and logged, because realms without email verification would otherwise
   *   lock out every new starter who was assigned work first.
   */
  static async resolveSignedInUser(claims: {
    subject: string;
    email: string;
    emailVerified: boolean;
    name?: string;
  }): Promise<User> {
    const email = claims.email.toLowerCase();
    const name = claims.name?.trim() || null;

    const bound = await AuthGateway.getUserBySubject(claims.subject);
    if (bound) {
      let user = bound;
      if (user.email !== email) {
        const taken = await AuthGateway.getUserByEmail(email);
        if (claims.emailVerified && !taken) {
          user = await AuthGateway.setEmail(user.id, email);
        } else {
          logSecurityEvent('auth.failure', {
            userId: user.id,
            email: safeForLog(email, 120),
            reason: 'token email differs from the bound account; kept the bound email',
          });
        }
      }
      if (name && user.name !== name) user = await AuthGateway.updateUser(user.id, { name });
      return user;
    }

    const existing = await AuthGateway.getUserByEmail(email);
    if (!existing) {
      return AuthGateway.createUser({ email, name, keycloakSubject: claims.subject });
    }

    if (existing.keycloakSubject && existing.keycloakSubject !== claims.subject) {
      logSecurityEvent('auth.failure', {
        userId: existing.id,
        email: safeForLog(email, 120),
        reason: 'email belongs to a different Keycloak account',
      });
      throw new IdentityConflictError(
        'This email address is linked to a different account. Contact an administrator.',
      );
    }

    if (existing.lastSignInAt === null && !claims.emailVerified) {
      if (process.env.REQUIRE_VERIFIED_EMAIL === 'true') {
        throw new IdentityConflictError(
          'Verify your email address in your account settings, then sign in again.',
        );
      }
      logSecurityEvent('auth.failure', {
        userId: existing.id,
        email: safeForLog(email, 120),
        reason:
          'unverified email claimed a never-signed-in record (allowed: REQUIRE_VERIFIED_EMAIL off)',
      });
    }

    let user = await AuthGateway.bindSubject(existing.id, claims.subject);
    if (name && user.name !== name) user = await AuthGateway.updateUser(user.id, { name });
    return user;
  }

  /**
   * The user row for an address, made if it does not exist yet. Used wherever
   * someone has to be named before they have signed in — contributors and
   * assignments. A given name overwrites the stored one.
   */
  static async getOrCreateUser(email: string, name?: string): Promise<User> {
    try {
      let user = await this.getUserByEmail(email);

      if (!user) {
        user = await this.createUser({
          email,
          name: name || undefined,
        });
      } else if (name && user.name !== name) {
        user = await this.updateUser(user.id, { name });
      }

      return user;
    } catch (error) {
      logger.error({ err: error }, 'Error in getOrCreateUser');
      throw error;
    }
  }
}
