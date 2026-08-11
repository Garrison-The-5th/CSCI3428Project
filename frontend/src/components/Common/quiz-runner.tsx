/**
 * File: quiz-runner.tsx
 * Description: Takes a quiz and submits it for server-side grading. Used on the Quizzes tab and.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Takes a quiz and submits it for server-side grading. Used on the Quizzes tab and
 * inline inside a module on the Learning tab, so both behave identically.
 *
 * The learner-facing API strips `isCorrect`, so this component cannot reveal the
 * answers even if it wanted to — after grading, the server sends back the correct
 * option ids only when the author enabled "show answers" for the quiz.
 *
 * Timing is the server's business. This asks it to open a run, gets back a
 * deadline, and counts down to it; leaving the page and coming back re-reads the
 * same deadline rather than starting again. The countdown here is a display of
 * that deadline, never the authority on it.
 */
import { LightBulbIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useRef, useState } from 'react';

import QuizTimer from '@/components/common/quiz-timer';
import { Button } from '@/components/ui/button';
import { useLearnerApi } from '@/services/learner-api';
import { AttemptResult, Quiz } from '@/services/quiz-api';
import { logger } from '@/utils/logger';

interface QuizRunnerProps {
  quiz: Quiz;
  /** Called after a successful attempt so progress can be refreshed. */
  onCompleted?: () => void;
}

const QuizRunner = ({ quiz, onCompleted }: QuizRunnerProps) => {
  const api = useLearnerApi();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openHintId, setOpenHintId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  /** Absolute deadline in local epoch ms, or null when the run is untimed. */
  const [deadline, setDeadline] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  /**
   * Guards the auto-submit. A tick, a click and a re-render can all reach for it
   * at once, and a quiz must be graded once.
   */
  const submittedRef = useRef(false);

  const submit = useCallback(
    async (answered: Record<string, string>) => {
      if (submittedRef.current) return;
      submittedRef.current = true;

      try {
        setSubmitting(true);
        setError(null);
        const attempt = await api.submitAttempt(quiz.id, answered);
        setResult(attempt);
        setDeadline(null);
        onCompleted?.();
      } catch (err) {
        logger.error('Error submitting quiz:', err);
        setError('Failed to submit the quiz');
        // Let them try again — the run is still open server-side.
        submittedRef.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    // api is rebuilt each render; depending on it would restart the effect below.

    [quiz.id, onCompleted],
  );

  // Open the run as soon as the quiz is on screen. The server hands back the
  // existing deadline if there is one, so this is safe on every mount — a reload
  // resumes the clock rather than resetting it.
  useEffect(() => {
    let cancelled = false;
    submittedRef.current = false;
    setAnswers({});
    setResult(null);
    setError(null);
    setDeadline(null);
    setSecondsLeft(null);

    (async () => {
      try {
        const session = await api.startQuiz(quiz.id);
        if (cancelled || session.secondsRemaining === null) return;

        // Anchor to the local clock via secondsRemaining rather than parsing
        // expiresAt directly: a device clock that is minutes out would otherwise
        // show a wrong — possibly already expired — countdown.
        setDeadline(Date.now() + session.secondsRemaining * 1000);
        setSecondsLeft(session.secondsRemaining);
      } catch (err) {
        logger.error('Could not start this quiz:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [quiz.id]);

  // Tick the display, and hand the paper in when the time is up.
  useEffect(() => {
    if (deadline === null || result) return;

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      // Auto-complete: whatever has been answered by now is what gets graded.
      if (remaining === 0) submit(answers);
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [deadline, result, answers, submit]);

  const reset = () => {
    setAnswers({});
    setResult(null);
    setError(null);
    submittedRef.current = false;
    // Retaking opens a fresh run, and with it a fresh clock.
    api
      .startQuiz(quiz.id)
      .then((session) => {
        if (session.secondsRemaining === null) return;
        setDeadline(Date.now() + session.secondsRemaining * 1000);
        setSecondsLeft(session.secondsRemaining);
      })
      .catch((err) => logger.error('Could not restart this quiz:', err));
  };

  const revealed = result?.showAnswers === true;
  const correctIds = new Set(result?.correctOptionIds ?? []);
  const unanswered = quiz.questions.filter((question) => !answers[question.id]).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {quiz.dueDate && (
          <p className="text-sm font-medium text-dark-gray">
            Due {new Date(quiz.dueDate).toLocaleDateString()}
          </p>
        )}

        {/* The countdown itself is the floating widget below, not a line here:
            it has to stay visible however far down the page they scroll. */}
        {secondsLeft !== null && !result && (
          <p className="text-sm text-dark-gray">
            Timed quiz — the clock is in the corner and can be dragged.
          </p>
        )}
      </div>

      {secondsLeft !== null && !result && (
        <QuizTimer secondsLeft={secondsLeft} totalSeconds={(quiz.timeLimitMinutes ?? 0) * 60} />
      )}

      {error && <div className="border-2 bg-danger p-3">{error}</div>}

      {result?.timedOut && (
        <div className="rounded-lg border border-navy/30 bg-navy/5 p-3 text-sm text-dark-gray">
          Time ran out, so this was handed in automatically.
        </div>
      )}

      {quiz.questions.length === 0 ? (
        <p className="text-dark-gray">No questions in this quiz yet.</p>
      ) : (
        <>
          {quiz.questions.map((question) => (
            <fieldset
              key={question.id}
              className="relative rounded-lg border border-gray-300 bg-white p-4"
            >
              <legend className="px-1 font-semibold text-dark-gray">
                {question.order}. {question.prompt}
              </legend>

              {question.hint && (
                <div className="mt-1">
                  <Button
                    type="button"
                    onClick={() => setOpenHintId(openHintId === question.id ? null : question.id)}
                    variant="ghost"
                    className="h-auto gap-1 px-0 text-sm text-navy hover:text-green-hover"
                  >
                    <LightBulbIcon className="w-4 h-4" />
                    {openHintId === question.id ? 'Hide hint' : 'Need a hint?'}
                  </Button>

                  {openHintId === question.id && (
                    <div
                      role="note"
                      className="mt-2 flex items-start gap-2 rounded-lg border border-navy/30
                        bg-light-gray p-3"
                    >
                      <LightBulbIcon className="mt-0.5 w-5 h-5 shrink-0 text-navy" />
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm text-dark-gray">{question.hint}</p>
                        {question.hintModuleNumber && (
                          <p className="mt-1 text-sm font-semibold text-dark-gray">
                            See module {question.hintModuleNumber}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        onClick={() => setOpenHintId(null)}
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        title="Close hint"
                      >
                        <XMarkIcon className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-2 flex flex-col gap-2">
                {question.options.map((option) => {
                  const selected = answers[question.id] === option.id;

                  // After grading, only mark answers when the author allows it.
                  let stateClass = 'text-dark-gray';
                  if (revealed && correctIds.has(option.id)) {
                    stateClass = 'font-semibold text-green';
                  } else if (revealed && selected) {
                    stateClass = 'font-semibold text-danger';
                  } else if (result && selected) {
                    stateClass = 'font-semibold text-dark-gray';
                  }

                  return (
                    <label
                      key={option.id}
                      className={`flex cursor-pointer items-center gap-3 ${stateClass}`}
                    >
                      <input
                        type="radio"
                        name={`${quiz.id}-${question.id}`}
                        checked={selected}
                        disabled={result !== null}
                        onChange={() =>
                          setAnswers((prev) => ({ ...prev, [question.id]: option.id }))
                        }
                        className="h-4 w-4 shrink-0 accent-[#5b9748]"
                      />
                      <span className="break-words">{option.text}</span>
                      {revealed && correctIds.has(option.id) && <span aria-hidden="true">✓</span>}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}

          <div className="flex flex-wrap items-center gap-4">
            {result ? (
              <>
                <p className="font-semibold text-dark-gray">
                  Score: {result.score} / {result.total}
                </p>
                {!revealed && (
                  <p className="text-sm text-dark-gray">Answers are hidden for this quiz.</p>
                )}
                <Button
                  onClick={reset}
                  variant="outline"
                  className="bg-white text-dark-gray hover:bg-light-gray"
                >
                  Try Again
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={() => setConfirming(true)}
                  disabled={submitting}
                  className="bg-navy text-white hover:bg-navy-hover"
                >
                  {submitting ? 'Submitting...' : 'Complete quiz'}
                </Button>
                {unanswered > 0 && (
                  <p className="text-sm text-dark-gray">
                    {unanswered} question{unanswered === 1 ? '' : 's'} unanswered
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* Handing in is final, so it asks first. */}
      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-quiz-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setConfirming(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
          >
            <h2 id="submit-quiz-title" className="text-xl font-bold text-dark-gray">
              Submit quiz
            </h2>
            <p className="mt-2 text-dark-gray">
              {unanswered > 0
                ? `You have ${unanswered} question${unanswered === 1 ? '' : 's'} unanswered. Submit anyway?`
                : 'Ready to hand this in?'}
            </p>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button
                onClick={() => setConfirming(false)}
                variant="outline"
                className="bg-white text-dark-gray hover:bg-light-gray"
              >
                Go back to quiz
              </Button>
              <Button
                onClick={() => {
                  setConfirming(false);
                  submit(answers);
                }}
                className="bg-navy text-white hover:bg-navy-hover"
              >
                Submit
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuizRunner;
