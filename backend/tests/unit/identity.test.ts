/**
 * File: identity.test.ts
 * Description: Unit tests for matching a Keycloak sign-in to a user record by its fixed id, not its email.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-16
 */
import AssignmentGateway from '@/gateways/assignment-gateway/assignment-gateway';
import AuthGateway from '@/gateways/auth-gateway/auth-gateway';
import AuthService, {
  IdentityConflictError,
  isErasedEmail,
} from '@/services/auth-service/auth-service';

import { Prisma } from '../../generated/prisma';

jest.mock('@/gateways/auth-gateway/auth-gateway');
jest.mock('@/gateways/assignment-gateway/assignment-gateway');
const gateway = AuthGateway as jest.Mocked<typeof AuthGateway>;
const assignments = AssignmentGateway as jest.Mocked<typeof AssignmentGateway>;

const row = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 7,
    email: 'ada@example.com',
    name: 'Ada',
    keycloakSubject: null,
    lastSignInAt: new Date(),
    ...overrides,
  }) as never;

const claims = (overrides: Record<string, unknown> = {}) => ({
  subject: 'sub-ada',
  email: 'ada@example.com',
  emailVerified: true,
  name: 'Ada',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.REQUIRE_VERIFIED_EMAIL;
  gateway.getUserBySubject.mockResolvedValue(null);
  gateway.getUserByEmail.mockResolvedValue(null);
  gateway.bindSubject.mockImplementation(async (id, keycloakSubject) =>
    row({ id, keycloakSubject }),
  );
  gateway.createUser.mockImplementation(async (data) => row({ id: 99, ...data }));
  gateway.unbindSubject.mockImplementation(async (id) => row({ id, keycloakSubject: null }));
  assignments.moveLinksToPlatform.mockResolvedValue({ count: 0 });
});

describe('resolveSignedInUser — an erased record still bound to the login', () => {
  const erased = () =>
    row({
      id: 5,
      email: 'erased-5-1700000000000@erased.invalid',
      name: null,
      keycloakSubject: 'sub-ada',
      lastSignInAt: null,
    });

  /**
   * Erased before erasure released the binding. With a verified email the old
   * code copied the real address back onto it, handing the erased account back.
   */
  it('releases it and gives them a fresh account instead', async () => {
    gateway.getUserBySubject.mockResolvedValueOnce(erased());

    const user = await AuthService.resolveSignedInUser(claims());

    expect(gateway.unbindSubject).toHaveBeenCalledWith(5);
    expect(gateway.setEmail).not.toHaveBeenCalled();
    expect(gateway.createUser).toHaveBeenCalledWith({
      email: 'ada@example.com',
      name: 'Ada',
      keycloakSubject: 'sub-ada',
    });
    expect(user).toMatchObject({ id: 99, email: 'ada@example.com' });
  });

  /** Without a verified email the old code left them signed in as the tombstone. */
  it('never leaves them signed in as the tombstone address', async () => {
    gateway.getUserBySubject.mockResolvedValueOnce(erased());

    const user = await AuthService.resolveSignedInUser(claims({ emailVerified: false }));

    expect(user.email).toBe('ada@example.com');
  });

  it('recognises only the tombstone domain as erased', () => {
    expect(isErasedEmail('erased-5-1@ERASED.invalid')).toBe(true);
    expect(isErasedEmail('ada@example.com')).toBe(false);
    expect(isErasedEmail('ada@erased.invalid.example.com')).toBe(false);
  });
});

describe('resolveSignedInUser — work sent by link before they had an account', () => {
  it('moves it onto the account on a first sign-in', async () => {
    gateway.getUserByEmail.mockResolvedValue(row({ lastSignInAt: null }));
    gateway.bindSubject.mockImplementation(async (id, keycloakSubject) =>
      row({ id, keycloakSubject, lastSignInAt: null }),
    );

    await AuthService.resolveSignedInUser(claims());

    expect(assignments.moveLinksToPlatform).toHaveBeenCalledWith('ada@example.com');
  });

  it('moves it for a brand-new account too', async () => {
    gateway.createUser.mockImplementation(async (data) =>
      row({ id: 99, ...data, lastSignInAt: null }),
    );

    await AuthService.resolveSignedInUser(claims());

    expect(assignments.moveLinksToPlatform).toHaveBeenCalledWith('ada@example.com');
  });

  /** After the first sign-in every request would otherwise pay for a pointless write. */
  it('leaves it alone for somebody who has signed in before', async () => {
    gateway.getUserBySubject.mockResolvedValue(row({ keycloakSubject: 'sub-ada' }));

    await AuthService.resolveSignedInUser(claims());

    expect(assignments.moveLinksToPlatform).not.toHaveBeenCalled();
  });
});

describe('resolveSignedInUser', () => {
  it('finds a returning user by their Keycloak id, whatever email the token carries', async () => {
    gateway.getUserBySubject.mockResolvedValue(row({ keycloakSubject: 'sub-ada' }));
    const user = await AuthService.resolveSignedInUser(
      claims({ email: 'someone-else@example.com', emailVerified: false }),
    );
    // Kept on their own address: an unverified email change moves nothing.
    expect(user.email).toBe('ada@example.com');
    expect(gateway.setEmail).not.toHaveBeenCalled();
  });

  it('carries over a verified email change when nobody else has that address', async () => {
    gateway.getUserBySubject.mockResolvedValue(row({ keycloakSubject: 'sub-ada' }));
    gateway.setEmail.mockResolvedValue(row({ email: 'ada@new.example.com' }));
    await AuthService.resolveSignedInUser(claims({ email: 'ADA@new.example.com' }));
    expect(gateway.setEmail).toHaveBeenCalledWith(7, 'ada@new.example.com');
  });

  it('never moves a user onto an address another record already has', async () => {
    gateway.getUserBySubject.mockResolvedValue(row({ keycloakSubject: 'sub-ada' }));
    gateway.getUserByEmail.mockResolvedValue(row({ id: 8, email: 'boss@example.com' }));
    await AuthService.resolveSignedInUser(claims({ email: 'boss@example.com' }));
    expect(gateway.setEmail).not.toHaveBeenCalled();
  });

  it('refuses an email that belongs to a different Keycloak account', async () => {
    gateway.getUserByEmail.mockResolvedValue(row({ keycloakSubject: 'sub-original' }));
    await expect(
      AuthService.resolveSignedInUser(claims({ subject: 'sub-impostor' })),
    ).rejects.toBeInstanceOf(IdentityConflictError);
    expect(gateway.bindSubject).not.toHaveBeenCalled();
  });

  it('binds an existing, unclaimed record to the account on first sign-in', async () => {
    gateway.getUserByEmail.mockResolvedValue(row());
    await AuthService.resolveSignedInUser(claims());
    expect(gateway.bindSubject).toHaveBeenCalledWith(7, 'sub-ada');
  });

  it('creates a new user bound to the account', async () => {
    await AuthService.resolveSignedInUser(claims({ email: 'New@Example.com' }));
    expect(gateway.createUser).toHaveBeenCalledWith({
      email: 'new@example.com',
      name: 'Ada',
      keycloakSubject: 'sub-ada',
    });
  });

  describe('a never-signed-in record claimed with an unverified email', () => {
    beforeEach(() => gateway.getUserByEmail.mockResolvedValue(row({ lastSignInAt: null })));

    it('is refused when REQUIRE_VERIFIED_EMAIL is on', async () => {
      process.env.REQUIRE_VERIFIED_EMAIL = 'true';
      await expect(
        AuthService.resolveSignedInUser(claims({ emailVerified: false })),
      ).rejects.toThrow(/verify your email/i);
      expect(gateway.bindSubject).not.toHaveBeenCalled();
    });

    it('is allowed while it is off, so realms without verification still work', async () => {
      await AuthService.resolveSignedInUser(claims({ emailVerified: false }));
      expect(gateway.bindSubject).toHaveBeenCalled();
    });
  });
});

describe('resolveSignedInUser — several requests on one first sign-in', () => {
  const duplicate = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });

  /**
   * The app makes several calls the moment somebody first lands, and each finds
   * no row. The ones that lose the insert used to fail as a 401 — which, when
   * the loser was the first-login tour's request, meant the tour never started.
   */
  it('hands a request that lost the insert the row the winner wrote', async () => {
    gateway.createUser.mockRejectedValue(duplicate());
    gateway.getUserBySubject
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row({ id: 42, keycloakSubject: 'sub-ada' }));

    const user = await AuthService.resolveSignedInUser(claims());

    expect(user).toMatchObject({ id: 42 });
  });

  /**
   * The other side of that race: the subject lookup misses, then the winner
   * commits, then the email lookup finds the winner's row. That row is theirs,
   * so refusing it as an unverified claim would lock them out of their own account.
   */
  it('hands over its own new row, unverified, with REQUIRE_VERIFIED_EMAIL on', async () => {
    process.env.REQUIRE_VERIFIED_EMAIL = 'true';
    gateway.getUserByEmail.mockResolvedValue(
      row({ id: 42, keycloakSubject: 'sub-ada', lastSignInAt: null }),
    );

    const user = await AuthService.resolveSignedInUser(claims({ emailVerified: false }));

    expect(user).toMatchObject({ id: 42 });
    expect(gateway.bindSubject).not.toHaveBeenCalled();
  });

  it('still fails on any other database error', async () => {
    gateway.createUser.mockRejectedValue(new Error('connection lost'));

    await expect(AuthService.resolveSignedInUser(claims())).rejects.toThrow('connection lost');
  });

  /** A duplicate with no row behind it is not a race; it is a real conflict. */
  it('fails when the duplicate is not the same person', async () => {
    gateway.createUser.mockRejectedValue(duplicate());

    await expect(AuthService.resolveSignedInUser(claims())).rejects.toThrow(
      'Unique constraint failed',
    );
  });
});
