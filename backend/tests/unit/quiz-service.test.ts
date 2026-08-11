/**
 * File: quiz-service.test.ts
 * Description: Unit tests for quiz grading, answer redaction, question
 *   validation and timed sessions.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import PublicationService from '@/services/publication-service/publication-service';
import QuizService, { redactAnswers } from '@/services/quiz-service/quiz-service';

jest.mock('@/gateways/quiz-gateway/quiz-gateway');
jest.mock('@/gateways/curriculum-gateway/curriculum-gateway');
jest.mock('@/services/publication-service/publication-service');
jest.mock('@/services/enrolment-service/enrolment-service');

const mockQuizGateway = QuizGateway as jest.Mocked<typeof QuizGateway>;
const mockPublication = PublicationService as jest.Mocked<typeof PublicationService>;

/** A published quiz with a known answer key: option `a2` is correct. */
function quizFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'quiz-1',
    title: 'Fire safety',
    description: null,
    moduleId: 'module-1',
    order: 1,
    published: true,
    showAnswers: false,
    dueDate: null,
    timeLimitMinutes: null,
    questions: [
      {
        id: 'q1',
        order: 1,
        prompt: 'Where is the extinguisher?',
        hint: null,
        hintModuleNumber: null,
        options: [
          { id: 'a1', order: 1, text: 'Nowhere', isCorrect: false },
          { id: 'a2', order: 2, text: 'By the door', isCorrect: true },
        ],
      },
      {
        id: 'q2',
        order: 2,
        prompt: 'Who do you call?',
        hint: null,
        hintModuleNumber: null,
        options: [
          { id: 'b1', order: 1, text: 'Reception', isCorrect: true },
          { id: 'b2', order: 2, text: 'Nobody', isCorrect: false },
        ],
      },
    ],
    ...overrides,
  };
}

describe('redactAnswers', () => {
  /**
   * The single most important guarantee in the quiz path: the answer key must
   * never reach the browser before submission.
   */
  it('removes isCorrect from every option', () => {
    const redacted = redactAnswers(quizFixture());

    for (const question of redacted.questions) {
      for (const option of question.options) {
        expect(option).not.toHaveProperty('isCorrect');
      }
    }
  });

  it('keeps everything a learner legitimately needs', () => {
    const redacted = redactAnswers(quizFixture());

    expect(redacted.title).toBe('Fire safety');
    expect(redacted.questions[0].prompt).toBe('Where is the extinguisher?');
    expect(redacted.questions[0].options[0].text).toBe('Nowhere');
    expect(redacted.questions[0].options[0].id).toBe('a1');
  });

  it('does not mutate the original, so a redacted read cannot corrupt a cached quiz', () => {
    const original = quizFixture();
    redactAnswers(original);
    expect(original.questions[0].options[1].isCorrect).toBe(true);
  });

  it('handles a quiz with no questions', () => {
    expect(redactAnswers({ ...quizFixture(), questions: [] }).questions).toEqual([]);
  });
});

describe('submitAttempt — grading', () => {
  beforeEach(() => {
    mockPublication.findPublishedQuiz.mockResolvedValue(quizFixture() as never);
    mockQuizGateway.findOpenSession.mockResolvedValue(null as never);
    mockQuizGateway.recordAttempt.mockResolvedValue({} as never);
  });

  it('scores every correct answer', async () => {
    const result = await QuizService.submitAttempt(1, 'quiz-1', { q1: 'a2', q2: 'b1' });
    expect(result).toMatchObject({ score: 2, total: 2 });
  });

  it('scores a partially correct submission', async () => {
    const result = await QuizService.submitAttempt(1, 'quiz-1', { q1: 'a2', q2: 'b2' });
    expect(result).toMatchObject({ score: 1, total: 2 });
  });

  it('scores zero for all wrong answers', async () => {
    const result = await QuizService.submitAttempt(1, 'quiz-1', { q1: 'a1', q2: 'b2' });
    expect(result.score).toBe(0);
  });

  it('counts an unanswered question as wrong rather than skipping it', async () => {
    const result = await QuizService.submitAttempt(1, 'quiz-1', { q1: 'a2' });
    expect(result).toMatchObject({ score: 1, total: 2 });
  });

  it('ignores an option id that belongs to a different question', async () => {
    const result = await QuizService.submitAttempt(1, 'quiz-1', { q1: 'b1', q2: 'a2' });
    expect(result.score).toBe(0);
  });

  it('records the attempt so the quiz stops being outstanding', async () => {
    await QuizService.submitAttempt(7, 'quiz-1', { q1: 'a2', q2: 'b1' });
    expect(mockQuizGateway.recordAttempt).toHaveBeenCalledWith(7, 'quiz-1', 2, 2);
  });

  it('withholds the correct answers when showAnswers is off', async () => {
    const result = await QuizService.submitAttempt(1, 'quiz-1', { q1: 'a2', q2: 'b1' });
    expect(result.showAnswers).toBe(false);
    expect(result.correctOptionIds).toEqual([]);
  });

  it('discloses the correct answers only when the author enabled it', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(
      quizFixture({ showAnswers: true }) as never,
    );
    const result = await QuizService.submitAttempt(1, 'quiz-1', { q1: 'a1', q2: 'b2' });
    expect(result.showAnswers).toBe(true);
    expect(result.correctOptionIds).toEqual(['a2', 'b1']);
  });

  /**
   * Grading reads the published snapshot, not the live rows. Otherwise an
   * author's unpublished rewrite would be marked against the questions the
   * learner actually saw.
   */
  it('grades against the published version, not the editable rows', async () => {
    await QuizService.submitAttempt(1, 'quiz-1', { q1: 'a2' });
    expect(mockPublication.findPublishedQuiz).toHaveBeenCalledWith('quiz-1');
    expect(mockQuizGateway.getQuizById).not.toHaveBeenCalled();
  });

  it('falls back to the live row for a quiz assigned on its own', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(null);
    mockQuizGateway.getQuizById.mockResolvedValue(quizFixture() as never);

    const result = await QuizService.submitAttempt(1, 'quiz-1', { q1: 'a2', q2: 'b1' });

    // `live: true` is what keeps a draft or recycled quiz unsubmittable.
    expect(mockQuizGateway.getQuizById).toHaveBeenCalledWith('quiz-1', true);
    expect(result.score).toBe(2);
  });

  it('refuses a quiz that cannot be reached at all', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(null);
    mockQuizGateway.getQuizById.mockResolvedValue(null as never);

    await expect(QuizService.submitAttempt(1, 'missing', {})).rejects.toThrow(/not found/);
  });
});

describe('submitAttempt — timed runs', () => {
  beforeEach(() => {
    mockPublication.findPublishedQuiz.mockResolvedValue(
      quizFixture({ timeLimitMinutes: 10 }) as never,
    );
    mockQuizGateway.recordAttempt.mockResolvedValue({} as never);
    mockQuizGateway.closeSession.mockResolvedValue({} as never);
  });

  /**
   * The clock decides how long they had, not whether the work counts. A tab
   * asleep for ten seconds must not lose answers already given.
   */
  it('still grades a submission that arrives after the deadline, and flags it', async () => {
    mockQuizGateway.findOpenSession.mockResolvedValue({
      id: 'session-1',
      expiresAt: new Date(Date.now() - 60_000),
    } as never);

    const result = await QuizService.submitAttempt(1, 'quiz-1', { q1: 'a2', q2: 'b1' });

    expect(result.timedOut).toBe(true);
    expect(result.score).toBe(2);
  });

  it('does not flag a submission inside the window', async () => {
    mockQuizGateway.findOpenSession.mockResolvedValue({
      id: 'session-1',
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    const result = await QuizService.submitAttempt(1, 'quiz-1', {});
    expect(result.timedOut).toBe(false);
  });

  it('closes the run so the next start hands out a fresh clock', async () => {
    mockQuizGateway.findOpenSession.mockResolvedValue({
      id: 'session-1',
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    await QuizService.submitAttempt(1, 'quiz-1', {});
    expect(mockQuizGateway.closeSession).toHaveBeenCalledWith('session-1');
  });
});

describe('startSession', () => {
  beforeEach(() => {
    (mockQuizGateway.createSession as unknown as jest.Mock).mockImplementation(
      async (data: object) => ({ id: 'new-session', startedAt: new Date(), ...data }),
    );
  });

  it('anchors the deadline to the server clock for a timed quiz', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(
      quizFixture({ timeLimitMinutes: 15 }) as never,
    );
    mockQuizGateway.findOpenSession.mockResolvedValue(null as never);

    const session = await QuizService.startSession(1, 'quiz-1');

    expect(session.timeLimitMinutes).toBe(15);
    expect(session.secondsRemaining).toBeGreaterThan(14 * 60);
    expect(session.secondsRemaining).toBeLessThanOrEqual(15 * 60);
    expect(session.expired).toBe(false);
  });

  it('reports an untimed quiz as having no deadline', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(quizFixture() as never);
    mockQuizGateway.findOpenSession.mockResolvedValue(null as never);

    const session = await QuizService.startSession(1, 'quiz-1');

    expect(session.expiresAt).toBeNull();
    expect(session.secondsRemaining).toBeNull();
  });

  /**
   * Calling start again mid-run must return the existing session. This is what
   * makes leaving and returning safe — and what stops a refresh buying time.
   */
  it('returns the open run rather than restarting the clock', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(
      quizFixture({ timeLimitMinutes: 30 }) as never,
    );
    const startedAt = new Date(Date.now() - 10 * 60_000);
    const expiresAt = new Date(Date.now() + 20 * 60_000);
    mockQuizGateway.findOpenSession.mockResolvedValue({
      id: 'existing',
      startedAt,
      expiresAt,
    } as never);

    const session = await QuizService.startSession(1, 'quiz-1');

    expect(session.sessionId).toBe('existing');
    expect(mockQuizGateway.createSession).not.toHaveBeenCalled();
    expect(session.secondsRemaining).toBeLessThanOrEqual(20 * 60);
  });

  it('reports an already-expired run rather than silently reissuing one', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(
      quizFixture({ timeLimitMinutes: 5 }) as never,
    );
    mockQuizGateway.findOpenSession.mockResolvedValue({
      id: 'stale',
      startedAt: new Date(Date.now() - 600_000),
      expiresAt: new Date(Date.now() - 300_000),
    } as never);

    const session = await QuizService.startSession(1, 'quiz-1');

    expect(session.expired).toBe(true);
    expect(session.secondsRemaining).toBe(0);
  });
});

describe('question validation', () => {
  beforeEach(() => {
    mockQuizGateway.getQuizById.mockResolvedValue(quizFixture() as never);
    (mockQuizGateway.runTransaction as unknown as jest.Mock).mockImplementation(
      async (fn: (db: unknown) => unknown) => fn({}),
    );
    mockQuizGateway.getLastQuestionOrder.mockResolvedValue({ order: 2 } as never);
    mockQuizGateway.createQuestion.mockResolvedValue({} as never);
  });

  it('requires a prompt', async () => {
    await expect(QuizService.addQuestion('quiz-1', { prompt: '  ', options: [] })).rejects.toThrow(
      /prompt/i,
    );
  });

  it('requires at least two options', async () => {
    await expect(
      QuizService.addQuestion('quiz-1', { prompt: 'Q', options: [{ text: 'only' }] }),
    ).rejects.toThrow(/at least 2 options/);
  });

  it('requires exactly one correct option', async () => {
    const none = [{ text: 'a' }, { text: 'b' }];
    await expect(QuizService.addQuestion('quiz-1', { prompt: 'Q', options: none })).rejects.toThrow(
      /exactly one/,
    );

    const two = [
      { text: 'a', isCorrect: true },
      { text: 'b', isCorrect: true },
    ];
    await expect(QuizService.addQuestion('quiz-1', { prompt: 'Q', options: two })).rejects.toThrow(
      /exactly one/,
    );
  });

  it('requires every option to have text', async () => {
    await expect(
      QuizService.addQuestion('quiz-1', {
        prompt: 'Q',
        options: [{ text: 'a', isCorrect: true }, { text: '   ' }],
      }),
    ).rejects.toThrow(/every option/);
  });

  it('accepts a well-formed question', async () => {
    await expect(
      QuizService.addQuestion('quiz-1', {
        prompt: 'Q',
        options: [{ text: 'a', isCorrect: true }, { text: 'b' }],
      }),
    ).resolves.not.toThrow();
  });

  it('caps the number of options so one question cannot become a payload', async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ text: `opt ${i}`, isCorrect: i === 0 }));
    await expect(QuizService.addQuestion('quiz-1', { prompt: 'Q', options: many })).rejects.toThrow(
      /at most 10 options/,
    );
  });
});
