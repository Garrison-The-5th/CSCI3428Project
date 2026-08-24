/**
 * File: auth-service.ts
 * Description: User lookup, creation and sign-in bookkeeping.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
// Service is useful for adding business logic/error handling
import { logger } from '@/config/logger';
import AuthGateway from '@/gateways/auth-gateway/auth-gateway';

import { User } from '../../../generated/prisma';

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
   * Three states, and someone can be more than one of them:
   *   author  — named on at least one course, or holding the author role
   *   student — has been assigned something
   *   no account — an address that has never been signed into
   *
   * "No account" means never signed in. Inferring it from a missing name was
   * wrong: a realm that sends no name claim left every genuine account looking
   * like a bare address.
   */
  static async getAllWithRoles() {
    const [users, assignedEmails] = await Promise.all([
      AuthGateway.getAllWithRoles(),
      AuthGateway.getAssignedEmails(),
    ]);

    return users.map((user) => {
      const hasAccount = user.lastSignInAt !== null;
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        subscribed: user.subscribed,
        hasAccount,
        isAuthor: user._count.editableCourses > 0 || user.role === 'admin',
        isStudent: assignedEmails.has(user.email.toLowerCase()),
      };
    });
  }

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

  static async getSubscribedUsers(): Promise<User[]> {
    try {
      return await AuthGateway.getSubscribedUsers();
    } catch (error) {
      logger.error({ err: error }, 'Error fetching subscribed users');
      throw new Error('Failed to retrieve subscribed users');
    }
  }

  /**
   * Get or create user - useful for SSO/OAuth flows
   */
  static searchUsers(query: string, options?: { accountsOnly?: boolean }) {
    return AuthGateway.searchUsers(query, options);
  }

  /** Whether this exact address belongs to somebody who has signed in. */
  static hasAccount(email: string) {
    return AuthGateway.hasAccount(email);
  }

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
