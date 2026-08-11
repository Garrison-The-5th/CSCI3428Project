/**
 * File: dashboard-service.test.ts
 * Description: Unit tests for the progress and completion rules behind the
 *   learner dashboard.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import DashboardService from '@/services/dashboard-service/dashboard-service';

jest.mock('@/gateways/curriculum-gateway/curriculum-gateway');
jest.mock('@/gateways/quiz-gateway/quiz-gateway');
jest.mock('@/services/enrolment-service/enrolment-service');
jest.mock('@/services/publication-service/publication-service');

const mockCurriculum = CurriculumGateway as jest.Mocked<typeof CurriculumGateway>;
const mockQuiz = QuizGateway as jest.Mocked<typeof QuizGateway>;

function course(overrides: Partial<Parameters<typeof DashboardService.build>[1][number]> = {}) {
  return {
    id: 'course-1',
    title: 'Fire safety',
    required: false,
    dueDate: null,
    contentUpdatedAt: new Date('2026-01-01'),
    modules: [
      { id: 'm1', estimatedMinutes: 10, quizzes: [] },
      { id: 'm2', estimatedMinutes: 20, quizzes: [{ id: 'quiz-1' }] },
    ],
    ...overrides,
  };
}

/** Wires up "this learner has viewed these modules and attempted these quizzes". */
function givenProgress(moduleIds: string[], quizIds: string[]) {
  mockCurriculum.getViewedModuleIds.mockResolvedValue(
    moduleIds.map((moduleId) => ({ moduleId, viewedAt: new Date() })) as never,
  );
  mockQuiz.getAttemptsForUser.mockResolvedValue(
    quizIds.map((quizId) => ({ quizId, score: 1, total: 1, completedAt: new Date() })) as never,
  );
  mockCurriculum.recordCompletion.mockResolvedValue({} as never);
  mockCurriculum.refreshCompletion.mockResolvedValue({} as never);
}

describe('module completion rule', () => {
  /**
   * A module counts as done when it has been opened AND every quiz inside it
   * has been attempted. Opening alone is not enough, which is the rule the
   * whole progress figure rests on.
   */
  it('does not count a viewed module whose quiz is unattempted', async () => {
    givenProgress(['m1', 'm2'], []);

    const result = await DashboardService.build(1, [course()], []);

    expect(result.courseProgress[0]).toMatchObject({
      completedModules: 1,
      totalModules: 2,
      percentComplete: 50,
    });
  });

  it('counts the module once its quiz has been attempted', async () => {
    givenProgress(['m1', 'm2'], ['quiz-1']);

    const result = await DashboardService.build(1, [course()], []);

    expect(result.courseProgress[0]).toMatchObject({
      completedModules: 2,
      percentComplete: 100,
    });
  });

  it('does not count an unviewed module even when its quiz was attempted', async () => {
    givenProgress(['m1'], ['quiz-1']);

    const result = await DashboardService.build(1, [course()], []);
    expect(result.courseProgress[0].completedModules).toBe(1);
  });

  it('reports 0% for a course with no modules rather than dividing by zero', async () => {
    givenProgress([], []);

    const result = await DashboardService.build(1, [course({ modules: [] })], []);
    expect(result.courseProgress[0].percentComplete).toBe(0);
  });
});

describe('time remaining', () => {
  it('sums only the minutes of unfinished modules', async () => {
    givenProgress(['m1'], []);

    const result = await DashboardService.build(1, [course()], []);

    expect(result.courseProgress[0].totalMinutes).toBe(30);
    expect(result.courseProgress[0].remainingMinutes).toBe(20);
  });

  it('reports nothing remaining once the course is finished', async () => {
    givenProgress(['m1', 'm2'], ['quiz-1']);

    const result = await DashboardService.build(1, [course()], []);
    expect(result.courseProgress[0].remainingMinutes).toBe(0);
  });
});

describe('outstanding work', () => {
  it('lists a part-finished course as outstanding', async () => {
    givenProgress(['m1'], []);

    const result = await DashboardService.build(1, [course()], []);

    expect(result.outstandingCourses).toHaveLength(1);
    expect(result.totals.coursesOutstanding).toBe(1);
    expect(result.totals.minutesRemaining).toBe(20);
  });

  it('drops a finished course from outstanding', async () => {
    givenProgress(['m1', 'm2'], ['quiz-1']);

    const result = await DashboardService.build(1, [course()], []);
    expect(result.outstandingCourses).toHaveLength(0);
  });

  it('lists an unattempted quiz and resolves its course title', async () => {
    givenProgress([], []);

    const result = await DashboardService.build(
      1,
      [course()],
      [
        {
          id: 'quiz-1',
          title: 'Fire quiz',
          moduleId: 'm2',
          dueDate: null,
          questions: [{ id: 'q' }],
        },
      ],
    );

    expect(result.outstandingQuizzes).toHaveLength(1);
    expect(result.outstandingQuizzes[0]).toMatchObject({
      quizId: 'quiz-1',
      courseTitle: 'Fire safety',
      questionCount: 1,
    });
  });

  it('drops an attempted quiz from outstanding', async () => {
    givenProgress([], ['quiz-1']);

    const result = await DashboardService.build(
      1,
      [course()],
      [{ id: 'quiz-1', title: 'Fire quiz', moduleId: 'm2', dueDate: null, questions: [] }],
    );

    expect(result.outstandingQuizzes).toHaveLength(0);
  });

  /** A quiz with no due date of its own inherits its course's. */
  it('falls back to the course due date for a quiz that has none', async () => {
    givenProgress([], []);
    const due = new Date('2026-12-01');

    const result = await DashboardService.build(
      1,
      [course({ dueDate: due })],
      [{ id: 'quiz-1', title: 'Fire quiz', moduleId: 'm2', dueDate: null, questions: [] }],
    );

    expect(result.outstandingQuizzes[0].dueDate).toBe(due.toISOString());
  });

  it("prefers the quiz's own due date when it has one", async () => {
    givenProgress([], []);
    const quizDue = new Date('2026-06-01');

    const result = await DashboardService.build(
      1,
      [course({ dueDate: new Date('2026-12-01') })],
      [{ id: 'quiz-1', title: 'Q', moduleId: 'm2', dueDate: quizDue, questions: [] }],
    );

    expect(result.outstandingQuizzes[0].dueDate).toBe(quizDue.toISOString());
  });
});

describe('upcoming deadlines', () => {
  it('sorts soonest first and excludes finished courses', async () => {
    givenProgress([], []);

    const result = await DashboardService.build(
      1,
      [
        course({ id: 'later', title: 'Later', dueDate: new Date('2026-12-01') }),
        course({ id: 'sooner', title: 'Sooner', dueDate: new Date('2026-09-01') }),
      ],
      [],
    );

    expect(result.upcomingDeadlines.map((entry) => entry.courseId)).toEqual(['sooner', 'later']);
  });

  it('omits a course with no due date — that is not a deadline', async () => {
    givenProgress([], []);

    const result = await DashboardService.build(1, [course()], []);
    expect(result.upcomingDeadlines).toHaveLength(0);
  });
});

describe('completion recording', () => {
  it('stamps a completion when the course reaches 100%', async () => {
    givenProgress(['m1', 'm2'], ['quiz-1']);

    await DashboardService.build(1, [course()], []);

    expect(mockCurriculum.recordCompletion).toHaveBeenCalledWith(1, 'course-1', 2);
  });

  it('does not stamp a completion for a part-finished course', async () => {
    givenProgress(['m1'], []);

    await DashboardService.build(1, [course()], []);
    expect(mockCurriculum.recordCompletion).not.toHaveBeenCalled();
  });

  /**
   * Once someone has worked through newly added material the notice must clear
   * itself, or the badge sticks forever.
   */
  it('moves the completion date forward and clears the notice when caught up', async () => {
    givenProgress(['m1', 'm2'], ['quiz-1']);

    const result = await DashboardService.build(1, [course()], [], new Map([['course-1', 3]]));

    expect(mockCurriculum.refreshCompletion).toHaveBeenCalledWith(1, 'course-1', 2);
    expect(result.courseProgress[0].hasNewContent).toBe(false);
    expect(result.courseProgress[0].newModuleCount).toBe(0);
  });

  it('surfaces new content on a course that is not yet finished', async () => {
    givenProgress(['m1'], []);

    const result = await DashboardService.build(1, [course()], [], new Map([['course-1', 2]]));

    expect(result.courseProgress[0].hasNewContent).toBe(true);
    expect(result.updatedCourses).toHaveLength(1);
  });
});
