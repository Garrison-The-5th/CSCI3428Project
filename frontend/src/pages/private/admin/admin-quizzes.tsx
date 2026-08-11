/**
 * File: admin-quizzes.tsx
 * Description: Authoring page for quizzes (admins and contributors).
 * Author: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Modified by: Jacob Matthews
 * Date: 2026-08-10
 */
/**
 * AdminQuizzes - authoring page for quizzes (admins and contributors).
 *
 * Grid view  : one card per lesson, searchable, showing how many modules and
 *              quizzes it has.
 * Lesson view: laid out like the course content page but showing only quizzes —
 *              the lesson's modules in a rail on the right, the selected
 *              module's quizzes in the editor on the left. Quizzes are multiple
 *              choice only and belong to exactly one module, so a lesson's quiz
 *              set is the quizzes across its modules.
 *
 * Quizzes with no module (created before that rule) get their own section with a
 * picker to move them into one.
 */
import {
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useState } from 'react';

import ConfirmDialog from '@/components/common/confirm-dialog';
import QuizEditor from '@/components/common/quiz-editor';
import ToastNotification from '@/components/common/toast-notification';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Course,
  curriculumApi,
  imageSrc,
  sectionGroups,
  sectionTint,
} from '@/services/curriculum-api';
import { Quiz, quizApi } from '@/services/quiz-api';
import { logger } from '@/utils/logger';

type Toast = { show: boolean; message: string; type: 'success' | 'error' };

const inputClass = 'bg-white text-dark-gray';
const primaryBtn = 'bg-navy text-white hover:bg-navy-hover';
const selectClass = 'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-dark-gray';

const AdminQuizzes = () => {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast>({ show: false, message: '', type: 'success' });

  const [openCourseId, setOpenCourseId] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  /** New-quiz title, keyed by module id. */
  const [newQuizTitles, setNewQuizTitles] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null);

  const notify = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ show: true, message, type });

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      // Author views so drafts are visible and answers come back for editing.
      const [quizList, courseList] = await Promise.all([
        quizApi.getQuizzesForAuthor(),
        curriculumApi.getCoursesForAuthor(),
      ]);
      setQuizzes(quizList);
      setCourses(courseList);
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

  const run = async (action: () => Promise<unknown>, successMessage: string, failure: string) => {
    try {
      await action();
      await fetchAll();
      notify(successMessage);
      return true;
    } catch (err) {
      logger.error(`${failure}:`, err);
      notify(failure, 'error');
      return false;
    }
  };

  const quizzesForModule = useCallback(
    (moduleId: string) => quizzes.filter((quiz) => quiz.moduleId === moduleId),
    [quizzes],
  );

  const quizCountForCourse = useCallback(
    (course: Course) =>
      course.modules.reduce((sum, module) => sum + quizzesForModule(module.id).length, 0),
    [quizzesForModule],
  );

  /** Quizzes predating the "must belong to a module" rule. */
  const orphanQuizzes = quizzes.filter((quiz) => !quiz.moduleId);

  const openCourse = courses.find((course) => course.id === openCourseId) ?? null;

  // Keep a module selected so the editor pane is never blank on arrival.
  useEffect(() => {
    if (!openCourse) return;
    const stillThere = openCourse.modules.some((module) => module.id === selectedModuleId);
    if (!stillThere) setSelectedModuleId(openCourse.modules[0]?.id ?? null);
  }, [openCourse, selectedModuleId]);

  const selectedModule =
    openCourse?.modules.find((module) => module.id === selectedModuleId) ?? null;

  /** Searches lesson titles and the titles of the quizzes inside them. */
  const visibleCourses = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return courses;

    return courses.filter((course) =>
      [
        course.title,
        ...course.modules.flatMap((module) => [
          module.title,
          ...quizzesForModule(module.id).map((quiz) => quiz.title),
        ]),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [courses, search, quizzesForModule]);

  const handleCreateQuiz = async (moduleId: string) => {
    const title = (newQuizTitles[moduleId] ?? '').trim();
    if (!title) return notify('Quiz needs a title', 'error');

    const ok = await run(
      () => quizApi.createQuiz({ title, moduleId }),
      `Quiz "${title}" created`,
      'Failed to create quiz',
    );
    if (ok) setNewQuizTitles((prev) => ({ ...prev, [moduleId]: '' }));
  };

  /**
   * Starts a section that has no modules yet.
   *
   * A quiz has to live in a module, so an empty section cannot take one
   * directly. Rather than sending the author to the lesson editor to make a
   * module first and come back, the module is created here and named after the
   * quiz — which is almost always what it would have been called anyway, and is
   * renameable in the lesson editor if not.
   */
  const handleCreateInEmptySection = async (sectionId: string) => {
    const title = (newQuizTitles[sectionId] ?? '').trim();
    if (!title) return notify('Quiz needs a title', 'error');
    if (!openCourse) return;

    const ok = await run(
      async () => {
        const created = await curriculumApi.createModule(openCourse.id, {
          sectionId,
          title,
          estimatedMinutes: 0,
        });
        const moduleId = created?.module?.id;
        if (!moduleId) throw new Error('The module could not be created');
        await quizApi.createQuiz({ title, moduleId });
        setSelectedModuleId(moduleId);
      },
      `Module and quiz "${title}" created`,
      'Failed to create the quiz',
    );

    if (ok) setNewQuizTitles((prev) => ({ ...prev, [sectionId]: '' }));
  };

  const deleteDialog = (
    <ConfirmDialog
      open={pendingDelete !== null}
      title="Delete quiz"
      message={
        <>
          Delete <span className="font-semibold">{pendingDelete?.label}</span> and all of its
          questions?
          <br />
          You can restore it from the Admin Dashboard.
        </>
      }
      onConfirm={async () => {
        const target = pendingDelete;
        setPendingDelete(null);
        if (target) {
          await run(
            () => quizApi.deleteQuiz(target.id),
            'Quiz moved to the recycle bin',
            'Failed to delete quiz',
          );
        }
      }}
      onCancel={() => setPendingDelete(null)}
    />
  );

  const toast_ = (
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

  // ---- Lesson detail: module rail on the right, quiz editor on the left ----
  if (openCourse) {
    const moduleQuizzes = selectedModule ? quizzesForModule(selectedModule.id) : [];

    return (
      <div className="page-container flex flex-col">
        <Button
          onClick={() => setOpenCourseId(null)}
          variant="ghost"
          className="mb-4 w-fit gap-2 px-0 text-dark-gray hover:text-green-hover"
        >
          <ArrowLeftIcon className="w-5 h-5" /> All lessons
        </Button>

        <header className="responsive-page-header">
          <h1 className="page-title font-bold text-dark-gray mb-2">{openCourse.title}</h1>
          <p className="page-subtitle text-dark-gray font-medium">
            Pick a module on the right to build its quizzes. A module can hold as many as you need.
          </p>
        </header>

        <hr className="mt-4 mb-8 h-0.5 border-t-0 bg-navy" />

        {openCourse.modules.length === 0 ? (
          <Card className="bg-light-gray">
            <CardContent className="py-16 text-center">
              <p>
                This lesson has no modules yet. Add one on Create a Lesson, then come back to build
                its quizzes.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            {/* ---- Quiz editor for the selected module ---- */}
            <div className="flex min-w-0 flex-col gap-6">
              {!selectedModule ? (
                <Card className="bg-light-gray">
                  <CardContent className="py-16 text-center">
                    <p>Pick a module to edit its quizzes.</p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <Card className="bg-light-gray shadow-sm">
                    <CardHeader className="p-4">
                      <CardTitle className="text-lg text-dark-gray">
                        {selectedModule.number} {selectedModule.title}
                      </CardTitle>
                      <p className="text-sm text-dark-gray">
                        {moduleQuizzes.length} quiz{moduleQuizzes.length === 1 ? '' : 'zes'} in this
                        module
                      </p>
                    </CardHeader>

                    <CardContent>
                      {/* Add another quiz to this module */}
                      <div
                        className="flex flex-wrap items-center gap-3 rounded-lg border-2
                          border-dashed border-navy/30 p-4"
                      >
                        <Input
                          value={newQuizTitles[selectedModule.id] ?? ''}
                          onChange={(e) =>
                            setNewQuizTitles((prev) => ({
                              ...prev,
                              [selectedModule.id]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) =>
                            e.key === 'Enter' && handleCreateQuiz(selectedModule.id)
                          }
                          placeholder={`New quiz for ${selectedModule.number} ${selectedModule.title}`}
                          className={`${inputClass} min-w-60 flex-1`}
                        />
                        <Button
                          onClick={() => handleCreateQuiz(selectedModule.id)}
                          className={primaryBtn}
                        >
                          <PlusIcon className="w-5 h-5 stroke-2" /> Add Quiz
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {moduleQuizzes.length === 0 ? (
                    <Card className="bg-light-gray">
                      <CardContent className="py-16 text-center">
                        <p>No quizzes in this module yet. Add one above.</p>
                      </CardContent>
                    </Card>
                  ) : (
                    moduleQuizzes.map((quiz) => (
                      <Card
                        key={quiz.id}
                        className="gap-4 border border-gray-300 bg-white shadow-sm"
                      >
                        <CardContent className="p-4">
                          <QuizEditor
                            quiz={quiz}
                            onChanged={fetchAll}
                            onNotify={notify}
                            onDeleteQuiz={() =>
                              setPendingDelete({ id: quiz.id, label: quiz.title })
                            }
                          />
                        </CardContent>
                      </Card>
                    ))
                  )}
                </>
              )}
            </div>

            {/* ---- Module rail, mirroring the course content page ---- */}
            <aside className="lg:sticky lg:top-20 lg:self-start">
              <Card className="gap-0 bg-light-gray p-0 shadow-sm">
                <div className="border-b border-gray-300 p-4">
                  <h2 className="font-semibold text-dark-gray">Modules</h2>
                  <p className="text-sm text-dark-gray">
                    {openCourse.modules.length} module
                    {openCourse.modules.length === 1 ? '' : 's'} · {quizCountForCourse(openCourse)}{' '}
                    quiz
                    {quizCountForCourse(openCourse) === 1 ? '' : 'zes'}
                  </p>
                </div>

                <div className="max-h-[70vh] overflow-y-auto p-2">
                  {sectionGroups(openCourse).map((group) => (
                    <div key={group.section.id} className="mb-3">
                      <h3
                        className={`rounded-md border-l-4 px-2 py-1 text-xs font-bold uppercase
                          tracking-wide text-dark-gray
                          ${group.section.color ? '' : 'border-l-navy/30 bg-navy/5'}`}
                        style={sectionTint(group.section.color)}
                      >
                        {group.section.number}. {group.section.title}
                      </h3>

                      <ul className="mt-1 flex flex-col">
                        {group.modules.map((module) => {
                          const count = quizzesForModule(module.id).length;

                          return (
                            <li key={module.id}>
                              <button
                                onClick={() => setSelectedModuleId(module.id)}
                                className={`flex w-full items-center gap-2 rounded-md px-3 py-2
                                  text-left text-sm ${
                                    module.id === selectedModuleId
                                      ? 'bg-white font-semibold text-dark-gray'
                                      : 'text-dark-gray hover:bg-white/60'
                                  }`}
                              >
                                <span className="min-w-0 flex-1 truncate">
                                  {module.number} {module.title}
                                </span>
                                <span
                                  className={`shrink-0 rounded-full px-2 text-xs
                                    ${count > 0 ? 'bg-navy text-white' : 'bg-gray-300 text-dark-gray'}`}
                                >
                                  {count}
                                </span>
                              </button>
                            </li>
                          );
                        })}

                        {group.modules.length === 0 && (
                          // An empty section is workable rather than a dead end:
                          // typing a title here creates the first module and the
                          // quiz together.
                          <li
                            className="flex flex-col gap-2 rounded-md border-2 border-dashed
                              border-navy/30 p-2"
                          >
                            <span className="text-xs text-dark-gray">
                              Empty section — name a quiz and its first module is made for you.
                            </span>
                            <Input
                              value={newQuizTitles[group.section.id] ?? ''}
                              onChange={(e) =>
                                setNewQuizTitles((prev) => ({
                                  ...prev,
                                  [group.section.id]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) =>
                                e.key === 'Enter' && handleCreateInEmptySection(group.section.id)
                              }
                              placeholder="New quiz title"
                              className={`${inputClass} h-8`}
                            />
                            <Button
                              onClick={() => handleCreateInEmptySection(group.section.id)}
                              className={`${primaryBtn} h-8`}
                            >
                              <PlusIcon className="w-4 h-4 stroke-2" /> Add quiz
                            </Button>
                          </li>
                        )}
                      </ul>
                    </div>
                  ))}
                </div>
              </Card>
            </aside>
          </div>
        )}

        {deleteDialog}
        {toast_}
      </div>
    );
  }

  // ---- Lesson grid ----
  return (
    <div className="page-container flex flex-col">
      <header className="responsive-page-header">
        <h1 className="page-title font-bold text-dark-gray mb-2">Create a Quiz</h1>
        <p className="page-subtitle text-dark-gray font-medium">
          Pick a lesson to build its quizzes. Every quiz belongs to one of the lesson&rsquo;s
          modules.
        </p>
      </header>

      <hr className="mt-4 mb-8 h-0.5 border-t-0 bg-navy" />

      {courses.length > 0 && (
        <div className="relative mb-6 max-w-md">
          <MagnifyingGlassIcon
            className="pointer-events-none absolute top-1/2 left-3 w-5 h-5 -translate-y-1/2
              text-dark-gray"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search lessons or quizzes..."
            aria-label="Search lessons and quizzes"
            className={`${inputClass} pl-10`}
          />
        </div>
      )}

      {courses.length === 0 ? (
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>No lessons yet. Create one on Create a Lesson first.</p>
          </CardContent>
        </Card>
      ) : visibleCourses.length === 0 ? (
        <Card className="bg-light-gray">
          <CardContent className="py-16 text-center">
            <p>Nothing matches &ldquo;{search}&rdquo;.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-6">
          {visibleCourses.map((course) => {
            const cover = imageSrc(course.imageData, course.imageType);
            const quizCount = quizCountForCourse(course);

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
                    <span className="text-sm text-dark-gray">No photo</span>
                  )}
                </div>

                <CardHeader className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="break-words text-lg text-dark-gray">
                      {course.title}
                    </CardTitle>
                    {!course.published && (
                      <Badge className="bg-gray-400 px-2 text-white">Draft</Badge>
                    )}
                  </div>
                </CardHeader>

                <CardContent
                  className="flex items-center justify-between border-t border-gray-300 p-4 text-sm
                    font-medium text-dark-gray"
                >
                  <span>Modules: {course.modules.length}</span>
                  <span>Quizzes: {quizCount}</span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Quizzes left over from before quizzes had to belong to a module */}
      {orphanQuizzes.length > 0 && (
        <Card className="mt-8 border-2 border-danger/40 bg-light-gray shadow-sm">
          <CardHeader className="p-4">
            <CardTitle className="text-lg text-dark-gray">Not attached to a module</CardTitle>
            <p className="text-sm text-dark-gray">
              Learners cannot see these. Pick a module to move each one into, or delete it.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {orphanQuizzes.map((quiz) => (
              <div
                key={quiz.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-300
                  bg-white px-4 py-3"
              >
                <span className="min-w-0 flex-1 break-words font-semibold text-dark-gray">
                  {quiz.title}
                </span>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (!e.target.value) return;
                    run(
                      () => quizApi.updateQuiz(quiz.id, { moduleId: e.target.value }),
                      `"${quiz.title}" moved into a module`,
                      'Failed to move quiz',
                    );
                  }}
                  className={selectClass}
                >
                  <option value="">Move to module...</option>
                  {courses.map((course) => (
                    <optgroup key={course.id} label={course.title}>
                      {course.modules.map((module) => (
                        <option key={module.id} value={module.id}>
                          {module.number} {module.title}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <Button
                  onClick={() => setPendingDelete({ id: quiz.id, label: quiz.title })}
                  variant="ghost"
                  size="icon"
                  className="hover:text-danger-hover"
                  title="Delete quiz"
                >
                  <TrashIcon className="w-5 h-5" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {deleteDialog}
      {toast_}
    </div>
  );
};

export default AdminQuizzes;
