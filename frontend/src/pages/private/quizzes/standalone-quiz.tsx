/**
 * File: standalone-quiz.tsx
 * Description: The start page and player for a quiz that belongs to no course.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-11
 */
/**
 * A quiz that stands on its own.
 *
 * An exam does not have to live inside a section, and a one-time quiz never can —
 * so neither has a course landing page to sit under. This is that page: what the
 * quiz costs in questions and minutes, a Start button, and the runner itself.
 *
 * The landing state is the interesting part. When the author has turned results
 * off, handing in sends the learner back here rather than showing a score, and
 * this page then says they have completed it without saying how they did. That is
 * the whole of the "results hidden" rule for a standalone quiz.
 */
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import QuizRunner from '@/components/common/quiz-runner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDue } from '@/services/due-dates';
import { useLearnerApi } from '@/services/learner-api';
import { Quiz, QUIZ_TYPE_LABELS } from '@/services/quiz-api';
import { logger } from '@/utils/logger';

/** The start page and player for a quiz that belongs to no course. */
const StandaloneQuiz = () => {
  const api = useLearnerApi();
  const { quizId } = useParams<{ quizId: string }>();
  const navigate = useNavigate();

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempted, setAttempted] = useState(false);
  /** Taking it, rather than looking at the front of it. */
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    if (!quizId) return;
    try {
      setLoading(true);
      const [quizzes, progress] = await Promise.all([api.getQuizzes(), api.getProgress()]);
      setQuiz(quizzes.find((candidate) => candidate.id === quizId) ?? null);
      setAttempted(progress.attemptedQuizIds.includes(quizId));
    } catch (err) {
      logger.error('Error loading quiz:', err);
    } finally {
      setLoading(false);
    }
    // api is rebuilt each render; depending on it would loop.
  }, [quizId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="page-container flex flex-col">
        <div className="text-center">Loading quiz...</div>
      </div>
    );
  }

  if (!quiz) {
    return (
      <div className="page-container flex flex-col">
        <Button onClick={() => navigate('/quizzes')} variant="ghost" className="w-fit px-0">
          ← All quizzes
        </Button>
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>That quiz could not be found.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-container flex flex-col">
      <Button
        onClick={() => (running ? setRunning(false) : navigate('/quizzes'))}
        variant="ghost"
        className="mb-4 w-fit gap-2 px-0 text-dark-gray hover:text-green-hover"
      >
        <ArrowLeftIcon className="w-5 h-5" /> {running ? 'Quiz overview' : 'All quizzes'}
      </Button>

      <header className="responsive-page-header">
        <h1 className="page-hero-title break-words font-bold text-dark-gray">{quiz.title}</h1>
        {quiz.description && (
          <p className="mt-3 break-words text-lg text-dark-gray">{quiz.description}</p>
        )}
      </header>

      <hr className="mt-4 mb-8 h-0.5 border-t-0 bg-navy" />

      {running ? (
        <Card className="bg-light-gray shadow-sm">
          <CardContent className="p-4">
            <QuizRunner
              quiz={quiz}
              // This page is already the front of the quiz — the About panel
              // and the Start button below are the details screen the player
              // draws inline, so the runner must not put a second one behind
              // them. The hero above carries the title for the same reason.
              showDetails={false}
              showTitle={false}
              onCompleted={() => setAttempted(true)}
              // Back to this page however the runner ends: the button under the
              // ring when a score was shown, the one under the marked answers
              // when only those were, and the moment they submit when the author
              // turned both off — the panel below then reports the completion
              // without a score.
              onFinished={() => {
                setRunning(false);
                load();
              }}
              finishLabel="Back to quiz overview"
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-6">
            {attempted && (
              <Card className="border-2 border-navy/30 bg-navy/5 shadow-sm">
                <CardContent className="flex items-start gap-3 p-4">
                  <CheckCircleIcon className="mt-0.5 w-6 h-6 shrink-0 text-green" />
                  <div className="min-w-0">
                    <p className="font-semibold text-dark-gray">You have completed this quiz.</p>
                    <p className="text-sm text-dark-gray">
                      {quiz.showResults
                        ? 'Take it again to have another go at your score.'
                        : 'Results for this one are not shown.'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="bg-light-gray shadow-sm">
              <CardHeader className="p-4">
                <CardTitle className="text-lg text-dark-gray">About this quiz</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm text-dark-gray">
                  <li className="flex items-center gap-2">
                    <QuestionMarkCircleIcon className="w-5 h-5 shrink-0" />
                    {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'}
                  </li>
                  <li className="flex items-center gap-2">
                    <ClockIcon className="w-5 h-5 shrink-0" />
                    {quiz.timeLimitMinutes === null
                      ? 'No time limit'
                      : `${quiz.timeLimitMinutes} minutes once you start`}
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircleIcon className="w-5 h-5 shrink-0" />
                    {quiz.showResults
                      ? 'Your score is shown when you submit'
                      : 'Your score is not shown'}
                  </li>
                </ul>
                {quiz.dueDate && (
                  <p
                    className={`mt-4 text-sm font-medium ${
                      quiz.locked ? 'text-danger' : 'text-dark-gray'
                    }`}
                  >
                    {quiz.locked ? 'Closed' : 'Due'} {formatDue(quiz.dueDate)}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <aside className="lg:sticky lg:top-20 lg:self-start">
            <Card className="bg-light-gray shadow-lg">
              <CardContent className="flex flex-col gap-3 p-4">
                {/* Past its deadline there is no way in. The server refuses to
                    open a run either, so this is the polite half of the lock
                    rather than the whole of it. */}
                <Button
                  onClick={() => setRunning(true)}
                  disabled={quiz.locked === true}
                  title={quiz.locked ? 'The deadline for this quiz has passed' : undefined}
                  className="w-full bg-navy py-6 text-md text-white hover:bg-navbar-hover
                    disabled:cursor-not-allowed disabled:bg-dark-gray/40"
                >
                  {quiz.locked ? 'Closed' : attempted ? 'Take it again' : 'Start quiz'}
                </Button>
                {quiz.locked && (
                  <p className="text-center text-sm text-danger">
                    The deadline has passed. Ask whoever assigned it if you still need it.
                  </p>
                )}
                <p className="text-center text-sm text-dark-gray">
                  {QUIZ_TYPE_LABELS[quiz.type]}
                  {quiz.timeLimitMinutes !== null && ` · ${quiz.timeLimitMinutes} min`}
                </p>
              </CardContent>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
};

export default StandaloneQuiz;
