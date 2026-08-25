/**
 * File: notification-and-people.test.ts
 * Description: Unit tests for email composition and delivery, new-content
 *   announcements, learner insights, enrolment scoping and privacy actions.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import AssignmentGateway from '@/gateways/assignment-gateway/assignment-gateway';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import AuthService from '@/services/auth-service/auth-service';
import EmailService from '@/services/email-service/email-service';
import EnrolmentService from '@/services/enrolment-service/enrolment-service';
import InsightsService from '@/services/insights-service/insights-service';
import NotificationService from '@/services/notification-service/notification-service';
import PublicationService from '@/services/publication-service/publication-service';

jest.mock('@/gateways/assignment-gateway/assignment-gateway');
jest.mock('@/gateways/curriculum-gateway/curriculum-gateway');
jest.mock('@/gateways/quiz-gateway/quiz-gateway');
jest.mock('@/gateways/auth-gateway/auth-gateway');
jest.mock('@/services/auth-service/auth-service');
jest.mock('@/services/publication-service/publication-service');

const assignments = AssignmentGateway as jest.Mocked<typeof AssignmentGateway>;
const curriculum = CurriculumGateway as jest.Mocked<typeof CurriculumGateway>;
const quizzes = QuizGateway as jest.Mocked<typeof QuizGateway>;
const auth = AuthService as jest.Mocked<typeof AuthService>;
const publications = PublicationService as jest.Mocked<typeof PublicationService>;

// No mail credentials in a unit run, so `deliver` takes the "log it" path and
// never opens an SMTP connection. That is the behaviour under test for most of these.
delete process.env.EMAIL_USER;
delete process.env.EMAIL_APP_PASSWORD;

describe('EmailService — assignment messages', () => {
  it('never throws when there are no credentials', async () => {
    const result = await EmailService.sendAssignmentEmail({
      to: 'ada@example.com',
      type: 'LINK',
      title: 'Fire safety',
      kind: 'course',
      token: 'a-very-long-token-value-here',
      dueDate: null,
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/not configured/);
  });

  /**
   * The two kinds of assignment say genuinely different things, and getting
   * them the wrong way round would either post a private link to someone who
   * should sign in, or tell a link holder to sign in to an account they do not
   * have.
   */
  it('tells a PLATFORM recipient to sign in, without sending a token', async () => {
    const logged: string[] = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      logged.push(String(chunk));
      return true;
    });

    await EmailService.sendAssignmentEmail({
      to: 'ada@example.com',
      type: 'PLATFORM',
      title: 'Fire safety',
      kind: 'course',
      token: 'secret-token-value-should-not-appear',
      dueDate: null,
    });

    jest.restoreAllMocks();
    const output = logged.join('');
    expect(output).not.toContain('secret-token-value-should-not-appear');
  });

  it('reports nothing to send when a new-content message has no items', async () => {
    const result = await EmailService.sendNewContentEmail({
      to: 'ada@example.com',
      courseId: 'c1',
      courseTitle: 'Fire safety',
      items: [],
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/Nothing new/);
  });

  it('accepts a well-formed new-content message', async () => {
    const result = await EmailService.sendNewContentEmail({
      to: 'ada@example.com',
      courseId: 'c1',
      courseTitle: 'Fire safety',
      items: [{ kind: 'section', number: '2.3', title: 'Extinguishers', module: '2. Equipment' }],
    });

    // Not configured, so not sent — but composed without throwing.
    expect(result.sent).toBe(false);
  });
});

describe('NotificationService.newItemsSince', () => {
  it('lists sections added since a moment', async () => {
    curriculum.getSectionsAddedSince.mockResolvedValue([
      { id: 'm2', number: '2.1', title: 'New section', module: { number: 2, title: 'Equipment' } },
    ] as never);
    curriculum.getQuizzesAddedSince.mockResolvedValue([] as never);

    const items = await NotificationService.newItemsSince('c1', new Date('2026-01-01'));

    expect(items).toEqual([
      { kind: 'section', number: '2.1', title: 'New section', module: '2. Equipment' },
    ]);
  });

  /**
   * A quiz inside a section that is itself new would be listed twice over — the
   * section line already covers it.
   */
  it('omits a quiz whose section is also new', async () => {
    curriculum.getSectionsAddedSince.mockResolvedValue([
      { id: 'm2', number: '2.1', title: 'New section', module: { number: 2, title: 'Equipment' } },
    ] as never);
    curriculum.getQuizzesAddedSince.mockResolvedValue([
      {
        id: 'q1',
        title: 'New quiz',
        section: { id: 'm2', number: '2.1', module: { number: 2, title: 'Equipment' } },
      },
    ] as never);

    const items = await NotificationService.newItemsSince('c1', new Date('2026-01-01'));
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('section');
  });

  it('includes a quiz added to an existing section', async () => {
    curriculum.getSectionsAddedSince.mockResolvedValue([] as never);
    curriculum.getQuizzesAddedSince.mockResolvedValue([
      {
        id: 'q1',
        title: 'New quiz',
        section: { id: 'm1', number: '1.1', module: { number: 1, title: 'Intro' } },
      },
    ] as never);

    const items = await NotificationService.newItemsSince('c1', new Date('2026-01-01'));
    expect(items).toEqual([{ kind: 'quiz', number: '1.1', title: 'New quiz', module: '1. Intro' }]);
  });

  it('labels a section with no module as ungrouped rather than crashing', async () => {
    curriculum.getSectionsAddedSince.mockResolvedValue([
      { id: 'm2', number: '2.1', title: 'Orphan', module: null },
    ] as never);
    curriculum.getQuizzesAddedSince.mockResolvedValue([] as never);

    const items = await NotificationService.newItemsSince('c1', new Date('2026-01-01'));
    expect(items[0].module).toBe('Ungrouped');
  });
});

describe('NotificationService.announceNewContent', () => {
  it('says nothing about a draft course — nobody can have finished it', async () => {
    curriculum.getCourseById.mockResolvedValue({ published: false, deletedAt: null } as never);

    await NotificationService.announceNewContent('c1');
    expect(curriculum.getCompletionsForCourse).not.toHaveBeenCalled();
  });

  it('says nothing about a deleted course', async () => {
    curriculum.getCourseById.mockResolvedValue({
      published: true,
      deletedAt: new Date(),
    } as never);

    await NotificationService.announceNewContent('c1');
    expect(curriculum.getCompletionsForCourse).not.toHaveBeenCalled();
  });

  /**
   * An author building out a module adds five sections in five minutes; without
   * a quiet period that is five emails about the same course.
   */
  it('skips a learner still inside the quiet period', async () => {
    curriculum.getCourseById.mockResolvedValue({
      published: true,
      deletedAt: null,
      title: 'Fire safety',
    } as never);
    curriculum.getCompletionsForCourse.mockResolvedValue([
      {
        id: 'comp-1',
        completedAt: new Date('2026-01-01'),
        notifiedAt: new Date(),
        user: { email: 'ada@example.com' },
      },
    ] as never);

    await NotificationService.announceNewContent('c1');

    expect(curriculum.getSectionsAddedSince).not.toHaveBeenCalled();
    expect(curriculum.markCompletionNotified).not.toHaveBeenCalled();
  });

  /** A mail outage must never turn into a failed save. */
  it('never throws when something downstream fails', async () => {
    curriculum.getCourseById.mockRejectedValue(new Error('database away'));
    await expect(NotificationService.announceNewContent('c1')).resolves.toBeUndefined();
  });
});

describe('EnrolmentService', () => {
  /**
   * A LINK assignment is delivered as a URL and is meant to stay outside the
   * platform — being sent one must never add the course to a Learning page.
   */
  it('reads only PLATFORM assignments', async () => {
    assignments.listPlatformForEmail.mockResolvedValue([
      { courseId: 'c1', quizId: null },
      { courseId: null, quizId: 'q1' },
    ] as never);

    const enrolment = await EnrolmentService.forEmail('Ada@Example.com');

    expect(assignments.listPlatformForEmail).toHaveBeenCalledWith('ada@example.com');
    expect([...enrolment.courseIds]).toEqual(['c1']);
    expect([...enrolment.quizIds]).toEqual(['q1']);
  });

  it('returns empty sets for someone with nothing assigned', async () => {
    assignments.listPlatformForEmail.mockResolvedValue([] as never);

    const enrolment = await EnrolmentService.forEmail('nobody@example.com');
    expect(enrolment.courseIds.size).toBe(0);
    expect(enrolment.quizIds.size).toBe(0);
  });
});

describe('InsightsService', () => {
  beforeEach(() => {
    curriculum.getViewedSectionIds.mockResolvedValue([] as never);
    quizzes.getAttemptsForUser.mockResolvedValue([] as never);
    // The default for these tests is a learner who has been sent no one-time
    // quizzes; the panel that shows them has its own tests below.
    quizzes.getAnsweredAttempts.mockResolvedValue([] as never);
  });

  /**
   * One-time quizzes are filed under the learner rather than under the quiz,
   * because they disappear from the learner's own side the moment they are
   * handed in — this is the only record of what was asked and answered.
   */
  it('reports a completed one-time quiz with the paper', async () => {
    assignments.listAll.mockResolvedValue([
      {
        email: 'ada@example.com',
        courseId: null,
        assignedAt: new Date(),
        dueDate: null,
        revokedAt: null,
        lastAccessedAt: null,
      },
    ] as never);
    auth.getUserByEmail.mockResolvedValue({
      id: 1,
      email: 'ada@example.com',
      name: 'Ada',
      lastSignInAt: new Date(),
    } as never);
    quizzes.getAnsweredAttempts.mockResolvedValue([
      {
        id: 'attempt-1',
        score: 1,
        total: 2,
        completedAt: new Date('2026-08-01T10:00:00Z'),
        quiz: { id: 'quiz-1', title: 'Induction', type: 'ONE_TIME' },
        answers: [
          {
            questionId: 'q1',
            order: 1,
            prompt: 'Where is the muster point?',
            chosen: ['Car park'],
            correct: ['Car park'],
            wasCorrect: true,
          },
          {
            questionId: 'q2',
            order: 2,
            prompt: 'Who do you report to?',
            chosen: ['Nobody'],
            correct: ['Site manager'],
            wasCorrect: false,
          },
        ],
      },
    ] as never);

    const [learner] = await InsightsService.listLearners(null);

    expect(learner.oneTimeQuizzes).toHaveLength(1);
    const [paper] = learner.oneTimeQuizzes;
    expect(paper.title).toBe('Induction');
    // 1 of 2 is 50%, and the percentage is worked out here rather than stored.
    expect(paper.percent).toBe(50);
    expect(paper.answers.map((answer) => answer.wasCorrect)).toEqual([true, false]);
    expect(paper.answers[1].correct).toEqual(['Site manager']);
  });

  it('reports no papers for someone who has never been sent one', async () => {
    assignments.listAll.mockResolvedValue([
      {
        email: 'ada@example.com',
        courseId: null,
        assignedAt: new Date(),
        dueDate: null,
        revokedAt: null,
        lastAccessedAt: null,
      },
    ] as never);
    auth.getUserByEmail.mockResolvedValue({
      id: 1,
      email: 'ada@example.com',
      name: 'Ada',
      lastSignInAt: new Date(),
    } as never);

    const [learner] = await InsightsService.listLearners(null);
    expect(learner.oneTimeQuizzes).toEqual([]);
  });

  it('returns nothing when nobody has been assigned anything', async () => {
    assignments.listAll.mockResolvedValue([] as never);
    expect(await InsightsService.listLearners(null)).toEqual([]);
  });

  /**
   * Someone can hold work before they have an account, so grouping by address
   * rather than by user row is what stops them appearing as two people.
   */
  it('groups a learner by email regardless of case', async () => {
    assignments.listAll.mockResolvedValue([
      {
        email: 'Ada@Example.com',
        courseId: 'c1',
        assignedAt: new Date(),
        dueDate: null,
        revokedAt: null,
        lastAccessedAt: null,
      },
      {
        email: 'ada@example.com',
        courseId: 'c2',
        assignedAt: new Date(),
        dueDate: null,
        revokedAt: null,
        lastAccessedAt: null,
      },
    ] as never);
    auth.getUserByEmail.mockResolvedValue({ id: 1, name: 'Ada', lastSignInAt: null } as never);
    publications.getLiveSnapshot.mockResolvedValue(null);
    curriculum.getCourseById.mockResolvedValue(null as never);

    const learners = await InsightsService.listLearners(null);
    expect(learners).toHaveLength(1);
  });

  it('marks someone who has never signed in as having no account', async () => {
    assignments.listAll.mockResolvedValue([
      {
        email: 'new@example.com',
        courseId: 'c1',
        assignedAt: new Date(),
        dueDate: null,
        revokedAt: null,
        lastAccessedAt: null,
      },
    ] as never);
    auth.getUserByEmail.mockResolvedValue({ id: 2, name: null, lastSignInAt: null } as never);
    publications.getLiveSnapshot.mockResolvedValue(null);
    curriculum.getCourseById.mockResolvedValue(null as never);

    const [learner] = await InsightsService.listLearners(null);
    expect(learner.hasAccount).toBe(false);
  });

  /**
   * The average uses the *best* attempt at each quiz, so retaking to improve a
   * score is reflected rather than averaged away by the earlier failures.
   */
  it('averages the best attempt at each quiz, not every attempt', async () => {
    assignments.listAll.mockResolvedValue([
      {
        email: 'ada@example.com',
        courseId: 'c1',
        assignedAt: new Date(),
        dueDate: null,
        revokedAt: null,
        lastAccessedAt: null,
      },
    ] as never);
    auth.getUserByEmail.mockResolvedValue({
      id: 1,
      name: 'Ada',
      lastSignInAt: new Date(),
    } as never);
    publications.getLiveSnapshot.mockResolvedValue({
      title: 'Fire safety',
      imageData: null,
      imageType: null,
      sections: [{ id: 'm1', quizzes: [{ id: 'q1' }] }],
    } as never);
    curriculum.getCourseById.mockResolvedValue({ dueDate: null } as never);
    curriculum.getViewedSectionIds.mockResolvedValue([
      { sectionId: 'm1', viewedAt: new Date() },
    ] as never);
    quizzes.getAttemptsForUser.mockResolvedValue([
      { quizId: 'q1', score: 2, total: 10, completedAt: new Date() },
      { quizId: 'q1', score: 9, total: 10, completedAt: new Date() },
    ] as never);

    const [learner] = await InsightsService.listLearners(null);

    expect(learner.courses[0].averageScore).toBe(90);
    expect(learner.courses[0].attemptedQuizzes).toBe(1);
  });

  it('reports null rather than zero when there are no attempts yet', async () => {
    assignments.listAll.mockResolvedValue([
      {
        email: 'ada@example.com',
        courseId: 'c1',
        assignedAt: new Date(),
        dueDate: null,
        revokedAt: null,
        lastAccessedAt: null,
      },
    ] as never);
    auth.getUserByEmail.mockResolvedValue({
      id: 1,
      name: 'Ada',
      lastSignInAt: new Date(),
    } as never);
    publications.getLiveSnapshot.mockResolvedValue({
      title: 'Fire safety',
      imageData: null,
      imageType: null,
      sections: [{ id: 'm1', quizzes: [] }],
    } as never);
    curriculum.getCourseById.mockResolvedValue({ dueDate: null } as never);

    const [learner] = await InsightsService.listLearners(null);
    expect(learner.courses[0].averageScore).toBeNull();
  });

  /** Assigned but never published means there is nothing to measure against. */
  it('omits a course that has never been published', async () => {
    assignments.listAll.mockResolvedValue([
      {
        email: 'ada@example.com',
        courseId: 'c1',
        assignedAt: new Date(),
        dueDate: null,
        revokedAt: null,
        lastAccessedAt: null,
      },
    ] as never);
    auth.getUserByEmail.mockResolvedValue({
      id: 1,
      name: 'Ada',
      lastSignInAt: new Date(),
    } as never);
    publications.getLiveSnapshot.mockResolvedValue(null);
    curriculum.getCourseById.mockResolvedValue(null as never);

    const [learner] = await InsightsService.listLearners(null);
    expect(learner.courses).toEqual([]);
    expect(learner.overallPercent).toBe(0);
  });

  it('returns null for a learner who holds nothing the caller assigned', async () => {
    assignments.listAll.mockResolvedValue([] as never);
    expect(await InsightsService.getLearner('nobody@example.com', 5)).toBeNull();
  });

  /**
   * Addresses are matched without regard to case, because an assignment is
   * keyed on whatever was typed into the box and "Ada@Example.com" is the same
   * person as "ada@example.com". Only the null path was covered before, so a
   * lookup that stopped finding anyone would have gone unnoticed.
   */
  it('finds a learner whose address was typed in a different case', async () => {
    assignments.listAll.mockResolvedValue([
      {
        email: 'Ada@Example.com',
        courseId: null,
        assignedAt: new Date(),
        dueDate: null,
        revokedAt: null,
        lastAccessedAt: null,
      },
    ] as never);
    auth.getUserByEmail.mockResolvedValue({
      id: 1,
      email: 'ada@example.com',
      name: 'Ada',
      lastSignInAt: new Date(),
    } as never);

    const learner = await InsightsService.getLearner('ADA@example.com', 5);

    expect(learner).not.toBeNull();
    expect(learner!.email).toBe('ada@example.com');
  });
});
