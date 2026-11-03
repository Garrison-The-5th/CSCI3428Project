/**
 * File: default-tutorial.test.ts
 * Description: Unit tests for the default tutorial — the rules that keep it in
 *   place, its creation on start-up, and how it reaches link holders.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-30
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { ForbiddenError } from '@/controllers/http-errors';
import AssignmentGateway from '@/gateways/assignment-gateway/assignment-gateway';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import AssignmentService from '@/services/assignment-service/assignment-service';
import AuthService from '@/services/auth-service/auth-service';
import CourseMapService from '@/services/course-map-service/course-map-service';
import CurriculumService from '@/services/curriculum-service/curriculum-service';
import {
  ensureDefaultTutorial,
  TUTORIAL_PLACEHOLDER,
} from '@/services/default-tutorial-service/default-tutorial-bootstrap';
import DefaultTutorialService from '@/services/default-tutorial-service/default-tutorial-service';
import PublicationService from '@/services/publication-service/publication-service';

import { Prisma } from '../../generated/prisma';

jest.mock('@/gateways/assignment-gateway/assignment-gateway');
jest.mock('@/gateways/curriculum-gateway/curriculum-gateway');
jest.mock('@/gateways/quiz-gateway/quiz-gateway');
jest.mock('@/services/auth-service/auth-service');
jest.mock('@/services/course-map-service/course-map-service');
jest.mock('@/services/email-service/email-service');
jest.mock('@/services/publication-service/publication-service');
jest.mock('@/services/dashboard-service/dashboard-service');
jest.mock('@/services/quiz-service/quiz-service');

const mockCurriculum = CurriculumGateway as jest.Mocked<typeof CurriculumGateway>;
const mockAssignments = AssignmentGateway as jest.Mocked<typeof AssignmentGateway>;
const mockQuiz = QuizGateway as jest.Mocked<typeof QuizGateway>;
const mockAuth = AuthService as jest.Mocked<typeof AuthService>;
const mockMap = CourseMapService as jest.Mocked<typeof CourseMapService>;
const mockPublication = PublicationService as jest.Mocked<typeof PublicationService>;

const TUTORIAL = 'tutorial';

/** A course row as the gateway hands it back, enough for the services under test. */
function courseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TUTORIAL,
    title: 'Getting started',
    kind: 'LESSON',
    published: true,
    publishedVersion: 1,
    deletedAt: null,
    daysRemaining: null,
    sections: [{ id: 's1' }],
    ...overrides,
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  DefaultTutorialService.clearCache();
  mockCurriculum.getDefaultTutorialId.mockResolvedValue(TUTORIAL);
  mockCurriculum.getCourseById.mockResolvedValue(courseRow());
});

describe('DefaultTutorialService.id', () => {
  /** It is read on every learner request, so one lookup has to be enough. */
  it('looks the tutorial up once and remembers it', async () => {
    await DefaultTutorialService.id();
    await DefaultTutorialService.id();

    expect(mockCurriculum.getDefaultTutorialId).toHaveBeenCalledTimes(1);
  });

  /**
   * A process that started before the bootstrap finished must still pick the
   * tutorial up, so a miss is never remembered.
   */
  it('asks again after a miss', async () => {
    mockCurriculum.getDefaultTutorialId.mockResolvedValueOnce(null);

    expect(await DefaultTutorialService.id()).toBeNull();
    expect(await DefaultTutorialService.id()).toBe(TUTORIAL);
  });
});

describe('the default tutorial cannot be taken away', () => {
  it('refuses to delete it', async () => {
    await expect(CurriculumService.deleteCourse(TUTORIAL)).rejects.toThrow(ForbiddenError);
    expect(mockCurriculum.softDeleteCourse).not.toHaveBeenCalled();
  });

  it('refuses to purge it, even straight from the bin route', async () => {
    await expect(CurriculumService.purgeCourse(TUTORIAL)).rejects.toThrow(ForbiddenError);
    expect(mockCurriculum.hardDeleteCourse).not.toHaveBeenCalled();
  });

  it('refuses to unpublish it', async () => {
    await expect(CurriculumService.updateCourse(TUTORIAL, { published: false })).rejects.toThrow(
      /cannot be unpublished/,
    );
    expect(mockCurriculum.updateCourse).not.toHaveBeenCalled();
  });

  it('refuses to change its kind', async () => {
    await expect(CurriculumService.updateCourse(TUTORIAL, { kind: 'QUIZ_SET' })).rejects.toThrow(
      /must stay a lesson/,
    );
    expect(mockCurriculum.updateCourse).not.toHaveBeenCalled();
  });

  /**
   * Admins edit the tutorial like any lesson; the guard is on taking it away,
   * not on changing what it says.
   */
  it('still lets its title and text be edited', async () => {
    mockCurriculum.updateCourse.mockResolvedValue(courseRow({ title: 'Start here' }));

    await CurriculumService.updateCourse(TUTORIAL, { title: 'Start here' });

    expect(mockCurriculum.updateCourse).toHaveBeenCalledWith(TUTORIAL, { title: 'Start here' });
  });

  it('leaves every other course alone', async () => {
    mockCurriculum.getCourseById.mockResolvedValue(courseRow({ id: 'course-1' }));
    mockCurriculum.softDeleteCourse.mockResolvedValue({} as never);

    await CurriculumService.deleteCourse('course-1');

    expect(mockCurriculum.softDeleteCourse).toHaveBeenCalledWith('course-1');
  });

  /** Everybody already has it; an assignment would only add a row to count. */
  it('refuses to assign it', async () => {
    await expect(
      AssignmentService.assign({ email: 'ada@example.com', courseId: TUTORIAL }),
    ).rejects.toThrow(/cannot be assigned/);
    expect(mockAssignments.create).not.toHaveBeenCalled();
  });

  it('refuses to assign a quiz from inside it', async () => {
    mockQuiz.getQuizById.mockResolvedValue({ id: 'q1', title: 'Check', type: 'EXAM' } as never);
    mockCurriculum.courseIdFromQuiz.mockResolvedValue(TUTORIAL);

    await expect(
      AssignmentService.assign({ email: 'ada@example.com', quizId: 'q1' }),
    ).rejects.toThrow(/cannot be assigned/);
    expect(mockAssignments.create).not.toHaveBeenCalled();
  });
});

describe('ensureDefaultTutorial', () => {
  /** What a just-created, never-published tutorial looks like. */
  const unpublished = (sections: unknown[] = []) =>
    courseRow({ publishedVersion: 0, published: false, sections });

  beforeEach(() => {
    mockPublication.publish.mockResolvedValue({ version: 1 } as never);
  });

  /** Every start-up after the first: it is there, published, and left alone. */
  it('does nothing when the tutorial already exists and is published', async () => {
    await ensureDefaultTutorial();

    expect(mockCurriculum.createDefaultTutorial).not.toHaveBeenCalled();
    expect(mockPublication.publish).not.toHaveBeenCalled();
  });

  it('creates, fills and publishes it on a fresh database', async () => {
    mockCurriculum.getDefaultTutorialId.mockResolvedValue(null);
    mockCurriculum.createDefaultTutorial.mockResolvedValue({ id: TUTORIAL } as never);
    mockCurriculum.getCourseById.mockResolvedValue(unpublished());
    const createSection = jest
      .spyOn(CurriculumService, 'createSection')
      .mockResolvedValue({ id: 's1' } as never);
    const createElement = jest
      .spyOn(CurriculumService, 'createElement')
      .mockResolvedValue({} as never);

    expect(await ensureDefaultTutorial()).toBe(TUTORIAL);

    expect(mockCurriculum.createDefaultTutorial).toHaveBeenCalledWith(TUTORIAL_PLACEHOLDER);
    expect(createSection).toHaveBeenCalledWith(TUTORIAL, expect.any(Object));
    expect(createElement).toHaveBeenCalledWith('s1', {
      type: 'TEXT',
      textContent: TUTORIAL_PLACEHOLDER.textContent,
    });
    // Published through the ordinary path, so learners read a real snapshot.
    expect(mockPublication.publish).toHaveBeenCalledWith(TUTORIAL, null);

    createSection.mockRestore();
    createElement.mockRestore();
  });

  /**
   * A crash between creating and publishing leaves a flagged, unpublished
   * course. The next start finishes the job rather than leaving it dark — and
   * does not add a second placeholder to content that is already there.
   */
  it('finishes a tutorial a previous start left unpublished', async () => {
    mockCurriculum.getCourseById.mockResolvedValue(unpublished([{ id: 's1' }]));
    const createSection = jest.spyOn(CurriculumService, 'createSection');

    await ensureDefaultTutorial();

    expect(createSection).not.toHaveBeenCalled();
    expect(mockPublication.publish).toHaveBeenCalledWith(TUTORIAL, null);
    createSection.mockRestore();
  });

  /** Two replicas booting together: the index lets one win, and the other uses its course. */
  it('uses the winner’s tutorial when another instance created it first', async () => {
    mockCurriculum.getDefaultTutorialId.mockResolvedValueOnce(null).mockResolvedValueOnce(TUTORIAL);
    mockCurriculum.createDefaultTutorial.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
    );

    expect(await ensureDefaultTutorial()).toBe(TUTORIAL);
  });

  /** A start-up that cannot make it must still serve everything else. */
  it('never throws', async () => {
    mockCurriculum.getDefaultTutorialId.mockRejectedValue(new Error('database is down'));

    await expect(ensureDefaultTutorial()).resolves.toBeNull();
  });
});

describe('the guest catalogue', () => {
  const now = new Date();
  const link = {
    id: 'a1',
    type: 'LINK',
    email: 'guest@example.com',
    courseId: 'course-1',
    quizId: null,
    dueDate: null,
    expiresAt: null,
    revokedAt: null,
    completedAt: null,
    assignedAt: now,
    lastAccessedAt: now,
    course: { published: true, deletedAt: null },
  };

  function snapshot(id: string) {
    return {
      id,
      title: id,
      dueDate: null,
      lockAfterDue: true,
      isDefaultTutorial: id === TUTORIAL,
      sections: [{ id: `${id}-s1`, elements: [], quizzes: [{ id: `${id}-q1`, questions: [] }] }],
    };
  }

  beforeEach(() => {
    mockAssignments.findByTokenHash.mockResolvedValue(link as never);
    mockAuth.getOrCreateUser.mockResolvedValue({ id: 7, email: link.email } as never);
    mockPublication.getLiveSnapshot.mockImplementation(async (id) => snapshot(id) as never);
    mockMap.forLearner.mockImplementation(async (course) => course as never);
  });

  /**
   * A link opens one item — but the walkthrough a guest is shown walks them
   * into the tutorial, so the link has to open that too or they are stranded
   * half way through it.
   */
  it('adds the tutorial to what a link opens', async () => {
    const { courses } = await AssignmentService.getSessionCatalogue('tok');

    expect(courses.map((course) => course.id)).toEqual(['course-1', TUTORIAL]);
  });

  it('gives it no deadline and never locks it', async () => {
    const { courses } = await AssignmentService.getSessionCatalogue('tok');
    const tutorial = courses.find((course) => course.id === TUTORIAL)!;

    expect(tutorial.dueDate).toBeNull();
    expect(tutorial.locked).toBe(false);
  });

  /** Its quizzes come with it, or a guest could open the course but not sit its quiz. */
  it('carries the quizzes inside it', async () => {
    const { quizzes } = await AssignmentService.getSessionCatalogue('tok');

    expect(quizzes.map((quiz) => quiz.id)).toEqual(['course-1-q1', `${TUTORIAL}-q1`]);
  });

  it('adds nothing before the tutorial exists', async () => {
    mockCurriculum.getDefaultTutorialId.mockResolvedValue(null);

    const { courses } = await AssignmentService.getSessionCatalogue('tok');

    expect(courses.map((course) => course.id)).toEqual(['course-1']);
  });
});

describe('the deploy migration', () => {
  /**
   * Existing users must not all be shown the tour the morning this ships, but
   * somebody who has only ever been assigned work — a row with no sign-in yet —
   * must still get it on their first real visit. Both halves rest on one
   * statement, so it is pinned here.
   */
  it('marks people who have signed in before as having skipped the tour, and nobody else', () => {
    const sql = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261030120000_default_tutorial_and_tour/migration.sql',
      ),
      'utf8',
    );

    expect(sql).toMatch(
      /UPDATE "User" SET "tourStatus" = 'SKIPPED' WHERE "lastSignInAt" IS NOT NULL;/,
    );
    expect(sql).toMatch(/"tourStatus" "TourStatus" NOT NULL DEFAULT 'NOT_STARTED'/);
    // At most one tutorial, enforced by the database rather than by hope.
    expect(sql).toMatch(/CREATE UNIQUE INDEX .* WHERE "isDefaultTutorial"/);
  });
});
