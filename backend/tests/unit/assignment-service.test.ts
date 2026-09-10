/**
 * File: assignment-service.test.ts
 * Description: Unit tests for token generation, assignment type selection,
 *   resend throttling and link failure reasons.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import { dueDateFromDays } from '@/config/validation';
import AssignmentGateway from '@/gateways/assignment-gateway/assignment-gateway';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import AssignmentService, {
  AssignmentError,
  LINK_IDLE_TIMEOUT_MS,
} from '@/services/assignment-service/assignment-service';
import AuthService from '@/services/auth-service/auth-service';
import EmailService from '@/services/email-service/email-service';

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
const mockCurriculum = CurriculumGateway as jest.Mocked<typeof CurriculumGateway>;
const mockQuiz = QuizGateway as jest.Mocked<typeof QuizGateway>;
const mockEmail = EmailService as jest.Mocked<typeof EmailService>;

/**
 * Assigning something a learner could not open.
 *
 * `resolveToken` turns unpublished content into "This training is not available
 * right now", and nothing used to stop a link being minted and mailed for
 * exactly that — so the author heard nothing and the recipient opened a dead
 * end. It was found on a one-time link, which is where it bites hardest: a quiz
 * is a draft until somebody publishes it, and a link is the only way in, so the
 * first one ever sent was the first chance to notice.
 */
describe('assign — refuses to send a link to a dead end', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.getUserByEmail.mockResolvedValue(null as never);
    mockAuth.getOrCreateUser.mockResolvedValue({ id: 1, email: 'ada@example.com' } as never);
    mockGateway.findDuplicate.mockResolvedValue(null as never);
    mockGateway.create.mockResolvedValue({ id: 'a1', token: 'tok', dueDate: null } as never);
    mockQuiz.findOneTimeQuiz.mockResolvedValue(null as never);
    mockEmail.sendAssignmentEmail.mockResolvedValue({ sent: true } as never);
  });

  const publishedCourse = {
    id: 'course-1',
    title: 'Fire safety',
    kind: 'QUIZ_SET',
    published: true,
    publishedVersion: 2,
  };

  it('refuses a course that is still a draft', async () => {
    mockCurriculum.getCourseById.mockResolvedValue({
      ...publishedCourse,
      published: false,
    } as never);

    await expect(
      AssignmentService.assign({ email: 'ada@example.com', courseId: 'course-1' }),
    ).rejects.toThrow(/still a draft/);
    expect(mockGateway.create).not.toHaveBeenCalled();
    expect(mockEmail.sendAssignmentEmail).not.toHaveBeenCalled();
  });

  /**
   * Publishing is versioned, so the flag alone is not enough: with no version
   * behind it the snapshot is empty and the link opens nothing — which looks
   * like it worked, and is worse than a refusal.
   */
  it('refuses a course flagged published but never actually published', async () => {
    mockCurriculum.getCourseById.mockResolvedValue({
      ...publishedCourse,
      publishedVersion: 0,
    } as never);

    await expect(
      AssignmentService.assign({ email: 'ada@example.com', courseId: 'course-1' }),
    ).rejects.toThrow(/no published version/);
    expect(mockGateway.create).not.toHaveBeenCalled();
  });

  it('refuses a quiz that is still a draft', async () => {
    mockQuiz.getQuizById.mockResolvedValue({
      id: 'quiz-1',
      title: 'Assessment',
      type: 'ONE_TIME',
      published: false,
    } as never);

    await expect(
      AssignmentService.assign({ email: 'ada@example.com', quizId: 'quiz-1' }),
    ).rejects.toThrow(/still a draft/);
    expect(mockGateway.create).not.toHaveBeenCalled();
  });

  /**
   * A one-time link cannot be shared until its set is published, which is the
   * same rule as for anything else — publishing the set is what makes the quiz
   * inside it reachable, so there is no longer a second state to get wrong.
   */
  it('refuses a one-time link whose set is still a draft', async () => {
    mockCurriculum.getCourseById.mockResolvedValue({
      ...publishedCourse,
      published: false,
    } as never);
    mockQuiz.findOneTimeQuiz.mockResolvedValue({
      id: 'quiz-1',
      title: 'Assessment',
      published: true,
    } as never);

    await expect(
      AssignmentService.assign({ email: 'ada@example.com', courseId: 'course-1' }),
    ).rejects.toThrow(/still a draft/);
    expect(mockGateway.create).not.toHaveBeenCalled();
    expect(mockEmail.sendAssignmentEmail).not.toHaveBeenCalled();
  });

  it('sends a published set with a published one-time quiz', async () => {
    mockCurriculum.getCourseById.mockResolvedValue(publishedCourse as never);
    mockQuiz.findOneTimeQuiz.mockResolvedValue({
      id: 'quiz-1',
      title: 'Assessment',
      published: true,
    } as never);

    await expect(
      AssignmentService.assign({ email: 'ada@example.com', courseId: 'course-1' }),
    ).resolves.toBeDefined();
    expect(mockGateway.create).toHaveBeenCalled();
  });

  /**
   * A one-time quiz set is handed over as a link to the course, so the kind
   * would otherwise be chosen from whether the address has signed in — and a
   * colleague with an account would get a platform enrolment: no URL anywhere,
   * and the quiz on their Quizzes tab, which one-time exists to prevent.
   */
  it('always sends a one-time quiz set as a link, even to an existing user', async () => {
    mockAuth.getUserByEmail.mockResolvedValue({ lastSignInAt: new Date() } as never);
    mockCurriculum.getCourseById.mockResolvedValue(publishedCourse as never);
    mockQuiz.findOneTimeQuiz.mockResolvedValue({
      id: 'quiz-1',
      title: 'Assessment',
      published: true,
    } as never);

    await AssignmentService.assign({ email: 'ada@example.com', courseId: 'course-1' });

    expect(mockGateway.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'LINK' }));
  });

  /** An ordinary quiz set is still whatever the address calls for. */
  it('leaves an ordinary set to the usual choice of kind', async () => {
    mockAuth.getUserByEmail.mockResolvedValue({ lastSignInAt: new Date() } as never);
    mockCurriculum.getCourseById.mockResolvedValue(publishedCourse as never);

    await AssignmentService.assign({ email: 'ada@example.com', courseId: 'course-1' });

    expect(mockGateway.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'PLATFORM' }));
  });
});

/**
 * How long a learner gets, and so what date is stamped on their assignment.
 *
 * The deadline belongs to the assignment rather than to the course, which is
 * what lets two people handed the same course a month apart get the same run at
 * it. Where the length comes from is the interesting part: a quiz standing on
 * its own carries one, and a quiz inside a course does not — it is due with the
 * course around it.
 */
describe('assign — where the deadline comes from', () => {
  const course = {
    id: 'course-1',
    title: 'Fire safety',
    kind: 'LESSON',
    published: true,
    publishedVersion: 2,
    daysRemaining: 5,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.getOrCreateUser.mockResolvedValue({ id: 1, email: 'ada@example.com' } as never);
    mockGateway.findDuplicate.mockResolvedValue(null as never);
    // Hands back what it was asked to store, so the assertions can read the
    // date the service actually worked out.
    mockGateway.create.mockImplementation((data) => ({ id: 'a1', ...data }) as never);
    mockQuiz.findOneTimeQuiz.mockResolvedValue(null as never);
    mockEmail.sendAssignmentEmail.mockResolvedValue({ sent: true } as never);
    mockCurriculum.getCourseById.mockResolvedValue(course as never);
  });

  /** Whatever hour the test runs at, the deadline lands at 11:59 PM. */
  it('stamps a date at 11:59 PM rather than a moment', async () => {
    const assignment = await AssignmentService.assign({
      email: 'ada@example.com',
      courseId: 'course-1',
    });

    const due = assignment.dueDate!;
    expect([due.getHours(), due.getMinutes(), due.getSeconds()]).toEqual([23, 59, 0]);
  });

  it('takes an exam inside a course from that course, not from the quiz', async () => {
    mockQuiz.getQuizById.mockResolvedValue({
      id: 'quiz-1',
      title: 'Assessment',
      type: 'EXAM',
      published: true,
      sectionId: 'section-1',
      // Left over from before a quiz in a course stopped owning a deadline. It
      // must not be what the learner is held to.
      daysRemaining: 30,
    } as never);
    mockCurriculum.getSectionById.mockResolvedValue({
      id: 'section-1',
      courseId: 'course-1',
    } as never);

    const assignment = await AssignmentService.assign({
      email: 'ada@example.com',
      quizId: 'quiz-1',
    });

    // The course's five days, not the quiz's thirty.
    expect(assignment.dueDate).toEqual(dueDateFromDays(5));
  });

  it('takes a quiz standing on its own from the quiz', async () => {
    mockQuiz.getQuizById.mockResolvedValue({
      id: 'quiz-2',
      title: 'Solo',
      type: 'EXAM',
      published: true,
      sectionId: null,
      daysRemaining: 3,
    } as never);

    const assignment = await AssignmentService.assign({
      email: 'ada@example.com',
      quizId: 'quiz-2',
    });

    expect(assignment.dueDate).toEqual(dueDateFromDays(3));
  });

  /** One person's deadline can still be set by hand when they need longer. */
  it('lets an explicit length on the request override the course', async () => {
    const assignment = await AssignmentService.assign({
      email: 'ada@example.com',
      courseId: 'course-1',
      daysRemaining: 10,
    });

    expect(assignment.dueDate).toEqual(dueDateFromDays(10));
  });
});

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

  /**
   * A one-time link that closed itself says so, rather than blaming the author
   * for having turned it off. Both are `revokedAt` on purpose — that is what
   * makes the author's on switch work on either — and what tells them apart is
   * having been completed and read.
   */
  it('reports a link that closed itself after its result was read as completed', async () => {
    await expectReason(
      {
        ...baseAssignment,
        revokedAt: new Date(),
        completedAt: new Date(),
        resultsSeenAt: new Date(),
      },
      'completed',
    );
  });

  it('still reports a completed link the author turned off by hand as revoked', async () => {
    await expectReason(
      { ...baseAssignment, revokedAt: new Date(), completedAt: new Date(), resultsSeenAt: null },
      'revoked',
    );
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

/**
 * The life of a one-time link after the paper goes in.
 *
 * It is not shut on the spot: the holder gets one more page load, so reloading —
 * or coming back to the tab — lands on their result rather than on an error
 * about a link that worked a moment ago. The load after that closes it.
 *
 * Counted here rather than in `resolveToken` because this is called once per page
 * load and that runs on every request, of which one page makes several.
 */
describe('getSessionUser — closing a completed one-time link', () => {
  const completedLink = {
    id: 'a1',
    type: 'LINK' as const,
    email: 'ada@example.com',
    token: 'tok',
    courseId: 'course-1',
    quizId: null,
    revokedAt: null,
    expiresAt: null,
    completedAt: new Date(),
    resultsSeenAt: null,
    lastAccessedAt: new Date(),
    assignedAt: new Date(),
    course: { id: 'course-1', deletedAt: null, published: true },
    quiz: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.getOrCreateUser.mockResolvedValue({
      id: 1,
      email: 'ada@example.com',
      name: 'Ada',
    } as never);
  });

  it('lets them back in once, and records that it has been used', async () => {
    mockGateway.findByToken.mockResolvedValue(completedLink as never);

    await expect(AssignmentService.getSessionUser('tok')).resolves.toMatchObject({
      email: 'ada@example.com',
    });
    expect(mockGateway.markResultsSeen).toHaveBeenCalledWith('a1');
    expect(mockGateway.revoke).not.toHaveBeenCalled();
  });

  it('closes the link on the load after that, and turns the switch off', async () => {
    mockGateway.findByToken.mockResolvedValue({
      ...completedLink,
      resultsSeenAt: new Date(),
    } as never);

    await expect(AssignmentService.getSessionUser('tok')).rejects.toMatchObject({
      reason: 'completed',
    });
    // The same state an author's off switch produces, so theirs can undo it.
    expect(mockGateway.revoke).toHaveBeenCalledWith('a1');
  });

  /** A link nobody has finished is left entirely alone. */
  it('does not touch a link that has not been completed', async () => {
    mockGateway.findByToken.mockResolvedValue({ ...completedLink, completedAt: null } as never);

    await AssignmentService.getSessionUser('tok');

    expect(mockGateway.markResultsSeen).not.toHaveBeenCalled();
    expect(mockGateway.revoke).not.toHaveBeenCalled();
  });
});
