/**
 * File: home.tsx
 * Description: The learner's dashboard.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Home - the learner's dashboard.
 *
 * Left  : outstanding courses with a progress ring each, then outstanding quizzes.
 * Right : upcoming due dates, soonest first, with the time still needed.
 */
import { ClockIcon, ExclamationTriangleIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ProgressDonut from '@/components/ui/progress-donut';
import { useAuth } from '@/contexts/auth-context';
import { Dashboard } from '@/services/curriculum-api';
import { useLearnerApi } from '@/services/learner-api';
import { logger } from '@/utils/logger';

/**
 * Width of one outstanding-learning card, and of the ring inside it.
 *
 * One constant because the two must agree: the card is deliberately no wider
 * than its ring, so the row scrolls as a tidy strip instead of each title
 * setting its own width.
 */
const DONUT_SIZE = 120;

/** "1 h 25 min" reads better than "85 min" once it passes an hour. */
function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

function daysUntil(iso: string): number {
  const due = new Date(iso);
  const today = new Date();
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function dueLabel(iso: string): { text: string; overdue: boolean } {
  const days = daysUntil(iso);
  if (days < 0) return { text: `${Math.abs(days)} days overdue`, overdue: true };
  if (days === 0) return { text: 'Due today', overdue: true };
  if (days === 1) return { text: 'Due tomorrow', overdue: false };
  return { text: `Due in ${days} days`, overdue: false };
}

const HomePage = () => {
  const api = useLearnerApi();
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setDashboard(await api.getDashboard());
    } catch (err) {
      logger.error('Error loading dashboard:', err);
      setError('Failed to load your learning');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading) {
    return (
      <div className="page-container flex flex-col">
        <div className="text-center">Loading your learning...</div>
      </div>
    );
  }

  const outstandingCourses = dashboard?.outstandingCourses ?? [];
  const outstandingQuizzes = dashboard?.outstandingQuizzes ?? [];
  const deadlines = dashboard?.upcomingDeadlines ?? [];
  const totals = dashboard?.totals;

  return (
    <div className="page-container flex flex-col">
      <header className="responsive-page-header">
        <h1 className="page-title font-bold text-dark-gray mb-2">
          Welcome, {user?.name || 'Guest'}!
        </h1>
        <p className="page-subtitle text-dark-gray font-medium">
          {totals && (totals.coursesOutstanding > 0 || totals.quizzesOutstanding > 0)
            ? `${totals.coursesOutstanding} course` +
              `${totals.coursesOutstanding === 1 ? '' : 's'} and ` +
              `${totals.quizzesOutstanding} quiz` +
              `${totals.quizzesOutstanding === 1 ? '' : 'zes'} outstanding · ` +
              `about ${formatMinutes(totals.minutesRemaining)} of learning left`
            : 'You are all caught up.'}
        </p>
      </header>

      <hr className="mt-4 mb-8 h-0.5 border-t-0 bg-navy" />

      {error && <div className="mb-4 border-2 bg-danger p-4">{error}</div>}

      {/* Courses that have gained content since the learner started them */}
      {(dashboard?.updatedCourses?.length ?? 0) > 0 && (
        <Card className="mb-6 border-2 border-navy/40 bg-light-gray shadow-sm">
          <CardHeader className="flex-row items-center gap-3 p-4">
            <SparklesIcon className="w-6 h-6 shrink-0 text-navy" />
            <CardTitle className="text-lg text-dark-gray">New in your courses</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {dashboard!.updatedCourses.map((course) => (
                <li key={course.courseId}>
                  {/* Straight to the course they were told about — landing on
                      the Learning grid would make them find it again. */}
                  <Link
                    to={`/learning/${course.courseId}`}
                    className="flex items-center justify-between gap-3 rounded-lg border
                      border-gray-300 bg-white px-4 py-3 transition-colors hover:bg-light-gray"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold text-dark-gray">{course.title}</span>
                      <span className="block text-sm text-dark-gray">
                        {course.newSectionCount
                          ? `${course.newSectionCount} new section` +
                            `${course.newSectionCount === 1 ? '' : 's'} added`
                          : 'Updated since you last worked on it'}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-navy">Review</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Outstanding learning */}
        <div className="flex flex-col gap-6">
          <Card className="bg-light-gray shadow-sm">
            <CardHeader className="p-4">
              <CardTitle className="text-lg text-dark-gray">Outstanding learning</CardTitle>
            </CardHeader>
            <CardContent>
              {outstandingCourses.length === 0 ? (
                <p className="py-8 text-center text-dark-gray">
                  Nothing outstanding — every course you have started is finished.
                </p>
              ) : (
                /**
                 * A rail rather than a wrapping grid: someone with a dozen
                 * courses outstanding should scroll sideways through them
                 * instead of pushing the rest of the dashboard off the screen.
                 * Each card is exactly as wide as its ring, so the row reads as
                 * a row of rings and a long title wraps inside that width rather
                 * than stretching the card.
                 */
                <ul className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2">
                  {outstandingCourses.map((course) => (
                    <li
                      key={course.courseId}
                      className="shrink-0 snap-start"
                      style={{ width: DONUT_SIZE }}
                    >
                      <Link
                        to={`/learning/${course.courseId}`}
                        title={course.title}
                        className="flex flex-col items-center gap-1 rounded-lg py-1
                          transition-colors hover:bg-white/70"
                      >
                        <ProgressDonut
                          percent={course.percentComplete}
                          size={DONUT_SIZE}
                          caption={`${course.completedSections}/${course.totalSections} sections`}
                        />
                        {/* Clamped and breaking on any character: the card is
                            fixed-width, so a long unbroken word has to fold
                            rather than widen it. */}
                        <p
                          className="line-clamp-2 w-full text-center text-sm font-semibold
                            break-words text-dark-gray"
                        >
                          {course.title}
                        </p>
                        <p className="flex items-center gap-1 text-xs text-dark-gray">
                          <ClockIcon className="w-3.5 h-3.5 shrink-0" />
                          {formatMinutes(course.remainingMinutes)} left
                        </p>
                        {course.required && (
                          <Badge className="bg-navy px-2 text-xs text-white">Required</Badge>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Outstanding quizzes */}
          <Card className="bg-light-gray shadow-sm">
            <CardHeader className="p-4">
              <CardTitle className="text-lg text-dark-gray">Outstanding quizzes</CardTitle>
            </CardHeader>
            <CardContent>
              {outstandingQuizzes.length === 0 ? (
                <p className="py-8 text-center text-dark-gray">No quizzes waiting for you.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {outstandingQuizzes.map((quiz) => (
                    <li key={quiz.quizId}>
                      <Link
                        to="/quizzes"
                        className="flex items-center justify-between gap-3 rounded-lg border
                          border-gray-300 bg-white px-4 py-3"
                      >
                        <span className="min-w-0">
                          <span className="block font-semibold text-dark-gray">{quiz.title}</span>
                          {quiz.courseTitle && (
                            <span className="block text-sm text-dark-gray">{quiz.courseTitle}</span>
                          )}
                          {quiz.dueDate && (
                            <span
                              className={`block text-sm font-medium ${
                                dueLabel(quiz.dueDate).overdue ? 'text-danger' : 'text-dark-gray'
                              }`}
                            >
                              {dueLabel(quiz.dueDate).text}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-sm text-dark-gray">
                          {quiz.questionCount} question{quiz.questionCount === 1 ? '' : 's'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Upcoming due dates, soonest first */}
        <Card className="h-fit bg-light-gray shadow-sm">
          <CardHeader className="p-4">
            <CardTitle className="text-lg text-dark-gray">Upcoming due dates</CardTitle>
          </CardHeader>
          <CardContent>
            {deadlines.length === 0 ? (
              <p className="py-8 text-center text-dark-gray">Nothing due.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {deadlines.map((course) => {
                  const due = dueLabel(course.dueDate!);

                  return (
                    <li
                      key={course.courseId}
                      className="rounded-lg border border-gray-300 bg-white px-4 py-3"
                    >
                      <p className="font-semibold text-dark-gray">{course.title}</p>
                      <p
                        className={`mt-1 flex items-center gap-1 text-sm font-medium ${
                          due.overdue ? 'text-danger' : 'text-dark-gray'
                        }`}
                      >
                        {due.overdue && <ExclamationTriangleIcon className="w-4 h-4" />}
                        {due.text}
                      </p>
                      <p className="mt-1 text-sm text-dark-gray">
                        {new Date(course.dueDate!).toLocaleDateString()} ·{' '}
                        {formatMinutes(course.remainingMinutes)} left
                      </p>
                      <p className="mt-1 text-sm text-dark-gray">
                        {course.percentComplete}% complete ({course.completedSections}/
                        {course.totalSections} sections)
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default HomePage;
