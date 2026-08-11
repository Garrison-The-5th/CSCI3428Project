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
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { NewBadge } from '@/components/common/new-badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useNewContent } from '@/contexts/new-content-context';
import { Course, imageSrc } from '@/services/curriculum-api';
import { useLearnerApi } from '@/services/learner-api';
import { logger } from '@/utils/logger';

const Quizzes = () => {
  const api = useLearnerApi();
  const navigate = useNavigate();
  const { newContentCourseIds } = useNewContent();
  const [courses, setCourses] = useState<Course[]>([]);
  const [attempted, setAttempted] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [courseList, progress] = await Promise.all([api.getCourses(), api.getProgress()]);
      setCourses(courseList);
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

  // Only courses that actually hold a quiz belong on this page.
  const withQuizzes = useMemo(
    () => courses.filter((course) => course.modules.some((module) => module.quizzes.length > 0)),
    [courses],
  );

  /**
   * Searches the quiz titles as well as the course's, because this page is
   * courses-as-containers: someone hunting for "Fire safety check" is naming a
   * quiz, and the card that holds it is the answer.
   */
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return withQuizzes;

    return withQuizzes.filter((course) =>
      [course.title, ...course.modules.flatMap((module) => module.quizzes.map((q) => q.title))]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [withQuizzes, search]);

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
          Pick a course to work through its quizzes.
        </p>
      </header>

      <hr className="mt-4 mb-8 h-0.5 border-t-0 bg-navy" />

      {error && <div className="mb-4 border-2 bg-danger p-4">{error}</div>}

      {withQuizzes.length > 0 && (
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

      {withQuizzes.length === 0 ? (
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>No quizzes have been published yet.</p>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>No quiz matches &ldquo;{search}&rdquo;.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-6">
          {visible.map((course) => {
            const cover = imageSrc(course.imageData, course.imageType);
            const quizzes = course.modules.flatMap((module) => module.quizzes);
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
