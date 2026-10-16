/**
 * File: admin-access-service.ts
 * Description: Who is an admin or an author, and granting or removing either — in Keycloak, where the roles live.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-16
 */
import { logger, logSecurityEvent } from '@/config/logger';
import { ConflictError, ForbiddenError, NotFoundError } from '@/controllers/http-errors';
import AuthGateway, { LocalRole } from '@/gateways/auth-gateway/auth-gateway';
import KeycloakGateway, {
  ADMIN_ROLE,
  AppRole,
  AUTHOR_ROLE,
  KeycloakError,
} from '@/gateways/keycloak-gateway/keycloak-gateway';

/** The two switches on the Users page. */
export type ManagedRole = 'admin' | 'author';

const KEYCLOAK_ROLE: Record<ManagedRole, AppRole> = { admin: ADMIN_ROLE, author: AUTHOR_ROLE };

/** The highest role somebody holds, as the local copy records it. */
function localRole(roles: string[]): LocalRole {
  if (roles.includes(ADMIN_ROLE)) return 'admin';
  if (roles.includes(AUTHOR_ROLE)) return 'author';
  return 'user';
}

/**
 * Admin and author access, managed from the Users page.
 *
 * - **Admin** — everything, including the Users page and these switches.
 * - **Author** (`contributor` in Keycloak) — everything except the Users page:
 *   creating courses and quizzes, assigning, the dashboard. Not account status.
 *
 * Being named on one course is separate from both: it lets somebody edit that
 * course and nothing else, and is managed on the course, not here.
 *
 * Keycloak is the source of truth: a role is changed there, so it is in the
 * person's next token and shows in the realm's own role lists. The local
 * `User.role` column is kept in step as a fallback for when Keycloak cannot be
 * reached, and is never what access decisions are made on.
 *
 * A change takes effect the next time the person's token refreshes — a few
 * minutes at most — not on the request that made it.
 */
export default class AdminAccessService {
  /** Whether the page may change roles, or only show them. */
  static canManage(): boolean {
    return KeycloakGateway.isConfigured();
  }

  /**
   * Everyone holding each role, by email, or null when Keycloak cannot say —
   * not configured, or not answering. Null rather than empty sets, so an
   * outage never reads as "nobody is an admin".
   */
  static async roleHolders(): Promise<{ admins: Set<string>; authors: Set<string> } | null> {
    if (!KeycloakGateway.isConfigured()) return null;
    try {
      const [admins, authors] = await Promise.all([
        KeycloakGateway.roleEmails(ADMIN_ROLE),
        KeycloakGateway.roleEmails(AUTHOR_ROLE),
      ]);
      return { admins, authors };
    } catch (error) {
      logger.error({ err: error }, 'could not read role holders from Keycloak');
      return null;
    }
  }

  /**
   * Grants or removes admin or author for one person.
   *
   * Refused for somebody who has never signed in — they have no Keycloak
   * account to give a role to yet — and for an admin removing their own admin
   * access, which would let a slip lock the last admin out.
   */
  static async setRole(
    actor: { id: number; email: string },
    targetId: number,
    role: ManagedRole,
    enabled: boolean,
  ) {
    const target = await AuthGateway.getUserById(targetId);
    if (!target) throw new NotFoundError(`User with ID ${targetId} not found`);

    if (role === 'admin' && !enabled && target.email.toLowerCase() === actor.email.toLowerCase()) {
      throw new ForbiddenError(
        'You cannot remove your own admin access. Ask another admin to do it.',
      );
    }
    if (target.lastSignInAt === null) {
      throw new ConflictError(
        `${target.email} has never signed in, so there is no account to change yet.`,
      );
    }

    let remaining: string[];
    try {
      const keycloakId = await KeycloakGateway.findUserId(target.email);
      if (!keycloakId) {
        throw new ConflictError(`${target.email} has no matching account in Keycloak.`);
      }
      if (enabled) await KeycloakGateway.grantRole(keycloakId, KEYCLOAK_ROLE[role]);
      else await KeycloakGateway.revokeRole(keycloakId, KEYCLOAK_ROLE[role]);
      // Read back rather than worked out, so the local copy is what Keycloak
      // now says — removing admin from somebody who is also an author leaves
      // them an author, not a plain user.
      remaining = await KeycloakGateway.userRealmRoles(keycloakId);
    } catch (error) {
      if (error instanceof KeycloakError) {
        logger.error({ err: error, target: target.email }, 'Keycloak role change failed');
        // Not the caller's fault, and not a 400: say plainly where it failed.
        throw new Error(`Keycloak did not accept the change: ${error.message}`);
      }
      throw error;
    }

    await AuthGateway.setRole(target.id, localRole(remaining));
    logSecurityEvent(enabled ? 'role.granted' : 'role.revoked', {
      userId: actor.id,
      email: target.email,
      resource: `user:${target.id}`,
      reason: role,
    });

    return {
      id: target.id,
      isAdmin: remaining.includes(ADMIN_ROLE),
      hasAuthorRole: remaining.includes(AUTHOR_ROLE),
    };
  }

  /**
   * Brings the local copy in line with what a sign-in token says. Never awaited
   * on the request path and never fatal: it is a cache, not a decision.
   */
  static async syncFromToken(user: { id: number; role: string | null }, roles: string[]) {
    const role = localRole(roles);
    if (user.role === role) return;
    try {
      await AuthGateway.setRole(user.id, role);
    } catch (error) {
      logger.error({ err: error, userId: user.id }, 'could not record role from token');
    }
  }
}
