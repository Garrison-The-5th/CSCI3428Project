/**
 * File: quizzes.tsx
 * Description: The grid of courses that have quizzes.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Quizzes - the grid of courses that have quizzes.
 *
 * Laid out like the Learning page: one card per course showing how many quizzes
 * it holds and how many are still to do. Picking one opens the quiz player.
 */
import { MagnifyingGlassIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { NewBadge } from '@/components/common/new-badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useNewContent } from '@/contexts/new-content-context';
import { Course, imageSrc } from '@/services/curriculum-api';
import { useLearnerApi } from '@/services/learner-api';
import { Quiz, QUIZ_TYPE_LABELS } from '@/services/quiz-api';
import { logger } from '@/utils/logger';

const Quizzes = () => {
  const api = useLearnerApi();
  const navigate = useNavigate();
  const { newContentCourseIds } = useNewContent();
  const [courses, setCourses] = useState<Course[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [attempted, setAttempted] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // The quiz list is what carries anything standing on its own; the course
      // list carries everything that sits inside one. Both are needed because a
      // course card counts the quizzes inside it, which the flat list cannot say.
      const [courseList, quizList, progress] = await Promise.all([
        api.getCourses(),
        api.getQuizzes(),
        api.getProgress(),
      ]);
      setCourses(courseList);
      setQuizzes(quizList);
      setAttempted(new Set(progress.attemptedQuizIds));
    } catch (err) {
      logger.error('Error fetching quizzes:', err);
      setError('Failed to load quizzes');
    } finally {
      setLoading(false);
    }
    // api is rebuilt each render; depending on it would loop.
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /**
   * Quiz sets that actually hold a quiz.
   *
   * The kind is what decides, not whether there happen to be quizzes inside. A
   * lesson's quizzes belong to the lesson — they follow on from the reading
   * either side of them, and are taken in place from the Learning tab — so
   * listing them here offered the same quiz twice, once stripped of everything
   * it was written against. Which tab a course appears on now follows from which
   * tab it was created on, both ways round.
   */
  const withQuizzes = useMemo(
    () =>
      courses.filter(
        (course) =>
          course.kind === 'QUIZ_SET' &&
          course.sections.some((section) => section.quizzes.length > 0),
      ),
    [courses],
  );

  /**
   * Quizzes with no section behind them, which get a card of their own.
   *
   * The API has already dropped everything that should not be browsable — a
   * learning check, and any one-time quiz — so what is left here is exactly the
   * standalone exams this person has been given, including one shared to their
   * address that they later signed in with.
   */
  const standalone = useMemo(() => quizzes.filter((quiz) => quiz.sectionId === null), [quizzes]);

  /**
   * Searches the quiz titles as well as the course's, because this page is
   * courses-as-containers: someone hunting for "Fire safety check" is naming a
   * quiz, and the card that holds it is the answer.
   */
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return withQuizzes;

    return withQuizzes.filter((course) =>
      [course.title, ...course.sections.flatMap((section) => section.quizzes.map((q) => q.title))]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [withQuizzes, search]);

  const visibleStandalone = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return standalone;
    return standalone.filter((quiz) => quiz.title.toLowerCase().includes(query));
  }, [standalone, search]);

  const nothingAtAll = withQuizzes.length === 0 && standalone.length === 0;
  const nothingMatches = visible.length === 0 && visibleStandalone.length === 0;

  if (loading) {
    return (
      <div className="page-container flex flex-col">
        <div className="text-center">Loading quizzes...</div>
      </div>
    );
  }

  return (
    <div className="page-container flex flex-col">
      <header className="responsive-page-header">
        <h1 className="page-title font-bold text-dark-gray mb-2">Quizzes</h1>
        <p className="page-subtitle text-dark-gray font-medium">
          Pick a course to work through its quizzes, or take one that stands on its own.
        </p>
      </header>

      <hr className="mt-4 mb-8 h-0.5 border-t-0 bg-navy" />

      {error && <div className="mb-4 border-2 bg-danger p-4">{error}</div>}

      {!nothingAtAll && (
        <div className="relative mb-6 max-w-md">
          <MagnifyingGlassIcon
            className="pointer-events-none absolute top-1/2 left-3 w-5 h-5 -translate-y-1/2
              text-dark-gray"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search courses or quizzes..."
            aria-label="Search quizzes"
            className="bg-white pl-10 text-dark-gray"
          />
        </div>
      )}

      {nothingAtAll ? (
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>No quizzes have been published yet.</p>
          </CardContent>
        </Card>
      ) : nothingMatches ? (
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>No quiz matches &ldquo;{search}&rdquo;.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-6">
          {/* Quizzes with no course behind them. Same card shape so the page reads
              as one list, with the type in place of a cover photo — there is no
              course image to borrow. */}
          {visibleStandalone.map((quiz) => {
            const done = attempted.has(quiz.id);

            return (
              <Card
                key={quiz.id}
                onClick={() => navigate(`/quizzes/standalone/${quiz.id}`)}
                className="relative flex aspect-[4/5] cursor-pointer flex-col gap-0 overflow-hidden
                  bg-light-gray p-0 shadow-sm transition-all duration-300 hover:-translate-y-1
                  hover:shadow-lg"
              >
                <div className="flex min-h-0 flex-1 flex-col">
                  <div
                    className="flex h-1/2 flex-col items-center justify-center gap-2 overflow-hidden
                      bg-navy/10"
                  >
                    <QuestionMarkCircleIcon className="w-10 h-10 text-navy" />
                    <span className="text-sm font-medium text-dark-gray">
                      {QUIZ_TYPE_LABELS[quiz.type]}
                    </span>
                  </div>
                  <CardHeader className="p-4">
                    <CardTitle className="break-words text-lg text-dark-gray">
                      {quiz.title}
                    </CardTitle>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {done && <Badge className="w-fit bg-navy px-2 text-white">Completed</Badge>}
                    </div>
                  </CardHeader>
                </div>

                <CardContent
                  className="flex items-center justify-between border-t border-gray-300 p-4 text-sm
                    font-medium text-dark-gray"
                >
                  <span>
                    {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'}
                  </span>
                  <span>
                    {quiz.timeLimitMinutes === null ? 'Untimed' : `${quiz.timeLimitMinutes} min`}
                  </span>
                </CardContent>
              </Card>
            );
          })}

          {visible.map((course) => {
            const cover = imageSrc(course.imageData, course.imageType);
            const quizzes = course.sections.flatMap((section) => section.quizzes);
            const done = quizzes.filter((quiz) => attempted.has(quiz.id)).length;
            const hasNew = newContentCourseIds.has(course.id);

            return (
              <Card
                key={course.id}
                onClick={() => navigate(`/quizzes/${course.id}`)}
                className={`relative flex aspect-[4/5] cursor-pointer flex-col gap-0 overflow-hidden
                  bg-light-gray p-0 shadow-sm transition-all duration-300 hover:-translate-y-1
                  hover:shadow-lg ${hasNew ? 'ring-2 ring-new' : ''}`}
              >
                {hasNew && (
                  <span
                    className="absolute top-3 right-3 z-10 flex h-4 w-4 rounded-full bg-new ring-2
                      ring-white"
                    role="status"
                    aria-label="New quizzes you have not attempted yet"
                    title="New quizzes you have not attempted yet"
                  />
                )}

                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex h-1/2 items-center justify-center overflow-hidden bg-navy/10">
                    {cover ? (
                      <img src={cover} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-sm text-dark-gray">No photo</span>
                    )}
                  </div>
                  <CardHeader className="p-4">
                    <CardTitle className="break-words text-lg text-dark-gray">
                      {course.title}
                    </CardTitle>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {quizzes.length > 0 && done === quizzes.length && !hasNew && (
                        <Badge className="w-fit bg-navy px-2 text-white">All done</Badge>
                      )}
                      {/* "All done" and "New quizzes" would contradict each other,
                          so the newer fact wins. */}
                      {hasNew && <NewBadge label="New quizzes" />}
                    </div>
                  </CardHeader>
                </div>

                <CardContent
                  className="flex items-center justify-between border-t border-gray-300 p-4 text-sm
                    font-medium text-dark-gray"
                >
                  <span>Quizzes: {quizzes.length}</span>
                  <span>
                    Done: {done}/{quizzes.length}
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Quizzes;
