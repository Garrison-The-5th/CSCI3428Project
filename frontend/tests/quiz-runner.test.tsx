/**
 * File: quiz-runner.test.tsx
 * Description: Component tests for the two phases of a quiz — the details panel
 *   in front of it, and the show-results / show-answers matrix behind it.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import QuizRunner from '@/components/common/quiz-runner';
import type { AttemptResult, Quiz } from '@/services/quiz-api';

/**
 * What a learner sees after handing a quiz in.
 *
 * This is worth testing at the component level rather than by picking apart the
 * helpers, because the failure mode is a disclosure: the bug these cover is a
 * learner being shown a marked paper the author switched off. "Did the questions
 * disappear" is the actual requirement, and only the rendered output answers it.
 *
 * The rules, and where they come from:
 *   - `showResults` governs the score ring.
 *   - `showAnswers` governs whether the paper comes back at all, because a marked
 *     question next to the option someone ticked gives the answer away even
 *     without the correct one highlighted.
 *   - A LEARNING_CHECK ignores both for the paper itself: telling the learner
 *     which questions they got right is the whole point of the kind, and
 *     `showAnswers` defaults to false for every quiz, so folding it into the
 *     toggles left every learning check submitting to a blank screen.
 */

const peekQuiz = jest.fn();
const startQuiz = jest.fn();
const submitAttempt = jest.fn();

jest.mock('@/services/learner-api', () => ({
  useLearnerApi: () => ({ peekQuiz, startQuiz, submitAttempt }),
}));

function quizOf(overrides: Partial<Quiz> = {}): Quiz {
  return {
    id: 'q1',
    title: 'Fire safety',
    description: null,
    type: 'EXAM',
    sectionId: 's1',
    order: 1,
    published: true,
    showResults: true,
    showAnswers: false,
    dueDate: null,
    timeLimitMinutes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    questions: [
      {
        id: 'qq1',
        order: 1,
        prompt: 'Where is the assembly point?',
        hint: null,
        hintSectionNumber: null,
        options: [
          { id: 'o1', order: 1, text: 'Car park' },
          { id: 'o2', order: 2, text: 'Roof' },
        ],
      },
    ],
    ...overrides,
  } as Quiz;
}

function resultOf(overrides: Partial<AttemptResult> = {}): AttemptResult {
  return {
    score: 1,
    total: 1,
    timedOut: false,
    type: 'EXAM',
    showResults: true,
    showAnswers: false,
    perQuestion: [{ questionId: 'qq1', correct: true }],
    correctOptionIds: [],
    ...overrides,
  } as AttemptResult;
}

/** A run nobody has opened yet — what the details panel is drawn from. */
function unopened(overrides: Record<string, unknown> = {}) {
  return { secondsRemaining: null, started: false, completed: false, result: null, ...overrides };
}

/**
 * Gets to the questions.
 *
 * An exam and a one-time link open on their details behind a Start button; a
 * learning check has no front and is on its questions already. Waiting for
 * whichever button turns up covers both without the caller having to say which
 * kind it rendered.
 */
async function reachQuestions(user: ReturnType<typeof userEvent.setup>) {
  const button = await screen.findByRole('button', { name: /start quiz|complete quiz/i });
  if (/start quiz/i.test(button.textContent ?? '')) await user.click(button);
}

/** Answers the one question and confirms the dialog, leaving the result on screen. */
async function submit(user: ReturnType<typeof userEvent.setup>) {
  await reachQuestions(user);
  await user.click(screen.getByLabelText(/car park/i, { selector: 'input' }));
  await user.click(screen.getByRole('button', { name: /complete quiz/i }));
  await user.click(screen.getByRole('button', { name: /^submit$/i }));
}

beforeEach(() => {
  jest.clearAllMocks();
  peekQuiz.mockResolvedValue(unopened());
  startQuiz.mockResolvedValue({ secondsRemaining: null, started: true, completed: false });
});

describe('after submitting — the results/answers matrix', () => {
  /**
   * The reported bug: score on, answers off still handed the whole paper back,
   * so "hide the correct answers" hid nothing anybody cared about.
   */
  it('shows the score and hides the questions when answers are off', async () => {
    const user = userEvent.setup();
    submitAttempt.mockResolvedValue(resultOf({ showResults: true, showAnswers: false }));

    render(<QuizRunner quiz={quizOf()} onFinished={jest.fn()} />);
    await submit(user);

    expect(await screen.findByText(/you scored/i)).toBeInTheDocument();
    expect(screen.queryByText(/where is the assembly point/i)).not.toBeInTheDocument();
  });

  it('shows the questions and no score when results are off', async () => {
    const user = userEvent.setup();
    submitAttempt.mockResolvedValue(
      resultOf({ showResults: false, showAnswers: true, correctOptionIds: ['o1'] }),
    );

    render(<QuizRunner quiz={quizOf()} onFinished={jest.fn()} />);
    await submit(user);

    expect(await screen.findByText(/quiz submitted/i)).toBeInTheDocument();
    expect(screen.getByText(/where is the assembly point/i)).toBeInTheDocument();
    expect(screen.queryByText(/you scored/i)).not.toBeInTheDocument();
  });

  it('shows both when both are on', async () => {
    const user = userEvent.setup();
    submitAttempt.mockResolvedValue(
      resultOf({ showResults: true, showAnswers: true, correctOptionIds: ['o1'] }),
    );

    render(<QuizRunner quiz={quizOf()} onFinished={jest.fn()} />);
    await submit(user);

    expect(await screen.findByText(/you scored/i)).toBeInTheDocument();
    expect(screen.getByText(/where is the assembly point/i)).toBeInTheDocument();
  });

  /** Nothing to report, so the learner is moved on rather than shown a blank panel. */
  it('leaves immediately when both are off', async () => {
    const user = userEvent.setup();
    const onFinished = jest.fn();
    submitAttempt.mockResolvedValue(resultOf({ showResults: false, showAnswers: false }));

    render(<QuizRunner quiz={quizOf()} onFinished={onFinished} />);
    await submit(user);

    await waitFor(() => expect(onFinished).toHaveBeenCalled());
    expect(screen.queryByText(/you scored/i)).not.toBeInTheDocument();
  });

  /**
   * There still has to be a way out when the score is hidden. The Next button
   * normally lives under the ring, so hiding the ring once hid it too.
   */
  it('still offers a way onward when the score is hidden', async () => {
    const user = userEvent.setup();
    submitAttempt.mockResolvedValue(resultOf({ showResults: false, showAnswers: true }));

    render(<QuizRunner quiz={quizOf()} onFinished={jest.fn()} finishLabel="Next" />);
    await submit(user);

    expect(await screen.findByRole('button', { name: /next/i })).toBeInTheDocument();
  });
});

describe('learning checks ignore the toggles for the marked paper', () => {
  const learningCheck = () => quizOf({ type: 'LEARNING_CHECK' });

  /**
   * The regression this exists to stop. `showAnswers` is false by default for
   * every quiz and nothing overrides it per type, so a learning check created
   * through the ordinary path and governed by the matrix would submit to a
   * screen with no ticks, no crosses and nothing to learn from.
   */
  it('marks the questions on default settings, with answers off', async () => {
    const user = userEvent.setup();
    submitAttempt.mockResolvedValue(
      resultOf({
        type: 'LEARNING_CHECK',
        showResults: true,
        showAnswers: false,
        score: 0,
        total: 0,
      }),
    );

    render(<QuizRunner quiz={learningCheck()} onFinished={jest.fn()} />);
    await submit(user);

    expect(await screen.findByText(/learning check complete/i)).toBeInTheDocument();
    expect(screen.getByText(/where is the assembly point/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/correct/i)).toBeInTheDocument();
  });

  /** Even with everything off, it stops and shows the marks rather than skipping. */
  it('does not skip past the marks when both toggles are off', async () => {
    const user = userEvent.setup();
    const onFinished = jest.fn();
    submitAttempt.mockResolvedValue(
      resultOf({
        type: 'LEARNING_CHECK',
        showResults: false,
        showAnswers: false,
        score: 0,
        total: 0,
      }),
    );

    render(<QuizRunner quiz={learningCheck()} onFinished={onFinished} />);
    await submit(user);

    expect(await screen.findByText(/learning check complete/i)).toBeInTheDocument();
    expect(screen.getByText(/where is the assembly point/i)).toBeInTheDocument();
    expect(onFinished).not.toHaveBeenCalled();
  });

  /**
   * The half the toggle still controls: which questions were wrong is shown,
   * what the right answer was is not.
   */
  it('withholds the correct option while still marking the question', async () => {
    const user = userEvent.setup();
    submitAttempt.mockResolvedValue(
      resultOf({
        type: 'LEARNING_CHECK',
        showResults: false,
        showAnswers: false,
        correctOptionIds: [],
        perQuestion: [{ questionId: 'qq1', correct: false }],
      }),
    );

    render(<QuizRunner quiz={learningCheck()} onFinished={jest.fn()} />);
    await submit(user);

    expect(await screen.findByLabelText(/incorrect/i)).toBeInTheDocument();
    // The tick that flags a correct option is never drawn without the answers on.
    expect(screen.queryByText('✓')).not.toBeInTheDocument();
  });
});

describe('submitting is gated', () => {
  /** A learning check is a gate: it cannot be handed in half done. */
  it('blocks submit on a learning check until every question is answered', () => {
    render(<QuizRunner quiz={quizOf({ type: 'LEARNING_CHECK' })} onFinished={jest.fn()} />);

    expect(screen.getByRole('button', { name: /complete quiz/i })).toBeDisabled();
  });

  it('allows an exam to be handed in unanswered', async () => {
    const user = userEvent.setup();
    render(<QuizRunner quiz={quizOf()} onFinished={jest.fn()} />);
    await reachQuestions(user);

    expect(screen.getByRole('button', { name: /complete quiz/i })).toBeEnabled();
  });
});

/**
 * The front of a quiz.
 *
 * The rule these protect is that looking at a quiz must never be what starts it,
 * and that coming back to a run already ticking must never put a Start button in
 * front of somebody whose clock is running down behind it.
 */
describe('the details panel in front of a timed quiz', () => {
  it('shows what the quiz costs, and does not open a run', async () => {
    render(<QuizRunner quiz={quizOf({ timeLimitMinutes: 20 })} onFinished={jest.fn()} />);

    expect(await screen.findByRole('button', { name: /start quiz/i })).toBeInTheDocument();
    expect(screen.getByText(/1 question/i)).toBeInTheDocument();
    expect(screen.getByText(/20 minutes once you start/i)).toBeInTheDocument();
    // The questions are behind the button, not beside it.
    expect(screen.queryByText(/where is the assembly point/i)).not.toBeInTheDocument();
    expect(startQuiz).not.toHaveBeenCalled();
  });

  it('starts the clock only when Start is pressed', async () => {
    const user = userEvent.setup();
    render(<QuizRunner quiz={quizOf({ timeLimitMinutes: 20 })} onFinished={jest.fn()} />);

    await user.click(await screen.findByRole('button', { name: /start quiz/i }));

    expect(startQuiz).toHaveBeenCalledWith('q1');
    expect(await screen.findByText(/where is the assembly point/i)).toBeInTheDocument();
  });

  /**
   * The reason `peekQuiz` exists at all: somebody who navigates away mid-run and
   * comes back must land on the questions with the time they have left, not on a
   * screen offering to start something already under way.
   */
  it('goes straight into a run already under way', async () => {
    peekQuiz.mockResolvedValue({ secondsRemaining: 240, started: true, completed: false });

    render(<QuizRunner quiz={quizOf({ timeLimitMinutes: 20 })} onFinished={jest.fn()} />);

    expect(await screen.findByText(/where is the assembly point/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start quiz/i })).not.toBeInTheDocument();
    expect(startQuiz).not.toHaveBeenCalled();
  });

  /** A learning check is a pause in a lesson, not something you sit down to. */
  it('never puts a front on a learning check', async () => {
    render(<QuizRunner quiz={quizOf({ type: 'LEARNING_CHECK' })} onFinished={jest.fn()} />);

    expect(await screen.findByText(/where is the assembly point/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start quiz/i })).not.toBeInTheDocument();
  });

  /**
   * Looking must never be what starts something.
   *
   * Every mount peeks — including the kinds that have no door in front of them —
   * because the peek is also what reports a sitting already done. Opening a run
   * is a second, separate call, and only for a quiz that has no front of its own
   * and nothing already under way.
   */
  it('asks before it opens anything', async () => {
    peekQuiz.mockResolvedValue(unopened({ started: true }));

    render(<QuizRunner quiz={quizOf({ type: 'LEARNING_CHECK' })} onFinished={jest.fn()} />);

    await screen.findByText(/where is the assembly point/i);
    expect(peekQuiz).toHaveBeenCalledWith('q1');
    expect(startQuiz).not.toHaveBeenCalled();
  });

  it('warns that a one-time link cannot be reopened, before it is opened', async () => {
    render(<QuizRunner quiz={quizOf({ type: 'ONE_TIME' })} onFinished={jest.fn()} />);

    expect(await screen.findByText(/one attempt only/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start quiz/i })).toBeInTheDocument();
  });

  /** Already handed in is a state to draw, not a Start button that will fail. */
  it('reports a one-time link that has already been handed in', async () => {
    peekQuiz.mockResolvedValue(unopened({ completed: true }));

    render(<QuizRunner quiz={quizOf({ type: 'ONE_TIME' })} onFinished={jest.fn()} />);

    expect(await screen.findByText(/already completed this quiz/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start quiz/i })).not.toBeInTheDocument();
  });

  /**
   * Coming back to a one-time quiz shows the paper, not a shrug.
   *
   * It cannot be sat again, so this is the only way its result is ever seen a
   * second time — and the author's toggles govern it exactly as they do on
   * submission, which is why nothing here is special-cased for a return visit.
   */
  it('hands back the result of a one-time link already sat', async () => {
    peekQuiz.mockResolvedValue(
      unopened({
        completed: true,
        result: resultOf({ type: 'ONE_TIME', showResults: true, showAnswers: false }),
      }),
    );

    render(<QuizRunner quiz={quizOf({ type: 'ONE_TIME' })} onFinished={jest.fn()} />);

    expect(await screen.findByText(/already completed this quiz/i)).toBeInTheDocument();
    expect(screen.getByText(/you scored/i)).toBeInTheDocument();
    // Answers off, so the marked paper stays shut even on a second look.
    expect(screen.queryByText(/where is the assembly point/i)).not.toBeInTheDocument();
  });

  it('shows the marked answers on a return visit when the author allows it', async () => {
    peekQuiz.mockResolvedValue(
      unopened({
        completed: true,
        result: resultOf({
          type: 'ONE_TIME',
          showResults: false,
          showAnswers: true,
          correctOptionIds: ['o1'],
        }),
      }),
    );

    render(<QuizRunner quiz={quizOf({ type: 'ONE_TIME' })} onFinished={jest.fn()} />);

    expect(await screen.findByText(/already completed this quiz/i)).toBeInTheDocument();
    expect(screen.getByText(/where is the assembly point/i)).toBeInTheDocument();
    expect(screen.queryByText(/you scored/i)).not.toBeInTheDocument();
    // Nothing to fill in — it is a record of what happened, not another go.
    expect(screen.queryByRole('button', { name: /complete quiz/i })).not.toBeInTheDocument();
  });

  /**
   * The standalone quiz page is already a front for the quiz — its own About
   * panel and Start button — so a second door behind the first would be a bug.
   */
  it('skips the panel where the page around it is already the front', async () => {
    render(<QuizRunner quiz={quizOf()} showDetails={false} onFinished={jest.fn()} />);

    expect(await screen.findByText(/where is the assembly point/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start quiz/i })).not.toBeInTheDocument();
    expect(startQuiz).toHaveBeenCalledWith('q1');
  });
});

/**
 * Coming back to a quiz already handed in.
 *
 * The requirement is that stepping back onto a finished quiz shows what it
 * showed when it was finished — not an empty form, and not a bare
 * acknowledgement. The server carries the paper on the peek, so this is about
 * what the runner does with it: draw the same result screen, fill the options
 * back in, and offer another go to exactly the kinds that permit one.
 */
describe('returning to a quiz already completed', () => {
  /** A peek reporting a sitting already done, with the paper it came back with. */
  function finished(result: Partial<AttemptResult>, completed = false) {
    peekQuiz.mockResolvedValue(
      unopened({
        completed,
        result: resultOf({
          perQuestion: [{ questionId: 'qq1', correct: true, chosenOptionIds: ['o1'] }],
          ...result,
        }),
      }),
    );
  }

  it('shows the score again instead of the questions', async () => {
    finished({ showResults: true });

    render(<QuizRunner quiz={quizOf()} onFinished={jest.fn()} />);

    expect(await screen.findByText(/you scored 100%/i)).toBeInTheDocument();
    // No second door in front of something already done.
    expect(screen.queryByRole('button', { name: /start quiz/i })).not.toBeInTheDocument();
    expect(startQuiz).not.toHaveBeenCalled();
  });

  /**
   * The marks used to come back beside empty options, which reads as somebody
   * else's paper. What was ticked travels with the result and is put back.
   */
  it('fills the options back in as they were ticked', async () => {
    finished({ showResults: true, showAnswers: true, correctOptionIds: ['o1'] });

    render(<QuizRunner quiz={quizOf()} onFinished={jest.fn()} />);

    await screen.findByText(/you scored 100%/i);
    expect(screen.getByLabelText(/car park/i, { selector: 'input' })).toBeChecked();
    expect(screen.getByLabelText(/roof/i, { selector: 'input' })).not.toBeChecked();
  });

  /** A learning check keeps no mark, so another go spoils nothing. */
  it('offers Restart Quiz on a learning check', async () => {
    finished({ type: 'LEARNING_CHECK', showResults: true });

    render(<QuizRunner quiz={quizOf({ type: 'LEARNING_CHECK' })} onFinished={jest.fn()} />);

    expect(await screen.findByRole('button', { name: /restart quiz/i })).toBeInTheDocument();
  });

  /** One sitting and one mark is what an exam means until the author says otherwise. */
  it('withholds Try again from an exam that allows one attempt', async () => {
    finished({ showResults: true }, true);

    render(<QuizRunner quiz={quizOf({ allowMultipleAttempts: false })} onFinished={jest.fn()} />);

    expect(await screen.findByText(/already completed this quiz/i)).toBeInTheDocument();
    expect(screen.getByText(/single attempt/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restart quiz/i })).not.toBeInTheDocument();
  });

  it('offers Restart Quiz on an exam that allows multiple attempts', async () => {
    finished({ showResults: true });

    render(<QuizRunner quiz={quizOf({ allowMultipleAttempts: true })} onFinished={jest.fn()} />);

    expect(await screen.findByRole('button', { name: /restart quiz/i })).toBeInTheDocument();
    expect(screen.queryByText(/already completed this quiz/i)).not.toBeInTheDocument();
  });

  /** Pressing it opens a fresh run and puts the questions back. */
  it('starts a new run when Restart Quiz is pressed', async () => {
    const user = userEvent.setup();
    finished({ showResults: true });
    startQuiz.mockResolvedValue(unopened({ started: true }));

    render(<QuizRunner quiz={quizOf({ allowMultipleAttempts: true })} onFinished={jest.fn()} />);

    await user.click(await screen.findByRole('button', { name: /restart quiz/i }));

    expect(startQuiz).toHaveBeenCalledWith('q1');
    expect(screen.getByText(/where is the assembly point/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/car park/i, { selector: 'input' })).not.toBeChecked();
  });

  /** A one-time link is the one kind that never reopens. */
  it('never offers Restart Quiz on a one-time link', async () => {
    finished({ type: 'ONE_TIME', showResults: true }, true);

    render(<QuizRunner quiz={quizOf({ type: 'ONE_TIME' })} onFinished={jest.fn()} />);

    expect(await screen.findByText(/only be taken once/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restart quiz/i })).not.toBeInTheDocument();
  });
});
