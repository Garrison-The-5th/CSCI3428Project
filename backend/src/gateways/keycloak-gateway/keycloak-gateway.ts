/**
 * File: keycloak-gateway.ts
 * Description: Calls to Keycloak's admin API — who holds the app's admin and author client roles, and granting or removing them.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: rware <rware@ttgteams.com>
 * Date: 2026-10-23
 */
import { keycloakSettings } from '@/config/keycloak';

/**
 * The only place the backend talks to Keycloak's admin REST API.
 *
 * Everything else about identity comes from the signed token on each request;
 * this exists because making somebody an admin or an author has to change
 * Keycloak itself, so that the role is in their next token and visible to
 * anyone checking the client's own role lists.
 *
 * The realm is shared with other applications, so everything here is scoped to
 * the app's own client (KEYCLOAK_CLIENT_ID): both roles are *client* roles on
 * it, and this never reads, grants or removes a realm role, and never creates,
 * edits or deletes an account. The accounts belong to the realm, not to us.
 *
 * It signs in as a service account — a confidential client using the client
 * credentials grant — rather than as a person, so no admin password is stored
 * anywhere. That client needs to view users, view the app's client, and map the
 * app's client roles; setup is in docs/keycloak.md.
 */

export const ADMIN_ROLE = 'admin';

/**
 * The global author role. Named `contributor` in Keycloak because that is what
 * the auth middleware, the frontend and existing realms already use; the app
 * calls it "Author". It allows everything an admin can do except the Users
 * page — managing accounts and roles stays with admins.
 */
export const AUTHOR_ROLE = 'contributor';

/** The roles the Users page can grant and remove. */
export type AppRole = typeof ADMIN_ROLE | typeof AUTHOR_ROLE;

interface KeycloakConfig {
  baseUrl: string;
  realm: string;
  appClientId: string;
  serviceClientId: string;
  serviceClientSecret: string;
}

/** Thrown for anything Keycloak refuses, with its status so callers can tell 404 from 403. */
export class KeycloakError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Keycloak admin-API settings from the environment, or null when no service client is configured —
 * callers then fall back to the local role copy.
 */
function config(): KeycloakConfig | null {
  const serviceClientId = process.env.KEYCLOAK_SERVICE_CLIENT_ID;
  const serviceClientSecret = process.env.KEYCLOAK_SERVICE_CLIENT_SECRET;
  if (!serviceClientId || !serviceClientSecret) return null;
  const settings = keycloakSettings();
  return {
    // Where the backend reaches Keycloak, which inside Docker is not the
    // browser-facing KEYCLOAK_URL.
    baseUrl: settings.internalUrl,
    realm: settings.realm,
    appClientId: settings.clientId,
    serviceClientId,
    serviceClientSecret,
  };
}

interface KeycloakUser {
  id: string;
  email?: string;
}

interface RoleRepresentation {
  id: string;
  name: string;
}

/** Page size for role member lists. */
const PAGE = 100;

export default class KeycloakGateway {
  private static cachedToken: { value: string; expiresAt: number } | null = null;
  private static cachedClientUuid: string | null = null;

  /** Whether the service account is set up. Without it, admin access is read-only. */
  static isConfigured(): boolean {
    return config() !== null;
  }

  /** Forgets the cached token and client id. For tests, and after a credentials change. */
  static resetToken() {
    KeycloakGateway.cachedToken = null;
    KeycloakGateway.cachedClientUuid = null;
  }

  private static require(): KeycloakConfig {
    const settings = config();
    if (!settings) {
      throw new KeycloakError(
        'Keycloak admin access is not set up — see docs/keycloak.md, "Admin role management"',
        503,
      );
    }
    return settings;
  }

  /** A service-account token, reused until shortly before it expires. */
  private static async token(settings: KeycloakConfig): Promise<string> {
    const cached = KeycloakGateway.cachedToken;
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const response = await fetch(
      `${settings.baseUrl}/realms/${encodeURIComponent(settings.realm)}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: settings.serviceClientId,
          client_secret: settings.serviceClientSecret,
        }),
      },
    );
    if (!response.ok) {
      throw new KeycloakError(
        `Keycloak refused the service account sign-in (${response.status})`,
        response.status,
      );
    }
    const body = (await response.json()) as { access_token: string; expires_in?: number };
    KeycloakGateway.cachedToken = {
      value: body.access_token,
      // Thirty seconds early, so a token never expires between check and use.
      expiresAt: Date.now() + ((body.expires_in ?? 60) - 30) * 1000,
    };
    return body.access_token;
  }

  /** One admin API call, relative to the realm. */
  private static async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const settings = KeycloakGateway.require();
    const token = await KeycloakGateway.token(settings);
    const response = await fetch(
      `${settings.baseUrl}/admin/realms/${encodeURIComponent(settings.realm)}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      },
    );
    if (!response.ok) {
      throw new KeycloakError(
        `Keycloak admin API ${path} failed (${response.status})`,
        response.status,
      );
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Every member of a role, page by page. */
  private static async members(path: string): Promise<KeycloakUser[]> {
    const all: KeycloakUser[] = [];
    for (let first = 0; ; first += PAGE) {
      const page = await KeycloakGateway.api<KeycloakUser[]>(`${path}?first=${first}&max=${PAGE}`);
      all.push(...page);
      if (page.length < PAGE) return all;
    }
  }

  /** Runs a call that is allowed to find nothing — a role that was never created. */
  private static async optional<T>(call: () => Promise<T>): Promise<T | null> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof KeycloakError && error.status === 404) return null;
      throw error;
    }
  }

  /** The internal id of the app's own client, which every role call hangs off. Fetched once. */
  private static async appClientUuid(): Promise<string> {
    if (KeycloakGateway.cachedClientUuid) return KeycloakGateway.cachedClientUuid;
    const { appClientId } = KeycloakGateway.require();
    const clients = await KeycloakGateway.api<Array<{ id: string }>>(
      `/clients?clientId=${encodeURIComponent(appClientId)}`,
    );
    const uuid = clients[0]?.id;
    if (!uuid) {
      throw new KeycloakError(`The realm has no "${appClientId}" client`, 404);
    }
    KeycloakGateway.cachedClientUuid = uuid;
    return uuid;
  }

  /** Path of one of the app's client roles, or of its role mappings for a user. */
  private static async clientPath(suffix: string): Promise<string> {
    return `/clients/${await KeycloakGateway.appClientUuid()}${suffix}`;
  }

  /** The email of everyone holding one of the app's client roles. */
  static async roleEmails(roleName: AppRole): Promise<Set<string>> {
    const path = await KeycloakGateway.clientPath(`/roles/${encodeURIComponent(roleName)}/users`);
    const holders = (await KeycloakGateway.optional(() => KeycloakGateway.members(path))) ?? [];
    return new Set(
      holders
        .map((user) => user.email?.toLowerCase())
        .filter((email): email is string => Boolean(email)),
    );
  }

  /** Keycloak's id for the account with exactly this email, if there is one. */
  static async findUserId(email: string): Promise<string | null> {
    const users = await KeycloakGateway.api<KeycloakUser[]>(
      `/users?email=${encodeURIComponent(email)}&exact=true`,
    );
    const match = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    return match?.id ?? null;
  }

  /** Where a user's mappings to the app's client roles live. */
  private static async userMappingsPath(userId: string): Promise<string> {
    const clientUuid = await KeycloakGateway.appClientUuid();
    return `/users/${encodeURIComponent(userId)}/role-mappings/clients/${clientUuid}`;
  }

  /** The app's client roles a user holds directly, by name. */
  static async userClientRoles(userId: string): Promise<string[]> {
    const roles = await KeycloakGateway.api<RoleRepresentation[]>(
      await KeycloakGateway.userMappingsPath(userId),
    );
    return (roles ?? []).map((role) => role.name);
  }

  /** One of the app's client roles, or null when it has not been created. */
  private static async clientRole(roleName: AppRole): Promise<RoleRepresentation | null> {
    const path = await KeycloakGateway.clientPath(`/roles/${encodeURIComponent(roleName)}`);
    return KeycloakGateway.optional(() => KeycloakGateway.api<RoleRepresentation>(path));
  }

  /**
   * Gives a user one of the app's client roles. Fails with a 404 if the role has not been created
   * on the client.
   */
  static async grantRole(userId: string, roleName: AppRole): Promise<void> {
    const role = await KeycloakGateway.clientRole(roleName);
    if (!role) {
      throw new KeycloakError(
        `The app's Keycloak client has no "${roleName}" role yet — create it under the client's Roles tab`,
        404,
      );
    }
    await KeycloakGateway.api(await KeycloakGateway.userMappingsPath(userId), {
      method: 'POST',
      body: JSON.stringify([role]),
    });
  }

  /** Takes one of the app's client roles away. A role that was never created is already gone. */
  static async revokeRole(userId: string, roleName: AppRole): Promise<void> {
    const role = await KeycloakGateway.clientRole(roleName);
    if (!role) return;
    await KeycloakGateway.api(await KeycloakGateway.userMappingsPath(userId), {
      method: 'DELETE',
      body: JSON.stringify([role]),
    });
  }
}
