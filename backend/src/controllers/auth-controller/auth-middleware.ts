/**
 * File: auth-middleware.ts
 * Description: Verifies the Keycloak JWT and attaches the user, recording the decision.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
import { createPublicKey, type JsonWebKey, KeyObject } from 'node:crypto';

import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';

import { clientAddress } from '@/config/client-address';
import { keycloakSettings } from '@/config/keycloak';
import { logger, logSecurityEvent, safeForLog } from '@/config/logger';
import AdminAccessService from '@/services/admin-access-service/admin-access-service';
import AuthService, { IdentityConflictError } from '@/services/auth-service/auth-service';

import { User } from '../../../generated/prisma';

const settings = keycloakSettings();

/**
 * The Keycloak clients whose tokens this API accepts — this app's own, unless
 * KEYCLOAK_CLIENT_ID names others (comma-separated).
 */
const ALLOWED_CLIENTS = settings.allowedClients;

/**
 * A key pinned in PUBLICKEY, when one is set — handy for a local realm and for
 * tests. Deployed, it is left unset and the realm's own published keys are used
 * instead, so a key rotation in a shared realm does not lock everyone out.
 */
const PINNED_KEY = process.env.PUBLICKEY
  ? `-----BEGIN PUBLIC KEY-----\n${process.env.PUBLICKEY}\n-----END PUBLIC KEY-----`
  : null;

/** The realm's signing keys by key id, and when they were last fetched. */
let realmKeys = new Map<string, KeyObject>();
let realmKeysFetchedAt = 0;
let realmKeysLoading: Promise<void> | null = null;

/** Never ask Keycloak for its keys more than once a minute, whatever tokens arrive. */
const KEY_REFETCH_MS = 60_000;

async function loadRealmKeys(): Promise<void> {
  const response = await fetch(
    `${settings.internalUrl}/realms/${encodeURIComponent(settings.realm)}/protocol/openid-connect/certs`,
  );
  if (!response.ok) throw new Error(`Keycloak signing keys unavailable (${response.status})`);
  const { keys } = (await response.json()) as {
    keys: Array<JsonWebKey & { kid?: string; use?: string }>;
  };
  const next = new Map<string, KeyObject>();
  for (const jwk of keys) {
    if (jwk.kid && jwk.kty === 'RSA' && jwk.use !== 'enc') {
      next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
    }
  }
  realmKeys = next;
  realmKeysFetchedAt = Date.now();
}

/**
 * The key a token must be signed with: the pinned one, or the realm key its
 * header names — fetched again only when the id is unknown, which is what a
 * rotation looks like.
 */
async function verificationKey(token: string): Promise<KeyObject | string> {
  if (PINNED_KEY) return PINNED_KEY;

  const kid = jwt.decode(token, { complete: true })?.header.kid;
  if (!kid) throw new Error('token header has no key id');

  if (!realmKeys.has(kid) && Date.now() - realmKeysFetchedAt > KEY_REFETCH_MS) {
    realmKeysLoading ??= loadRealmKeys().finally(() => {
      realmKeysLoading = null;
    });
    await realmKeysLoading;
  }

  const key = realmKeys.get(kid);
  if (!key) throw new Error('token signed with a key this realm does not publish');
  return key;
}

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

/**
 * Verifies the Keycloak bearer token, checks it was issued to this app, and attaches the caller's
 * claims (`req.auth`) and local user row (`req.user`). Every outcome is security-logged.
 */
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

    // Signed by this realm, for this realm. Every app in a shared realm gets
    // tokens signed with the same key, so `iss` alone does not make a token
    // ours — the client check below does that.
    const decoded = jwt.verify(token, await verificationKey(token), {
      algorithms: ['RS256'],
      issuer: settings.issuer,
    }) as JwtPayload;

    const clientId = decoded.azp as string | undefined;
    const email = decoded.email as string | undefined;
    // Keycloak sets this only once the person has proved they own the address.
    const emailVerified = decoded.email_verified === true;
    const subject = decoded.sub as string | undefined;
    const name = decoded.name as string | undefined;
    // Only roles on this app's own client count. Realm roles are deliberately
    // ignored: the realm is shared with other applications, and a realm-wide
    // `admin` granted for one of them must not make somebody an admin here.
    const roles = clientId
      ? ((decoded.resource_access?.[clientId]?.roles as string[] | undefined) ?? [])
      : [];

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
