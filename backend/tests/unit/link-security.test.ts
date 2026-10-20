/**
 * File: link-security.test.ts
 * Description: Unit tests for hashed assignment links, links to account holders, and the email link base URL.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-16
 */
import { appBaseUrl } from '@/config/app-url';
import AssignmentGateway from '@/gateways/assignment-gateway/assignment-gateway';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import AssignmentService from '@/services/assignment-service/assignment-service';
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

const gateway = AssignmentGateway as jest.Mocked<typeof AssignmentGateway>;
const auth = AuthService as jest.Mocked<typeof AuthService>;
const curriculum = CurriculumGateway as jest.Mocked<typeof CurriculumGateway>;
const quizzes = QuizGateway as jest.Mocked<typeof QuizGateway>;
const email = EmailService as jest.Mocked<typeof EmailService>;

const course = {
  id: 'c1',
  title: 'Fire safety',
  kind: 'LESSON',
  published: true,
  publishedVersion: 1,
  daysRemaining: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  auth.getUserByEmail.mockResolvedValue(null as never);
  auth.getOrCreateUser.mockResolvedValue({ id: 1, email: 'ada@example.com' } as never);
  gateway.findDuplicate.mockResolvedValue(null as never);
  gateway.create.mockImplementation(
    (data) => Promise.resolve({ id: 'a1', dueDate: null, ...data }) as never,
  );
  curriculum.getCourseById.mockResolvedValue(course as never);
  quizzes.findOneTimeQuiz.mockResolvedValue(null as never);
  email.sendAssignmentEmail.mockResolvedValue({ sent: true } as never);
});

describe('assignment links are stored only as hashes', () => {
  it('stores the hash, emails the token, and hands the token back once', async () => {
    const created = await AssignmentService.assign({ email: 'ada@example.com', courseId: 'c1' });

    const stored = gateway.create.mock.calls[0][0];
    expect(stored).not.toHaveProperty('token');
    const sent = email.sendAssignmentEmail.mock.calls[0][0].token;
    expect(stored.tokenHash).toBe(AssignmentService.hashToken(sent));
    expect(created).toMatchObject({ token: sent });
    expect(created).not.toHaveProperty('tokenHash');
  });

  it('looks a link up by the hash of what was presented', async () => {
    gateway.findByTokenHash.mockResolvedValue(null as never);
    await expect(AssignmentService.resolveToken('abc')).rejects.toThrow();
    expect(gateway.findByTokenHash).toHaveBeenCalledWith(AssignmentService.hashToken('abc'));
  });

  it('issues a new link by replacing the hash, so the old link stops working', async () => {
    gateway.findById.mockResolvedValue({ id: 'a1', type: 'LINK' } as never);
    const token = await AssignmentService.issueNewLink('a1');
    expect(gateway.setTokenHash).toHaveBeenCalledWith('a1', AssignmentService.hashToken(token));
  });

  it('has no link to issue for someone who signs in', async () => {
    gateway.findById.mockResolvedValue({ id: 'a1', type: 'PLATFORM' } as never);
    await expect(AssignmentService.issueNewLink('a1')).rejects.toThrow(/signs in/);
  });
});

describe('links and people who have an account', () => {
  it('refuses to send a link to an address that signs in', async () => {
    auth.getUserByEmail.mockResolvedValue({ lastSignInAt: new Date() } as never);
    await expect(
      AssignmentService.assign({ email: 'ada@example.com', courseId: 'c1', type: 'LINK' }),
    ).rejects.toThrow(/has an account/);
    expect(gateway.create).not.toHaveBeenCalled();
  });

  it('keeps an account holder’s notes out of reach of a link', async () => {
    gateway.findByTokenHash.mockResolvedValue({
      id: 'a1',
      type: 'LINK',
      email: 'ada@example.com',
      revokedAt: null,
      expiresAt: null,
      lastAccessedAt: new Date(),
      assignedAt: new Date(),
      course: { id: 'c1', deletedAt: null, published: true },
      courseId: 'c1',
    } as never);
    auth.getOrCreateUser.mockResolvedValue({ id: 1, lastSignInAt: new Date() } as never);

    await expect(AssignmentService.updateNote('tok', 'n1', 'hello')).rejects.toThrow(/sign in/);
    await expect(AssignmentService.deleteNote('tok', 'n1')).rejects.toThrow(/sign in/);
    expect(curriculum.updateNote).not.toHaveBeenCalled();
    expect(curriculum.deleteNote).not.toHaveBeenCalled();
  });
});

describe('appBaseUrl in production', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('never builds links from a request host it was not told to trust', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.APP_BASE_URL;
    delete process.env.APP_ALLOWED_HOSTS;
    expect(appBaseUrl('https://evil.example')).not.toContain('evil.example');
  });

  it('uses an allowed request host', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.APP_BASE_URL;
    process.env.APP_ALLOWED_HOSTS = 'learn.example.com';
    expect(appBaseUrl('https://learn.example.com')).toBe('https://learn.example.com');
  });

  it('prefers APP_BASE_URL over anything the request says', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_BASE_URL = 'https://learn.example.com/';
    expect(appBaseUrl('https://evil.example')).toBe('https://learn.example.com');
  });
});
