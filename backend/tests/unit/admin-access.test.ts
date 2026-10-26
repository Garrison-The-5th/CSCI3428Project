/**
 * File: admin-access.test.ts
 * Description: Unit tests for granting and removing admin and author access, and the Keycloak admin API calls behind it.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: rware <rware@ttgteams.com>
 * Date: 2026-10-23
 */
import { ConflictError, ForbiddenError, NotFoundError } from '@/controllers/http-errors';
import AuthGateway from '@/gateways/auth-gateway/auth-gateway';
import KeycloakGateway from '@/gateways/keycloak-gateway/keycloak-gateway';
import AdminAccessService from '@/services/admin-access-service/admin-access-service';

jest.mock('@/gateways/auth-gateway/auth-gateway');
const auth = AuthGateway as jest.Mocked<typeof AuthGateway>;

const actor = { id: 1, email: 'boss@example.com' };
const signedIn = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 2,
    email: 'ada@example.com',
    role: 'user',
    lastSignInAt: new Date(),
    ...overrides,
  }) as never;

/** A fake Keycloak: answers by URL, and records every call made to it. */
function fakeKeycloak(routes: Record<string, unknown>) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 't', expires_in: 300 }));
    }
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method !== 'GET') return new Response(null, { status: 204 });
    const key = Object.keys(routes).find((pattern) => url.includes(pattern));
    if (key === undefined) return new Response('', { status: 404 });
    return new Response(JSON.stringify(routes[key]));
  }) as typeof fetch;
  return calls;
}

const realFetch = global.fetch;
beforeEach(() => {
  process.env.KEYCLOAK_SERVICE_CLIENT_ID = 'learning-admin-api';
  process.env.KEYCLOAK_SERVICE_CLIENT_SECRET = 'secret';
  KeycloakGateway.resetToken();
});
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.KEYCLOAK_SERVICE_CLIENT_ID;
  delete process.env.KEYCLOAK_SERVICE_CLIENT_SECRET;
});

describe('AdminAccessService.setRole — the rules', () => {
  it('refuses to let an admin remove their own access', async () => {
    auth.getUserById.mockResolvedValue(signedIn({ id: 1, email: 'Boss@example.com' }));
    await expect(AdminAccessService.setRole(actor, 1, 'admin', false)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('refuses somebody who has never signed in, who has no account to change', async () => {
    auth.getUserById.mockResolvedValue(signedIn({ lastSignInAt: null }));
    await expect(AdminAccessService.setRole(actor, 2, 'admin', true)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('says so when the user does not exist', async () => {
    auth.getUserById.mockResolvedValue(null);
    await expect(AdminAccessService.setRole(actor, 9, 'admin', true)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('fails with a clear message when Keycloak admin access is not set up', async () => {
    delete process.env.KEYCLOAK_SERVICE_CLIENT_ID;
    auth.getUserById.mockResolvedValue(signedIn());
    await expect(AdminAccessService.setRole(actor, 2, 'admin', true)).rejects.toThrow(/not set up/);
    expect(auth.setRole).not.toHaveBeenCalled();
  });
});

/** The app's client, which every role call goes through. */
const CLIENT = { '/clients?clientId=': [{ id: 'client-uuid' }] };
const ADMIN = { id: 'role-1', name: 'admin' };
const AUTHOR = { id: 'role-2', name: 'contributor' };

describe('AdminAccessService.setRole — Keycloak', () => {
  it('grants the admin client role on the app client and records it locally', async () => {
    auth.getUserById.mockResolvedValue(signedIn());
    const calls = fakeKeycloak({
      '/role-mappings/clients/client-uuid': [ADMIN],
      '/users?email=': [{ id: 'kc-2', email: 'ada@example.com' }],
      '/clients/client-uuid/roles/admin': ADMIN,
      ...CLIENT,
    });

    await expect(AdminAccessService.setRole(actor, 2, 'admin', true)).resolves.toEqual({
      id: 2,
      isAdmin: true,
      hasAuthorRole: false,
    });

    const grant = calls.find(
      (call) => call.method === 'POST' && call.url.includes('role-mappings'),
    );
    expect(grant?.url).toContain('/users/kc-2/role-mappings/clients/client-uuid');
    expect(grant?.body).toEqual([ADMIN]);
    expect(auth.setRole).toHaveBeenCalledWith(2, 'admin');
  });

  it('never touches a realm role — the realm is shared with other apps', async () => {
    auth.getUserById.mockResolvedValue(signedIn({ role: 'admin' }));
    const calls = fakeKeycloak({
      '/role-mappings/clients/client-uuid': [],
      '/users?email=': [{ id: 'kc-2', email: 'ada@example.com' }],
      '/clients/client-uuid/roles/admin': ADMIN,
      ...CLIENT,
    });

    await AdminAccessService.setRole(actor, 2, 'admin', true);
    await AdminAccessService.setRole(actor, 2, 'admin', false);

    expect(calls.some((call) => call.url.includes('/role-mappings/realm'))).toBe(false);
    expect(calls.some((call) => /\/admin\/realms\/[^/]+\/roles\//.test(call.url))).toBe(false);
  });

  it('grants author as the "contributor" client role', async () => {
    auth.getUserById.mockResolvedValue(signedIn());
    const calls = fakeKeycloak({
      '/role-mappings/clients/client-uuid': [AUTHOR],
      '/users?email=': [{ id: 'kc-2', email: 'ada@example.com' }],
      '/clients/client-uuid/roles/contributor': AUTHOR,
      ...CLIENT,
    });

    await expect(AdminAccessService.setRole(actor, 2, 'author', true)).resolves.toEqual({
      id: 2,
      isAdmin: false,
      hasAuthorRole: true,
    });

    const grant = calls.find((call) => call.method === 'POST');
    expect(grant?.body).toEqual([AUTHOR]);
    expect(auth.setRole).toHaveBeenCalledWith(2, 'author');
  });

  it('says plainly when the role has not been created on the client', async () => {
    auth.getUserById.mockResolvedValue(signedIn());
    fakeKeycloak({
      '/users?email=': [{ id: 'kc-2', email: 'ada@example.com' }],
      ...CLIENT,
    });
    await expect(AdminAccessService.setRole(actor, 2, 'admin', true)).rejects.toThrow(
      /no "admin" role/,
    );
    expect(auth.setRole).not.toHaveBeenCalled();
  });

  it('lets an admin remove their own author role — only their admin role is protected', async () => {
    auth.getUserById.mockResolvedValue(signedIn({ id: 1, email: 'boss@example.com' }));
    fakeKeycloak({
      '/role-mappings/clients/client-uuid': [ADMIN],
      '/users?email=': [{ id: 'kc-1', email: 'boss@example.com' }],
      '/clients/client-uuid/roles/contributor': AUTHOR,
      ...CLIENT,
    });
    await expect(AdminAccessService.setRole(actor, 1, 'author', false)).resolves.toMatchObject({
      isAdmin: true,
    });
  });

  it('removes admin from the app client', async () => {
    auth.getUserById.mockResolvedValue(signedIn({ role: 'admin' }));
    const calls = fakeKeycloak({
      '/role-mappings/clients/client-uuid': [],
      '/users?email=': [{ id: 'kc-2', email: 'ada@example.com' }],
      '/clients/client-uuid/roles/admin': ADMIN,
      ...CLIENT,
    });

    await AdminAccessService.setRole(actor, 2, 'admin', false);

    const removed = calls.filter((call) => call.method === 'DELETE');
    expect(removed).toEqual([
      expect.objectContaining({
        url: expect.stringContaining('/users/kc-2/role-mappings/clients/client-uuid'),
        body: [ADMIN],
      }),
    ]);
    expect(auth.setRole).toHaveBeenCalledWith(2, 'user');
  });

  it('leaves somebody an author when admin is removed and they also hold author', async () => {
    auth.getUserById.mockResolvedValue(signedIn({ role: 'admin' }));
    fakeKeycloak({
      '/role-mappings/clients/client-uuid': [AUTHOR],
      '/users?email=': [{ id: 'kc-2', email: 'ada@example.com' }],
      '/clients/client-uuid/roles/admin': ADMIN,
      ...CLIENT,
    });
    await AdminAccessService.setRole(actor, 2, 'admin', false);
    expect(auth.setRole).toHaveBeenCalledWith(2, 'author');
  });

  it('does not change the local copy when Keycloak refuses', async () => {
    auth.getUserById.mockResolvedValue(signedIn());
    fakeKeycloak({ '/users?email=': [] });
    await expect(AdminAccessService.setRole(actor, 2, 'author', true)).rejects.toThrow(
      /no matching account/,
    );
    expect(auth.setRole).not.toHaveBeenCalled();
  });
});

describe('AdminAccessService.roleHolders', () => {
  it("lists the app client's role holders, by lower-cased email", async () => {
    fakeKeycloak({
      '/clients/client-uuid/roles/admin/users': [{ id: 'a', email: 'Ada@Example.com' }],
      '/clients/client-uuid/roles/contributor/users': [{ id: 'c', email: 'cleo@example.com' }],
      ...CLIENT,
    });
    expect(await AdminAccessService.roleHolders()).toEqual({
      admins: new Set(['ada@example.com']),
      authors: new Set(['cleo@example.com']),
    });
  });

  it('answers null, not "nobody", when Keycloak cannot be asked', async () => {
    delete process.env.KEYCLOAK_SERVICE_CLIENT_ID;
    expect(await AdminAccessService.roleHolders()).toBeNull();

    process.env.KEYCLOAK_SERVICE_CLIENT_ID = 'learning-admin-api';
    global.fetch = jest.fn().mockRejectedValue(new Error('down')) as typeof fetch;
    expect(await AdminAccessService.roleHolders()).toBeNull();
  });
});

describe('AdminAccessService.syncFromToken', () => {
  it('records the highest role from the token, and writes nothing when it already matches', async () => {
    await AdminAccessService.syncFromToken({ id: 3, role: 'user' }, ['admin', 'contributor']);
    expect(auth.setRole).toHaveBeenCalledWith(3, 'admin');

    await AdminAccessService.syncFromToken({ id: 4, role: 'user' }, ['contributor']);
    expect(auth.setRole).toHaveBeenCalledWith(4, 'author');

    auth.setRole.mockClear();
    await AdminAccessService.syncFromToken({ id: 3, role: 'admin' }, ['admin', 'offline_access']);
    expect(auth.setRole).not.toHaveBeenCalled();
  });
});

describe('AdminAccessService.deleteUser', () => {
  beforeEach(() => {
    auth.deleteUser.mockReset();
    auth.deleteUser.mockResolvedValue({ assignmentsDeleted: 2 });
  });

  it('refuses to let an admin delete themselves', async () => {
    auth.getUserById.mockResolvedValue(signedIn({ id: 1, email: 'Boss@example.com' }));
    await expect(AdminAccessService.deleteUser(actor, 1)).rejects.toBeInstanceOf(ForbiddenError);
    expect(auth.deleteUser).not.toHaveBeenCalled();
  });

  it('says so when the user does not exist', async () => {
    auth.getUserById.mockResolvedValue(null);
    await expect(AdminAccessService.deleteUser(actor, 9)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("removes the app's roles, never the shared account, then deletes the data", async () => {
    auth.getUserById.mockResolvedValue(signedIn({ keycloakSubject: 'kc-2' }));
    const calls = fakeKeycloak({
      '/clients/client-uuid/roles/admin': ADMIN,
      '/clients/client-uuid/roles/contributor': AUTHOR,
      ...CLIENT,
    });

    await expect(AdminAccessService.deleteUser(actor, 2)).resolves.toEqual({
      id: 2,
      rolesRemoved: true,
      assignmentsDeleted: 2,
    });
    const deletes = calls.filter((call) => call.method === 'DELETE');
    expect(deletes.map((call) => call.body)).toEqual([[ADMIN], [AUTHOR]]);
    expect(
      deletes.every((call) => call.url.endsWith('/users/kc-2/role-mappings/clients/client-uuid')),
    ).toBe(true);
    expect(calls.some((call) => /\/users\/kc-2$/.test(call.url))).toBe(false);
    expect(auth.deleteUser).toHaveBeenCalledWith(2, 'ada@example.com');
  });

  it('keeps the data when Keycloak refuses, so nothing is half-deleted', async () => {
    auth.getUserById.mockResolvedValue(signedIn({ keycloakSubject: 'kc-2' }));
    global.fetch = jest.fn(async (input: string | URL | Request) =>
      String(input).endsWith('/openid-connect/token')
        ? new Response(JSON.stringify({ access_token: 't', expires_in: 300 }))
        : new Response('', { status: 403 }),
    ) as typeof fetch;

    await expect(AdminAccessService.deleteUser(actor, 2)).rejects.toThrow(/Keycloak/);
    expect(auth.deleteUser).not.toHaveBeenCalled();
  });

  it('skips Keycloak for somebody who never signed in', async () => {
    auth.getUserById.mockResolvedValue(signedIn({ lastSignInAt: null, keycloakSubject: null }));
    const calls = fakeKeycloak({});
    await expect(AdminAccessService.deleteUser(actor, 2)).resolves.toMatchObject({
      rolesRemoved: true,
    });
    expect(calls).toEqual([]);
  });

  it('still deletes the data without Keycloak admin access, and says roles were not checked', async () => {
    delete process.env.KEYCLOAK_SERVICE_CLIENT_ID;
    auth.getUserById.mockResolvedValue(signedIn({ keycloakSubject: 'kc-2' }));
    await expect(AdminAccessService.deleteUser(actor, 2)).resolves.toMatchObject({
      rolesRemoved: false,
    });
    expect(auth.deleteUser).toHaveBeenCalled();
  });
});
