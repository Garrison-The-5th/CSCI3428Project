/**
 * File: quiz-runner.tsx
 * Description: Takes a quiz of any of the three kinds and submits it for grading.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-11
 */
/**
 * Takes a quiz and submits it for server-side grading. Used on the Quizzes tab and
 * inline inside a section on the Learning tab, so both behave identically.
 *
 * The learner-facing API strips `isCorrect`, so this component cannot reveal the
 * answers even if it wanted to — after grading, the server sends back the correct
 * option ids only when the author enabled "show answers" for the quiz.
 *
 * What happens after Submit is the author's choice, not this component's. The two
 * toggles are independent, and between them they give four different result
 * screens:
 *
 *   answers off, results off → nothing to report, so `onFinished` fires at once.
 *   answers off, results on  → the ring and the percentage, and nothing else.
 *                              The paper is not handed back: showing the
 *                              questions again is showing the answers, since a
 *                              marked question next to the option they ticked
 *                              gives the answer away.
 *   answers on,  results off → the questions with the correct options in green,
 *                              and no score anywhere on the page.
 *   answers on,  results on  → the score, then the marked questions below it.
 *
 * A LEARNING CHECK IS THE ONE EXCEPTION, and deliberately so.
 *
 * Its whole reason to exist is telling the learner which questions they got
 * right — "the user should be given a x or check mark for the questions that are
 * either wrong or right" — so the marked paper always comes back, whatever the
 * toggles say. Folding it into the four rules above looked tidier but broke the
 * kind on its default settings: `showAnswers` is `false` by default for every
 * quiz (see schema.prisma) and nothing overrides it per type, so every learning
 * check ever created would have submitted to a blank screen.
 *
 * The toggles still do their jobs around that fixed point. `showResults` governs
 * the percentage ring, and `showAnswers` governs whether the *correct* options
 * are picked out in green — so a learning check with answers off still says
 * which ones you got wrong, without saying what the right answer was, which is
 * the more useful half of the feedback anyway.
 *
 * Timing is the server's business. This asks it to open a run, gets back a
 * deadline, and counts down to it; leaving the page and coming back re-reads the
 * same deadline rather than starting again. The countdown here is a display of
 * that deadline, never the authority on it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO PHASES, ONE ELEMENT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * An exam and a one-time link both open on their details — how long they take,
 * how many questions, what happens when the paper goes in — behind a Start
 * button, and only become the questions once that button is pressed. Both phases
 * are this component, so a quiz is one thing in the player exactly as an article
 * or a video is: stepping onto it shows the front of it, and stepping away and
 * back does not restart anything.
 *
 * What decides which phase is on screen is the server, not this component's
 * memory. It asks `peekQuiz` — which reports the run already open and starts
 * nothing — so somebody coming back to a clock still ticking is put straight
 * into the questions with the time they have left, while somebody arriving for
 * the first time gets the details. Reading a quiz must never be what starts it,
 * which is the whole reason that call exists separately from `startQuiz`.
 *
 * A LEARNING CHECK HAS NO FRONT AND IS DELIBERATELY UNTOUCHED. It is a pause in
 * the middle of a lesson rather than a thing you sit down to, so it opens on its
 * questions as it always has — there is no clock to start and nothing to warn
 * anybody about.
 */
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  LightBulbIcon,
  QuestionMarkCircleIcon,
  XCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useRef, useState } from 'react';

import QuizTimer from '@/components/common/quiz-timer';
import { Button } from '@/components/ui/button';
import ProgressDonut from '@/components/ui/progress-donut';
import { useLearnerApi } from '@/services/learner-api';
import {
  AttemptResult,
  isMultiAnswer,
  Quiz,
  QuizAnswers,
  QuizQuestion,
  QuizSession,
} from '@/services/quiz-api';
import { logger } from '@/utils/logger';

interface QuizRunnerProps {
  quiz: Quiz;
  /** Called after a successful attempt so progress can be refreshed. */
  onCompleted?: () => void;
  /**
   * Where to go when the learner leaves the result screen — or straight away,
   * when the author has turned results off.
   *
   * The course player passes "move to the next element"; a standalone quiz passes
   * "back to the landing page". Without one the result screen simply stays put,
   * which is what the authoring preview wants.
   */
  onFinished?: () => void;
  /** Label for the button that leaves the result screen. */
  finishLabel?: string;
  /**
   * Whether to open on the quiz's details behind a Start button.
   *
   * On by default, which is what makes a quiz one element in the player. A page
   * that is already a front for the quiz — the standalone quiz page, with its
   * own About panel and Start button — passes false and gets the questions
   * straight away, rather than a second door behind the first.
   *
   * Ignored for a learning check, which never has a front.
   */
  showDetails?: boolean;
  /** Hide the title where the surrounding page already gives it. */
  showTitle?: boolean;
}

/**
 * The options a returned paper says were ticked, in the shape the form holds
 * them.
 *
 * Without this a revisited quiz came back with its ticks and crosses floating
 * beside empty options — the marks were right and the paper underneath was
 * blank, which reads as somebody else's result. Older payloads have no
 * `chosenOptionIds`, and those simply come back unfilled as before.
 */
function answersFrom(result: AttemptResult): QuizAnswers {
  const answers: QuizAnswers = {};
  for (const entry of result.perQuestion) {
    if (entry.chosenOptionIds?.length) answers[entry.questionId] = entry.chosenOptionIds;
  }
  return answers;
}

const QuizRunner = ({
  quiz,
  onCompleted,
  onFinished,
  finishLabel = 'Next',
  showDetails = true,
  showTitle = true,
}: QuizRunnerProps) => {
  const api = useLearnerApi();
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openHintId, setOpenHintId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** Set when the server refuses a second go at a one-time quiz. */
  const [closed, setClosed] = useState(false);

  /** Absolute deadline in local epoch ms, or null when the run is untimed. */
  const [deadline, setDeadline] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const isLearningCheck = quiz.type === 'LEARNING_CHECK';
  const isOneTime = quiz.type === 'ONE_TIME';

  /** A gated quiz waiting on Start. Never a learning check — it has no front. */
  const gated = showDetails && !isLearningCheck;

  /**
   * Which phase is on screen.
   *
   * Starts as 'checking' rather than 'details' so the panel does not flash in
   * front of somebody who is part way through — the answer to that comes from
   * the server, and until it does there is nothing honest to draw.
   */
  const [phase, setPhase] = useState<'checking' | 'details' | 'running'>(
    gated ? 'checking' : 'running',
  );
  const [starting, setStarting] = useState(false);

  /**
   * Guards the auto-submit. A tick, a click and a re-render can all reach for it
   * at once, and a quiz must be graded once.
   */
  const submittedRef = useRef(false);

  // Held in a ref so `submit` can reach the latest handler without listing it as
  // a dependency, which would restart the countdown on every parent render.
  const finishRef = useRef(onFinished);
  finishRef.current = onFinished;

  const submit = useCallback(
    async (answered: QuizAnswers) => {
      if (submittedRef.current) return;
      submittedRef.current = true;

      try {
        setSubmitting(true);
        setError(null);
        const attempt = await api.submitAttempt(quiz.id, answered);
        setDeadline(null);
        onCompleted?.();

        // Both toggles off means they are told nothing at all — no score, no
        // answers. There is nothing to render, so the only honest thing is to
        // move them straight on; a blank "submitted" panel is a slower version
        // of the same. With nowhere to go (the authoring preview passes no
        // handler) it falls through and reports the submission instead.
        //
        // A learning check never takes this path: it always has its ticks and
        // crosses to show, so there is always something worth stopping for.
        if (!attempt.showResults && !attempt.showAnswers && !isLearningCheck && finishRef.current) {
          finishRef.current();
          return;
        }

        setResult(attempt);
      } catch (err) {
        logger.error('Error submitting quiz:', err);
        // A one-time quiz refuses a second attempt. That is a state rather than a
        // failure: say so and stop offering the questions.
        if (err instanceof Error && /already completed/i.test(err.message)) {
          setClosed(true);
          return;
        }
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

  /**
   * Takes a session — from a peek or a start — and puts the countdown on the
   * clock it describes.
   *
   * Anchored to the local clock via `secondsRemaining` rather than by parsing
   * `expiresAt`: a device clock that is minutes out would otherwise show a wrong,
   * possibly already expired, countdown.
   */
  const applySession = (session: QuizSession) => {
    if (session.secondsRemaining === null) return;
    setDeadline(Date.now() + session.secondsRemaining * 1000);
    setSecondsLeft(session.secondsRemaining);
  };

  /*
   * What is on screen when the quiz arrives.
   *
   * Always a peek first, whether the quiz is gated or not. A peek starts
   * nothing and answers three questions at once: has this been handed in, may
   * it be sat again, and is a run already ticking.
   *
   * Asking that first is what lets a finished quiz come back with its paper.
   * The ungated path used to open a run immediately, which for anything with a
   * single sitting meant the server refusing — correctly — and the page having
   * to render "you have already done this" off an error, with no result to show
   * beside it. Starting is now something that happens only once there is
   * actually a run to start.
   */
  useEffect(() => {
    let cancelled = false;
    submittedRef.current = false;
    setAnswers({});
    setResult(null);
    setError(null);
    setClosed(false);
    setDeadline(null);
    setSecondsLeft(null);
    setPhase(gated ? 'checking' : 'running');

    (async () => {
      try {
        const session = await api.peekQuiz(quiz.id);
        if (cancelled) return;

        /*
         * A quiz already handed in, whichever kind it is.
         *
         * The peek reports this as a state rather than throwing, because "you
         * have done this" is a screen to draw and not a failed request — and it
         * brings the paper back with it, so coming back to a finished quiz shows
         * exactly what it showed on the day rather than an empty form or a bare
         * acknowledgement. What is drawn of it is still the author's two
         * toggles, carried on the result itself, so this needs no rule of its
         * own.
         *
         * `completed` is the narrower fact: not "they have done it" but "they
         * may not do it again" — a one-time link always, an exam whose author
         * did not allow multiple attempts. A learning check comes back with its
         * paper and without that flag, which is what puts Try again under it.
         */
        if (session.result) {
          setResult(session.result);
          setAnswers(answersFrom(session.result));
          if (session.completed) setClosed(true);
          // Past the gate either way: there is nothing left to consent to, so
          // what follows is the quiz's own screen rather than a door in front
          // of it.
          setPhase('running');
          return;
        }

        // Closed with nothing to show for it: an attempt from before papers were
        // kept, or a quiz whose questions have been rewritten since.
        if (session.completed) {
          setClosed(true);
          setPhase('running');
          return;
        }

        // Nothing under way and a door in front of it: the details panel, and
        // the clock stays off the wall until Start is pressed.
        if (gated && !session.started) {
          setPhase('details');
          applySession(session);
          return;
        }

        // Part way through: back into the questions with the time left. An
        // expired run counts as started — the clock they were given has simply
        // run out, and the countdown below hands the paper in for them.
        //
        // Otherwise there is no door and no run, which is a page that is itself
        // the front of the quiz (see `showDetails`), so opening one here is what
        // its own Start button already asked for.
        const run = session.started ? session : await api.startQuiz(quiz.id);
        if (cancelled) return;
        setPhase('running');
        applySession(run);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && /already completed/i.test(err.message)) {
          setClosed(true);
          return;
        }
        logger.error('Could not open this quiz:', err);
        // Nothing is known about the run, so offer the door rather than a blank
        // panel — pressing Start will report the real error if there is one.
        if (gated) setPhase('details');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [quiz.id, gated]);

  /** Pressing Start: this is the call that puts a clock on the wall. */
  const start = async () => {
    if (starting) return;
    setStarting(true);
    setError(null);

    try {
      const session = await api.startQuiz(quiz.id);
      applySession(session);
      setPhase('running');
    } catch (err) {
      logger.error('Could not start this quiz:', err);
      if (err instanceof Error && /already completed/i.test(err.message)) {
        setClosed(true);
        return;
      }
      setError('Failed to start the quiz');
    } finally {
      setStarting(false);
    }
  };

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

  /**
   * The right arrow leaves the result screen, matching the arrow keys that step
   * through the course. Bound here rather than in the player so it works on a
   * standalone quiz too.
   */
  useEffect(() => {
    if (!result || !onFinished) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      onFinished();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [result, onFinished]);

  /**
   * Who may have another go.
   *
   * A learning check always: it keeps no mark anywhere, so a retake spoils
   * nothing, and having another run at the thing you have just got wrong is the
   * whole point of a formative check. An exam only when its author allowed
   * multiple attempts — one sitting and one mark is what an exam means until
   * they say otherwise. A one-time link never, which is what it is for.
   *
   * The server enforces the same three answers on start and on submit, so the
   * button appearing is a statement about what will be permitted rather than a
   * hope.
   */
  const canRetry = isLearningCheck || (quiz.type === 'EXAM' && quiz.allowMultipleAttempts === true);

  /** Retaking: clears the paper and opens a fresh run. */
  const reset = () => {
    setAnswers({});
    setResult(null);
    setError(null);
    // A revisited quiz arrives with its paper and, for a learning check, no
    // block on sitting it again — so the banner has to go with the paper.
    setClosed(false);
    submittedRef.current = false;
    // Retaking opens a fresh run, and with it a fresh clock. No details panel in
    // between: they have just read them, and pressing Try again is the same act
    // of consent that Start is.
    api
      .startQuiz(quiz.id)
      .then(applySession)
      .catch((err) => logger.error('Could not restart this quiz:', err));
  };

  /** Ticking an option: radio behaviour for one answer, checkbox for several. */
  const choose = (question: QuizQuestion, optionId: string) => {
    setAnswers((prev) => {
      if (!isMultiAnswer(question)) return { ...prev, [question.id]: [optionId] };

      const current = prev[question.id] ?? [];
      return {
        ...prev,
        [question.id]: current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId],
      };
    });
  };

  const revealed = result?.showAnswers === true;
  /**
   * Whether the questions stay on the page after grading.
   *
   * Before grading they always show — they are the quiz. After it they are the
   * marked paper, and handing that back is a disclosure in its own right: the
   * options they ticked, sitting under a tick or a cross, spell out the answer
   * whether or not the correct ones are highlighted. So the answers toggle is
   * what governs it, and with answers off a score is all they get.
   *
   * Except on a learning check, where the marked paper is the entire point of
   * the exercise and comes back regardless — see the note at the top of the file
   * for why that cannot be folded into the toggles.
   */
  const showQuestions = !result || revealed || isLearningCheck;
  const correctIds = new Set(result?.correctOptionIds ?? []);
  const perQuestion = new Map(
    (result?.perQuestion ?? []).map((entry) => [entry.questionId, entry.correct]),
  );
  const unanswered = quiz.questions.filter(
    (question) => (answers[question.id] ?? []).length === 0,
  ).length;
  // A learning check is a gate, and the rule is that it cannot be handed in half
  // done — the learner has to have had a go at every question to get past it.
  const submitBlocked = isLearningCheck && unanswered > 0;

  /**
   * The quiz's own name.
   *
   * Drawn here rather than by the page around it, because the quiz is one
   * element now and its title has to survive the move between its details and
   * its questions. A page that is already headed by the title — the standalone
   * quiz page — turns this off.
   */
  const heading = showTitle ? (
    <h2 className="shrink-0 break-words text-xl font-semibold text-dark-gray">{quiz.title}</h2>
  ) : null;

  /**
   * A quiz they have handed in and cannot sit again.
   *
   * With their paper back from the server this is only a banner: the result
   * panels below draw the score and the marked answers from `result` exactly as
   * they do the moment it is submitted, so the author's two toggles govern a
   * second look and a first one identically. It is a full stop of its own only
   * when there is no paper to show — an older attempt from before papers were
   * kept, or a quiz whose questions have since been rewritten.
   *
   * The reason it is closed differs, so the second line says which: a one-time
   * link was always going to shut, while an exam is shut because its author
   * chose one sitting, and telling somebody an exam "could only be taken once"
   * would misdescribe a setting that can be changed.
   */
  const closedNotice = closed ? (
    <div className="rounded-lg border border-navy/30 bg-navy/5 p-6 text-center">
      <CheckCircleIcon className="mx-auto w-10 h-10 text-green" />
      <p className="mt-2 font-semibold text-dark-gray">You have already completed this quiz.</p>
      <p className="mt-1 text-sm text-dark-gray">
        {isOneTime
          ? 'This one could only be taken once, so there is nothing more to do here.'
          : 'This one allows a single attempt, so your result above is final.'}
      </p>
      {onFinished && !result && (
        <Button onClick={onFinished} className="mt-4 bg-navy text-white hover:bg-navy-hover">
          {finishLabel}
        </Button>
      )}
    </div>
  ) : null;

  if (closed && !result) {
    return (
      <div className="flex flex-col gap-4">
        {heading}
        {closedNotice}
      </div>
    );
  }

  // Waiting to hear whether a run is already open. Deliberately quiet: drawing
  // the details panel here and replacing it a moment later would flash a Start
  // button at somebody whose clock is already running.
  if (phase === 'checking') {
    return (
      <div className="flex flex-col gap-4">
        {heading}
        <p className="py-8 text-center text-dark-gray">Loading quiz...</p>
      </div>
    );
  }

  /**
   * The front of the quiz: what it costs, what it does, and the button that
   * starts the clock.
   *
   * Everything here is what a learner needs before consenting to a timed run
   * they cannot pause. It is the same panel for an exam and a one-time link,
   * with the one-time warning added, because the decision they are making is the
   * same shape — the one-time one is simply less forgiving.
   */
  if (phase === 'details') {
    return (
      <div className="flex flex-col gap-4">
        {heading}

        {quiz.description && (
          <p className="whitespace-pre-wrap break-words text-dark-gray">{quiz.description}</p>
        )}

        <div className="rounded-lg border-2 border-navy/30 bg-navy/5 p-6">
          <h3 className="font-semibold text-dark-gray">Before you start</h3>

          <ul className="mt-3 flex flex-col gap-2 text-sm text-dark-gray">
            <li className="flex items-center gap-2">
              <QuestionMarkCircleIcon className="w-5 h-5 shrink-0" />
              {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'}
            </li>
            <li className="flex items-center gap-2">
              <ClockIcon className="w-5 h-5 shrink-0" />
              {quiz.timeLimitMinutes === null
                ? 'No time limit'
                : `${quiz.timeLimitMinutes} minute${quiz.timeLimitMinutes === 1 ? '' : 's'} once ` +
                  'you start'}
            </li>
            <li className="flex items-center gap-2">
              <CheckCircleIcon className="w-5 h-5 shrink-0" />
              {quiz.showResults ? 'Your score is shown when you submit' : 'Your score is not shown'}
            </li>
            {quiz.dueDate && (
              <li className="flex items-center gap-2">
                <ClockIcon className="w-5 h-5 shrink-0" />
                Due {new Date(quiz.dueDate).toLocaleDateString()}
              </li>
            )}
          </ul>

          {/* The clock keeps running once it has started, so say so plainly
              rather than letting somebody discover it by leaving. */}
          {quiz.timeLimitMinutes !== null && (
            <p className="mt-4 flex items-start gap-2 text-sm text-dark-gray">
              <ExclamationTriangleIcon className="mt-0.5 w-5 h-5 shrink-0" />
              The clock starts when you press Start and does not stop if you leave the page. Come
              back and you carry on with the time you have left.
            </p>
          )}

          {isOneTime && (
            <p className="mt-2 flex items-start gap-2 text-sm font-medium text-dark-gray">
              <ExclamationTriangleIcon className="mt-0.5 w-5 h-5 shrink-0" />
              One attempt only. Once you hand this in you will not be able to open it again.
            </p>
          )}

          {error && <div className="mt-4 border-2 bg-danger p-3">{error}</div>}

          <Button
            onClick={start}
            disabled={starting || quiz.questions.length === 0}
            title={quiz.questions.length === 0 ? 'This quiz has no questions yet' : undefined}
            className="mt-5 bg-navy text-white hover:bg-navy-hover"
          >
            {starting ? 'Starting...' : 'Start quiz'}
          </Button>

          {quiz.questions.length === 0 && (
            <p className="mt-2 text-sm text-dark-gray">There are no questions in this quiz yet.</p>
          )}
        </div>
      </div>
    );
  }

  const percent = result && result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;

  /**
   * Leaving the result screen. Shared, because it has to sit under whichever of
   * the two panels the toggles produced — a learner with results off still needs
   * the same way out as one who was shown a score.
   */
  const resultActions = (
    <>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {onFinished && (
          <Button onClick={onFinished} className="gap-2 bg-navy text-white hover:bg-navy-hover">
            {finishLabel}
            <ArrowRightIcon className="w-5 h-5" />
          </Button>
        )}
        {canRetry && (
          <Button
            onClick={reset}
            variant="outline"
            className="bg-white text-dark-gray hover:bg-light-gray"
          >
            Try again
          </Button>
        )}
      </div>
      {onFinished && <p className="text-xs text-dark-gray">Or press → to carry on</p>}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {heading}
      {closedNotice}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {quiz.dueDate && !isLearningCheck && (
          <p className="text-sm font-medium text-dark-gray">
            Due {new Date(quiz.dueDate).toLocaleDateString()}
          </p>
        )}

        {isOneTime && !result && (
          <p className="text-sm font-medium text-dark-gray">
            One attempt only — this cannot be reopened once you hand it in.
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

      {/* The score. Only when the author turned results on — with them off the
          learner is never told a number, whatever the answers toggle says. */}
      {result && result.showResults && (
        <div
          className="flex flex-col items-center gap-3 rounded-lg border-2 border-navy/30 bg-navy/5
            p-6"
        >
          <ProgressDonut
            percent={percent}
            caption={isLearningCheck ? undefined : `${result.score} of ${result.total} correct`}
          />
          <p className="text-lg font-semibold text-dark-gray">
            {isLearningCheck ? 'Learning check complete' : `You scored ${percent}%`}
          </p>
          {isLearningCheck && (
            <p className="text-center text-sm text-dark-gray">
              {showQuestions
                ? 'This one is not marked or recorded — the ticks below are just for you.'
                : 'This one is not marked or recorded.'}
            </p>
          )}

          {resultActions}
        </div>
      )}

      {/* Answers on, results off: no score anywhere, but they still need the way
          onward that normally lives under the ring. */}
      {result && !result.showResults && (
        <div
          className="flex flex-col items-center gap-3 rounded-lg border-2 border-navy/30 bg-navy/5
            p-4"
        >
          <p className="text-center font-semibold text-dark-gray">
            {revealed
              ? 'Quiz submitted — the correct answers are marked below.'
              : isLearningCheck
                ? 'Learning check complete — your answers are marked below.'
                : 'Quiz submitted.'}
          </p>
          {resultActions}
        </div>
      )}

      {quiz.questions.length === 0 ? (
        <p className="text-dark-gray">No questions in this quiz yet.</p>
      ) : showQuestions ? (
        <>
          {quiz.questions.map((question) => {
            const multi = isMultiAnswer(question);
            const chosen = answers[question.id] ?? [];
            // Whether they got this one right. Always sent back, which is what
            // gives a learning check its ticks and crosses without a mark being
            // kept anywhere.
            const marked = perQuestion.get(question.id);

            return (
              <fieldset
                key={question.id}
                className="relative rounded-lg border border-gray-300 bg-white p-4"
              >
                <legend className="flex items-center gap-2 px-1 font-semibold text-dark-gray">
                  <span>
                    {question.order}. {question.prompt}
                  </span>
                  {marked === true && (
                    <CheckCircleIcon className="w-5 h-5 shrink-0 text-green" aria-label="Correct" />
                  )}
                  {marked === false && (
                    <XCircleIcon className="w-5 h-5 shrink-0 text-danger" aria-label="Incorrect" />
                  )}
                </legend>

                {multi && !result && (
                  <p className="mt-1 text-xs font-medium text-dark-gray">
                    Pick every answer that applies.
                  </p>
                )}

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
                          {question.hintSectionNumber && (
                            <p className="mt-1 text-sm font-semibold text-dark-gray">
                              See section {question.hintSectionNumber}
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
                    const selected = chosen.includes(option.id);

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
                          type={multi ? 'checkbox' : 'radio'}
                          name={`${quiz.id}-${question.id}`}
                          checked={selected}
                          disabled={result !== null}
                          onChange={() => choose(question, option.id)}
                          className="h-4 w-4 shrink-0 accent-[#5b9748]"
                        />
                        <span className="break-words">{option.text}</span>
                        {revealed && correctIds.has(option.id) && <span aria-hidden="true">✓</span>}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}

          {!result && (
            <div className="flex flex-wrap items-center gap-4">
              <Button
                onClick={() => setConfirming(true)}
                disabled={submitting || submitBlocked}
                title={submitBlocked ? 'Answer every question before handing this in' : undefined}
                className="bg-navy text-white hover:bg-navy-hover"
              >
                {submitting ? 'Submitting...' : 'Complete quiz'}
              </Button>
              {unanswered > 0 && (
                <p className="text-sm text-dark-gray">
                  {unanswered} question{unanswered === 1 ? '' : 's'} unanswered
                  {submitBlocked && ' — answer them all to continue'}
                </p>
              )}
            </div>
          )}
        </>
      ) : null}

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
              {isOneTime
                ? 'This quiz can only be taken once. Once you hand it in you will not be ' +
                  'able to open it again.'
                : unanswered > 0
                  ? `You have ${unanswered} question${unanswered === 1 ? '' : 's'} ` +
                    'unanswered. Submit anyway?'
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
