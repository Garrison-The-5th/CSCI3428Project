/**
 * File: admin-learning.tsx
 * Description: The lesson library.
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-09-22
 */
/**
 * AdminLearning - the lesson library.
 *
 * Courses show as cards laid out like the Learning page, split into published and
 * drafts. Creating one drops you into its editor; clicking a card opens it. The
 * editor lives on its own route and is only reachable from here.
 */
import {
  AdjustmentsHorizontalIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import ToastNotification from '@/components/common/toast-notification';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Course, curriculumApi, imageSrc } from '@/services/curriculum-api';
import { logger } from '@/utils/logger';

type Toast = { show: boolean; message: string; type: 'success' | 'error' };

/**
 * Which lessons to show.
 *
 * The page already splits its cards into Published and Drafts, so a filter here
 * hides one of those sections rather than reshuffling the cards — someone who
 * picks Drafts is saying "stop showing me the published ones", and a page that
 * answered by merging both into one grid would have ignored them.
 */
type Filter = 'all' | 'published' | 'drafts';

/*
  Published and draft, and nothing else.

  There was a Required option here too. It never narrowed this page in the way
  the other two do — required is not a state a lesson is *instead of* published
  or draft, so picking it left both sections standing and only thinned the cards
  inside them — and the Required badge on each card already says the same thing
  without a mode to be in. Whether a lesson is required is set on its own landing
  page, which is where an author changes it.
*/
const FILTERS: Array<{ key: Filter; label: string; hint: string }> = [
  { key: 'all', label: 'Everything', hint: 'Every lesson, published and draft' },
  { key: 'published', label: 'Published', hint: 'Live, and reachable by whoever holds them' },
  { key: 'drafts', label: 'Drafts', hint: 'Not published, so no learner can reach them yet' },
];

const inputClass = 'bg-white text-dark-gray';
const primaryBtn = 'bg-navy text-white hover:bg-navy-hover';

/**
 * The author's Learning page: every lesson course they may edit, filterable, as cards that open the
 * editor.
 */
const AdminLearning = () => {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast>({ show: false, message: '', type: 'success' });

  const [newCourseTitle, setNewCourseTitle] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filtersRef = useRef<HTMLDivElement>(null);

  /** Shows a toast. */
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

  // Clicking away closes the filter menu, which is what a menu is expected to do.
  useEffect(() => {
    if (!filtersOpen) return;
    const onClick = (event: MouseEvent) => {
      if (!filtersRef.current?.contains(event.target as Node)) setFiltersOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [filtersOpen]);

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
   * Lessons only.
   *
   * A quiz set is a course underneath — one module nobody sees and a section per
   * quiz — which is what had them turning up on this page beside real lessons,
   * where nothing about the card describes what they are. They are made and
   * edited on the Quizzes tab, and that is the only place they belong.
   */
  const lessons = useMemo(() => courses.filter((course) => course.kind !== 'QUIZ_SET'), [courses]);

  /**
   * Searches across both states at once, then splits.
   *
   * Filtering before the split rather than after is what makes the two counts
   * honest while a search is active: "Published (1)" then means one match, not
   * one course that happens to be published somewhere in the library.
   */
  const matching = useMemo(() => {
    const query = search.trim().toLowerCase();

    return lessons.filter((course) => {
      if (!query) return true;
      return [
        course.title,
        course.shortDescription ?? '',
        ...course.tags,
        ...course.sections.map((section) => `${section.number} ${section.title}`),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [lessons, search, filter]);

  /** Which of the two sections to draw. Each filter hides the one it is not about. */
  const showPublished = filter === 'all' || filter === 'published';
  const showDrafts = filter === 'all' || filter === 'drafts';

  const published = matching.filter((course) => course.published);
  const drafts = matching.filter((course) => !course.published);
  const activeFilter = FILTERS.find((entry) => entry.key === filter)!;

  /** One course's card: cover, title, counts and status. */
  const courseCard = (course: Course) => {
    const cover = imageSrc(course.imageData, course.imageType);
    const quizCount = course.sections.reduce((sum, section) => sum + section.quizzes.length, 0);

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
          <span>Sections: {course.sections.length}</span>
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

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1 sm:max-w-md">
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

        <div ref={filtersRef} className="relative">
          <Button
            onClick={() => setFiltersOpen((open) => !open)}
            variant="outline"
            aria-expanded={filtersOpen}
            aria-haspopup="menu"
            className="gap-2 bg-white text-dark-gray hover:bg-light-gray"
          >
            <AdjustmentsHorizontalIcon className="w-5 h-5" />
            Filters
            {filter !== 'all' && (
              <Badge className="bg-navy px-2 text-white">{activeFilter.label}</Badge>
            )}
          </Button>

          {filtersOpen && (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-gray-300 bg-white
                p-1 shadow-lg"
            >
              {FILTERS.map((entry) => (
                <button
                  key={entry.key}
                  role="menuitemradio"
                  aria-checked={filter === entry.key}
                  onClick={() => {
                    setFilter(entry.key);
                    setFiltersOpen(false);
                  }}
                  className={`flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left ${
                    filter === entry.key
                      ? 'bg-navy text-white'
                      : 'text-dark-gray hover:bg-light-gray'
                  }`}
                >
                  <span className="text-sm font-semibold">{entry.label}</span>
                  <span
                    className={`text-xs
                    ${filter === entry.key ? 'text-white/80' : 'text-dark-gray'}`}
                  >
                    {entry.hint}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
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

      {lessons.length === 0 ? (
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>No lessons yet. Create one above to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-10">
          {/* Both sections filtered by the same search, so the counts in these
              headings are honest while one is running: "Published (1)" means one
              match, not one course that happens to be published somewhere. */}
          {showPublished && (
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
          )}

          {showDrafts && (
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
          )}
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
