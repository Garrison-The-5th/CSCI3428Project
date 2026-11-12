/**
 * File: central-profile.test.ts
 * Description: Unit tests for giving a person a central profile on their first sign-in, and only then.
 * Author: rware <rware@ttgteams.com>
 * Date: 2026-11-10
 */
import AuthGateway from '@/gateways/auth-gateway/auth-gateway';
import CentralProfileGateway, {
  CentralProfileError,
} from '@/gateways/central-profile-gateway/central-profile-gateway';
import AuthService from '@/services/auth-service/auth-service';

jest.mock('@/gateways/auth-gateway/auth-gateway');
jest.mock('@/gateways/central-profile-gateway/central-profile-gateway', () => {
  const actual = jest.requireActual('@/gateways/central-profile-gateway/central-profile-gateway');
  return {
    ...actual,
    __esModule: true,
    default: { resolvePerson: jest.fn() },
  };
});

const gateway = AuthGateway as jest.Mocked<typeof AuthGateway>;
const central = CentralProfileGateway as jest.Mocked<typeof CentralProfileGateway>;

const row = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 7,
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    keycloakSubject: null,
    lastSignInAt: new Date(),
    ...overrides,
  }) as never;

const claims = (overrides: Record<string, unknown> = {}) => ({
  subject: 'sub-ada',
  email: 'ada@example.com',
  emailVerified: true,
  name: 'Ada Lovelace',
  givenName: 'Ada',
  familyName: 'Lovelace',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  gateway.getUserBySubject.mockResolvedValue(null);
  gateway.getUserByEmail.mockResolvedValue(null);
  gateway.createUser.mockImplementation(async (data) => row({ id: 99, ...data }));
  gateway.bindSubject.mockImplementation(async (id, keycloakSubject) =>
    row({ id, keycloakSubject }),
  );
  central.resolvePerson.mockResolvedValue(true);
});

describe('central profile on first sign-in', () => {
  it('resolves a brand-new person before their row is made', async () => {
    await AuthService.resolveSignedInUser(claims());

    expect(central.resolvePerson).toHaveBeenCalledWith({
      keycloak_id: 'sub-ada',
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.com',
    });
    expect(central.resolvePerson.mock.invocationCallOrder[0]).toBeLessThan(
      gateway.createUser.mock.invocationCallOrder[0],
    );
  });

  it('resolves someone claiming a row made by an assignment', async () => {
    gateway.getUserByEmail.mockResolvedValue(row());

    await AuthService.resolveSignedInUser(claims());

    expect(central.resolvePerson).toHaveBeenCalledTimes(1);
    expect(gateway.bindSubject).toHaveBeenCalled();
  });

  it('does not call central for a returning user', async () => {
    gateway.getUserBySubject.mockResolvedValue(row({ keycloakSubject: 'sub-ada' }));

    await AuthService.resolveSignedInUser(claims());

    expect(central.resolvePerson).not.toHaveBeenCalled();
  });

  it('sends a Workspace address as the work email', async () => {
    await AuthService.resolveSignedInUser(claims({ email: 'Ada@TTGteams.com' }));

    expect(central.resolvePerson).toHaveBeenCalledWith(
      expect.objectContaining({ work_email: 'ada@ttgteams.com' }),
    );
    expect(central.resolvePerson.mock.calls[0][0]).not.toHaveProperty('email');
  });

  it('falls back to the full name, then the mailbox, when the token has no given name', async () => {
    await AuthService.resolveSignedInUser(
      claims({ givenName: undefined, familyName: undefined, name: 'Ada King Lovelace' }),
    );
    expect(central.resolvePerson).toHaveBeenLastCalledWith(
      expect.objectContaining({ first_name: 'Ada', last_name: 'King Lovelace' }),
    );

    await AuthService.resolveSignedInUser(
      claims({ givenName: undefined, familyName: undefined, name: undefined }),
    );
    expect(central.resolvePerson).toHaveBeenLastCalledWith(
      expect.objectContaining({ first_name: 'ada', last_name: '-' }),
    );
  });

  it('lets the sign-in through when central says the email is taken', async () => {
    central.resolvePerson.mockRejectedValue(new CentralProfileError('taken', 409));

    const user = await AuthService.resolveSignedInUser(claims());

    expect(user).toMatchObject({ id: 99 });
  });

  it('fails the sign-in without writing a row when central is down', async () => {
    central.resolvePerson.mockRejectedValue(new CentralProfileError('down', 503));

    await expect(AuthService.resolveSignedInUser(claims())).rejects.toThrow('down');
    expect(gateway.createUser).not.toHaveBeenCalled();
  });
});
