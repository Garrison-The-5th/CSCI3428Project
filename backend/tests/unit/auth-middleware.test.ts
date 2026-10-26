/**
 * File: auth-middleware.test.ts
 * Description: Unit tests for token checks in a shared realm — the realm's own keys, its issuer, this app's client, and client roles only.
 * Author: rware <rware@ttgteams.com>
 * Date: 2026-10-23
 */
import { generateKeyPairSync } from 'node:crypto';

import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';

import type { AuthenticatedRequest } from '@/controllers/auth-controller/auth-middleware';
import AuthService from '@/services/auth-service/auth-service';

jest.mock('@/services/auth-service/auth-service');
jest.mock('@/services/admin-access-service/admin-access-service');

const ISSUER = 'https://auth.example.com/realms/central';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const realmKeys = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig' }] };

let authenticateAndAttachUser: (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

const realFetch = global.fetch;
/** Every URL the middleware fetched — kept by hand, since Jest clears mock calls per test. */
const fetched: string[] = [];
beforeAll(() => {
  // Deployed, no key is pinned: the realm's published keys are used.
  delete process.env.PUBLICKEY;
  process.env.KEYCLOAK_URL = 'https://auth.example.com';
  process.env.KEYCLOAK_REALM = 'central';
  process.env.KEYCLOAK_CLIENT_ID = 'learning-client';
  global.fetch = (async (input: string | URL | Request) => {
    fetched.push(String(input));
    return new Response(JSON.stringify(realmKeys));
  }) as typeof fetch;
  jest.isolateModules(() => {
    ({ authenticateAndAttachUser } = jest.requireActual(
      '@/controllers/auth-controller/auth-middleware',
    ));
  });
});
afterAll(() => {
  global.fetch = realFetch;
  process.env.PUBLICKEY = 'unit-test-public-key';
  delete process.env.KEYCLOAK_URL;
  delete process.env.KEYCLOAK_REALM;
  delete process.env.KEYCLOAK_CLIENT_ID;
});

beforeEach(() => {
  jest.mocked(AuthService.resolveSignedInUser).mockResolvedValue({ id: 7 } as never);
});

const token = (claims: Record<string, unknown>, issuer = ISSUER) =>
  jwt.sign(
    { azp: 'learning-client', email: 'ada@example.com', sub: 'sub-ada', ...claims },
    privateKey,
    { algorithm: 'RS256', keyid: 'k1', issuer, expiresIn: 60 },
  );

/** Runs the middleware; answers the status it sent, or 'next' and the claims it attached. */
async function check(bearer: string) {
  const req = { headers: { authorization: `Bearer ${bearer}` }, path: '/x', method: 'GET' };
  let status = 0;
  const res = {
    status: (code: number) => {
      status = code;
      return res;
    },
    send: () => res,
  };
  let passed = false;
  await authenticateAndAttachUser(req as never, res as never, () => {
    passed = true;
  });
  return { passed, status, auth: (req as AuthenticatedRequest).auth };
}

describe('authenticateAndAttachUser in a shared realm', () => {
  it("counts only roles on this app's client", async () => {
    const result = await check(
      token({
        realm_access: { roles: ['admin'] },
        resource_access: {
          'learning-client': { roles: ['contributor'] },
          'other-app': { roles: ['admin'] },
        },
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.auth?.roles).toEqual(['contributor']);
  });

  it('gives a realm-wide admin no role here', async () => {
    const result = await check(token({ realm_access: { roles: ['admin', 'contributor'] } }));
    expect(result.passed).toBe(true);
    expect(result.auth?.roles).toEqual([]);
  });

  it("refuses a token issued to another of the realm's apps", async () => {
    const result = await check(token({ azp: 'other-app' }));
    expect(result).toMatchObject({ passed: false, status: 401 });
  });

  it('refuses a token from another realm', async () => {
    const result = await check(token({}, 'https://auth.example.com/realms/elsewhere'));
    expect(result).toMatchObject({ passed: false, status: 401 });
  });

  it('refuses a token signed with a key the realm does not publish', async () => {
    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const forged = jwt.sign(
      { azp: 'learning-client', email: 'ada@example.com', sub: 'sub-ada' },
      stranger,
      { algorithm: 'RS256', keyid: 'k1', issuer: ISSUER, expiresIn: 60 },
    );
    expect(await check(forged)).toMatchObject({ passed: false, status: 401 });
  });

  it("fetches the realm's keys from Keycloak rather than needing one pinned", async () => {
    expect(fetched).toEqual([
      'https://auth.example.com/realms/central/protocol/openid-connect/certs',
    ]);
  });
});
