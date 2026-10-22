/**
 * File: keycloak-gateway.ts
 * Description: Calls to Keycloak's admin API — who holds the admin and author roles, and granting or removing them.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-16
 */

/**
 * The only place the backend talks to Keycloak's admin REST API.
 *
 * Everything else about identity comes from the signed token on each request;
 * this exists because making somebody an admin or an author has to change
 * Keycloak itself, so that the role is in their next token and visible to
 * anyone checking the realm's own role lists.
 *
 * It signs in as a service account — a confidential client using the client
 * credentials grant — rather than as a person, so no admin password is stored
 * anywhere. That client needs the realm-management roles `view-users`,
 * `manage-users`, `view-clients` and `view-realm`; setup is in docs/keycloak.md.
 *
 * Both roles are *realm* roles. Older setups (docs/CMS.md) granted them as
 * client roles on the app's client instead, and the auth middleware honours
 * both, so reading a role's holders and removing a role cover both; granting
 * only ever adds the realm role.
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
  return {
    // Where the backend reaches Keycloak, which inside Docker is not the
    // browser-facing KEYCLOAK_URL — hence a variable of its own.
    baseUrl: (
      process.env.KEYCLOAK_ADMIN_URL ??
      process.env.KEYCLOAK_URL ??
      'http://localhost:4000'
    ).replace(/\/+$/, ''),
    realm: process.env.KEYCLOAK_REALM ?? 'learningapp',
    appClientId: process.env.KEYCLOAK_CLIENT_ID ?? 'learning-client',
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

  /** Whether the service account is set up. Without it, admin access is read-only. */
  static isConfigured(): boolean {
    return config() !== null;
  }

  /** Forgets the cached token. For tests, and after a credentials change. */
  static resetToken() {
    KeycloakGateway.cachedToken = null;
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

  /** The internal id of the app's own client, which legacy admin client roles hang off. */
  private static async appClientUuid(): Promise<string | null> {
    const { appClientId } = KeycloakGateway.require();
    const clients = await KeycloakGateway.api<Array<{ id: string }>>(
      `/clients?clientId=${encodeURIComponent(appClientId)}`,
    );
    return clients[0]?.id ?? null;
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

  /** The email of everyone holding a role, as a realm role or the older client role. */
  static async roleEmails(roleName: AppRole): Promise<Set<string>> {
    const role = encodeURIComponent(roleName);
    const realmHolders =
      (await KeycloakGateway.optional(() => KeycloakGateway.members(`/roles/${role}/users`))) ?? [];

    const clientUuid = await KeycloakGateway.optional(() => KeycloakGateway.appClientUuid());
    const clientHolders = clientUuid
      ? ((await KeycloakGateway.optional(() =>
          KeycloakGateway.members(`/clients/${clientUuid}/roles/${role}/users`),
        )) ?? [])
      : [];

    return new Set(
      [...realmHolders, ...clientHolders]
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

  /**
   * Removes the account from the realm, so it can no longer sign in. An account
   * that is already gone counts as done: a retry after a half-finished delete
   * must not fail on the half that worked.
   */
  static async deleteUser(userId: string): Promise<void> {
    await KeycloakGateway.optional(() =>
      KeycloakGateway.api(`/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
    );
  }

  /** The realm roles a user holds directly, by name. */
  static async userRealmRoles(userId: string): Promise<string[]> {
    const roles = await KeycloakGateway.api<RoleRepresentation[]>(
      `/users/${encodeURIComponent(userId)}/role-mappings/realm`,
    );
    return (roles ?? []).map((role) => role.name);
  }

  private static async realmRole(roleName: AppRole): Promise<RoleRepresentation> {
    const role = await KeycloakGateway.optional(() =>
      KeycloakGateway.api<RoleRepresentation>(`/roles/${encodeURIComponent(roleName)}`),
    );
    if (!role) {
      throw new KeycloakError(
        `The realm has no "${roleName}" realm role yet — create it under Realm roles`,
        404,
      );
    }
    return role;
  }

  /**
   * Gives a user one of the app's realm roles. Fails with a 404 if the realm role has not been
   * created in Keycloak.
   */
  static async grantRole(userId: string, roleName: AppRole): Promise<void> {
    const role = await KeycloakGateway.realmRole(roleName);
    await KeycloakGateway.api(`/users/${encodeURIComponent(userId)}/role-mappings/realm`, {
      method: 'POST',
      body: JSON.stringify([role]),
    });
  }

  /**
   * Takes a role away, whichever way it was given. Removing only the realm role
   * would leave someone granted it the older client-role way still holding it.
   */
  static async revokeRole(userId: string, roleName: AppRole): Promise<void> {
    const user = encodeURIComponent(userId);
    const role = encodeURIComponent(roleName);
    const realmRole = await KeycloakGateway.optional(() =>
      KeycloakGateway.api<RoleRepresentation>(`/roles/${role}`),
    );
    if (realmRole) {
      await KeycloakGateway.api(`/users/${user}/role-mappings/realm`, {
        method: 'DELETE',
        body: JSON.stringify([realmRole]),
      });
    }

    const clientUuid = await KeycloakGateway.optional(() => KeycloakGateway.appClientUuid());
    if (!clientUuid) return;
    const clientRole = await KeycloakGateway.optional(() =>
      KeycloakGateway.api<RoleRepresentation>(`/clients/${clientUuid}/roles/${role}`),
    );
    if (clientRole) {
      await KeycloakGateway.api(`/users/${user}/role-mappings/clients/${clientUuid}`, {
        method: 'DELETE',
        body: JSON.stringify([clientRole]),
      });
    }
  }
}
