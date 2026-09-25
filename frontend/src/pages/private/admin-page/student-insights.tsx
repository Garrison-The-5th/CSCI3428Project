/**
 * File: student-insights.tsx
 * Description: Student insights — who has been given learning, and how they are getting on.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
/**
 * Student insights — who has been given learning, and how they are getting on.
 *
 * Three depths, each a step narrower:
 *   list   : every learner, with a short bar per course under their name
 *   learner: one person, their courses as cards
 *   course : one person on one course — modules done, quizzes, marks, last seen
 *
 * Which one is showing lives in this component's state rather than the URL. The
 * dashboard already owns the ?tab= parameter, and nesting a second router-driven
 * level under it would fight that for the back button.
 */
import {
  ArrowLeftIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import ProgressDonut from '@/components/ui/progress-donut';
import { assignmentApi, LearnerCourseProgress, LearnerInsight } from '@/services/assignment-api';
import { imageSrc } from '@/services/curriculum-api';
import { logger } from '@/utils/logger';

interface StudentInsightsProps {
  onNotify: (message: string, type?: 'success' | 'error') => void;
}

/** "2 days ago", or "never" — relative reads better than a date for recency. */
function lastSeen(iso: string | null): string {
  if (!iso) return 'never opened';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The short progress bar the list uses.
 *
 * Deliberately thin and captioned with the percentage: a learner may hold a
 * dozen courses, and a stack of full-size meters would bury the name they belong
 * to.
 */
const MiniBar = ({ course }: { course: LearnerCourseProgress }) => (
  <li className="flex items-center gap-2 text-xs">
    <span className="min-w-0 flex-1 truncate text-dark-gray" title={course.title}>
      {course.title}
    </span>
    <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-gray-300">
      <span
        className="block h-full rounded-full bg-[#5b9748]"
        style={{ width: `${course.percentComplete}%` }}
      />
    </span>
    <span className="w-9 shrink-0 text-right tabular-nums text-dark-gray">
      {course.percentComplete}%
    </span>
  </li>
);

const StudentInsights = ({ onNotify }: StudentInsightsProps) => {
  const [learners, setLearners] = useState<LearnerInsight[]>([]);
  const [scope, setScope] = useState<'all' | 'mine'>('mine');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [openEmail, setOpenEmail] = useState<string | null>(null);
  const [openCourseId, setOpenCourseId] = useState<string | null>(null);
  /** Which one-time quiz paper is expanded, if any. */
  const [openPaperId, setOpenPaperId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await assignmentApi.listInsights();
      setLearners(response.learners);
      setScope(response.scope);
    } catch (err) {
      logger.error('Error loading student insights:', err);
      onNotify('Failed to load student insights', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return learners;
    return learners.filter((learner) =>
      `${learner.name ?? ''} ${learner.email}`.toLowerCase().includes(query),
    );
  }, [learners, search]);

  const openLearner = learners.find((learner) => learner.email === openEmail) ?? null;
  const openCourse =
    openLearner?.courses.find((course) => course.courseId === openCourseId) ?? null;

  // ---- One learner on one course ----
  if (openLearner && openCourse) {
    return (
      <div className="flex flex-col gap-6">
        <Button
          onClick={() => setOpenCourseId(null)}
          variant="ghost"
          className="w-fit gap-2 px-0 text-dark-gray hover:text-green-hover"
        >
          <ArrowLeftIcon className="w-5 h-5" /> {openLearner.name ?? openLearner.email}
        </Button>

        <Card className="bg-light-gray shadow-sm">
          <CardHeader className="p-4">
            <CardTitle className="text-lg text-dark-gray">{openCourse.title}</CardTitle>
            <p className="text-sm text-dark-gray">
              {openLearner.name ?? openLearner.email} · last worked on{' '}
              {lastSeen(openCourse.lastActivityAt)}
            </p>
          </CardHeader>

          <CardContent className="flex flex-wrap items-center gap-8">
            <ProgressDonut
              percent={openCourse.percentComplete}
              size={110}
              caption={`${openCourse.completedSections} of ${openCourse.totalSections} sections`}
            />

            <dl className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium text-dark-gray">Sections completed</dt>
                <dd className="text-xl font-bold text-dark-gray">
                  {openCourse.completedSections}
                  <span className="text-sm font-normal">/{openCourse.totalSections}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-dark-gray">Quizzes attempted</dt>
                <dd className="text-xl font-bold text-dark-gray">
                  {openCourse.attemptedQuizzes}
                  <span className="text-sm font-normal">/{openCourse.totalQuizzes}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-dark-gray">Average mark</dt>
                <dd className="text-xl font-bold text-dark-gray">
                  {openCourse.averageScore === null ? (
                    <span className="text-sm font-normal">No attempts yet</span>
                  ) : (
                    `${openCourse.averageScore}%`
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-dark-gray">Assigned</dt>
                <dd className="text-sm text-dark-gray">
                  {new Date(openCourse.assignedAt).toLocaleDateString()}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-dark-gray">Due</dt>
                <dd className="text-sm text-dark-gray">
                  {openCourse.dueDate
                    ? new Date(openCourse.dueDate).toLocaleDateString()
                    : 'No due date'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-dark-gray">Last worked on</dt>
                <dd className="text-sm text-dark-gray">{lastSeen(openCourse.lastActivityAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* The average is over their best attempt at each quiz, which is worth
            saying — otherwise a figure that improves after a retake looks wrong. */}
        <p className="text-sm text-dark-gray">
          The average mark is the mean of their best attempt at each quiz. Progress is measured
          against the published version of the course.
        </p>
      </div>
    );
  }

  /**
   * One card under a learner's name. The same card whichever list it is in —
   * what a lesson and a quiz set differ in is the heading they are filed under,
   * not what is worth reporting about them.
   */
  const learnerCard = (course: LearnerCourseProgress) => {
    const cover = imageSrc(course.imageData, course.imageType);

    return (
      <Card
        key={course.courseId}
        onClick={() => setOpenCourseId(course.courseId)}
        className="flex cursor-pointer flex-col gap-0 overflow-hidden bg-light-gray p-0 shadow-sm
          transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
      >
        <div className="flex h-24 items-center justify-center overflow-hidden bg-navy/10">
          {cover ? (
            <img src={cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm text-dark-gray">No photo</span>
          )}
        </div>

        <CardHeader className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="break-words text-base text-dark-gray">{course.title}</CardTitle>
            {course.revoked && <Badge className="bg-gray-400 px-2 text-white">Turned off</Badge>}
          </div>

          <span className="mt-2 block h-2 overflow-hidden rounded-full bg-gray-300">
            <span
              className="block h-full rounded-full bg-[#5b9748]"
              style={{ width: `${course.percentComplete}%` }}
            />
          </span>
          <p className="mt-1 text-xs text-dark-gray">
            {course.percentComplete}% · {course.completedSections}/{course.totalSections} sections
          </p>
        </CardHeader>

        <CardContent
          className="flex items-center justify-between border-t border-gray-300 p-4 text-xs
            font-medium text-dark-gray"
        >
          <span className="flex items-center gap-1">
            <ClockIcon className="w-4 h-4" />
            {lastSeen(course.lastActivityAt)}
          </span>
          <span>{course.averageScore === null ? 'No marks' : `${course.averageScore}% avg`}</span>
        </CardContent>
      </Card>
    );
  };

  // ---- One learner, their courses as cards ----
  if (openLearner) {
    /*
      Filed apart, for the reason in the comment on the two grids below. Anything
      with no kind at all is a course: that is what every course was before quiz
      sets existed, and it is what an older payload means.
    */
    const learnerLessons = openLearner.courses.filter((course) => course.kind !== 'QUIZ_SET');
    const learnerQuizzes = openLearner.courses.filter((course) => course.kind === 'QUIZ_SET');

    return (
      <div className="flex flex-col gap-6">
        <Button
          onClick={() => setOpenEmail(null)}
          variant="ghost"
          className="w-fit gap-2 px-0 text-dark-gray hover:text-green-hover"
        >
          <ArrowLeftIcon className="w-5 h-5" /> All students
        </Button>

        <header className="flex flex-wrap items-center gap-4">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-navy
              text-2xl font-bold text-white"
          >
            {(openLearner.name || openLearner.email).charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h2 className="break-words text-2xl font-bold text-dark-gray">
              {openLearner.name ?? openLearner.email}
            </h2>
            {openLearner.name && (
              <p className="break-all text-sm text-dark-gray">{openLearner.email}</p>
            )}
            <div className="mt-1 flex flex-wrap gap-2">
              <Badge className="bg-navy px-2 text-white">
                {learnerLessons.length} course{learnerLessons.length === 1 ? '' : 's'}
                {learnerQuizzes.length > 0 &&
                  ` · ${learnerQuizzes.length} quiz${learnerQuizzes.length === 1 ? '' : 'zes'}`}
              </Badge>
              <Badge className="bg-[#5b9748] px-2 text-white">
                {openLearner.overallPercent}% overall
              </Badge>
              {!openLearner.hasAccount && (
                <Badge className="bg-new px-2 text-white">No account</Badge>
              )}
            </div>
          </div>
        </header>

        {openLearner.courses.length === 0 ? (
          <Card className="bg-light-gray">
            <CardContent className="py-16 text-center">
              <p>Nothing they hold has been published yet.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-8">
            {/*
    Courses above, quizzes below.

    A learner holds both through the same kind of assignment, which is
    why they arrive in one list — but a quiz set has no sections to be
    part way through, so its bar and its "3/8 sections" are measuring
    the authoring rows rather than any journey. Side by side with a
    lesson's they invite a comparison that is not there to be made.
    Anything with no kind is filed as a course: that is what every
    course was before quiz sets existed.
  */}
            {learnerLessons.length > 0 && (
              <section>
                <h3 className="mb-3 text-lg font-bold text-dark-gray">
                  Courses{` (${learnerLessons.length})`}
                </h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-6">
                  {learnerLessons.map(learnerCard)}
                </div>
              </section>
            )}

            {learnerQuizzes.length > 0 && (
              <section>
                <h3 className="mb-3 text-lg font-bold text-dark-gray">
                  Quizzes{` (${learnerQuizzes.length})`}
                </h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-6">
                  {learnerQuizzes.map(learnerCard)}
                </div>
              </section>
            )}
          </div>
        )}

        {/*
          One-time quizzes, filed under the person rather than under the quiz.
          They vanish from the learner's own side the moment they are handed in,
          so this is the only record of what was asked and what was answered —
          which is why the paper is shown in full rather than just a mark.
        */}
        {openLearner.oneTimeQuizzes.length > 0 && (
          <Card className="mt-8 bg-light-gray shadow-sm">
            <CardHeader className="p-4">
              <CardTitle className="text-lg text-dark-gray">One-time quizzes completed</CardTitle>
              <p className="text-sm text-dark-gray">
                Sent by link and taken once. The learner can no longer see these.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {openLearner.oneTimeQuizzes.map((paper) => (
                <div key={paper.attemptId} className="rounded-lg border border-gray-300 bg-white">
                  <button
                    onClick={() =>
                      setOpenPaperId(openPaperId === paper.attemptId ? null : paper.attemptId)
                    }
                    className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left"
                    aria-expanded={openPaperId === paper.attemptId}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-semibold text-dark-gray">
                        {paper.title}
                      </span>
                      <span className="block text-xs text-dark-gray">
                        Completed {new Date(paper.completedAt).toLocaleString()}
                      </span>
                    </span>
                    <Badge className="bg-navy px-2 text-white">
                      {paper.score}/{paper.total} · {paper.percent}%
                    </Badge>
                  </button>

                  {openPaperId === paper.attemptId && (
                    <ul className="flex flex-col gap-3 border-t border-gray-300 p-4">
                      {paper.answers.map((answer) => (
                        <li key={answer.questionId}>
                          <p className="flex items-start gap-2 font-medium text-dark-gray">
                            <span
                              className={
                                answer.wasCorrect
                                  ? 'shrink-0 font-bold text-green'
                                  : 'shrink-0 font-bold text-danger'
                              }
                              aria-label={answer.wasCorrect ? 'Correct' : 'Incorrect'}
                            >
                              {answer.wasCorrect ? '✓' : '✗'}
                            </span>
                            <span className="min-w-0 break-words">
                              {answer.order}. {answer.prompt}
                            </span>
                          </p>
                          <p className="mt-1 ml-6 text-sm text-dark-gray">
                            Answered: {answer.chosen.length > 0 ? answer.chosen.join(', ') : '—'}
                          </p>
                          {!answer.wasCorrect && (
                            <p className="ml-6 text-sm text-dark-gray">
                              Correct: {answer.correct.join(', ')}
                            </p>
                          )}
                        </li>
                      ))}
                      {paper.answers.length === 0 && (
                        <li className="text-sm text-dark-gray">
                          No answers were recorded for this attempt.
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ---- The list ----
  if (loading) {
    return <p className="py-8 text-center text-dark-gray">Loading student insights...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="relative max-w-md">
        <MagnifyingGlassIcon
          className="pointer-events-none absolute top-1/2 left-3 w-5 h-5 -translate-y-1/2
            text-dark-gray"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search students by name or email..."
          aria-label="Search students"
          className="bg-white pl-10 text-dark-gray"
        />
      </div>

      {scope === 'mine' && learners.length > 0 && (
        <p className="text-sm text-dark-gray">
          Showing people you assigned learning to. Admins see everyone.
        </p>
      )}

      {learners.length === 0 ? (
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>Nobody has been assigned learning yet.</p>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>No student matches &ldquo;{search}&rdquo;.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-4">
          {visible.map((learner) => (
            <Card
              key={learner.email}
              onClick={() => setOpenEmail(learner.email)}
              className="cursor-pointer bg-light-gray p-0 shadow-sm transition-all duration-200
                hover:-translate-y-0.5 hover:shadow-lg"
            >
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex items-center gap-3">
                  <UserCircleIcon className="w-9 h-9 shrink-0 text-navy" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-semibold text-dark-gray">
                      {learner.name ?? learner.email}
                    </span>
                    {learner.name && (
                      <span className="block break-all text-xs text-dark-gray">
                        {learner.email}
                      </span>
                    )}
                  </span>
                  {!learner.hasAccount && (
                    <Badge className="shrink-0 bg-new px-2 text-white">No account</Badge>
                  )}
                </div>

                {/* Scrollable so a learner with many courses stays one card
                    rather than a column of its own. */}
                {learner.courses.length === 0 ? (
                  <p className="text-xs text-dark-gray">Nothing published yet.</p>
                ) : (
                  <ul className="flex max-h-28 flex-col gap-1.5 overflow-y-auto pr-1">
                    {learner.courses.map((course) => (
                      <MiniBar key={course.courseId} course={course} />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default StudentInsights;
