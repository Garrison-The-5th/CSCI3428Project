/**
 * File: quiz-access.test.ts
 * Description: Unit tests for who may open, start and submit a quiz.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-10-16
 */
import { NotFoundError } from '@/controllers/http-errors';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import EnrolmentService from '@/services/enrolment-service/enrolment-service';
import PublicationService from '@/services/publication-service/publication-service';
import QuizService from '@/services/quiz-service/quiz-service';

jest.mock('@/gateways/curriculum-gateway/curriculum-gateway');
jest.mock('@/gateways/quiz-gateway/quiz-gateway');
jest.mock('@/services/enrolment-service/enrolment-service');
jest.mock('@/services/publication-service/publication-service');

const enrolment = EnrolmentService as jest.Mocked<typeof EnrolmentService>;
const publications = PublicationService as jest.Mocked<typeof PublicationService>;
const quizzes = QuizGateway as jest.Mocked<typeof QuizGateway>;
const curriculum = CurriculumGateway as jest.Mocked<typeof CurriculumGateway>;

const learner = { id: 3, email: 'ada@example.com' };

function enrolledIn({ courseIds = [] as string[], quizIds = [] as string[] } = {}) {
  enrolment.forEmail.mockResolvedValue({
    courseIds: new Set(courseIds),
    quizIds: new Set(quizIds),
  } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  publications.getLiveSnapshots.mockResolvedValue([]);
  quizzes.getQuizById.mockResolvedValue(null as never);
  curriculum.canEditCourse.mockResolvedValue(false as never);
});

describe('QuizService.assertCanRun', () => {
  it('allows a quiz assigned on its own', async () => {
    enrolledIn({ quizIds: ['q1'] });
    await expect(QuizService.assertCanRun(learner, 'q1', false)).resolves.toBeUndefined();
  });

  it('allows a quiz inside an assigned course, as published', async () => {
    enrolledIn({ courseIds: ['c1'] });
    publications.getLiveSnapshots.mockResolvedValue([
      { id: 'c1', sections: [{ quizzes: [{ id: 'q-in-lesson' }] }] },
    ] as never);
    await expect(QuizService.assertCanRun(learner, 'q-in-lesson', false)).resolves.toBeUndefined();
  });

  it('refuses a published quiz nobody gave them, as not found', async () => {
    enrolledIn();
    quizzes.getQuizById.mockResolvedValue({ id: 'q9', sectionId: null } as never);
    await expect(QuizService.assertCanRun(learner, 'q9', false)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('lets a global author try a standalone quiz', async () => {
    enrolledIn();
    quizzes.getQuizById.mockResolvedValue({ id: 'q9', sectionId: null } as never);
    await expect(QuizService.assertCanRun(learner, 'q9', true)).resolves.toBeUndefined();
  });

  it('lets someone who can edit the course try a quiz inside it, and nobody else', async () => {
    enrolledIn();
    quizzes.getQuizById.mockResolvedValue({ id: 'q5', sectionId: 's1' } as never);
    curriculum.getSectionById.mockResolvedValue({ id: 's1', courseId: 'c1' } as never);

    curriculum.canEditCourse.mockResolvedValue(true as never);
    await expect(QuizService.assertCanRun(learner, 'q5', false)).resolves.toBeUndefined();

    curriculum.canEditCourse.mockResolvedValue(false as never);
    await expect(QuizService.assertCanRun(learner, 'q5', false)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
