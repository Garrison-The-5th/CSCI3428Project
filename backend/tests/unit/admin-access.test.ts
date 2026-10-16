/**
 * File: admin-access.test.ts
 * Description: Unit tests for granting and removing admin and author access, and the Keycloak admin API calls behind it.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-16
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

describe('AdminAccessService.setRole — Keycloak', () => {
  it('grants the realm admin role and records it locally', async () => {
    auth.getUserById.mockResolvedValue(signedIn());
    const calls = fakeKeycloak({
      '/role-mappings/realm': [{ id: 'role-1', name: 'admin' }],
      '/users?email=': [{ id: 'kc-2', email: 'ada@example.com' }],
      '/roles/admin': { id: 'role-1', name: 'admin' },
    });

    await expect(AdminAccessService.setRole(actor, 2, 'admin', true)).resolves.toEqual({
      id: 2,
      isAdmin: true,
      hasAuthorRole: false,
    });

    const grant = calls.find(
      (call) => call.method === 'POST' && call.url.includes('role-mappings'),
    );
    expect(grant?.url).toContain('/users/kc-2/role-mappings/realm');
    expect(grant?.body).toEqual([{ id: 'role-1', name: 'admin' }]);
    expect(auth.setRole).toHaveBeenCalledWith(2, 'admin');
  });

  it('grants author as the realm "contributor" role', async () => {
    auth.getUserById.mockResolvedValue(signedIn());
    const calls = fakeKeycloak({
      '/role-mappings/realm': [{ id: 'role-2', name: 'contributor' }],
      '/users?email=': [{ id: 'kc-2', email: 'ada@example.com' }],
      '/roles/contributor': { id: 'role-2', name: 'contributor' },
    });

    await expect(AdminAccessService.setRole(actor, 2, 'author', true)).resolves.toEqual({
      id: 2,
      isAdmin: false,
      hasAuthorRole: true,
    });

    const grant = calls.find((call) => call.method === 'POST');
    expect(grant?.body).toEqual([{ id: 'role-2', name: 'contributor' }]);
    expect(auth.setRole).toHaveBeenCalledWith(2, 'author');
  });

  it('lets an admin remove their own author role — only their admin role is protected', async () => {
    auth.getUserById.mockResolvedValue(signedIn({ id: 1, email: 'boss@example.com' }));
    fakeKeycloak({
      '/role-mappings/realm': [{ id: 'role-1', name: 'admin' }],
      '/users?email=': [{ id: 'kc-1', email: 'boss@example.com' }],
      '/roles/contributor': { id: 'role-2', name: 'contributor' },
    });
    await expect(AdminAccessService.setRole(actor, 1, 'author', false)).resolves.toMatchObject({
      isAdmin: true,
    });
  });

  it('removes admin both as a realm role and as the older client role', async () => {
    auth.getUserById.mockResolvedValue(signedIn({ role: 'admin' }));
    const calls = fakeKeycloak({
      '/role-mappings/realm': [],
      '/users?email=': [{ id: 'kc-2', email: 'ada@example.com' }],
      '/clients/client-uuid/roles/admin': { id: 'client-role', name: 'admin' },
      '/clients?clientId=': [{ id: 'client-uuid' }],
      '/roles/admin': { id: 'role-1', name: 'admin' },
    });

    await AdminAccessService.setRole(actor, 2, 'admin', false);

    const removed = calls.filter((call) => call.method === 'DELETE').map((call) => call.url);
    expect(removed).toEqual([
      expect.stringContaining('/users/kc-2/role-mappings/realm'),
      expect.stringContaining('/users/kc-2/role-mappings/clients/client-uuid'),
    ]);
    expect(auth.setRole).toHaveBeenCalledWith(2, 'user');
  });

  it('leaves somebody an author when admin is removed and they also hold author', async () => {
    auth.getUserById.mockResolvedValue(signedIn({ role: 'admin' }));
    fakeKeycloak({
      '/role-mappings/realm': [{ id: 'role-2', name: 'contributor' }],
      '/users?email=': [{ id: 'kc-2', email: 'ada@example.com' }],
      '/roles/admin': { id: 'role-1', name: 'admin' },
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
  it('lists realm and client role holders together, by lower-cased email', async () => {
    fakeKeycloak({
      '/clients/client-uuid/roles/admin/users': [{ id: 'b', email: 'Old@Example.com' }],
      '/clients?clientId=': [{ id: 'client-uuid' }],
      '/roles/admin/users': [{ id: 'a', email: 'ada@example.com' }],
      '/roles/contributor/users': [{ id: 'c', email: 'cleo@example.com' }],
    });
    expect(await AdminAccessService.roleHolders()).toEqual({
      admins: new Set(['ada@example.com', 'old@example.com']),
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
