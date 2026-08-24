/**
 * File: quiz-service.test.ts
 * Description: Unit tests for quiz grading, answer redaction, question
 *   validation and timed sessions.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
import AssignmentGateway from '@/gateways/assignment-gateway/assignment-gateway';
import CurriculumGateway from '@/gateways/curriculum-gateway/curriculum-gateway';
import QuizGateway from '@/gateways/quiz-gateway/quiz-gateway';
import EnrolmentService from '@/services/enrolment-service/enrolment-service';
import PublicationService from '@/services/publication-service/publication-service';
import QuizService, { redactAnswers } from '@/services/quiz-service/quiz-service';

jest.mock('@/gateways/quiz-gateway/quiz-gateway');
jest.mock('@/gateways/curriculum-gateway/curriculum-gateway');
jest.mock('@/gateways/assignment-gateway/assignment-gateway');
jest.mock('@/services/publication-service/publication-service');
jest.mock('@/services/enrolment-service/enrolment-service');

const mockQuizGateway = QuizGateway as jest.Mocked<typeof QuizGateway>;
const mockCurriculum = CurriculumGateway as jest.Mocked<typeof CurriculumGateway>;
const mockPublication = PublicationService as jest.Mocked<typeof PublicationService>;
const mockEnrolment = EnrolmentService as jest.Mocked<typeof EnrolmentService>;
const mockAssignments = AssignmentGateway as jest.Mocked<typeof AssignmentGateway>;

/** A published quiz with a known answer key: option `a2` is correct. */
function quizFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'quiz-1',
    title: 'Fire safety',
    description: null,
    sectionId: 'section-1',
    order: 1,
    type: 'EXAM',
    published: true,
    showResults: true,
    showAnswers: false,
    dueDate: null,
    timeLimitMinutes: null,
    questions: [
      {
        id: 'q1',
        order: 1,
        prompt: 'Where is the extinguisher?',
        hint: null,
        hintSectionNumber: null,
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
        hintSectionNumber: null,
        options: [
          { id: 'b1', order: 1, text: 'Reception', isCorrect: true },
          { id: 'b2', order: 2, text: 'Nobody', isCorrect: false },
        ],
      },
    ],
    ...overrides,
  };
}

/**
 * Nobody has sat anything, unless the test in hand says they have.
 *
 * `clearMocks` resets the record of calls but not the implementations, so a
 * `mockResolvedValue` set in one test is still answering in every test after it
 * in the file. "Has this person already handed this in" is exactly the kind of
 * answer that quietly changes what a later, unrelated test is exercising — it
 * decides whether a quiz may be started at all — so it is put back to no here
 * rather than left to whichever test ran last.
 */
beforeEach(() => {
  mockQuizGateway.hasAttempted.mockResolvedValue(false as never);
  mockQuizGateway.findLatestAttempt.mockResolvedValue(null as never);
});

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
    mockQuizGateway.recordAttempt.mockResolvedValue({ id: 'attempt-1' } as never);
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

  /**
   * Handing a quiz in credits the section it sits in.
   *
   * A section counts as done when it has been viewed *and* its quizzes have been
   * attempted, and the view half used to be recorded only by opening a piece of
   * content. A quiz set's sections hold nothing but the quiz, so a learner could
   * sit a whole set, score full marks, and still show nought per cent — which is
   * what a one-time link did: the dashboard knew about the attempt and the course
   * knew nothing.
   */
  it('credits the section the quiz sits in, so the course can complete', async () => {
    await QuizService.submitAttempt(7, 'quiz-1', { q1: 'a2', q2: 'b1' });
    expect(mockCurriculum.recordSectionView).toHaveBeenCalledWith(7, 'section-1');
  });

  it('has nothing to credit for a quiz that stands on its own', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(quizFixture({ sectionId: null }) as never);

    await QuizService.submitAttempt(7, 'quiz-1', { q1: 'a2' });

    expect(mockCurriculum.recordSectionView).not.toHaveBeenCalled();
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

  /**
   * The paper is kept for every kind now.
   *
   * It was one-time only, on the reasoning that a retake supersedes it anyway.
   * What that missed is coming back to a quiz already handed in, where the
   * learner has to see what they saw when they submitted — and the attempt row
   * alone cannot say which questions they got right or what they ticked.
   */
  it('keeps the paper for an ordinary exam', async () => {
    await QuizService.submitAttempt(1, 'quiz-1', { q1: 'a2', q2: 'b2' });

    expect(mockQuizGateway.recordAnswers).toHaveBeenCalledWith('attempt-1', [
      expect.objectContaining({ questionId: 'q1', chosen: ['By the door'], wasCorrect: true }),
      expect.objectContaining({ questionId: 'q2', chosen: ['Nobody'], wasCorrect: false }),
    ]);
  });

  /** Only a one-time link closes the URL it arrived on. */
  it('does not close an exam’s assignment', async () => {
    await QuizService.submitAttempt(1, 'quiz-1', { q1: 'a2' });
    expect(mockAssignments.markQuizCompleted).not.toHaveBeenCalled();
  });

  it('closes the link a one-time quiz arrived on', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(quizFixture({ type: 'ONE_TIME' }) as never);

    await QuizService.submitAttempt(1, 'quiz-1', { q1: 'a2' });

    expect(mockAssignments.markQuizCompleted).toHaveBeenCalledWith(1, 'quiz-1');
  });
});

/**
 * How many goes somebody gets.
 *
 * Three answers, and the server has to hold all three or the Try again button is
 * a hope rather than a statement: a one-time link never reopens, an exam reopens
 * only when its author allowed it, and a learning check always does because it
 * keeps no mark that a retake could spoil.
 */
describe('submitAttempt — how many sittings', () => {
  beforeEach(() => {
    mockQuizGateway.findOpenSession.mockResolvedValue(null as never);
    mockQuizGateway.recordAttempt.mockResolvedValue({ id: 'attempt-1' } as never);
    mockQuizGateway.hasAttempted.mockResolvedValue(true as never);
  });

  it('refuses a second go at a one-time quiz', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(quizFixture({ type: 'ONE_TIME' }) as never);

    await expect(QuizService.submitAttempt(1, 'quiz-1', {})).rejects.toThrow(/already completed/i);
  });

  it('refuses a second go at an exam that allows one attempt', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(
      quizFixture({ allowMultipleAttempts: false }) as never,
    );

    await expect(QuizService.submitAttempt(1, 'quiz-1', {})).rejects.toThrow(/already completed/i);
  });

  it('allows a second go at an exam that allows multiple attempts', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(
      quizFixture({ allowMultipleAttempts: true }) as never,
    );

    const result = await QuizService.submitAttempt(1, 'quiz-1', { q1: 'a2', q2: 'b1' });

    expect(result.score).toBe(2);
  });

  it('always allows another go at a learning check', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(
      quizFixture({ type: 'LEARNING_CHECK' }) as never,
    );

    await expect(
      QuizService.submitAttempt(1, 'quiz-1', { q1: 'a2', q2: 'b1' }),
    ).resolves.toBeDefined();
  });

  /** The same three answers, stated again where the clock is handed out. */
  it('refuses to open a run at an exam already sat once', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(
      quizFixture({ allowMultipleAttempts: false }) as never,
    );

    await expect(QuizService.startSession(1, 'quiz-1')).rejects.toThrow(/already completed/i);
    expect(mockQuizGateway.createSession).not.toHaveBeenCalled();
  });

  it('opens a fresh run at an exam that allows multiple attempts', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(
      quizFixture({ allowMultipleAttempts: true }) as never,
    );
    (mockQuizGateway.createSession as unknown as jest.Mock).mockResolvedValue({
      id: 'new-session',
      startedAt: new Date(),
      expiresAt: null,
    });

    const session = await QuizService.startSession(1, 'quiz-1');

    expect(session.started).toBe(true);
    expect(session.sessionId).toBe('new-session');
  });
});

describe('submitAttempt — timed runs', () => {
  beforeEach(() => {
    mockPublication.findPublishedQuiz.mockResolvedValue(
      quizFixture({ timeLimitMinutes: 10 }) as never,
    );
    mockQuizGateway.recordAttempt.mockResolvedValue({ id: 'attempt-1' } as never);
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

/**
 * The details screen in front of a quiz depends entirely on this: it has to be
 * able to ask "are they part way through?" without the asking being what starts
 * them off.
 */
describe('peekSession', () => {
  beforeEach(() => {
    (mockQuizGateway.createSession as unknown as jest.Mock).mockImplementation(
      async (data: object) => ({ id: 'new-session', startedAt: new Date(), ...data }),
    );
  });

  it('reports an unopened quiz without starting the clock', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(
      quizFixture({ timeLimitMinutes: 20 }) as never,
    );
    mockQuizGateway.findOpenSession.mockResolvedValue(null as never);

    const session = await QuizService.peekSession(1, 'quiz-1');

    expect(session.started).toBe(false);
    expect(session.sessionId).toBeNull();
    expect(session.secondsRemaining).toBeNull();
    // The time limit still travels, because the details panel has to show it.
    expect(session.timeLimitMinutes).toBe(20);
    expect(mockQuizGateway.createSession).not.toHaveBeenCalled();
  });

  it('reports the run already open, with the time left on it', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(
      quizFixture({ timeLimitMinutes: 30 }) as never,
    );
    mockQuizGateway.findOpenSession.mockResolvedValue({
      id: 'existing',
      startedAt: new Date(Date.now() - 10 * 60_000),
      expiresAt: new Date(Date.now() + 20 * 60_000),
    } as never);

    const session = await QuizService.peekSession(1, 'quiz-1');

    expect(session.started).toBe(true);
    expect(session.sessionId).toBe('existing');
    expect(session.secondsRemaining).toBeLessThanOrEqual(20 * 60);
    expect(mockQuizGateway.createSession).not.toHaveBeenCalled();
  });

  /**
   * A one-time quiz already handed in is a state to draw, not a failed request —
   * so this reports it rather than throwing the way `startSession` does.
   */
  it('reports a one-time quiz that has already been handed in', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(quizFixture({ type: 'ONE_TIME' }) as never);
    mockQuizGateway.hasAttempted.mockResolvedValue(true as never);

    const session = await QuizService.peekSession(1, 'quiz-1');

    expect(session.completed).toBe(true);
    expect(session.started).toBe(false);
  });

  /** A learning check has no front, so it never reports itself as unstarted. */
  it('treats a learning check as already under way', async () => {
    mockPublication.findPublishedQuiz.mockResolvedValue(
      quizFixture({ type: 'LEARNING_CHECK' }) as never,
    );

    const session = await QuizService.peekSession(1, 'quiz-1');

    expect(session.started).toBe(true);
    expect(session.sessionId).toBeNull();
    expect(mockQuizGateway.findOpenSession).not.toHaveBeenCalled();
  });

  /**
   * Coming back to something already handed in.
   *
   * The paper is what makes a revisit show what the learner saw on the day
   * rather than an empty form, so it comes back for every kind — not just the
   * one that cannot be retaken. `completed` is the narrower fact underneath it:
   * not "they have done this" but "they may not do it again".
   */
  describe('a sitting already done', () => {
    /** An attempt with a marked paper against the fixture's two questions. */
    function pastAttempt() {
      mockQuizGateway.hasAttempted.mockResolvedValue(true as never);
      mockQuizGateway.findLatestAttempt.mockResolvedValue({
        id: 'attempt-1',
        score: 1,
        total: 2,
        answers: [
          {
            questionId: 'q1',
            order: 1,
            chosen: ['By the door'],
            correct: ['By the door'],
            wasCorrect: true,
          },
          {
            questionId: 'q2',
            order: 2,
            chosen: ['Nobody'],
            correct: ['Reception'],
            wasCorrect: false,
          },
        ],
      } as never);
    }

    it('closes a one-time quiz and hands its paper back', async () => {
      mockPublication.findPublishedQuiz.mockResolvedValue(
        quizFixture({ type: 'ONE_TIME' }) as never,
      );
      pastAttempt();

      const session = await QuizService.peekSession(1, 'quiz-1');

      expect(session.completed).toBe(true);
      expect(session.started).toBe(false);
      expect(session.result?.score).toBe(1);
      expect(session.result?.perQuestion).toEqual([
        expect.objectContaining({ questionId: 'q1', correct: true }),
        expect.objectContaining({ questionId: 'q2', correct: false }),
      ]);
    });

    /** One sitting is what an exam means until its author says otherwise. */
    it('closes an exam that does not allow multiple attempts', async () => {
      mockPublication.findPublishedQuiz.mockResolvedValue(
        quizFixture({ allowMultipleAttempts: false }) as never,
      );
      pastAttempt();

      const session = await QuizService.peekSession(1, 'quiz-1');

      expect(session.completed).toBe(true);
      expect(session.result?.score).toBe(1);
    });

    /** Allowed a retake, so the result comes back without the door shutting. */
    it('leaves an exam open when multiple attempts are allowed', async () => {
      mockPublication.findPublishedQuiz.mockResolvedValue(
        quizFixture({ allowMultipleAttempts: true }) as never,
      );
      mockQuizGateway.findOpenSession.mockResolvedValue(null as never);
      pastAttempt();

      const session = await QuizService.peekSession(1, 'quiz-1');

      expect(session.completed).toBe(false);
      expect(session.result?.score).toBe(1);
    });

    /**
     * A learning check keeps no mark — its attempt row is 0 of 0 — so the ring
     * is counted back off the paper. The rule that nothing about how they did is
     * stored anywhere reportable holds; what comes back is the screen they saw.
     */
    it('never closes a learning check, and counts its ring off the paper', async () => {
      mockPublication.findPublishedQuiz.mockResolvedValue(
        quizFixture({ type: 'LEARNING_CHECK' }) as never,
      );
      mockQuizGateway.hasAttempted.mockResolvedValue(true as never);
      mockQuizGateway.findLatestAttempt.mockResolvedValue({
        id: 'attempt-1',
        score: 0,
        total: 0,
        answers: [
          { questionId: 'q1', order: 1, chosen: [], correct: [], wasCorrect: true },
          { questionId: 'q2', order: 2, chosen: [], correct: [], wasCorrect: false },
        ],
      } as never);

      const session = await QuizService.peekSession(1, 'quiz-1');

      expect(session.completed).toBe(false);
      expect(session.result?.score).toBe(1);
      expect(session.result?.total).toBe(2);
    });

    /**
     * The paper records option *text*, so it can be read on its own long after
     * the quiz is edited. Turning it back into ids is what lets the revisited
     * form come back ticked rather than blank with marks floating beside it.
     */
    it('rebuilds what was ticked as option ids', async () => {
      mockPublication.findPublishedQuiz.mockResolvedValue(
        quizFixture({ type: 'ONE_TIME', showAnswers: true }) as never,
      );
      pastAttempt();

      const session = await QuizService.peekSession(1, 'quiz-1');

      expect(session.result?.perQuestion[0].chosenOptionIds).toEqual(['a2']);
      expect(session.result?.perQuestion[1].chosenOptionIds).toEqual(['b2']);
      expect(session.result?.correctOptionIds).toEqual(['a2', 'b1']);
    });

    /** Answers stay the author's to disclose, on a second look as on the first. */
    it('withholds the answer key when the author has not allowed it', async () => {
      mockPublication.findPublishedQuiz.mockResolvedValue(
        quizFixture({ type: 'ONE_TIME', showAnswers: false }) as never,
      );
      pastAttempt();

      const session = await QuizService.peekSession(1, 'quiz-1');

      expect(session.result?.correctOptionIds).toEqual([]);
    });
  });
});

/**
 * Which tab a quiz is listed on.
 *
 * A course belongs to the tab it was created on, and so does everything in it. A
 * lesson's quizzes follow on from the content either side of them and are taken
 * in place from the Learning tab; listing them here as well offered the same
 * quiz in two places, one of which stripped it of everything it was written
 * against.
 */
describe('getQuizzesForLearner — quiz sets only', () => {
  function snapshot(kind: 'LESSON' | 'QUIZ_SET', quizId: string) {
    return {
      id: `course-${quizId}`,
      kind,
      sections: [{ quizzes: [{ ...quizFixture({ id: quizId }), type: 'EXAM' }] }],
    };
  }

  beforeEach(() => {
    mockEnrolment.forEmail.mockResolvedValue({
      courseIds: new Set(['course-set', 'course-lesson']),
      quizIds: new Set(),
    } as never);
    mockCurriculum.getPublishedCourses.mockResolvedValue([
      { id: 'course-set' },
      { id: 'course-lesson' },
    ] as never);
  });

  it('lists a quiz set’s quizzes and leaves a lesson’s alone', async () => {
    mockPublication.getLiveSnapshots.mockResolvedValue([
      snapshot('QUIZ_SET', 'in-set'),
      snapshot('LESSON', 'in-lesson'),
    ] as never);

    const quizzes = await QuizService.getQuizzesForLearner('ada@example.com');

    expect(quizzes.map((quiz) => quiz.id)).toEqual(['in-set']);
  });

  /** An older snapshot with no kind on it reads as a lesson, so it stays out. */
  it('treats a snapshot with no kind as a lesson', async () => {
    mockPublication.getLiveSnapshots.mockResolvedValue([
      { id: 'course-old', sections: [{ quizzes: [quizFixture({ id: 'old' })] }] },
    ] as never);

    expect(await QuizService.getQuizzesForLearner('ada@example.com')).toEqual([]);
  });
});

/**
 * Where a one-time link may live, and what it may live beside.
 *
 * Both halves matter: a lesson section would make it reachable by reading the
 * lesson, and a second quiz in its set would be handed over by the same link.
 */
describe('one-time link placement', () => {
  const section = { id: 'section-1', courseId: 'course-1' };

  beforeEach(() => {
    mockCurriculum.getSectionById.mockResolvedValue(section as never);
    mockQuizGateway.createQuiz.mockResolvedValue(quizFixture() as never);
    mockQuizGateway.updateQuiz.mockResolvedValue(quizFixture() as never);
    mockCurriculum.getLastContentOrder.mockResolvedValue(0 as never);
  });

  /** One section means one quiz: the set is nothing but the one-time link. */
  function quizSetWith(sectionCount: number) {
    mockCurriculum.getCourseById.mockResolvedValue({ id: 'course-1', kind: 'QUIZ_SET' } as never);
    mockCurriculum.getSectionsForRenumber.mockResolvedValue(
      Array.from({ length: sectionCount }, (_, i) => ({ id: `section-${i + 1}` })) as never,
    );
  }

  it('lets a one-time link own the only section of a quiz set', async () => {
    quizSetWith(1);

    await expect(
      QuizService.createQuiz({ title: 'Assessment', type: 'ONE_TIME', sectionId: 'section-1' }),
    ).resolves.toBeDefined();

    expect(mockQuizGateway.createQuiz).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ONE_TIME', sectionId: 'section-1' }),
    );
  });

  it('refuses a one-time link in a lesson section', async () => {
    mockCurriculum.getCourseById.mockResolvedValue({ id: 'course-1', kind: 'LESSON' } as never);

    await expect(
      QuizService.createQuiz({ title: 'Assessment', type: 'ONE_TIME', sectionId: 'section-1' }),
    ).rejects.toThrow(/cannot sit in a lesson section/);
  });

  it('refuses a one-time link in a set that holds more than one quiz', async () => {
    quizSetWith(3);

    await expect(
      QuizService.createQuiz({ title: 'Assessment', type: 'ONE_TIME', sectionId: 'section-1' }),
    ).rejects.toThrow(/only quiz in its set/);
  });

  it('applies the same rules when an existing quiz is switched to one-time', async () => {
    mockQuizGateway.getQuizById.mockResolvedValue(
      quizFixture({ type: 'EXAM', sectionId: 'section-1' }) as never,
    );

    quizSetWith(2);
    await expect(QuizService.updateQuiz('quiz-1', { type: 'ONE_TIME' })).rejects.toThrow(
      /only quiz in its set/,
    );

    quizSetWith(1);
    await expect(QuizService.updateQuiz('quiz-1', { type: 'ONE_TIME' })).resolves.toBeDefined();
  });

  /** Standing on its own is what a one-time link has always been able to do. */
  it('still allows a one-time link with no section at all', async () => {
    await expect(
      QuizService.createQuiz({ title: 'Assessment', type: 'ONE_TIME' }),
    ).resolves.toBeDefined();

    expect(mockQuizGateway.createQuiz).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ONE_TIME', sectionId: null }),
    );
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

  it('requires at least one correct option', async () => {
    const none = [{ text: 'a' }, { text: 'b' }];
    await expect(QuizService.addQuestion('quiz-1', { prompt: 'Q', options: none })).rejects.toThrow(
      /at least one option must be marked correct/,
    );

    // Two correct options out of three is a multiple-answer question, and is
    // allowed — what is refused is marking every option correct, which leaves
    // nothing to get wrong.
    const all = [
      { text: 'a', isCorrect: true },
      { text: 'b', isCorrect: true },
    ];
    await expect(QuizService.addQuestion('quiz-1', { prompt: 'Q', options: all })).rejects.toThrow(
      /nothing to answer/,
    );
  });

  it('accepts a question with more than one correct answer', async () => {
    const options = [
      { text: 'a', isCorrect: true },
      { text: 'b', isCorrect: true },
      { text: 'c', isCorrect: false },
    ];
    await expect(
      QuizService.addQuestion('quiz-1', { prompt: 'Q', options }),
    ).resolves.not.toThrow();
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
