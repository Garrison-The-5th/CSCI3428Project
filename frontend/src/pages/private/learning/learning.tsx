/**
 * File: learning.tsx
 * Description: The grid of published courses.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * Learning - the grid of published courses.
 *
 * One portrait card per course: cover photo and title on top, lesson and quiz
 * counts along the bottom. Picking one opens its overview page.
 *
 * A course that has gained content since the learner started it, and that they
 * have not read yet, is marked — so the dot on the Learning tab in the sidebar
 * leads somewhere specific rather than just to this page.
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

/**
 * The learner's Learning tab: a grid of the courses assigned to them, with progress and "new"
 * marks.
 */
const Learning = () => {
  const api = useLearnerApi();
  const navigate = useNavigate();
  const { newContentCourseIds } = useNewContent();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchCourses = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setCourses(await api.getCourses());
    } catch (err) {
      logger.error('Error fetching courses:', err);
      setError('Failed to load the curriculum');
    } finally {
      setLoading(false);
    }
    // api is rebuilt each render; depending on it would loop.
  }, []);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  /**
   * Lessons only.
   *
   * A quiz set is a course underneath — one module nobody sees and a section per
   * quiz — which is what put it on this page alongside real lessons. It belongs
   * on the Quizzes tab, where it was created and where it reads as what it is,
   * so which tab a course appears on follows from what it was made as.
   */
  const lessons = useMemo(() => courses.filter((course) => course.kind !== 'QUIZ_SET'), [courses]);

  /**
   * Matches on more than the title. Someone looking for "manual handling" is as
   * likely to remember the tag or a section name as the course's own wording, and
   * a search that only reads titles quietly fails for them.
   */
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return lessons;

    return lessons.filter((course) =>
      [
        course.title,
        course.shortDescription ?? '',
        course.description ?? '',
        ...course.tags,
        ...course.sections.map((section) => `${section.number} ${section.title}`),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [lessons, search]);

  if (loading) {
    return (
      <div className="page-container flex flex-col">
        <div className="text-center">Loading curriculum...</div>
      </div>
    );
  }

  return (
    <div className="page-container flex flex-col">
      <header className="responsive-page-header">
        <h1 className="page-title font-bold text-dark-gray mb-2">Learning</h1>
        <p className="page-subtitle text-dark-gray font-medium">Choose a course to get started.</p>
      </header>

      <hr className="mt-4 mb-8 h-0.5 border-t-0 bg-navy" />

      {error && <div className="mb-4 border-2 bg-danger p-4">{error}</div>}

      {courses.length > 0 && (
        <div className="relative mb-6 max-w-md">
          <MagnifyingGlassIcon
            className="pointer-events-none absolute top-1/2 left-3 w-5 h-5 -translate-y-1/2
              text-dark-gray"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search courses, tags or sections..."
            aria-label="Search courses"
            className="bg-white pl-10 text-dark-gray"
          />
        </div>
      )}

      {courses.length === 0 ? (
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>No courses have been published yet.</p>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>No course matches &ldquo;{search}&rdquo;.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-6">
          {visible.map((course) => {
            const cover = imageSrc(course.imageData, course.imageType);
            const quizCount = course.sections.reduce(
              (sum, section) => sum + section.quizzes.length,
              0,
            );
            const hasNew = newContentCourseIds.has(course.id);

            return (
              <Card
                key={course.id}
                onClick={() => navigate(`/learning/${course.id}`)}
                className={`relative flex aspect-[4/5] cursor-pointer flex-col gap-0 overflow-hidden
                  bg-light-gray p-0 shadow-sm transition-all duration-300 hover:-translate-y-1
                  hover:shadow-lg ${hasNew ? 'ring-2 ring-new' : ''}`}
              >
                {/* Sits over the cover rather than in the header, so it reads at
                    a glance across a grid instead of needing the title found first. */}
                {hasNew && (
                  <span
                    className="absolute top-3 right-3 z-10 flex h-4 w-4 rounded-full bg-new ring-2
                      ring-white"
                    role="status"
                    aria-label="New content you have not read yet"
                    title="New content you have not read yet"
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
                      {/* Past its deadline the course cannot be opened, so the
                          card says so here rather than let somebody click in and
                          find every way through greyed out. */}
                      {course.locked && (
                        <Badge className="w-fit bg-danger px-2 text-white">Closed</Badge>
                      )}
                      {course.required && !course.locked && (
                        <Badge className="w-fit bg-navy px-2 text-white">Required</Badge>
                      )}
                      {hasNew && <NewBadge label="New content" />}
                    </div>
                  </CardHeader>
                </div>

                <CardContent
                  className="flex items-center justify-between border-t border-gray-300 p-4 text-sm
                    font-medium text-dark-gray"
                >
                  <span>Lessons: {course.sections.length}</span>
                  <span>Quizzes: {quizCount}</span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Learning;
