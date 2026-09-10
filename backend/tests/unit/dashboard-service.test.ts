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
    sections: [
      { id: 'm1', estimatedMinutes: 10, quizzes: [] },
      { id: 'm2', estimatedMinutes: 20, quizzes: [{ id: 'quiz-1' }] },
    ],
    ...overrides,
  };
}

/** Wires up "this learner has viewed these sections and attempted these quizzes". */
function givenProgress(sectionIds: string[], quizIds: string[]) {
  mockCurriculum.getViewedSectionIds.mockResolvedValue(
    sectionIds.map((sectionId) => ({ sectionId, viewedAt: new Date() })) as never,
  );
  mockQuiz.getAttemptsForUser.mockResolvedValue(
    quizIds.map((quizId) => ({ quizId, score: 1, total: 1, completedAt: new Date() })) as never,
  );
  mockCurriculum.recordCompletion.mockResolvedValue({} as never);
  mockCurriculum.refreshCompletion.mockResolvedValue({} as never);
}

describe('section completion rule', () => {
  /**
   * A section counts as done when it has been opened AND every quiz inside it
   * has been attempted. Opening alone is not enough, which is the rule the
   * whole progress figure rests on.
   */
  it('does not count a viewed section whose quiz is unattempted', async () => {
    givenProgress(['m1', 'm2'], []);

    const result = await DashboardService.build(1, [course()], []);

    expect(result.courseProgress[0]).toMatchObject({
      completedSections: 1,
      totalSections: 2,
      percentComplete: 50,
    });
  });

  it('counts the section once its quiz has been attempted', async () => {
    givenProgress(['m1', 'm2'], ['quiz-1']);

    const result = await DashboardService.build(1, [course()], []);

    expect(result.courseProgress[0]).toMatchObject({
      completedSections: 2,
      percentComplete: 100,
    });
  });

  it('does not count an unviewed section even when its quiz was attempted', async () => {
    givenProgress(['m1'], ['quiz-1']);

    const result = await DashboardService.build(1, [course()], []);
    expect(result.courseProgress[0].completedSections).toBe(1);
  });

  it('reports 0% for a course with no sections rather than dividing by zero', async () => {
    givenProgress([], []);

    const result = await DashboardService.build(1, [course({ sections: [] })], []);
    expect(result.courseProgress[0].percentComplete).toBe(0);
  });
});

describe('time remaining', () => {
  it('sums only the minutes of unfinished sections', async () => {
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

  it('lists an unattempted quiz that was handed over on its own', async () => {
    givenProgress([], []);

    const result = await DashboardService.build(
      1,
      [course()],
      [
        {
          id: 'solo',
          title: 'Fire quiz',
          sectionId: null,
          dueDate: null,
          questions: [{ id: 'q' }],
        },
      ],
    );

    expect(result.outstandingQuizzes).toHaveLength(1);
    expect(result.outstandingQuizzes[0]).toMatchObject({ quizId: 'solo', questionCount: 1 });
  });

  it('drops an attempted quiz from outstanding', async () => {
    givenProgress([], ['solo']);

    const result = await DashboardService.build(
      1,
      [course()],
      [{ id: 'solo', title: 'Fire quiz', sectionId: null, dueDate: null, questions: [] }],
    );

    expect(result.outstandingQuizzes).toHaveLength(0);
  });

  /**
   * A quiz inside a course is part of that course. Chasing it here as well split
   * one piece of work into two entries carrying the same deadline, and pointed
   * the learner at the Quizzes tab for something taken inside a lesson.
   */
  it('leaves a quiz that belongs to a course out of outstanding quizzes', async () => {
    givenProgress([], []);

    const result = await DashboardService.build(
      1,
      [course()],
      [{ id: 'quiz-1', title: 'Fire quiz', sectionId: 'm2', dueDate: null, questions: [] }],
    );

    expect(result.outstandingQuizzes).toHaveLength(0);
  });
});

/**
 * One course, one date. A quiz inside a course falls due with the course around
 * it, whatever is written on the quiz itself — otherwise an exam could close a
 * week before the lesson it belongs to.
 */
describe('a quiz in a course is due with the course', () => {
  it("ignores the quiz's own date in favour of its course's", async () => {
    givenProgress([], []);
    const courseDue = new Date('2026-12-01T23:59:00');

    const result = await DashboardService.build(
      1,
      [course({ dueDate: courseDue })],
      [
        {
          id: 'quiz-1',
          title: 'Q',
          sectionId: 'm2',
          dueDate: new Date('2026-06-01T23:59:00'),
          questions: [],
        },
      ],
    );

    // Not on either list in its own right, and not carrying its own June date
    // into the deadlines beside its course's December one.
    expect(result.outstandingQuizzes).toHaveLength(0);
    expect(result.upcomingDeadlines.map((entry) => entry.dueDate)).toEqual([
      courseDue.toISOString(),
    ]);
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

    expect(result.upcomingDeadlines.map((entry) => entry.id)).toEqual(['sooner', 'later']);
  });

  it('omits a course with no due date — that is not a deadline', async () => {
    givenProgress([], []);

    const result = await DashboardService.build(1, [course()], []);
    expect(result.upcomingDeadlines).toHaveLength(0);
  });

  /**
   * Courses and standalone quizzes rank against one clock. The list answers
   * "what is due next", so a quiz due before a course has to sort above it
   * rather than sit on a list of its own.
   */
  it('ranks a standalone quiz among the courses', async () => {
    givenProgress([], []);

    const result = await DashboardService.build(
      1,
      [course({ id: 'course-1', title: 'Course', dueDate: new Date('2026-12-01T23:59:00') })],
      [
        {
          id: 'solo',
          title: 'Solo quiz',
          sectionId: null,
          dueDate: new Date('2026-09-01T23:59:00'),
          questions: [],
        },
      ],
    );

    expect(result.upcomingDeadlines.map((entry) => [entry.kind, entry.id])).toEqual([
      ['quiz', 'solo'],
      ['course', 'course-1'],
    ]);
  });

  /** It falls due with its course, which is already on the list. */
  it('leaves a quiz that belongs to a course off the list', async () => {
    givenProgress([], []);

    const result = await DashboardService.build(
      1,
      [course({ dueDate: new Date('2026-12-01T23:59:00') })],
      [
        {
          id: 'quiz-1',
          title: 'In a course',
          sectionId: 'm2',
          dueDate: new Date('2026-09-01T23:59:00'),
          questions: [],
        },
      ],
    );

    expect(result.upcomingDeadlines.map((entry) => entry.kind)).toEqual(['course']);
  });
});

/**
 * Past 11:59 PM on its day, a course is shut. The dashboard says so rather than
 * leaving the browser to work it out from a clock the learner can change.
 */
describe('locking', () => {
  it('locks a course whose deadline has gone', async () => {
    givenProgress([], []);

    const result = await DashboardService.build(
      1,
      [course({ dueDate: new Date('2020-01-01T23:59:00') })],
      [],
    );

    expect(result.courseProgress[0].locked).toBe(true);
    expect(result.upcomingDeadlines[0].overdue).toBe(true);
  });

  /** The deadline is 11:59 PM, so the day it falls on is still theirs. */
  it('leaves a course due later today unlocked', async () => {
    givenProgress([], []);
    const tonight = new Date();
    tonight.setHours(23, 59, 0, 0);

    const result = await DashboardService.build(1, [course({ dueDate: tonight })], []);

    expect(result.courseProgress[0].locked).toBe(false);
  });

  it('leaves a course with no deadline unlocked', async () => {
    givenProgress([], []);

    const result = await DashboardService.build(1, [course()], []);
    expect(result.courseProgress[0].locked).toBe(false);
  });

  /**
   * A course whose author turned the lock off is late, not shut. The distinction
   * is the whole point of the setting: the learner is told they are overdue and
   * can still finish.
   */
  it('leaves a passed deadline open when the course says not to lock', async () => {
    givenProgress([], []);

    const result = await DashboardService.build(
      1,
      [course({ dueDate: new Date('2020-01-01T23:59:00'), lockAfterDue: false })],
      [],
    );

    expect(result.courseProgress[0].locked).toBe(false);
    // Still on the deadline list, still marked overdue.
    expect(result.upcomingDeadlines[0].overdue).toBe(true);
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
    expect(result.courseProgress[0].newSectionCount).toBe(0);
  });

  it('surfaces new content on a course that is not yet finished', async () => {
    givenProgress(['m1'], []);

    const result = await DashboardService.build(1, [course()], [], new Map([['course-1', 2]]));

    expect(result.courseProgress[0].hasNewContent).toBe(true);
    expect(result.updatedCourses).toHaveLength(1);
  });
});
