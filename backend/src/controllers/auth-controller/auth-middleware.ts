/**
 * File: auth-middleware.ts
 * Description: Verifies the Keycloak JWT and attaches the user, recording the decision.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';

import { clientAddress } from '@/config/client-address';
import { logger, logSecurityEvent, safeForLog } from '@/config/logger';
import AdminAccessService from '@/services/admin-access-service/admin-access-service';
import AuthService, { IdentityConflictError } from '@/services/auth-service/auth-service';

import { User } from '../../../generated/prisma';

if (!process.env.PUBLICKEY) {
  throw new Error('PUBLICKEY environment variable is not defined');
}

const public_key = `
-----BEGIN PUBLIC KEY-----
${process.env.PUBLICKEY}
-----END PUBLIC KEY-----
`.trim();

/**
 * The Keycloak clients whose tokens this API accepts — this app's own, unless
 * KEYCLOAK_CLIENT_ID names others (comma-separated).
 */
const ALLOWED_CLIENTS = (process.env.KEYCLOAK_CLIENT_ID ?? 'learning-client')
  .split(',')
  .map((client) => client.trim())
  .filter(Boolean);

export interface AuthClaims {
  email: string;
  name?: string;
  subject: string;
  clientId: string;
  roles: string[];
}

export interface AuthenticatedRequest extends Request {
  user?: User;
  auth?: AuthClaims;
  /** Set by requireCourseEditor: which course this request is editing. */
  courseId?: string;
}

export async function authenticateAndAttachUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const ip = clientAddress(req);
  const path = req.path;

  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      // Logged because §3.4.2 requires *all* authentication decisions to be
      // recorded, not only the ones that fail interestingly. A burst of these
      // from one address is the signature of a scanner.
      logSecurityEvent('auth.missing-token', { ip, method: req.method, path });
      return res.status(401).send({ errorMessage: 'Unauthorized Request' });
    }

    const decoded = jwt.verify(token, public_key, {
      algorithms: ['RS256'],
    }) as JwtPayload;

    const clientId = decoded.azp as string | undefined;
    const email = decoded.email as string | undefined;
    // Keycloak sets this only once the person has proved they own the address.
    const emailVerified = decoded.email_verified === true;
    const subject = decoded.sub as string | undefined;
    const name = decoded.name as string | undefined;
    // A role assigned either on the client or on the realm counts, so `admin` works
    // however it was mapped in Keycloak.
    const clientRoles = clientId
      ? ((decoded.resource_access?.[clientId]?.roles as string[] | undefined) ?? [])
      : [];
    const realmRoles = (decoded.realm_access?.roles as string[] | undefined) ?? [];
    const roles = [...new Set([...clientRoles, ...realmRoles])];

    if (!clientId || !email || !subject) {
      logSecurityEvent('auth.failure', {
        ip,
        method: req.method,
        path,
        reason: 'token payload missing azp, email or sub',
      });
      return res.status(401).send({ errorMessage: 'Invalid token payload' });
    }

    // Only tokens issued to this app. Any other client in the realm signs with
    // the same key, and its roles live under its own name — accepting it would
    // let a role granted for some other app count here.
    if (!ALLOWED_CLIENTS.includes(clientId)) {
      logSecurityEvent('auth.failure', {
        ip,
        method: req.method,
        path,
        reason: `token issued to another client (${safeForLog(clientId, 60)})`,
      });
      return res.status(401).send({ errorMessage: 'Invalid token payload' });
    }

    req.auth = {
      clientId,
      email,
      name,
      roles,
      subject,
    };

    try {
      req.user = await AuthService.resolveSignedInUser({ subject, email, emailVerified, name });
    } catch (error) {
      if (error instanceof IdentityConflictError) {
        return res.status(403).send({ errorMessage: error.message });
      }
      throw error;
    }

    logSecurityEvent('auth.success', {
      userId: req.user.id,
      email: safeForLog(email, 120),
      ip,
      method: req.method,
      path,
    });

    // Mark the account as real. A User row alone proves nothing — assigning work
    // creates one — and not every realm sends a name claim, so this stamp is the
    // only dependable evidence that someone can actually sign in.
    //
    // Throttled to once an hour so an authenticated session is not a write per
    // request, and deliberately not awaited: it must never delay or fail a call.
    void AuthService.markSignedIn(req.user);
    // Keeps the local copy of the admin role true to the token, for the Users
    // page to fall back on if Keycloak's admin API cannot be asked.
    void AdminAccessService.syncFromToken(req.user, roles);

    next();
  } catch (error) {
    // The reason is recorded for the operator but never returned to the caller,
    // which would tell an attacker whether a token was expired or forged.
    logSecurityEvent('auth.failure', {
      ip,
      method: req.method,
      path,
      reason: error instanceof Error ? safeForLog(error.message, 120) : 'unknown',
    });
    logger.debug({ err: error }, 'token verification failed');
    res.status(401).send({ errorMessage: 'Failed to authenticate user' });
  }
}
