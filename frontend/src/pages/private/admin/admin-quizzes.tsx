/**
 * File: admin-quizzes.tsx
 * Description: Authoring page for quizzes (admins and contributors).
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-13
 */
/**
 * AdminQuizzes — where quizzes are written.
 *
 * Grid view: one card per quiz. What the author calls a quiz is a QUIZ_SET
 * underneath — a course with a quiz per section and no elements — and the words
 * "quiz set" are deliberately absent from everything they read here. The
 * distinction is ours, not theirs: they named a quiz, and the questions inside
 * it are its questions.
 *
 * Detail view: the same shell as Create a Lesson. Every sidebar tab is there;
 * the one showing the course structure over there shows the quiz builder here.
 * That is the whole difference, which is what keeps the two from drifting.
 */
import {
  AdjustmentsHorizontalIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import ToastNotification from '@/components/common/toast-notification';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import CourseEditor from '@/pages/private/admin/course-editor';
import { Course, curriculumApi, imageSrc } from '@/services/curriculum-api';
import { logger } from '@/utils/logger';

type Toast = { show: boolean; message: string; type: 'success' | 'error' };

/**
 * Which cards to show.
 *
 * The two that sorted lessons from quizzes are gone, because this page no
 * longer holds both. A quiz written inside a lesson belongs to that lesson — it
 * follows on from the content either side of it — and is edited there, on the
 * lesson's own Quiz pane. Listing it here as well made the same quiz appear in
 * two places and invited it to be treated as a thing of its own, which it is
 * not. What a course is shows on the tab it was created on, and nowhere else.
 */
type Filter = 'all' | 'drafts' | 'published';

const FILTERS: Array<{ key: Filter; label: string; hint: string }> = [
  { key: 'all', label: 'Everything', hint: 'Every quiz' },
  { key: 'drafts', label: 'Drafts', hint: 'Not published, so no learner can reach them yet' },
  { key: 'published', label: 'Published', hint: 'Live, and reachable by whoever holds them' },
];

const inputClass = 'bg-white text-dark-gray';
const primaryBtn = 'bg-navy text-white hover:bg-navy-hover';

/**
 * The author's Quizzes page: every quiz set they may edit, filterable, with a form to create a new
 * one and an editor that opens in place.
 */
const AdminQuizzes = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast>({ show: false, message: '', type: 'success' });

  const [openCourseId, setOpenCourseId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const filtersRef = useRef<HTMLDivElement>(null);

  /** Shows a toast. */
  const notify = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ show: true, message, type });

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      // Author view, so drafts are visible and answers come back for editing.
      setCourses(await curriculumApi.getCoursesForAuthor());
    } catch (err) {
      logger.error('Error fetching quizzes:', err);
      notify('Failed to load quizzes', 'error');
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

  /** How many quizzes a set holds. */
  const quizCount = (course: Course) =>
    course.sections.reduce((sum, section) => sum + section.quizzes.length, 0);

  /**
   * How long the whole thing takes.
   *
   * A quiz carries its estimate per section, because that is where the
   * author types it. A lesson's own minutes cover its reading as well as its
   * quizzes, so for a lesson this counts only the quizzes' own time limits —
   * otherwise the figure on a quiz card would describe the lesson, not the
   * quizzes in it.
   */
  const totalMinutes = (course: Course) =>
    course.kind === 'QUIZ_SET'
      ? course.sections.reduce((sum, section) => sum + section.estimatedMinutes, 0)
      : course.sections.reduce(
          (sum, section) =>
            sum + section.quizzes.reduce((n, quiz) => n + (quiz.timeLimitMinutes ?? 0), 0),
          0,
        );

  /** Creates a quiz set with the typed name and opens it in the editor. */
  const createQuizSet = async () => {
    const title = newTitle.trim();
    if (!title) return notify('Give the quiz a name', 'error');

    try {
      setCreating(true);
      const created = await curriculumApi.createQuizSet(title);
      setNewTitle('');
      await fetchAll();
      notify(`"${title}" created`);
      // Straight into it, because naming something is only ever the first step.
      if (created?.course?.id) setOpenCourseId(created.course.id);
    } catch (err) {
      logger.error('Failed to create quiz:', err);
      notify(err instanceof Error && err.message ? err.message : 'Failed to create', 'error');
    } finally {
      setCreating(false);
    }
  };

  /**
   * The cards, filtered and searched.
   *
   * Quizzes proper, and only those — a lesson's quizzes are edited on that
   * lesson's own Quiz pane, where the content they were written against is. An
   * empty one is still kept, or a quiz just created would vanish before it could
   * be filled.
   */
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();

    return courses
      .filter((course) => course.kind === 'QUIZ_SET')
      .filter((course) =>
        filter === 'drafts' ? !course.published : filter === 'published' ? course.published : true,
      )
      .filter((course) => {
        if (!query) return true;
        return [
          course.title,
          ...course.sections.flatMap((section) => [
            section.title,
            ...section.quizzes.map((quiz) => quiz.title),
          ]),
        ]
          .join(' ')
          .toLowerCase()
          .includes(query);
      });
  }, [courses, search, filter]);

  const toastNode = (
    <ToastNotification
      show={toast.show}
      message={toast.message}
      type={toast.type}
      onClose={() => setToast((prev) => ({ ...prev, show: false }))}
    />
  );

  if (loading) {
    return (
      <div className="page-container flex flex-col">
        <div className="text-center">Loading quizzes...</div>
      </div>
    );
  }

  // ---- Detail: the Create a Lesson shell, with Quiz in place of Modules ----
  if (openCourseId) {
    return (
      <>
        <CourseEditor
          courseId={openCourseId}
          mode="quiz"
          onBack={() => {
            setOpenCourseId(null);
            fetchAll();
          }}
          backLabel="All quizzes"
        />
        {toastNode}
      </>
    );
  }

  const activeFilter = FILTERS.find((entry) => entry.key === filter)!;

  return (
    <div className="page-container flex flex-col">
      <header className="responsive-page-header">
        <h1 className="page-title font-bold text-dark-gray mb-2">Create a Quiz</h1>
        <p className="page-subtitle text-dark-gray font-medium">
          Name a quiz to start a new one, or pick one below to edit it.
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
            placeholder="Search quizzes..."
            aria-label="Search quizzes"
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

      {/* New quiz. Only a name — what kind each question set is gets decided
          per quiz inside, where the question is actually being asked. Solid
          border rather than dashed: this is a permanent part of the page, not a
          placeholder waiting to be filled. */}
      <div
        className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border-2 border-solid
          border-navy/30 p-4"
      >
        <Input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createQuizSet()}
          placeholder="Name a new quiz..."
          aria-label="New quiz name"
          className={`${inputClass} min-w-60 flex-1`}
        />
        <Button onClick={createQuizSet} disabled={creating} className={primaryBtn}>
          <PlusIcon className="w-5 h-5 stroke-2" /> {creating ? 'Creating...' : 'Add quiz'}
        </Button>
      </div>

      {visible.length === 0 ? (
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>
              {search.trim()
                ? `Nothing matches “${search}”.`
                : filter === 'all'
                  ? 'No quizzes yet. Name one above to start.'
                  : `Nothing under “${activeFilter.label}”.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-6">
          {visible.map((course) => {
            const cover = imageSrc(course.imageData, course.imageType);
            const quizzes = quizCount(course);
            const minutes = totalMinutes(course);
            const isSet = course.kind === 'QUIZ_SET';

            return (
              <Card
                key={course.id}
                onClick={() => setOpenCourseId(course.id)}
                className="flex cursor-pointer flex-col gap-0 overflow-hidden bg-light-gray p-0
                  shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="flex h-32 items-center justify-center overflow-hidden bg-navy/10">
                  {cover ? (
                    <img src={cover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-sm text-dark-gray">{isSet ? 'Quiz' : 'Lesson'}</span>
                  )}
                </div>

                <CardHeader className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="break-words text-lg text-dark-gray">
                      {course.title}
                    </CardTitle>
                    <Badge
                      className={
                        course.published ? 'bg-navy px-2 text-white' : 'bg-gray-400 px-2 text-white'
                      }
                    >
                      {course.published ? 'Published' : 'Draft'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-dark-gray">
                    {isSet ? 'Quiz' : 'Inside a lesson'}
                  </p>
                </CardHeader>

                <CardContent
                  className="flex items-center justify-between border-t border-gray-300 p-4 text-sm
                    font-medium text-dark-gray"
                >
                  <span>
                    {quizzes} quiz{quizzes === 1 ? '' : 'zes'}
                  </span>
                  <span>{minutes > 0 ? `${minutes} min` : 'Untimed'}</span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {toastNode}
    </div>
  );
};

export default AdminQuizzes;
