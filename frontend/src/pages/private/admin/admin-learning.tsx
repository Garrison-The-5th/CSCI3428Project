/**
 * File: admin-learning.tsx
 * Description: The lesson library.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * AdminLearning - the lesson library.
 *
 * Courses show as cards laid out like the Learning page, split into published and
 * drafts. Creating one drops you into its editor; clicking a card opens it. The
 * editor lives on its own route and is only reachable from here.
 */
import { MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import ToastNotification from '@/components/common/toast-notification';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Course, curriculumApi, imageSrc } from '@/services/curriculum-api';
import { logger } from '@/utils/logger';

type Toast = { show: boolean; message: string; type: 'success' | 'error' };

const inputClass = 'bg-white text-dark-gray';
const primaryBtn = 'bg-navy text-white hover:bg-navy-hover';

const AdminLearning = () => {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast>({ show: false, message: '', type: 'success' });

  const [newCourseTitle, setNewCourseTitle] = useState('');
  const [search, setSearch] = useState('');

  const notify = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ show: true, message, type });

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      setCourses(await curriculumApi.getCoursesForAuthor());
    } catch (err) {
      logger.error('Error fetching courses:', err);
      notify('Failed to load lessons', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /** Creating a lesson opens its editor straight away — there is nothing to see here. */
  const handleCreateCourse = async () => {
    if (!newCourseTitle.trim()) return notify('Give the lesson a name', 'error');
    try {
      const response = await curriculumApi.createCourse(newCourseTitle.trim());
      setNewCourseTitle('');
      navigate(`/admin/learning/${response.course.id}`);
    } catch (err) {
      logger.error('Failed to create lesson:', err);
      notify('Failed to create the lesson', 'error');
    }
  };

  /**
   * Searches across both states at once, then splits.
   *
   * Filtering before the split rather than after is what makes the two counts
   * honest while a search is active: "Published (1)" then means one match, not
   * one course that happens to be published somewhere in the library.
   */
  const matching = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return courses;

    return courses.filter((course) =>
      [
        course.title,
        course.shortDescription ?? '',
        ...course.tags,
        ...course.modules.map((module) => `${module.number} ${module.title}`),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [courses, search]);

  const published = matching.filter((course) => course.published);
  const drafts = matching.filter((course) => !course.published);

  const courseCard = (course: Course) => {
    const cover = imageSrc(course.imageData, course.imageType);
    const quizCount = course.modules.reduce((sum, module) => sum + module.quizzes.length, 0);

    return (
      <Card
        key={course.id}
        onClick={() => navigate(`/admin/learning/${course.id}`)}
        className="flex aspect-[4/5] cursor-pointer flex-col gap-0 overflow-hidden bg-light-gray p-0
          shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-1/2 items-center justify-center overflow-hidden bg-navy/10">
            {cover ? (
              <img src={cover} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-sm text-dark-gray">No photo</span>
            )}
          </div>
          <CardHeader className="p-4">
            <CardTitle className="break-words text-lg text-dark-gray">{course.title}</CardTitle>
            <div className="mt-2 flex flex-wrap gap-2">
              {course.required && <Badge className="bg-navy px-2 text-white">Required</Badge>}
              {!course.published && <Badge className="bg-gray-400 px-2 text-white">Draft</Badge>}
            </div>
          </CardHeader>
        </div>

        <CardContent
          className="flex items-center justify-between border-t border-gray-300 p-4 text-sm
            font-medium text-dark-gray"
        >
          <span>Modules: {course.modules.length}</span>
          <span>Quizzes: {quizCount}</span>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="page-container flex flex-col">
        <div className="text-center">Loading lessons...</div>
      </div>
    );
  }

  return (
    <div className="page-container flex flex-col">
      <header className="responsive-page-header">
        <h1 className="page-title font-bold text-dark-gray mb-2">Create a Lesson</h1>
        <p className="page-subtitle text-dark-gray font-medium">
          Pick a lesson to edit it, or start a new one.
        </p>
      </header>

      <hr className="mt-4 mb-8 h-0.5 border-t-0 bg-navy" />

      <div className="relative mb-6 max-w-md">
        <MagnifyingGlassIcon
          className="pointer-events-none absolute top-1/2 left-3 w-5 h-5 -translate-y-1/2
            text-dark-gray"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search lessons — drafts and published..."
          aria-label="Search lessons"
          className={`${inputClass} pl-10`}
        />
      </div>

      <Card className="mb-8 border-2 border-navy/30 bg-light-gray shadow-sm">
        <CardHeader className="p-4">
          <CardTitle className="text-lg text-dark-gray">New Lesson</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Input
            value={newCourseTitle}
            onChange={(e) => setNewCourseTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateCourse()}
            placeholder="Lesson name"
            className={`${inputClass} min-w-60 flex-1`}
          />
          <Button onClick={handleCreateCourse} className={primaryBtn}>
            <PlusIcon className="w-5 h-5 stroke-2" /> Create and edit
          </Button>
        </CardContent>
      </Card>

      {courses.length === 0 ? (
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>No lessons yet. Create one above to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-10">
          <section>
            <h2 className="mb-1 text-xl font-bold text-dark-gray">
              Published{published.length > 0 && ` (${published.length})`}
            </h2>
            <p className="mb-4 text-sm text-dark-gray">Visible to learners now.</p>
            {published.length === 0 ? (
              <p className="text-dark-gray">
                {search.trim() ? 'No published lesson matches that.' : 'Nothing published yet.'}
              </p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-6">
                {published.map(courseCard)}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-1 text-xl font-bold text-dark-gray">
              Drafts{drafts.length > 0 && ` (${drafts.length})`}
            </h2>
            <p className="mb-4 text-sm text-dark-gray">Hidden from learners until published.</p>
            {drafts.length === 0 ? (
              <p className="text-dark-gray">
                {search.trim() ? 'No draft matches that.' : 'No drafts.'}
              </p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-6">
                {drafts.map(courseCard)}
              </div>
            )}
          </section>
        </div>
      )}

      <ToastNotification
        show={toast.show}
        message={toast.message}
        type={toast.type}
        onClose={() => setToast((prev) => ({ ...prev, show: false }))}
      />
    </div>
  );
};

export default AdminLearning;
