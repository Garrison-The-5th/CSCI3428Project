/**
 * File: enrolment-service.test.ts
 * Description: Unit tests for what a signed-in learner is entitled to see, and
 *   when their copy of it falls due.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-04
 */
import AssignmentGateway from '@/gateways/assignment-gateway/assignment-gateway';
import EnrolmentService from '@/services/enrolment-service/enrolment-service';

jest.mock('@/gateways/assignment-gateway/assignment-gateway');

const mockGateway = AssignmentGateway as jest.Mocked<typeof AssignmentGateway>;

/** The gateway hands these back newest first, which is what the rules rest on. */
function given(assignments: Array<Record<string, unknown>>) {
  mockGateway.listPlatformForEmail.mockResolvedValue(assignments as never);
}

describe('forEmail', () => {
  beforeEach(() => jest.clearAllMocks());

  it('normalises the address before looking anything up', async () => {
    given([]);
    await EnrolmentService.forEmail('  Ada@Example.COM ');
    expect(mockGateway.listPlatformForEmail).toHaveBeenCalledWith('ada@example.com');
  });

  /**
   * The deadline is the assignment's, which is the whole point: two people
   * handed the same course a month apart are due on two different dates, and
   * nothing on the course itself can tell them apart.
   */
  it('reports the deadline stamped on each assignment', async () => {
    const courseDue = new Date('2026-03-10T23:59:00');
    const quizDue = new Date('2026-04-01T23:59:00');
    given([
      { courseId: 'course-1', quizId: null, dueDate: courseDue },
      { courseId: null, quizId: 'quiz-1', dueDate: quizDue },
    ]);

    const enrolment = await EnrolmentService.forEmail('ada@example.com');

    expect(enrolment.courseIds).toEqual(new Set(['course-1']));
    expect(enrolment.quizIds).toEqual(new Set(['quiz-1']));
    expect(enrolment.dueByCourseId.get('course-1')).toEqual(courseDue);
    expect(enrolment.dueByQuizId.get('quiz-1')).toEqual(quizDue);
  });

  /** Whatever hour it was stamped at, a deadline means 11:59 PM on its day. */
  it('moves a deadline set at another time of day to the end of that day', async () => {
    given([{ courseId: 'course-1', quizId: null, dueDate: new Date('2026-03-10T09:15:00') }]);

    const due = (await EnrolmentService.forEmail('ada@example.com')).dueByCourseId.get('course-1')!;

    expect([due.getDate(), due.getHours(), due.getMinutes()]).toEqual([10, 23, 59]);
  });

  /**
   * Re-assigning something is how somebody is given longer, so the newest grant
   * has to win. The gateway orders newest first and the first write per key
   * stands.
   */
  it('keeps the most recent deadline when the same course was assigned twice', async () => {
    const newer = new Date('2026-06-01T23:59:00');
    given([
      { courseId: 'course-1', quizId: null, dueDate: newer },
      { courseId: 'course-1', quizId: null, dueDate: new Date('2026-01-01T23:59:00') },
    ]);

    const enrolment = await EnrolmentService.forEmail('ada@example.com');
    expect(enrolment.dueByCourseId.get('course-1')).toEqual(newer);
  });

  /**
   * Mapped rather than absent, so a caller can tell "assigned with no deadline"
   * apart from "not assigned" — the two mean very different things to a lock.
   */
  it('records a course assigned with no deadline as having none', async () => {
    given([{ courseId: 'course-1', quizId: null, dueDate: null }]);

    const enrolment = await EnrolmentService.forEmail('ada@example.com');

    expect(enrolment.courseIds.has('course-1')).toBe(true);
    expect(enrolment.dueByCourseId.has('course-1')).toBe(true);
    expect(enrolment.dueByCourseId.get('course-1')).toBeNull();
  });
});
