/**
 * File: assignment-service.test.ts
 * Description: Unit tests for token generation, assignment type selection,
 *   resend throttling and link failure reasons.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import AssignmentGateway from '@/gateways/assignment-gateway/assignment-gateway';
import AssignmentService, {
  AssignmentError,
  LINK_IDLE_TIMEOUT_MS,
} from '@/services/assignment-service/assignment-service';
import AuthService from '@/services/auth-service/auth-service';

jest.mock('@/gateways/assignment-gateway/assignment-gateway');
jest.mock('@/gateways/curriculum-gateway/curriculum-gateway');
jest.mock('@/gateways/quiz-gateway/quiz-gateway');
jest.mock('@/services/auth-service/auth-service');
jest.mock('@/services/email-service/email-service');
jest.mock('@/services/publication-service/publication-service');
jest.mock('@/services/dashboard-service/dashboard-service');
jest.mock('@/services/quiz-service/quiz-service');

const mockGateway = AssignmentGateway as jest.Mocked<typeof AssignmentGateway>;
const mockAuth = AuthService as jest.Mocked<typeof AuthService>;

describe('generateToken', () => {
  it('produces a 256-bit token', () => {
    const token = AssignmentService.generateToken();
    // 32 random bytes as base64url — 43 characters, unpadded.
    expect(token).toHaveLength(43);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('is URL-safe, so it can be dropped straight into a link', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(AssignmentService.generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => AssignmentService.generateToken()));
    expect(tokens.size).toBe(500);
  });
});

describe('parseType', () => {
  it('defaults to LINK when nothing is specified', () => {
    expect(AssignmentService.parseType(undefined)).toBe('LINK');
    expect(AssignmentService.parseType('')).toBe('LINK');
    expect(AssignmentService.parseType(null)).toBe('LINK');
  });

  it('accepts the two valid values', () => {
    expect(AssignmentService.parseType('LINK')).toBe('LINK');
    expect(AssignmentService.parseType('PLATFORM')).toBe('PLATFORM');
  });

  it('rejects anything else', () => {
    expect(() => AssignmentService.parseType('OTHER')).toThrow(/PLATFORM or LINK/);
  });
});

describe('chooseType', () => {
  /**
   * Having signed in is the tell — not having a name. Not every Keycloak realm
   * sends a name claim, and reading a missing one as "no account" would post
   * private links to people with perfectly good logins.
   */
  it('gives PLATFORM to someone who has signed in', async () => {
    mockAuth.getUserByEmail.mockResolvedValue({
      id: 1,
      email: 'ada@example.com',
      name: null,
      lastSignInAt: new Date(),
    } as never);

    expect(await AssignmentService.chooseType('ada@example.com')).toBe('PLATFORM');
  });

  it('gives LINK to an address that has never signed in', async () => {
    mockAuth.getUserByEmail.mockResolvedValue({
      id: 2,
      email: 'new@example.com',
      name: 'Has A Name',
      lastSignInAt: null,
    } as never);

    expect(await AssignmentService.chooseType('new@example.com')).toBe('LINK');
  });

  it('gives LINK to an address never seen before', async () => {
    mockAuth.getUserByEmail.mockResolvedValue(null);
    expect(await AssignmentService.chooseType('stranger@example.com')).toBe('LINK');
  });
});

describe('checkResendAllowance', () => {
  it('allows the first message', () => {
    const result = AssignmentService.checkResendAllowance({
      notifiedAt: null,
      notifyWindowStart: null,
      notifyCount: 0,
    });

    expect(result.allowed).toBe(true);
    expect(result.nextCount).toBe(1);
  });

  it('refuses inside the cooldown and says when to come back', () => {
    const result = AssignmentService.checkResendAllowance({
      notifiedAt: new Date(Date.now() - 60_000),
      notifyWindowStart: new Date(Date.now() - 60_000),
      notifyCount: 1,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/send again in/);
  });

  it('allows again once the cooldown has passed', () => {
    const sixMinutesAgo = new Date(Date.now() - 6 * 60_000);
    const result = AssignmentService.checkResendAllowance({
      notifiedAt: sixMinutesAgo,
      notifyWindowStart: sixMinutesAgo,
      notifyCount: 1,
    });

    expect(result.allowed).toBe(true);
  });

  it('refuses once the daily cap is spent', () => {
    const anHourAgo = new Date(Date.now() - 60 * 60_000);
    const result = AssignmentService.checkResendAllowance({
      notifiedAt: anHourAgo,
      notifyWindowStart: anHourAgo,
      notifyCount: 5,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/limit/);
  });

  /** Rolling, not a permanent ceiling on how often someone may be reminded. */
  it('starts a fresh window once the old one has lapsed', () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60_000);
    const result = AssignmentService.checkResendAllowance({
      notifiedAt: twoDaysAgo,
      notifyWindowStart: twoDaysAgo,
      notifyCount: 5,
    });

    expect(result.allowed).toBe(true);
    expect(result.nextCount).toBe(1);
  });
});

describe('resolveToken — failure reasons', () => {
  const baseAssignment = {
    id: 'a1',
    type: 'LINK' as const,
    email: 'ada@example.com',
    token: 'tok',
    courseId: 'course-1',
    quizId: null,
    revokedAt: null,
    expiresAt: null,
    lastAccessedAt: new Date(),
    assignedAt: new Date(),
    course: { id: 'course-1', deletedAt: null, published: true },
    quiz: null,
  };

  async function expectReason(assignment: unknown, reason: string) {
    mockGateway.findByToken.mockResolvedValue(assignment as never);
    await expect(AssignmentService.resolveToken('tok')).rejects.toMatchObject({ reason });
  }

  it('reports an empty token as not-found', async () => {
    await expect(AssignmentService.resolveToken('')).rejects.toBeInstanceOf(AssignmentError);
  });

  it('reports an unknown token as not-found', async () => {
    mockGateway.findByToken.mockResolvedValue(null as never);
    await expect(AssignmentService.resolveToken('nope')).rejects.toMatchObject({
      reason: 'not-found',
    });
  });

  /**
   * A PLATFORM token is an internal handle, never mailed out. Anything
   * presenting one is guessing or holding a stale URL.
   */
  it('tells a PLATFORM token holder to sign in', async () => {
    await expectReason({ ...baseAssignment, type: 'PLATFORM' }, 'sign-in');
  });

  it('reports a revoked link', async () => {
    await expectReason({ ...baseAssignment, revokedAt: new Date() }, 'revoked');
  });

  it('reports an expired link', async () => {
    await expectReason({ ...baseAssignment, expiresAt: new Date(Date.now() - 1000) }, 'expired');
  });

  it('reports a link whose course was unpublished as unavailable', async () => {
    await expectReason(
      { ...baseAssignment, course: { ...baseAssignment.course, published: false } },
      'unavailable',
    );
  });

  it('reports a link whose course was deleted as unavailable', async () => {
    await expectReason(
      { ...baseAssignment, course: { ...baseAssignment.course, deletedAt: new Date() } },
      'unavailable',
    );
  });

  /** §3.2.2 — sessions must time out after inactivity. */
  it('closes a link that has sat unused past the idle timeout', async () => {
    await expectReason(
      {
        ...baseAssignment,
        lastAccessedAt: new Date(Date.now() - LINK_IDLE_TIMEOUT_MS - 60_000),
      },
      'idle',
    );
  });

  it('measures idleness from assignment when the link was never opened', async () => {
    await expectReason(
      {
        ...baseAssignment,
        lastAccessedAt: null,
        assignedAt: new Date(Date.now() - LINK_IDLE_TIMEOUT_MS - 60_000),
      },
      'idle',
    );
  });

  it('accepts a link used recently', async () => {
    mockGateway.findByToken.mockResolvedValue(baseAssignment as never);
    mockGateway.touch.mockResolvedValue({} as never);
    mockAuth.getOrCreateUser.mockResolvedValue({ id: 5, email: 'ada@example.com' } as never);

    const { user } = await AssignmentService.resolveToken('tok');
    expect(user.id).toBe(5);
    expect(mockGateway.touch).toHaveBeenCalledWith('a1');
  });
});
